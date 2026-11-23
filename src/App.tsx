import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountType, Invoice, Operation, OperationDraft, ProMode, ProRole } from './types';
import { useOperations } from './data/useOperations';
import { usePlanning } from './data/usePlanning';
import { categoriesFor } from './data/categories';
import { buildAlerts, forecast as computeForecast, todayKey } from './lib/forecast';
import { balanceSince, endOfMonthAvailable, habitualFlows, monthlyBudget } from './lib/monthly';
import { usePilot } from './pilot/usePilot';
import { runIntent, type PilotEnv, type PilotReply } from './pilot/execute';
import { parseIntent, type InvoiceVoiceDraft } from './voice/intents';
import { parseCommand, RECURRING_TYPICAL } from './voice/parseCommand';
import { detectPlanned } from './voice/planned';

const NOT_FOR_EMPLOYEE_SAY = "Cette commande n'est pas disponible avec votre profil.";
import { PilotDialog, PilotPanelCard, PilotPill, PilotSheet } from './components/PilotUI';
import { applyAnswer, applyField, missingSlots, QUESTIONS, type Candidate } from './pilot/missing';
import { isNo } from './voice/wake';
import { InvoiceSheet } from './components/PlanSheets';
import { parisYMD } from './lib/dates';
import { useAuth } from './auth/AuthProvider';
import { BottomNav, type NavItem } from './components/BottomNav';
import { VoiceSheet } from './components/VoiceSheet';
import { OpeningSheet } from './components/OpeningSheet';
import { BudgetSheet, RecurringSheet, type BudgetPrefill, type RecurringPrefill } from './components/PlanSheets';
import { warmUpVoiceEngine } from './voice/recognizer';
import { OperationSelectContext } from './components/OperationContext';
import { formatEuros } from './lib/money';
import { Brand } from './components/Brand';
import { Icon } from './components/Icon';
import { ChooseAccount } from './screens/ChooseAccount';
import { AuthFlow } from './screens/AuthFlow';
import { SetupScreen } from './screens/SetupScreen';
import { PersonalHome } from './screens/personal/PersonalHome';
import { PersonalMonth } from './screens/personal/PersonalMonth';
import { PersonalCategories } from './screens/personal/PersonalCategories';
import { PersonalRecurring } from './screens/personal/PersonalRecurring';
import { ProHome } from './screens/pro/ProHome';
import { ProFlows } from './screens/pro/ProFlows';
import { Invoices } from './screens/pro/Invoices';
import { ProTeam } from './screens/pro/ProTeam';
import { ProTeamLive } from './screens/pro/ProTeamLive';
import { EmployeeHome } from './screens/employee/EmployeeHome';

const PERSONAL_NAV: NavItem[] = [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'month', label: 'Mois', icon: 'calendar' },
  { id: 'categories', label: 'Catégories', icon: 'pie' },
  { id: 'recurring', label: 'Récurrent', icon: 'repeat' },
];

const proNav = (mode: ProMode): NavItem[] => [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'flows', label: 'Flux', icon: 'swap' },
  { id: 'invoices', label: 'Factures', icon: 'file' },
  mode === 'equipe' ? { id: 'team', label: 'Équipe', icon: 'users' } : { id: 'matrix', label: 'Matrice', icon: 'table' },
];

const EMPLOYEE_NAV: NavItem[] = [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'all', label: 'Mes frais', icon: 'list' },
];

/** Démonstration : opération simulée de -100 € ou +100 €. */
const DEMO: Record<'depense' | 'recette', Omit<OperationDraft, 'date'>> = {
  depense: { kind: 'depense', amountCents: 10_000, categoryId: 'carburant', label: 'Démo — dépense' },
  recette: { kind: 'recette', amountCents: 10_000, categoryId: 'ventes', label: 'Démo — encaissement' },
};

/* ───────── Porte d'entrée : démo, configuration, connexion ───────── */

