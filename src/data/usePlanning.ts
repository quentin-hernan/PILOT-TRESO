import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountType, Invoice, OperationKind, PlannedOp, ProRole, Recurring } from '../types';
import { supabase } from '../lib/supabase';
import { makeDate } from '../lib/dates';
import { todayKey, ymdOfKey } from '../lib/forecast';
import { FIXED_CATEGORY_IDS, PERSONAL_CATEGORIES } from './categories';
import { initialInvoices, initialPlanned, personalRecurrings, proRecurrings } from './mock';

interface Options {
  live: boolean;
  account: AccountType;
  userId?: string;
  orgId?: string;
  role: ProRole;
  /** Appelé quand des opérations récurrentes viennent d'être créées (il faut alors recharger les opérations). */
  onRecurringApplied: () => void;
}

export interface RecurringDraft {
  label: string;
  kind: Recurring['kind'];
  amountCents: number;
  categoryId: string;
  dayOfMonth: number;
}

export interface InvoiceDraft {
  counterparty: string;
  label: string;
  amountCents: number;
  /** AAAA-MM-JJ */
  dueKey: string;
  direction: Invoice['direction'];
}

export interface PlannedDraft {
  kind: OperationKind;
  amountCents: number;
  categoryId: string;
  label: string;
  /** AAAA-MM-JJ */
  dateKey: string;
}

export interface PlanningApi {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  recurrings: Recurring[];
  /** Budget mensuel par catégorie (slug -> centimes). Compte particulier. */
  budgets: Map<string, number>;
  invoices: Invoice[];
  /** Opérations ponctuelles prévues à une date future. */
  planned: PlannedOp[];
  /** Renvoie l'identifiant créé. */
  addPlanned: (d: PlannedDraft) => Promise<string>;
  removePlanned: (id: string) => Promise<void>;
  /** Renvoie l'identifiant créé. */
  addRecurring: (d: RecurringDraft) => Promise<string>;
  updateRecurring: (id: string, d: RecurringDraft) => Promise<void>;
  setRecurringActive: (id: string, active: boolean) => Promise<void>;
  removeRecurring: (id: string) => Promise<void>;
  /** `null` = pas de budget pour cette catégorie. */
  setBudget: (categoryId: string, cents: number | null) => Promise<void>;
  /** Retire le budget de toutes les catégories. */
  clearBudgets: () => Promise<void>;
  /** Renvoie l'identifiant créé. */
  addInvoice: (d: InvoiceDraft) => Promise<string>;
  updateInvoice: (id: string, d: InvoiceDraft) => Promise<void>;
  setInvoiceStatus: (id: string, status: Invoice['status']) => Promise<void>;
  removeInvoice: (id: string) => Promise<void>;
}

interface RecRow {
  id: string;
  kind: 'depense' | 'recette';
  amount_cents: number;
  category_id: string | null;
  label: string;
  day_of_month: number;
  active: boolean;
  last_applied: string | null;
}

interface InvRow {
  id: string;
  counterparty: string;
  label: string;
  amount_cents: number;
  due_date: string;
  direction: 'a_encaisser' | 'a_payer';
  status: 'en_attente' | 'payee';
}

interface PlanRow {
  id: string;
  kind: 'depense' | 'recette';
  amount_cents: number;
  category_id: string | null;
  label: string;
  planned_date: string;
}
const PLAN_COLUMNS = 'id, kind, amount_cents, category_id, label, planned_date';
const NOT_READY_PLANNED = "Pour les dépenses prévues, exécutez le fichier supabase/migrations/0006_planned.sql dans Supabase.";

const REC_COLUMNS = 'id, kind, amount_cents, category_id, label, day_of_month, active, last_applied';
const INV_COLUMNS = 'id, counterparty, label, amount_cents, due_date, direction, status';

const keyToIso = (key: string): string => {
  const p = ymdOfKey(key);
  return makeDate(p.y, p.m, p.d).toISOString();
};

const NOT_READY = "La base n'est pas à jour : exécutez le fichier supabase/migrations/0003_planning.sql dans Supabase.";

/**
 * Récurrences, budgets par catégorie et factures.
 * - démo : données fictives en mémoire ;
 * - connecté : lecture / écriture Supabase. À l'ouverture, les opérations récurrentes arrivées à échéance sont créées
 *   par la base (fonction apply_recurrences), une seule fois même si plusieurs appareils sont ouverts.
 * Un employé n'a accès à rien de tout cela (règles de sécurité de la base).
 */
