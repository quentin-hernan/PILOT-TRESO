import { useState, type FormEvent, type ReactNode } from 'react';
import type { AccountType, ProMode } from '../types';
import { useAuth } from '../auth/AuthProvider';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';
import { ChooseAccount } from './ChooseAccount';

type View =
  | { name: 'choose' }
  | { name: 'login' }
  | { name: 'signup'; account: AccountType; mode: ProMode }
  | { name: 'join' };

/** Parcours hors connexion : choix du compte, inscription, connexion, code d'invitation. */
export function AuthFlow({ onDemo }: { onDemo: () => void }) {
  const [view, setView] = useState<View>({ name: 'choose' });
  const back = () => setView({ name: 'choose' });

  switch (view.name) {
    case 'choose':
      return (
        <ChooseAccount
          onChoose={(account, mode) => setView({ name: 'signup', account, mode })}
          onLogin={() => setView({ name: 'login' })}
          onJoin={() => setView({ name: 'join' })}
          onDemo={onDemo}
        />
      );
    case 'login':
      return <LoginForm onBack={back} onSignup={back} />;
    case 'signup':
      return <SignupForm account={view.account} mode={view.mode} onBack={back} />;
    case 'join':
      return <JoinForm onBack={back} />;
  }
}

/* ───────── Pièces communes ───────── */

function Shell({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack: () => void; children: ReactNode }) {
  return (
    <main className="welcome">
      <Brand />
      <section className="auth-card">
        <button className="back" onClick={onBack}>
          <Icon name="chevLeft" size={18} /> Retour
        </button>
        <h2>{title}</h2>
        {subtitle && <p className="muted center">{subtitle}</p>}
        {children}
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} required />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Gère l'état « en cours » et l'erreur d'un envoi de formulaire. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

const MIN_PASSWORD = 8;

function validPassword(p: string) {
  return p.length >= MIN_PASSWORD;
}

/* ───────── Connexion ───────── */

function LoginForm({ onBack, onSignup }: { onBack: () => void; onSignup: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(() => signIn(email, password));

  return (
    <Shell title="Connexion" onBack={onBack}>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Adresse e-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Mot de passe" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary block" disabled={busy}>
          {busy ? 'Connexion…' : 'Me connecter'}
        </button>
      </form>
      <button className="link-row" onClick={onSignup}>
        Pas encore de compte ? <b>Créer un compte</b>
      </button>
    </Shell>
  );
}

/* ───────── Inscription particulier / professionnel ───────── */

function SignupForm({ account, mode, onBack }: { account: AccountType; mode: ProMode; onBack: () => void }) {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const pro = account === 'professionnel';

  const { busy, error, submit } = useSubmit(async () => {
    if (!validPassword(password)) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
    await signUp({ email, password, displayName: `${firstName.trim()} ${lastName.trim()}`, accountType: account, mode, orgName });
  });

  const kind = account === 'particulier' ? 'Particulier' : mode === 'solo' ? 'Professionnel · Auto-entrepreneur' : 'Professionnel · Patron';

  return (
    <Shell title="Créer mon compte" subtitle={kind} onBack={onBack}>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Prénom" value={firstName} onChange={setFirstName} autoComplete="given-name" />
        <Field label="Nom" value={lastName} onChange={setLastName} autoComplete="family-name" />
        {pro && <Field label="Nom de votre activité" value={orgName} onChange={setOrgName} placeholder="Ex. Dupont Plomberie" />}
        <Field label="Adresse e-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Mot de passe"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`${MIN_PASSWORD} caractères minimum`}
        />
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary block" disabled={busy}>
          {busy ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
    </Shell>
  );
}

/* ───────── Employé : inscription avec un code d'invitation ───────── */

function JoinForm({ onBack }: { onBack: () => void }) {
  const { signUp, checkInvitation } = useAuth();
  const [code, setCode] = useState('');
  const [orgName, setOrgName] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const verify = useSubmit(async () => {
    const found = await checkInvitation(code);
    if (!found) throw new Error("Ce code est invalide, expiré ou déjà utilisé. Demandez-en un nouveau à votre patron.");
    setOrgName(found);
  });

  const create = useSubmit(async () => {
    if (!validPassword(password)) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
    await signUp({ email, password, displayName: `${firstName.trim()} ${lastName.trim()}`, accountType: 'professionnel', inviteCode: code });
  });

  if (!orgName) {
    return (
      <Shell title="Rejoindre mon entreprise" subtitle="Saisissez le code donné par votre patron." onBack={onBack}>
        <form className="auth-form" onSubmit={verify.submit}>
          <Field label="Code d'invitation" value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder="Ex. 3F9A1C07BD" />
          {verify.error && <p className="form-error">{verify.error}</p>}
          <button className="btn btn-primary block" disabled={verify.busy}>
            {verify.busy ? 'Vérification…' : 'Vérifier le code'}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title={`Rejoindre ${orgName}`} subtitle="Code valide. Créez votre accès employé." onBack={() => setOrgName(null)}>
      <form className="auth-form" onSubmit={create.submit}>
        <Field label="Prénom" value={firstName} onChange={setFirstName} autoComplete="given-name" />
        <Field label="Nom" value={lastName} onChange={setLastName} autoComplete="family-name" />
        <Field label="Adresse e-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Mot de passe" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={`${MIN_PASSWORD} caractères minimum`} />
        {create.error && <p className="form-error">{create.error}</p>}
        <button className="btn btn-primary block" disabled={create.busy}>
          {create.busy ? 'Création…' : 'Créer mon accès'}
        </button>
      </form>
    </Shell>
  );
}