export default function App() {
  const { configured, state, signOut } = useAuth();
  const [demo, setDemo] = useState(false);

  if (demo) return <DemoApp onExit={() => setDemo(false)} canExit={configured} />;
  if (!configured) return <SetupScreen onDemo={() => setDemo(true)} />;

  switch (state.status) {
    case 'loading':
      return (
        <main className="welcome splash">
          <Brand />
          <p className="muted center">Chargement…</p>
        </main>
      );
    case 'error':
      return (
        <main className="welcome">
          <Brand />
          <section className="auth-card">
            <h2>Compte inaccessible</h2>
            <p className="form-error">{state.message}</p>
            <button className="btn btn-ghost block" onClick={signOut}>
              Se déconnecter
            </button>
          </section>
        </main>
      );
    case 'out':
      return <AuthFlow onDemo={() => setDemo(true)} />;
    case 'in': {
      const { profile, membership } = state;
      return (
        <Workspace
          key={profile.id}
          live
          account={profile.accountType}
          proMode={membership?.mode ?? 'solo'}
          role={membership?.role ?? 'patron'}
          userName={profile.displayName}
          userId={profile.id}
          orgId={membership?.orgId}
          onBack={signOut}
          backLabel="Déconnexion"
        />
      );
    }
  }
}

/* ───────── Démonstration (données fictives, sans compte) ───────── */

function DemoApp({ onExit, canExit }: { onExit: () => void; canExit: boolean }) {
  const [account, setAccount] = useState<AccountType | null>(null);
  const [proMode, setProMode] = useState<ProMode>('solo');
  const [role, setRole] = useState<ProRole>('patron');

  if (!account) {
    return (
      <ChooseAccount
        onChoose={(acc, mode) => {
          setAccount(acc);
          setProMode(mode);
          setRole('patron');
        }}
        onQuitDemo={canExit ? onExit : undefined}
      />
    );
  }

  return (
    <Workspace
      key={`${account}-${proMode}`}
      account={account}
      proMode={proMode}
      role={role}
      onRoleChange={setRole}
      userName={role === 'employe' ? 'Julie Moreau' : 'Thomas Martin'}
      onBack={() => setAccount(null)}
      backLabel="Changer de compte"
    />
  );
}

/* ───────── Espace de travail (commun à la démo et au compte connecté) ───────── */

interface WorkspaceProps {
  account: AccountType;
  proMode: ProMode;
  role: ProRole;
  userName: string;
  /** Fourni uniquement en démo : permet de basculer entre vue Patron et vue Employé. */
  onRoleChange?: (role: ProRole) => void;
  /** Compte connecté (Supabase) : les opérations sont enregistrées dans la base. */
  live?: boolean;
  userId?: string;
  orgId?: string;
  onBack: () => void;
  backLabel: string;
}

type SheetState =
  | { kind: 'op'; mode: 'voice' | 'manual'; presetText?: string }
  | { kind: 'pilot' }
  | { kind: 'invoice'; draft: InvoiceVoiceDraft & { heard: string } }
  | { kind: 'edit'; op: Operation }
  | { kind: 'recurring'; prefill: RecurringPrefill }
  | { kind: 'budget'; prefill: BudgetPrefill }
  | { kind: 'opening'; cents?: number | null };