export function usePlanning({ live, account, userId, orgId, role, onRecurringApplied }: Options): PlanningApi {
  const personal = account === 'particulier';
  const hasAccess = personal || role === 'patron';

  const [recurrings, setRecurrings] = useState<Recurring[]>(() => (live ? [] : personal ? personalRecurrings : proRecurrings));
  const [invoices, setInvoices] = useState<Invoice[]>(() => (live || personal ? [] : initialInvoices()));
  const [budgetMap, setBudgetMap] = useState<Map<string, number>>(
    () => new Map(live ? [] : PERSONAL_CATEGORIES.filter((c) => c.budgetCents).map((c) => [c.id, c.budgetCents!])),
  );
  const [status, setStatus] = useState<PlanningApi['status']>(live && hasAccess ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<PlannedOp[]>(() => (live || !personal ? [] : initialPlanned()));
  const [slugToId, setSlugToId] = useState<Map<string, string>>(new Map());

  const scopeCol = personal ? 'owner_id' : 'org_id';
  const scopeVal = personal ? userId : orgId;

  const idToSlug = useMemo(() => new Map([...slugToId.entries()].map(([s, i]) => [i, s])), [slugToId]);

  const toRecurring = useCallback(
    (r: RecRow, i2s: Map<string, string>): Recurring => ({
      id: r.id,
      label: r.label,
      amountCents: Number(r.amount_cents),
      kind: r.kind,
      categoryId: (r.category_id && i2s.get(r.category_id)) || 'autre',
      dayOfMonth: r.day_of_month,
      active: r.active,
      lastApplied: r.last_applied ?? undefined,
    }),
    [],
  );

  const toInvoice = (r: InvRow): Invoice => ({
    id: r.id,
    counterparty: r.counterparty,
    label: r.label,
    amountCents: Number(r.amount_cents),
    dueDate: keyToIso(r.due_date),
    direction: r.direction,
    status: r.status,
  });

  // ───── Chargement (compte connecté) ─────
  useEffect(() => {
    if (!live || !supabase || !scopeVal || !hasAccess) return;
    const sb = supabase;
    let cancelled = false;
    (async () => {
      try {
        // 1. La base crée les opérations récurrentes arrivées à échéance.
        const applied = await sb.rpc('apply_recurrences');
        if (applied.error) {
          if (!cancelled) {
            setError(NOT_READY);
            setStatus('ready');
          }
          return;
        }
        let appliedCount = Number(applied.data);
        // les opérations prévues dont la date est arrivée deviennent de vraies opérations
        const plannedApplied = await sb.rpc('apply_planned');
        const plannedOk = !plannedApplied.error;
        if (plannedOk) appliedCount += Number(plannedApplied.data);
        if (appliedCount > 0 && !cancelled) onRecurringApplied();

        // 2. Lecture.
        const cats = await sb.from('categories').select('id, slug, budget_cents').eq(scopeCol, scopeVal);
        if (cats.error) throw new Error(cats.error.message);
        const s2i = new Map<string, string>(cats.data.map((c) => [c.slug as string, c.id as string]));
        const i2s = new Map<string, string>(cats.data.map((c) => [c.id as string, c.slug as string]));
        const recs = await sb.from('recurrences').select(REC_COLUMNS).eq(scopeCol, scopeVal).order('day_of_month');
        if (recs.error) throw new Error(recs.error.message);
        const plan = plannedOk ? await sb.from('planned_operations').select(PLAN_COLUMNS).eq(scopeCol, scopeVal).order('planned_date') : null;
        const invs = personal ? null : await sb.from('invoices').select(INV_COLUMNS).eq('org_id', scopeVal).order('due_date');
        if (invs?.error) throw new Error(invs.error.message);

        if (cancelled) return;
        setSlugToId(s2i);
        setBudgetMap(new Map(cats.data.filter((c) => c.budget_cents && !FIXED_CATEGORY_IDS.has(c.slug as string)).map((c) => [c.slug as string, Number(c.budget_cents)])));
        setRecurrings((recs.data as RecRow[]).map((r) => toRecurring(r, i2s)));
        setInvoices(invs ? (invs.data as InvRow[]).map(toInvoice) : []);
        setPlanned(plan && !plan.error ? (plan.data as PlanRow[]).map((r) => ({ id: r.id, kind: r.kind, amountCents: Number(r.amount_cents), categoryId: (r.category_id && i2s.get(r.category_id)) || 'autre', label: r.label, date: r.planned_date })) : []);
        if (!plannedOk || plan?.error) setError((e) => e ?? NOT_READY_PLANNED);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Chargement impossible.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onRecurringApplied est volontairement exclu : il ne doit pas relancer le chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hasAccess, personal, scopeCol, scopeVal, toRecurring]);

  const need = () => {
    if (!supabase || !scopeVal) throw new Error('Non connecté.');
    return { sb: supabase, scopeVal };
  };

  // ───── Récurrences ─────
  const addRecurring = useCallback(
    async (d: RecurringDraft): Promise<string> => {
      if (!live) {
        const id = `rec-${Date.now()}`;
        setRecurrings((l) => [...l, { id, ...d, active: true, lastApplied: todayKey() }]);
        return id;
      }
      const { sb, scopeVal: sv } = need();
      const { data, error: e } = await sb
        .from('recurrences')
        .insert({
          [scopeCol]: sv,
          kind: d.kind,
          amount_cents: d.amountCents,
          category_id: slugToId.get(d.categoryId) ?? null,
          label: d.label,
          day_of_month: d.dayOfMonth,
          // Les jours déjà passés ne sont pas recréés : la première opération arrive à la prochaine date.
          last_applied: todayKey(),
        })
        .select(REC_COLUMNS)
        .single();
      if (e) throw new Error(e.message);
      setRecurrings((l) => [...l, toRecurring(data as RecRow, idToSlug)]);
      return (data as RecRow).id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, scopeCol, scopeVal, slugToId, idToSlug, toRecurring],
  );

  const updateRecurring = useCallback(
    async (id: string, d: RecurringDraft) => {
      const previous = recurrings.find((r) => r.id === id);
      const dayChanged = previous?.dayOfMonth !== d.dayOfMonth;
      if (!live) {
        setRecurrings((l) => l.map((r) => (r.id === id ? { ...r, ...d, lastApplied: dayChanged ? todayKey() : r.lastApplied } : r)));
        return;
      }
      const { sb } = need();
      const { data, error: e } = await sb
        .from('recurrences')
        .update({
          kind: d.kind,
          amount_cents: d.amountCents,
          category_id: slugToId.get(d.categoryId) ?? null,
          label: d.label,
          day_of_month: d.dayOfMonth,
          ...(dayChanged ? { last_applied: todayKey() } : {}),
        })
        .eq('id', id)
        .select(REC_COLUMNS)
        .maybeSingle();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('Modification refusée.');
      setRecurrings((l) => l.map((r) => (r.id === id ? toRecurring(data as RecRow, idToSlug) : r)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, recurrings, slugToId, idToSlug, toRecurring],
  );

  const setRecurringActive = useCallback(
    async (id: string, active: boolean) => {
      // Une récurrence remise en route repart d'aujourd'hui : les mois de pause ne sont pas rattrapés.
      if (!live) {
        setRecurrings((l) => l.map((r) => (r.id === id ? { ...r, active, lastApplied: active ? todayKey() : r.lastApplied } : r)));
        return;
      }
      const { sb } = need();
      const { data, error: e } = await sb
        .from('recurrences')
        .update({ active, ...(active ? { last_applied: todayKey() } : {}) })
        .eq('id', id)
        .select(REC_COLUMNS)
        .maybeSingle();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('Modification refusée.');
      setRecurrings((l) => l.map((r) => (r.id === id ? toRecurring(data as RecRow, idToSlug) : r)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, idToSlug, toRecurring],
  );

  const removeRecurring = useCallback(
    async (id: string) => {
      if (live) {
        const { sb } = need();
        const { data, error: e } = await sb.from('recurrences').delete().eq('id', id).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Suppression refusée.');
      }
      setRecurrings((l) => l.filter((r) => r.id !== id));
    },
    [live],
  );

  // ───── Opérations prévues ─────
  const addPlanned = useCallback(
    async (d: PlannedDraft): Promise<string> => {
      if (!live) {
        const id = `pl-${Date.now()}`;
        setPlanned((l) => [...l, { id, kind: d.kind, amountCents: d.amountCents, categoryId: d.categoryId, label: d.label, date: d.dateKey }]);
        return id;
      }
      const { sb, scopeVal: sv } = need();
      const { data, error: e } = await sb
        .from('planned_operations')
        .insert({ [scopeCol]: sv, kind: d.kind, amount_cents: d.amountCents, category_id: slugToId.get(d.categoryId) ?? null, label: d.label, planned_date: d.dateKey })
        .select(PLAN_COLUMNS)
        .single();
      if (e) throw new Error(e.message.includes('planned_operations') ? NOT_READY_PLANNED : e.message);
      const r = data as PlanRow;
      setPlanned((l) => [...l, { id: r.id, kind: r.kind, amountCents: Number(r.amount_cents), categoryId: d.categoryId, label: r.label, date: r.planned_date }]);
      return r.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, scopeCol, slugToId],
  );

  const removePlanned = useCallback(
    async (id: string) => {
      if (live) {
        const { sb } = need();
        const { data, error: e } = await sb.from('planned_operations').delete().eq('id', id).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Suppression refusée.');
      }
      setPlanned((l) => l.filter((p) => p.id !== id));
    },
    [live],
  );

  // ───── Budgets ─────
  const setBudget = useCallback(
    async (categoryId: string, cents: number | null) => {
      if (live) {
        const { sb, scopeVal: sv } = need();
        const catId = slugToId.get(categoryId);
        if (!catId) throw new Error('Catégorie introuvable.');
        const { data, error: e } = await sb
          .from('categories')
          .update({ budget_cents: cents })
          .eq('id', catId)
          .eq(scopeCol, sv)
          .select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Modification refusée.');
      }
      setBudgetMap((m) => {
        const next = new Map(m);
        if (cents) next.set(categoryId, cents);
        else next.delete(categoryId);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, scopeCol, slugToId],
  );

  const clearBudgets = useCallback(async () => {
    if (live) {
      const { sb, scopeVal: sv } = need();
      const { error: e } = await sb.from('categories').update({ budget_cents: null }).eq(scopeCol, sv);
      if (e) throw new Error(e.message);
    }
    setBudgetMap(new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, scopeCol]);

  // ───── Factures ─────
  const addInvoice = useCallback(
    async (d: InvoiceDraft): Promise<string> => {
      if (!live) {
        const id = `inv-${Date.now()}`;
        setInvoices((l) => [
          ...l,
          { id, counterparty: d.counterparty, label: d.label, amountCents: d.amountCents, dueDate: keyToIso(d.dueKey), direction: d.direction, status: 'en_attente' },
        ]);
        return id;
      }
      const { sb, scopeVal: sv } = need();
      const { data, error: e } = await sb
        .from('invoices')
        .insert({ org_id: sv, counterparty: d.counterparty, label: d.label, amount_cents: d.amountCents, due_date: d.dueKey, direction: d.direction })
        .select(INV_COLUMNS)
        .single();
      if (e) throw new Error(e.message);
      setInvoices((l) => [...l, toInvoice(data as InvRow)]);
      return (data as InvRow).id;
    },
    [live],
  );

  const updateInvoice = useCallback(
    async (id: string, d: InvoiceDraft) => {
      if (!live) {
        setInvoices((l) =>
          l.map((i) => (i.id === id ? { ...i, counterparty: d.counterparty, label: d.label, amountCents: d.amountCents, dueDate: keyToIso(d.dueKey), direction: d.direction } : i)),
        );
        return;
      }
      const { sb } = need();
      const { data, error: e } = await sb
        .from('invoices')
        .update({ counterparty: d.counterparty, label: d.label, amount_cents: d.amountCents, due_date: d.dueKey, direction: d.direction })
        .eq('id', id)
        .select(INV_COLUMNS)
        .maybeSingle();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('Modification refusée.');
      setInvoices((l) => l.map((i) => (i.id === id ? toInvoice(data as InvRow) : i)));
    },
    [live],
  );

  const setInvoiceStatus = useCallback(
    async (id: string, st: Invoice['status']) => {
      if (live) {
        const { sb } = need();
        const { data, error: e } = await sb.from('invoices').update({ status: st }).eq('id', id).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Modification refusée.');
      }
      setInvoices((l) => l.map((i) => (i.id === id ? { ...i, status: st } : i)));
    },
    [live],
  );

  const removeInvoice = useCallback(
    async (id: string) => {
      if (live) {
        const { sb } = need();
        const { data, error: e } = await sb.from('invoices').delete().eq('id', id).select('id');
        if (e) throw new Error(e.message);
        if (!data || data.length === 0) throw new Error('Suppression refusée.');
      }
      setInvoices((l) => l.filter((i) => i.id !== id));
    },
    [live],
  );

  return {
    status,
    error,
    recurrings,
    budgets: budgetMap,
    invoices,
    planned,
    addPlanned,
    removePlanned,
    addRecurring,
    updateRecurring,
    setRecurringActive,
    removeRecurring,
    setBudget,
    clearBudgets,
    addInvoice,
    updateInvoice,
    setInvoiceStatus,
    removeInvoice,
  };
}
