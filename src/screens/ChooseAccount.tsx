import { useState } from 'react';
import type { AccountType, ProMode } from '../types';
import { Icon } from '../components/Icon';
import { Brand } from '../components/Brand';

interface Props {
  onChoose: (account: AccountType, mode: ProMode) => void;
  /** Présents seulement quand Supabase est configuré. */
  onLogin?: () => void;
  onJoin?: () => void;
  /** Ouvre la démonstration (données fictives). */
  onDemo?: () => void;
  /** Dans la démo : retour à l'écran précédent. */
  onQuitDemo?: () => void;
}

export function ChooseAccount({ onChoose, onLogin, onJoin, onDemo, onQuitDemo }: Props) {
  const [step, setStep] = useState<'type' | 'pro'>('type');
  const live = Boolean(onLogin);

  return (
    <main className="welcome">
      <Brand />

      {step === 'type' ? (
        <section aria-labelledby="choose-title">
          {live && (
            <button className="btn btn-primary block login-cta" onClick={onLogin}>
              J'ai déjà un compte — Me connecter
            </button>
          )}
          <h2 id="choose-title">{live ? 'Ou créez un compte' : 'Quel compte souhaitez-vous créer ?'}</h2>
          <p className="muted center">Deux espaces totalement séparés, chacun sécurisé.</p>

          <div className="choices">
            <button className="choice choice-perso" onClick={() => onChoose('particulier', 'solo')}>
              <span className="choice-icon">
                <Icon name="home" size={22} />
              </span>
              <span className="choice-title">Particulier</span>
              <span className="choice-text">Mon budget du mois : dépenses du quotidien, récurrences et catégories.</span>
              <ul>
                <li>Vue mensuelle claire</li>
                <li>Budget par catégorie</li>
                <li>Salaire, crédit, abonnements</li>
              </ul>
            </button>

            <button className="choice choice-pro" onClick={() => setStep('pro')}>
              <span className="choice-icon">
                <Icon name="building" size={22} />
              </span>
              <span className="choice-title">Professionnel</span>
              <span className="choice-text">Ma trésorerie d'activité : encaissements, décaissements, factures et échéances.</span>
              <ul>
                <li>Factures et échéances</li>
                <li>Employés avec accès limité</li>
                <li>Prêt pour ma matrice Excel</li>
              </ul>
            </button>
          </div>

          {onJoin && (
            <button className="link-row" onClick={onJoin}>
              Je suis employé et j'ai un <b>code d'invitation</b>
            </button>
          )}
        </section>
      ) : (
        <section aria-labelledby="pro-title">
          <button className="back" onClick={() => setStep('type')}>
            <Icon name="chevLeft" size={18} /> Retour
          </button>
          <h2 id="pro-title">Comment travaillez-vous ?</h2>
          <p className="muted center">Cela définit qui peut utiliser l'application.</p>

          <div className="choices">
            <button className="choice choice-pro" onClick={() => onChoose('professionnel', 'solo')}>
              <span className="choice-icon">
                <Icon name="wrench" size={22} />
              </span>
              <span className="choice-title">Auto-entrepreneur</span>
              <span className="choice-text">Un seul utilisateur, toutes les permissions.</span>
            </button>
            <button className="choice choice-pro" onClick={() => onChoose('professionnel', 'equipe')}>
              <span className="choice-icon">
                <Icon name="users" size={22} />
              </span>
              <span className="choice-title">Entreprise avec employés</span>
              <span className="choice-text">
                Vous êtes <b>Patron</b> : vous voyez tout. Vos <b>employés</b> saisissent leurs propres dépenses, sans accès à vos comptes.
              </span>
            </button>
          </div>
        </section>
      )}

      {onDemo && (
        <button className="link-row" onClick={onDemo}>
          Voir la démonstration (données fictives)
        </button>
      )}
      {onQuitDemo && (
        <button className="link-row" onClick={onQuitDemo}>
          Quitter la démonstration
        </button>
      )}
      {!live && !onQuitDemo && <p className="demo-note">Version de démonstration — données fictives, aucune donnée enregistrée.</p>}
    </main>
  );
}