function Workspace({ account, proMode, role, userName, onRoleChange, live, userId, orgId, onBack, backLabel }: WorkspaceProps) {
  const [tab, setTab] = useState('home');
  const data = useOperations({ live: Boolean(live), account, userId, orgId, role });
  const { ops } = data;
  const planning = usePlanning({ live: Boolean(live), account, userId, orgId, role, onRecurringApplied: data.refresh });
  const { invoices } = planning;

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [directSave, setDirectSave] = useState(() => {
    try {
      return localStorage.getItem('pilottreso.directSave') === '1';
    } catch {
      return false;
    }
  });
  const changeDirectSave = (v: boolean) => {
    setDirectSave(v);
    try {
      localStorage.setItem('pilottreso.directSave', v ? '1' : '0');
    } catch {
      /* stockage indisponible : l'option vaut pour cette session */
    }
  };

  useEffect(() => {
    document.documentElement.dataset.account = account;
  }, [account]);

  // Prépare la dictée en arrière-plan : quand on appuie sur le micro, il écoute tout de suite.
  useEffect(() => {
    const t = setTimeout(warmUpVoiceEngine, 800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const isEmployee = account === 'professionnel' && proMode === 'equipe' && role === 'employe';
  const personal = account === 'particulier';
  // Le solde de départ se règle côté propriétaire / patron (compte connecté uniquement).
  const canEditOpening = !isEmployee;

  const demo = (kind: 'depense' | 'recette') => {
    const base = DEMO[kind];
    void data.add({
      ...base,
      categoryId: personal ? (kind === 'depense' ? 'carburant' : 'autre-recette') : base.categoryId,
      date: new Date().toISOString(),
    });
  };

  // Le bouton micro écoute une commande tout de suite (mêmes pouvoirs que « Dis Pilot »). La toute première fois, la fenêtre
  // de configuration (autorisation du micro, téléchargement éventuel du moteur) s'ouvre.
  const openMic = () => {
    if (pilot.talk() === 'needs-setup') setSheet({ kind: 'op', mode: 'voice' });
  };

  /** Enregistrement direct : on enregistre tout de suite, avec un bouton Annuler pendant quelques secondes. */
  const saveDirect = async (draft: OperationDraft) => {
    const id = await data.add(draft);
    setSheet(null);
    const sign = draft.kind === 'depense' ? '−' : '+';
    setToast({
      text: `${sign}${formatEuros(draft.amountCents)} enregistré`,
      undo: () => {
        void data.remove(id);
        setToast({ text: 'Opération annulée' });
      },
    });
  };

  const submitSheet = async (draft: OperationDraft) => {
    if (sheet?.kind === 'edit') {
      await data.update(sheet.op.id, draft);
      setToast({ text: 'Opération modifiée' });
    } else {
      await data.add(draft);
      setToast({ text: 'Opération enregistrée' });
    }
    setSheet(null);
  };

  const deleteOp = async () => {
    if (sheet?.kind !== 'edit') return;
    await data.remove(sheet.op.id);
    setSheet(null);
    setToast({ text: 'Opération supprimée' });
  };

  const switchRole = (r: ProRole) => {
    onRoleChange?.(r);
    setTab('home');
  };

  // Solde actuel : le solde de départ est celui d'un jour précis, les opérations d'avant ne comptent plus
  const balanceCents = useMemo(() => balanceSince(data.openingCents, data.openingDate, ops), [data.openingCents, data.openingDate, ops]);
  // « Disponible du mois » : solde actuel + récurrences encore à passer jusqu'à la fin du mois
  const endOfMonth = useMemo(() => endOfMonthAvailable(balanceCents, planning.recurrings, todayKey(), planning.planned), [balanceCents, planning.recurrings, planning.planned]);
  const habitual = useMemo(() => habitualFlows(ops, planning.recurrings, todayKey(), personal), [ops, planning.recurrings, personal]);
  const forecast = useMemo(
    () => computeForecast({ balanceCents, recurrings: planning.recurrings, invoices, planned: planning.planned, today: todayKey(), habitual }),
    [balanceCents, planning.recurrings, invoices, planning.planned, habitual],
  );
  const monthly = useMemo(() => monthlyBudget(ops, planning.recurrings, todayKey(), planning.planned), [ops, planning.recurrings, planning.planned]);
  const alerts = useMemo(
    () =>
      buildAlerts({
        ops,
        budgets: personal ? planning.budgets : undefined,
        categories: categoriesFor(account),
        invoices,
        forecast,
        today: todayKey(),
      }),
    [ops, personal, planning.budgets, account, invoices, forecast],
  );

  /** Facture réglée : on crée l'opération du jour (modifiable ensuite) puis on la marque comme réglée. */
  const settleInvoice = async (inv: Invoice) => {
    const incoming = inv.direction === 'a_encaisser';
    await data.add({
      kind: incoming ? 'recette' : 'depense',
      amountCents: inv.amountCents,
      categoryId: incoming ? 'ventes' : 'achats',
      label: inv.label ? `${inv.counterparty} — ${inv.label}` : inv.counterparty,
      date: new Date().toISOString(),
    });
    await planning.setInvoiceStatus(inv.id, 'payee');
    setToast({ text: incoming ? 'Encaissement enregistré' : 'Paiement enregistré' });
  };

  const swipe = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  const [slide, setSlide] = useState<'left' | 'right' | null>(null);

  const navItems = personal ? PERSONAL_NAV : isEmployee ? EMPLOYEE_NAV : proNav(proMode);
  const activeTab = navItems.some((n) => n.id === tab) ? tab : 'home';

  // ───── Pilot : « Dis Pilot… » ─────
  const pilotEnv = (): PilotEnv => ({
    account,
    isEmployee,
    navIds: navItems.map((n) => n.id),
    today: todayKey(),
    ops,
    balanceCents,
    forecast,
    alerts,
    budgets: planning.budgets,
    monthly,
    endOfMonth,
    recurrings: planning.recurrings,
    invoices,
    categories: categoriesFor(account),
    act: {
      navigate: (id) => {
        setSlide(null);
        setTab(id);
      },
      editOp: (op) => setSheet({ kind: 'edit', op }),
      deleteOp: async (id) => {
        await data.remove(id);
      },
      openInvoice: (draft) => setSheet({ kind: 'invoice', draft: { ...draft, heard: pilotHeard.current } }),
      settleInvoice,
      setRecurringActive: planning.setRecurringActive,
      removeRecurring: planning.removeRecurring,
      openOpening: (cents) => setSheet({ kind: 'opening', cents }),
      setDirectSave: changeDirectSave,
    },
  });
  const pilotHeard = useRef('');
  // ───── Informations manquantes : questions au milieu de l'écran (jamais le formulaire complet) ─────
  const [missing, setMissing] = useState<Candidate | null>(null);
  const missingRef = useRef<Candidate | null>(null);
  missingRef.current = missing;
  const askedRef = useRef<string | null>(null);
  const [lastHeard, setLastHeard] = useState<{ text: string; ok: boolean } | null>(null);

  /** Enregistre un ajout dont tout est connu : renvoie la réponse de Pilot (action immédiate + de quoi l'annuler). */
  const commit = (c: Candidate): PilotReply => {
    const cats = categoriesFor(account);
    const cat = cats.find((x) => x.id === (c.kind === 'invoice' || c.kind === 'opening' ? '' : c.categoryId));
    const sign = (kind: 'depense' | 'recette') => (kind === 'depense' ? 'moins' : 'plus');
    const monthEndNow = (balance: number) => balance + endOfMonth.incomeToComeCents - endOfMonth.expenseToComeCents;
    const done = (say: string, undo: () => Promise<string>) => ({ say, undo });
    switch (c.kind) {
      case 'op': {
        const draft: OperationDraft = { kind: c.opKind, amountCents: c.amountCents!, categoryId: c.categoryId, label: c.label || cat!.label, date: c.date };
        // salaire, loyer, crédit, énergie, abonnements… : ça revient chaque mois, on propose de le répéter
        const day = parisYMD(draft.date).d;
        const offer =
          !isEmployee && RECURRING_TYPICAL.has(draft.categoryId)
            ? {
                label: `Répéter chaque mois (le ${day})`,
                run: async () => {
                  const rid = await planning.addRecurring({ label: draft.label, kind: draft.kind, amountCents: draft.amountCents, categoryId: draft.categoryId, dayOfMonth: day });
                  return done(`Récurrence enregistrée : ${draft.label}, ${sign(draft.kind)} ${formatEuros(draft.amountCents)} le ${day} de chaque mois.`, async () => {
                    await planning.removeRecurring(rid);
                    return 'Récurrence annulée.';
                  });
                },
              }
            : undefined;
        return {
          say: 'Un instant…',
          auto: async () => {
            const id = await data.add(draft);
            return {
              ...done(`Enregistré : ${sign(draft.kind)} ${formatEuros(draft.amountCents)}, ${draft.label}.`, async () => {
                await data.remove(id);
                return 'Opération annulée.';
              }),
              offer,
            };
          },
        };
      }
      case 'recurring': {
        const label = c.label || (c.word ? c.word.charAt(0).toUpperCase() + c.word.slice(1) : cat!.label);
        return {
          say: 'Un instant…',
          auto: async () => {
            const id = await planning.addRecurring({ label, kind: c.recKind, amountCents: c.amountCents!, categoryId: c.categoryId, dayOfMonth: c.dayOfMonth! });
            return done(`Récurrence enregistrée : ${label}, ${sign(c.recKind)} ${formatEuros(c.amountCents!)} le ${c.dayOfMonth} de chaque mois.`, async () => {
              await planning.removeRecurring(id);
              return 'Récurrence annulée.';
            });
          },
        };
      }
      case 'budget': {
        const previous = planning.budgets.get(c.categoryId) ?? null;
        const next = c.remove ? null : c.amountCents!;
        return {
          say: 'Un instant…',
          auto: async () => {
            await planning.setBudget(c.categoryId, next);
            return done(next ? `Budget ${cat!.label} fixé à ${formatEuros(next)}.` : `Budget ${cat!.label} retiré.`, async () => {
              await planning.setBudget(c.categoryId, previous);
              return 'Budget remis comme avant.';
            });
          },
        };
      }
      case 'opening': {
        const previousCents = data.openingCents;
        const previousDate = data.openingDate;
        return {
          say: 'Un instant…',
          auto: async () => {
            await data.setOpening(c.amountCents!);
            return done(
              `Solde de départ enregistré : ${formatEuros(c.amountCents!)} aujourd'hui. Disponible fin de mois : ${formatEuros(monthEndNow(c.amountCents!))}.`,
              async () => {
                await data.setOpening(previousCents, previousDate);
                return 'Solde de départ remis comme avant.';
              },
            );
          },
        };
      }
      case 'planned': {
        const label = c.label || cat!.label;
        const when = new Date(`${c.dateKey}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
        return {
          say: 'Un instant…',
          auto: async () => {
            const id = await planning.addPlanned({ kind: c.opKind, amountCents: c.amountCents!, categoryId: c.categoryId, label, dateKey: c.dateKey });
            return done(`Prévu le ${when} : ${sign(c.opKind)} ${formatEuros(c.amountCents!)}, ${label}. Il compte dans votre disponible du mois.`, async () => {
              await planning.removePlanned(id);
              return 'Opération prévue annulée.';
            });
          },
        };
      }
      case 'invoice':
        return {
          say: 'Un instant…',
          auto: async () => {
            const id = await planning.addInvoice({ counterparty: c.counterparty, label: c.label, amountCents: c.amountCents!, dueKey: c.dueKey!, direction: c.direction });
            return done(`Facture enregistrée : ${c.counterparty}, ${formatEuros(c.amountCents!)}, échéance le ${c.dueKey!.split('-').reverse().join('/')}.`, async () => {
              await planning.removeInvoice(id);
              return 'Facture annulée.';
            });
          },
        };
    }
  };

  /**
   * Commande de Pilot (après « Dis Pilot »). Quand TOUT est compris, l'ajout est fait tout de suite (« ding », bouton Annuler).
   * S'il manque quelque chose, Pilot pose seulement la ou les questions utiles, au milieu de l'écran.
   */
  const dispatchPilot = (command: string): PilotReply => {
    pilotHeard.current = command;
    setMissing(null); // une nouvelle commande remplace une question restée sans réponse
    const ignore: PilotReply = { say: '', silent: true };
    const today = parisYMD(new Date());
    const ask = (c: Candidate): PilotReply => {
      const slots = missingSlots(c);
      if (slots.length === 0) return commit(c);
      setMissing(c);
      return ignore;
    };

    const intent = parseIntent(command, { account, today });
    if (intent) {
      if (intent.type === 'opening') {
        if (!canEditOpening) return { say: NOT_FOR_EMPLOYEE_SAY };
        return ask({ kind: 'opening', heard: command, amountCents: intent.amountCents });
      }
      if (intent.type === 'invoice_new' && !isEmployee) {
        const d = intent.draft;
        return ask({ kind: 'invoice', heard: command, direction: d.direction, counterparty: d.counterparty, label: d.label, amountCents: d.amountCents, dueKey: d.dueKey });
      }
      return runIntent(intent, pilotEnv());
    }

    const cats = categoriesFor(account);
    // « le 28, j'ai 80 euros d'assurance » : une dépense (ou recette) PRÉVUE à une date future, pas une opération d'aujourd'hui
    const pl = isEmployee ? null : detectPlanned(command, account);
    if (pl) {
      const pc = cats.find((c) => c.id === pl.parsed.categoryId);
      return ask({ kind: 'planned', heard: command, opKind: pl.parsed.kind, amountCents: pl.parsed.amountCents, categoryId: pc && pc.kind === pl.parsed.kind ? pc.id : '', label: pl.parsed.label, dateKey: pl.dateKey });
    }
    const p = parseCommand(command, account);
    if (!p.amountCents && !p.categoryId && !p.budget && !p.recurring) {
      return { say: `Je n'ai pas compris « ${command} ». Dites par exemple : j'ai dépensé 50 euros de carburant, ou : quel est mon solde.` };
    }
    const cat = cats.find((c) => c.id === p.categoryId);

    if (p.budget) {
      if (isEmployee || !personal) return { say: 'Les budgets par catégorie existent pour le compte particulier.' };
      const ok = cat && cat.kind === 'depense' && !cat.fixed;
      return ask({
        kind: 'budget',
        heard: command,
        categoryId: ok ? cat.id : '',
        amountCents: p.amountCents,
        remove: p.budgetRemove,
        note: cat?.fixed ? `${cat.label} est une charge fixe : elle se gère dans les récurrences. Quelle autre catégorie ?` : undefined,
      });
    }
    if (p.recurring) {
      if (isEmployee) return { say: NOT_FOR_EMPLOYEE_SAY };
      return ask({
        kind: 'recurring',
        heard: command,
        recKind: p.kind,
        amountCents: p.amountCents,
        categoryId: cat && cat.kind === p.kind ? cat.id : '',
        label: p.label,
        word: p.categoryWord,
        dayOfMonth: p.dayOfMonth,
      });
    }
    if (isEmployee && p.kind === 'recette') return { say: 'Un employé ne peut saisir que des dépenses.' };
    const kind = isEmployee ? 'depense' : p.kind;
    return ask({ kind: 'op', heard: command, opKind: kind, amountCents: p.amountCents, categoryId: cat && cat.kind === kind ? cat.id : '', label: p.label, date: p.date });
  };

  /** Une question est posée à l'écran : ce qui est dit en est la réponse (sans « Dis Pilot »). */
  const answerPilot = (text: string): boolean => {
    const c = missingRef.current;
    if (!c) return false;
    if (isNo(text)) {
      setMissing(null);
      return true;
    }
    const r = applyAnswer(c, text, { account, today: parisYMD(new Date()) });
    setLastHeard({ text, ok: r.filled.length > 0 });
    if (r.filled.length > 0) setMissing(r.candidate);
    else {
      const first = missingSlots(c)[0];
      pilot.ask(`Je n'ai pas compris. ${QUESTIONS[first](c)}`);
    }
    return true;
  };

    const pilot = usePilot({ blocked: sheet !== null, dispatch: dispatchPilot, onAnswer: answerPilot });
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __pilot?: unknown }).__pilot = { hear: pilot.hear };
  });
  useEffect(() => {
    if (!missing) {
      askedRef.current = null;
      setLastHeard(null);
      return;
    }
    const slots = missingSlots(missing);
    if (slots.length === 0) {
      // tout est là : on enregistre tout de suite
      setMissing(null);
      pilot.present(commit(missing), missing.heard);
      return;
    }
    if (askedRef.current !== slots[0]) {
      askedRef.current = slots[0];
      pilot.ask(QUESTIONS[slots[0]](missing));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
  /** Balayage horizontal : écran suivant (vers la gauche) ou précédent (vers la droite). */
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const target = e.target as HTMLElement;
    // pas de balayage depuis un champ, un menu ou une zone qui défile elle-même horizontalement
    const blocked = target.closest('input, select, textarea, .sheet, [data-noswipe]') !== null;
    swipe.current = e.touches.length === 1 && !blocked ? { x: t.clientX, y: t.clientY, ok: true } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || sheet) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const i = navItems.findIndex((n) => n.id === activeTab);
    const next = navItems[i + (dx < 0 ? 1 : -1)];
    if (!next) return;
    setSlide(dx < 0 ? 'left' : 'right');
    setTab(next.id);
  };

  const employeeOps = ops.filter((o) => o.author === 'employe');
  const onDemo = live ? undefined : demo;
  const onEditOpening = canEditOpening ? () => setSheet({ kind: 'opening' }) : undefined;

  const badge =
    account === 'particulier'
      ? 'Particulier'
      : proMode === 'solo'
        ? 'Pro · Auto-entrepreneur'
        : role === 'patron'
          ? 'Pro · Patron'
          : 'Pro · Employé';

  return (
    <div className="app" data-account={account}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="avatar">{(userName || '?').charAt(0).toUpperCase()}</span>
          <div>
            <small>{badge}</small>
            <strong>{userName}</strong>
          </div>
        </div>
        <div className="topbar-right">
          <PilotPill pilot={pilot} onOpen={() => setSheet({ kind: 'pilot' })} />
          {onRoleChange && (
            <button className="role-toggle" onClick={() => switchRole(role === 'patron' ? 'employe' : 'patron')} title="Changer de vue">
              Vue : {role === 'patron' ? 'Patron' : 'Employé'}
            </button>
          )}
          <button className="account-badge" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </header>

      {data.error && data.status === 'ready' && <p className="live-banner">{data.error}</p>}
      {planning.error && <p className="live-banner">{planning.error}</p>}

      <OperationSelectContext.Provider value={(op) => setSheet({ kind: 'edit', op })}>
        <main
          className={`screen ${slide ? `slide-${slide}` : ''}`}
          key={`${account}-${role}-${activeTab}`}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {data.status === 'loading' && <p className="empty">Chargement de vos opérations…</p>}
          {data.status === 'error' && <p className="form-error">{data.error}</p>}

          {data.status === 'ready' && (
            <>
              {personal && (
                <>
                  {activeTab === 'home' && (
                    <PersonalHome
                      ops={ops}
                      balanceCents={balanceCents}
                      endOfMonth={endOfMonth}
                      onDemo={onDemo}
                      onEditOpening={onEditOpening}
                      onSeeAll={() => setTab('month')}
                      monthly={monthly}
                      alerts={alerts}
                      forecast={forecast}
                      onRemovePlanned={(id) => void planning.removePlanned(id)}
                    />
                  )}
                  {activeTab === 'month' && <PersonalMonth ops={ops} />}
                  {activeTab === 'categories' && <PersonalCategories ops={ops} planning={planning} />}
                  {activeTab === 'recurring' && <PersonalRecurring planning={planning} />}
                </>
              )}

              {account === 'professionnel' && !isEmployee && (
                <>
                  {activeTab === 'home' && (
                    <ProHome
                      ops={ops}
                      invoices={invoices}
                      mode={proMode}
                      balanceCents={balanceCents}
                      onDemo={onDemo}
                      onEditOpening={onEditOpening}
                      onSeeInvoices={() => setTab('invoices')}
                      onSeeFlows={() => setTab('flows')}
                      alerts={alerts}
                      forecast={forecast}
                    />
                  )}
                  {activeTab === 'flows' && <ProFlows ops={ops} mode={proMode} />}
                  {activeTab === 'invoices' && <Invoices planning={planning} onSettle={settleInvoice} />}
                  {activeTab === 'team' &&
                    (live && orgId && userId ? <ProTeamLive orgId={orgId} myId={userId} /> : <ProTeam role={role} onViewAs={switchRole} />)}
                  {activeTab === 'matrix' && <MatrixPlaceholder />}
                </>
              )}

              {isEmployee && (
                <EmployeeHome ops={employeeOps} view={activeTab === 'all' ? 'all' : 'home'} onDemo={onDemo} onSeeAll={() => setTab('all')} />
              )}
            </>
          )}
        </main>
      </OperationSelectContext.Provider>

      <PilotPanelCard pilot={pilot} />
      {missing && (
        <PilotDialog
          candidate={missing}
          categories={categoriesFor(account)}
          onField={(key, value) => setMissing((m) => (m ? applyField(m, key, value) : m))}
          onCancel={() => setMissing(null)}
          status={pilot.state === 'paused' ? 'speaking' : pilot.state === 'busy' ? 'busy' : 'listening'}
          level={pilot.level}
          lastHeard={lastHeard}
        />
      )}

      <BottomNav items={navItems} active={activeTab} onSelect={(id) => { setSlide(null); setTab(id); }} onMic={openMic} />

      {sheet?.kind === 'op' && (
        <VoiceSheet
          account={account}
          mode={sheet.mode}
          presetText={sheet.presetText}
          onCommand={sheet.presetText ? undefined : (text) => parseIntent(text, { account, today: parisYMD(new Date()) }) !== null && (pilot.run(text), true)}
          expenseOnly={isEmployee}
          directSave={directSave}
          onDirectSaveChange={changeDirectSave}
          onConfirm={submitSheet}
          onDirect={saveDirect}
          onRecurring={(prefill) => setSheet({ kind: 'recurring', prefill })}
          onBudget={personal ? (prefill) => setSheet({ kind: 'budget', prefill }) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'pilot' && <PilotSheet pilot={pilot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'invoice' && (
        <InvoiceSheet
          prefill={sheet.draft}
          onSave={async (d) => {
            await planning.addInvoice(d);
            setToast({ text: 'Facture enregistrée' });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'budget' && (
        <BudgetSheet
          prefill={sheet.prefill}
          choices={categoriesFor(account).filter((c) => c.kind === 'depense' && !c.fixed)}
          budgets={planning.budgets}
          onSave={async (id, cents) => {
            await planning.setBudget(id, cents);
            setToast({ text: cents ? 'Budget enregistré' : 'Budget retiré' });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'recurring' && (
        <RecurringSheet
          prefill={sheet.prefill}
          categories={categoriesFor(account)}
          professional={!personal}
          onSave={async (d) => {
            await planning.addRecurring(d);
            setToast({ text: 'Récurrence enregistrée' });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'edit' && (
        <VoiceSheet
          account={account}
          mode="edit"
          initial={sheet.op}
          expenseOnly={isEmployee}
          onConfirm={submitSheet}
          onDelete={deleteOp}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'opening' && (
        <OpeningSheet
          currentCents={sheet.cents ?? data.openingCents}
          personal={personal}
          onSave={async (c) => {
            await data.setOpening(c);
            setToast({ text: 'Solde de départ enregistré' });
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {!sheet && !toast && !live && (
        <button className="manual-link" onClick={() => setSheet({ kind: 'op', mode: 'manual' })}>
          Saisie manuelle
        </button>
      )}

      {toast && (
        <div className={`toast ${toast.undo ? 'toast-long' : ''}`} role="status">
          <Icon name="check" size={16} /> {toast.text}
          {toast.undo && (
            <button className="toast-undo" onClick={toast.undo}>
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MatrixPlaceholder() {
  return (
    <>
      <h2 className="screen-title">Matrice Excel</h2>
      <p className="muted">Point d'entrée prévu pour relier votre tableau de pilotage (étape 6).</p>
      <section className="card center-card">
        <span className="big-icon">
          <Icon name="table" size={30} />
        </span>
        <p>
          La structure de données est prête. La liaison avec votre matrice et les calculs (URSSAF, TVA) viendront dans une étape
          ultérieure.
        </p>
      </section>
    </>
  );
}
