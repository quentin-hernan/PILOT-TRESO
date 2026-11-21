import { useEffect, useMemo, useState } from 'react';
import type { AccountType, Invoice, Operation, OperationDraft, ProMode, ProRole } from './types';
import { useOperations } from './data/useOperations';
import { usePlanning } from './data/usePlanning';
import { categoriesFor } from './data/categories';
import { buildAlerts, forecast as computeForecast, todayKey } from './lib/forecast';
import { signed } from './lib/stats';
import { useAuth } from './auth/AuthProvider';
import { BottomNav, type NavItem } from './components/BottomNav';
import { VoiceSheet } from './components/VoiceSheet';
import { OpeningSheet } from './components/OpeningSheet';
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
  | { kind: 'op'; mode: 'voice' | 'manual' }
  | { kind: 'edit'; op: Operation }
  | { kind: 'opening' };

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
  const canEditOpening = Boolean(live) && !isEmployee;

  const demo = (kind: 'depense' | 'recette') => {
    const base = DEMO[kind];
    void data.add({
      ...base,
      categoryId: personal ? (kind === 'depense' ? 'carburant' : 'autre-recette') : base.categoryId,
      date: new Date().toISOString(),
    });
  };

  const openMic = () => setSheet({ kind: 'op', mode: 'voice' });

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

  const balanceCents = useMemo(() => data.openingCents + ops.reduce((sum, o) => sum + signed(o), 0), [data.openingCents, ops]);
  const forecast = useMemo(
    () => computeForecast({ balanceCents, recurrings: planning.recurrings, invoices, today: todayKey() }),
    [balanceCents, planning.recurrings, invoices],
  );
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

  const navItems = personal ? PERSONAL_NAV : isEmployee ? EMPLOYEE_NAV : proNav(proMode);
  const activeTab = navItems.some((n) => n.id === tab) ? tab : 'home';
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
        <main className="screen" key={`${account}-${role}-${activeTab}`}>
          {data.status === 'loading' && <p className="empty">Chargement de vos opérations…</p>}
          {data.status === 'error' && <p className="form-error">{data.error}</p>}

          {data.status === 'ready' && (
            <>
              {personal && (
                <>
                  {activeTab === 'home' && (
                    <PersonalHome
                      ops={ops}
                      openingCents={data.openingCents}
                      onDemo={onDemo}
                      onEditOpening={onEditOpening}
                      onSeeAll={() => setTab('month')}
                      budgets={planning.budgets}
                      alerts={alerts}
                      forecast={forecast}
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
                      openingCents={data.openingCents}
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

      <BottomNav items={navItems} active={activeTab} onSelect={setTab} onMic={openMic} />

      {sheet?.kind === 'op' && (
        <VoiceSheet
          account={account}
          mode={sheet.mode}
          expenseOnly={isEmployee}
          directSave={directSave}
          onDirectSaveChange={changeDirectSave}
          onConfirm={submitSheet}
          onDirect={saveDirect}
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
          currentCents={data.openingCents}
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
