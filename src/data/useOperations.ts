import { useCallback, useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AccountType, Operation, OperationDraft, ProRole } from '../types';
import { supabase } from '../lib/supabase';
import { initialPersonalOps, initialProOps, PRO_OPENING_CENTS } from './mock';

interface Options {
  /** true = compte connecté (Supabase), false = démonstration (données fictives locales). */
  live: boolean;
  account: AccountType;
  userId?: string;
  orgId?: string;
  role: ProRole;
}

export interface OperationsApi {
  ops: Operation[];
  status: 'loading' | 'ready' | 'error';
  /** Message d'erreur de chargement, ou avertissement (ex. base pas à jour). */
  error: string | null;
  /** Solde de départ en centimes. */
  openingCents: number;
  /** Renvoie l'identifiant de l'opération créée. */
  add: (draft: OperationDraft) => Promise<string>;
  update: (id: string, draft: OperationDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setOpening: (cents: number) => Promise<void>;
  /** Recharge les opérations depuis la base (après la création de récurrences, par exemple). */
  refresh: () => void;
}

interface Row {
  id: string;
  kind: 'depense' | 'recette';
  amount_cents: number;
  category_id: string | null;
  label: string;
  occurred_at: string;
  created_by: string;
}

const COLUMNS = 'id, kind, amount_cents, category_id, label, occurred_at, created_by';

const sortOps = (l: Operation[]) => [...l].sort((a, b) => b.date.localeCompare(a.date));

/**
 * Source unique des opérations pour l'application.
 * - démo : données fictives en mémoire ;
 * - connecté : lecture / écriture Supabase (règles RLS côté base) + mises à jour en temps réel.
 */
export function useOperations({ live, account, userId, orgId, role }: Options): OperationsApi {
  const personal = account === 'particulier';
  const [ops, setOps] = useState<Operation[]>(() => (live ? [] : personal ? initialPersonalOps() : initialProOps()));
  const [openingCents, setOpeningCents] = useState(live || personal ? 0 : PRO_OPENING_CENTS);
  const [status, setStatus] = useState<OperationsApi['status']>(live ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  // slug de catégorie (côté appli) <-> identifiant de catégorie (côté base)
  const [slugToId, setSlugToId] = useState<Map<string, string>>(new Map());

  const scopeCol = personal ? 'owner_id' : 'org_id';
  const scopeVal = personal ? userId : orgId;

  const toOp = useCallback(
    (r: Row, idToSlug: Map<string, string>, fresh = false): Operation => ({
      id: r.id,
      kind: r.kind,
      amountCents: Number(r.amount_cents),
      categoryId: (r.category_id && idToSlug.get(r.category_id)) || 'autre',
      label: r.label,
      date: r.occurred_at,
      author: personal ? undefined : r.created_by === userId ? role : 'employe',
      fresh,
    }),
    [personal, userId, role],
  );

  /** Retire la surbrillance « nouvelle opération » au bout de 2 s. */
  const unfreshLater = useCallback(() => {
    setTimeout(() => setOps((l) => l.map((o) => (o.fresh ? { ...o, fresh: false } : o))), 2000);
  }, []);

  // ───── Chargement + temps réel (compte connecté) ─────
  useEffect(() => {
    if (!live || !supabase || !userId) return;
    const sb = supabase;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        if (!scopeVal) throw new Error('Organisation introuvable.');
        const cats = await sb.from('categories').select('id, slug').eq(scopeCol, scopeVal);
        if (cats.error) throw new Error(cats.error.message);
        const s2i = new Map<string, string>(cats.data.map((c) => [c.slug as string, c.id as string]));
        const i2s = new Map<string, string>(cats.data.map((c) => [c.id as string, c.slug as string]));

        const rows = await sb
          .from('operations')
          .select(COLUMNS)
          .eq(scopeCol, scopeVal)
          .order('occurred_at', { ascending: false })
          .limit(2000);
        if (rows.error) throw new Error(rows.error.message);

        const opening = await sb
          .from(personal ? 'profiles' : 'organizations')
          .select('opening_balance_cents')
          .eq('id', scopeVal)
          .maybeSingle();

        if (cancelled) return;
        setSlugToId(s2i);
        setOps((rows.data as Row[]).map((r) => toOp(r, i2s)));
        if (opening.error) {
          setError("La base n'est pas à jour : exécutez le fichier supabase/migrations/0002_operations.sql dans Supabase.");
        } else {
          setOpeningCents(Number(opening.data?.opening_balance_cents ?? 0));
        }
        setStatus('ready');

        const onChange = (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as unknown as Row;
          setOps((l) => {
            const exists = l.some((o) => o.id === row.id);
            const next = toOp(row, i2s, !exists);
            return sortOps(exists ? l.map((o) => (o.id === row.id ? { ...next, fresh: o.fresh } : o)) : [next, ...l]);
          });
          unfreshLater();
        };
        const filter = `${scopeCol}=eq.${scopeVal}`;
        channel = sb
          .channel(`operations-${scopeVal}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'operations', filter }, onChange)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'operations', filter }, onChange)
          // Supabase n'applique pas les filtres aux suppressions : on reçoit seulement l'identifiant de la ligne
          // supprimée et on la retire de la liste si on la connaît (sans effet pour les autres comptes).
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'operations' }, (payload) => {
            const id = (payload.old as { id?: string }).id;
            if (id) setOps((l) => l.filter((o) => o.id !== id));
          })
          .subscribe();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Chargement impossible.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [live, personal, scopeCol, scopeVal, userId, toOp, unfreshLater, reloadKey]);

  const i2sFromState = useCallback(() => new Map([...slugToId.entries()].map(([s, i]) => [i, s])), [slugToId]);

  // ───── Ajout ─────
  const add = useCallback(
    async (d: OperationDraft): Promise<string> => {
      if (!live) {
        const op: Operation = {
          id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: d.kind,
          amountCents: d.amountCents,
          categoryId: d.categoryId,
          label: d.label,
          date: d.date,
          author: personal ? undefined : role,
          fresh: true,
        };
        setOps((l) => sortOps([op, ...l.map((o) => (o.fresh ? { ...o, fresh: false } : o))]));
        return op.id;
      }
      if (!supabase || !scopeVal) throw new Error('Non connecté.');
      const { data, error: e } = await supabase
        .from('operations')
        .insert({
          [scopeCol]: scopeVal,
          kind: d.kind,
          amount_cents: d.amountCents,
          category_id: slugToId.get(d.categoryId) ?? null,
          label: d.label,
          occurred_at: d.date,
        })
        .select(COLUMNS)
        .single();
      if (e) throw new Error(e.message);
      const op = toOp(data as Row, i2sFromState(), true);
      // le temps réel peut avoir déjà ajouté cette ligne : on évite le doublon
      setOps((l) => (l.some((o) => o.id === op.id) ? l : sortOps([op, ...l])));
      unfreshLater();
      return op.id;
    },
    [live, personal, role, scopeCol, scopeVal, slugToId, toOp, i2sFromState, unfreshLater],
  );

  // ───── Modification ─────
  const update = useCallback(
    async (id: string, d: OperationDraft) => {
      if (!live) {
        setOps((l) =>
          sortOps(
            l.map((o) =>
              o.id === id ? { ...o, kind: d.kind, amountCents: d.amountCents, categoryId: d.categoryId, label: d.label, date: d.date } : o,
            ),
          ),
        );
        return;
      }
      if (!supabase) throw new Error('Non connecté.');
      const { data, error: e } = await supabase
        .from('operations')
        .update({
          kind: d.kind,
          amount_cents: d.amountCents,
          category_id: slugToId.get(d.categoryId) ?? null,
          label: d.label,
          occurred_at: d.date,
        })
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle();
      if (e) throw new Error(e.message);
      if (!data) throw new Error("Modification refusée : vous n'avez pas le droit de modifier cette opération.");
      const op = toOp(data as Row, i2sFromState());
      setOps((l) => sortOps(l.map((o) => (o.id === id ? op : o))));
    },
    [live, slugToId, toOp, i2sFromState],
  );

  // ───── Suppression ─────
  const remove = useCallback(
    async (id: string) => {
      if (!live) {
        setOps((l) => l.filter((o) => o.id !== id));
        return;
      }
      if (!supabase) throw new Error('Non connecté.');
      const { data, error: e } = await supabase.from('operations').delete().eq('id', id).select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error("Suppression refusée : vous n'avez pas le droit de supprimer cette opération.");
      setOps((l) => l.filter((o) => o.id !== id));
    },
    [live],
  );

  // ───── Solde de départ ─────
  const setOpening = useCallback(
    async (cents: number) => {
      if (!live) {
        setOpeningCents(cents);
        return;
      }
      if (!supabase || !scopeVal) throw new Error('Non connecté.');
      const { data, error: e } = await supabase
        .from(personal ? 'profiles' : 'organizations')
        .update({ opening_balance_cents: cents })
        .eq('id', scopeVal)
        .select('id');
      if (e) throw new Error(e.message);
      if (!data || data.length === 0) throw new Error('Modification refusée.');
      setOpeningCents(cents);
      setError(null);
    },
    [live, personal, scopeVal],
  );

  return { ops, status, error, openingCents, add, update, remove, setOpening, refresh };
}
