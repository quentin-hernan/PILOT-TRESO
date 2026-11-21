import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AccountType, ProMode, ProRole } from '../types';
import { supabase, supabaseConfigured } from '../lib/supabase';

export interface Profile {
  id: string;
  displayName: string;
  accountType: AccountType;
}

export interface Membership {
  orgId: string;
  orgName: string;
  mode: ProMode;
  role: ProRole;
}

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  accountType: AccountType;
  mode?: ProMode;
  orgName?: string;
  inviteCode?: string;
}

type State =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'error'; message: string }
  | { status: 'in'; session: Session; profile: Profile; membership: Membership | null };

interface AuthApi {
  configured: boolean;
  state: State;
  signUp: (input: SignUpInput) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Renvoie le nom de l'entreprise si le code d'invitation est valide, sinon null. */
  checkInvitation: (code: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}

/** Traduit les messages d'erreur techniques en français. */
function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Un compte existe déjà avec cet e-mail.';
  if (m.includes('password should be at least')) return 'Mot de passe trop court.';
  if (m.includes('email not confirmed')) return "E-mail non confirmé. Dans Supabase, désactivez « Confirm email » (Authentication > Providers > Email).";
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Adresse e-mail invalide.';
  if (m.includes('database error saving new user')) return "Création impossible : code d'invitation invalide ou expiré.";
  if (m.includes('failed to fetch') || m.includes('network')) return 'Connexion impossible. Vérifiez votre accès internet.';
  return message;
}

async function loadAccount(userId: string): Promise<{ profile: Profile; membership: Membership | null }> {
  if (!supabase) throw new Error('Supabase non configuré');
  const { data: p, error: pe } = await supabase
    .from('profiles')
    .select('id, display_name, account_type')
    .eq('id', userId)
    .maybeSingle();
  if (pe) throw new Error(pe.message);
  if (!p) throw new Error("Profil introuvable. Le script SQL de l'étape 2 a-t-il bien été exécuté avant la création du compte ?");

  const profile: Profile = { id: p.id, displayName: p.display_name, accountType: p.account_type };
  if (profile.accountType !== 'professionnel') return { profile, membership: null };

  const { data: m, error: me } = await supabase
    .from('members')
    .select('org_id, role, organizations ( name, mode )')
    .eq('user_id', userId)
    .maybeSingle();
  if (me) throw new Error(me.message);
  if (!m) return { profile, membership: null };
  const org = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as { name: string; mode: ProMode } | null;
  return {
    profile,
    membership: { orgId: m.org_id, orgName: org?.name ?? '', mode: org?.mode ?? 'solo', role: m.role },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(supabaseConfigured ? { status: 'loading' } : { status: 'out' });

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        setState({ status: 'out' });
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        setState({ status: 'loading' });
        // Ne jamais attendre un appel Supabase directement dans ce callback (risque de blocage).
        setTimeout(() => {
          loadAccount(session.user.id)
            .then((acc) => setState({ status: 'in', session, ...acc }))
            .catch((e: Error) => setState({ status: 'error', message: e.message }));
        }, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    if (!supabase) throw new Error('Supabase non configuré');
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: {
          account_type: input.accountType,
          display_name: input.displayName.trim(),
          mode: input.mode ?? 'solo',
          org_name: input.orgName?.trim() ?? '',
          invite_code: input.inviteCode?.trim() ?? '',
        },
      },
    });
    if (error) throw new Error(translate(error.message));
    if (!data.session) {
      throw new Error(
        "Compte créé, mais Supabase demande une confirmation par e-mail. Désactivez « Confirm email » (Authentication > Providers > Email) puis connectez-vous.",
      );
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase non configuré');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(translate(error.message));
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const checkInvitation = useCallback(async (code: string) => {
    if (!supabase) throw new Error('Supabase non configuré');
    const { data, error } = await supabase.rpc('check_invitation', { p_code: code });
    if (error) throw new Error(translate(error.message));
    return (data as string | null) ?? null;
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ configured: supabaseConfigured, state, signUp, signIn, signOut, checkInvitation }),
    [state, signUp, signIn, signOut, checkInvitation],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
