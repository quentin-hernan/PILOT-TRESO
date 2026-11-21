import type { ProRole } from '../../types';
import { Icon, type IconName } from '../../components/Icon';
import { MatrixCard } from './ProHome';

interface Props {
  role: ProRole;
  onViewAs: (role: ProRole) => void;
}

const PATRON_RIGHTS = [
  [true, 'Solde et trésorerie complète'],
  [true, 'Toutes les opérations'],
  [true, 'Factures et échéances'],
  [true, 'Gérer les employés'],
  [true, 'Paramètres et matrice Excel'],
] as const;

const EMPLOYEE_RIGHTS = [
  [true, 'Saisir ses propres dépenses'],
  [true, 'Voir ses propres opérations'],
  [false, 'Solde et comptes'],
  [false, 'Données du patron'],
  [false, 'Factures et paramètres'],
] as const;

export function ProTeam({ role, onViewAs }: Props) {
  return (
    <>
      <h2 className="screen-title">Équipe & accès</h2>
      <p className="muted">Qui voit quoi dans votre entreprise.</p>

      <div className="role-cards">
        <RoleCard
          title="Patron"
          icon="briefcase"
          rights={PATRON_RIGHTS}
          active={role === 'patron'}
          onView={() => onViewAs('patron')}
        />
        <RoleCard
          title="Employé"
          icon="user"
          rights={EMPLOYEE_RIGHTS}
          active={role === 'employe'}
          onView={() => onViewAs('employe')}
        />
      </div>

      <section className="card note">
        <Icon name="lock" />
        <p className="small">
          Ces règles seront appliquées <b>dans la base de données</b> (étape 2), pas seulement masquées dans l'écran : un employé
          ne pourra pas lire les données du patron, même en essayant.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Membres</h3>
        </div>
        <ul className="members">
          <li>
            <span className="avatar">T</span>
            <span className="op-body">
              <span className="op-label">Thomas Martin</span>
              <span className="op-meta">Patron</span>
            </span>
            <span className="badge badge-patron">Patron</span>
          </li>
          <li>
            <span className="avatar alt">J</span>
            <span className="op-body">
              <span className="op-label">Julie Moreau</span>
              <span className="op-meta">Saisit ses frais d'essence</span>
            </span>
            <span className="badge badge-employe">Employé</span>
          </li>
        </ul>
        <button className="btn btn-ghost block" disabled>
          + Inviter un employé (étape 2)
        </button>
      </section>

      <MatrixCard />
    </>
  );
}

function RoleCard({
  title,
  icon,
  rights,
  active,
  onView,
}: {
  title: string;
  icon: IconName;
  rights: readonly (readonly [boolean, string])[];
  active: boolean;
  onView: () => void;
}) {
  return (
    <section className={`card role ${active ? 'role-on' : ''}`}>
      <div className="role-head">
        <span className="role-icon">
          <Icon name={icon} size={20} />
        </span>
        <h3>{title}</h3>
        {active && <span className="pill pill-done">Vue actuelle</span>}
      </div>
      <ul className="rights">
        {rights.map(([ok, text]) => (
          <li key={text} className={ok ? 'yes' : 'no'}>
            <Icon name={ok ? 'check' : 'x'} size={16} /> {text}
          </li>
        ))}
      </ul>
      <button className={`btn block ${active ? 'btn-ghost' : 'btn-primary'}`} onClick={onView} disabled={active}>
        Voir l'appli en tant que {title.toLowerCase()}
      </button>
    </section>
  );
}
