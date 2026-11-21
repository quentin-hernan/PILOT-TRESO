import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatShortDate } from '../../lib/dates';
import { Icon } from '../../components/Icon';
import { MatrixCard } from './ProHome';

interface Member {
  userId: string;
  role: 'patron' | 'employe';
  name: string;
}
interface Invite {
  code: string;
  expiresAt: string;
}

/** Équipe réelle (Supabase) : membres et codes d'invitation. Réservé au patron. */
export function ProTeamLive({ orgId, myId }: { orgId: string; myId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: ms, error: e1 } = await supabase.from('members').select('user_id, role').eq('org_id', orgId);
    if (e1) return setError(e1.message);
    const ids = (ms ?? []).map((m) => m.user_id);
    const { data: ps } = await supabase.from('profiles').select('id, display_name').in('id', ids);
    const names = new Map((ps ?? []).map((p) => [p.id, p.display_name as string]));
    setMembers((ms ?? []).map((m) => ({ userId: m.user_id, role: m.role, name: names.get(m.user_id) ?? '—' })));

    const { data: inv, error: e2 } = await supabase
      .from('invitations')
      .select('code, expires_at')
      .eq('org_id', orgId)
      .is('used_by', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (e2) return setError(e2.message);
    setInvites((inv ?? []).map((i) => ({ code: i.code, expiresAt: i.expires_at })));
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvite = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('create_invitation', { p_org: orgId });
    if (e) setError(e.message);
    await load();
    setBusy(false);
  };

  const removeMember = async (userId: string, name: string) => {
    if (!supabase || !window.confirm(`Retirer ${name} de l'équipe ? Il perdra l'accès à l'entreprise.`)) return;
    const { error: e } = await supabase.from('members').delete().eq('org_id', orgId).eq('user_id', userId);
    if (e) setError(e.message);
    await load();
  };

  const revokeInvite = async (code: string) => {
    if (!supabase) return;
    await supabase.from('invitations').delete().eq('code', code);
    await load();
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* copie non disponible : le code reste affiché */
    }
  };

  return (
    <>
      <h2 className="screen-title">Équipe & accès</h2>
      <p className="muted">Invitez vos employés avec un code. Ils ne verront que leurs propres dépenses.</p>

      {error && <p className="form-error">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h3>Membres</h3>
          <span className="muted">{members.length}</span>
        </div>
        <ul className="members">
          {members.map((m) => (
            <li key={m.userId}>
              <span className={`avatar ${m.role === 'employe' ? 'alt' : ''}`}>{(m.name || '?').charAt(0).toUpperCase()}</span>
              <span className="op-body">
                <span className="op-label">{m.userId === myId ? `${m.name} (vous)` : m.name}</span>
                <span className="op-meta">{m.role === 'patron' ? 'Patron' : 'Employé'}</span>
              </span>
              <span className={`badge badge-${m.role}`}>{m.role === 'patron' ? 'Patron' : 'Employé'}</span>
              {m.userId !== myId && (
                <button className="icon-btn" aria-label={`Retirer ${m.name}`} onClick={() => removeMember(m.userId, m.name)}>
                  <Icon name="x" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Inviter un employé</h3>
        </div>
        <p className="muted small">
          Générez un code et transmettez-le à votre employé. Il choisit « J'ai un code d'invitation » à l'inscription. Le code
          est valable 7 jours et ne sert qu'une fois.
        </p>
        <button className="btn btn-primary block" onClick={createInvite} disabled={busy}>
          {busy ? 'Création…' : '+ Générer un code d’invitation'}
        </button>
        {invites.length > 0 && (
          <ul className="invites">
            {invites.map((i) => (
              <li key={i.code}>
                <code>{i.code}</code>
                <small className="muted">jusqu'au {formatShortDate(i.expiresAt)}</small>
                <button className="link" onClick={() => copy(i.code)}>
                  {copied === i.code ? 'Copié' : 'Copier'}
                </button>
                <button className="icon-btn" aria-label="Annuler ce code" onClick={() => revokeInvite(i.code)}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MatrixCard />
    </>
  );
}
