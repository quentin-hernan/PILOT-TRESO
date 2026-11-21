import type { Operation } from '../../types';
import { PRO_CATEGORIES } from '../../data/categories';
import { formatMonthTitle, parisYMD } from '../../lib/dates';
import { opsOfMonth, totals } from '../../lib/stats';
import { Hero } from '../../components/Hero';
import { DemoBar } from '../../components/DemoBar';
import { GroupedOperations, OperationList } from '../../components/OperationList';
import { Icon } from '../../components/Icon';

interface Props {
  /** Uniquement les opérations saisies par cet employé. */
  ops: Operation[];
  view: 'home' | 'all';
  /** Fourni seulement en démonstration. */
  onDemo?: (kind: 'depense' | 'recette') => void;
  onSeeAll: () => void;
}

export function EmployeeHome({ ops, view, onDemo, onSeeAll }: Props) {
  const t = parisYMD(new Date());
  const monthOps = opsOfMonth(ops, t.y, t.m);
  const { expense } = totals(monthOps);

  if (view === 'all') {
    return (
      <>
        <h2 className="screen-title">Mes frais</h2>
        <p className="muted">Toutes vos opérations saisies.</p>
        <section className="card">
          <GroupedOperations ops={ops} categories={PRO_CATEGORIES} />
        </section>
      </>
    );
  }

  return (
    <>
      <Hero label={`Mes frais · ${formatMonthTitle(t.y, t.m)}`} cents={expense} inverse sub="Total de vos dépenses saisies ce mois-ci" />

      {onDemo && <DemoBar onAdd={onDemo} expenseOnly />}

      <section className="card note">
        <Icon name="lock" />
        <p className="small">
          Vous ne voyez que <b>vos propres opérations</b>. Le solde de l'entreprise et les données du patron ne sont pas accessibles
          avec ce compte.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Mes dernières opérations</h3>
          <button className="link" onClick={onSeeAll}>
            Tout voir
          </button>
        </div>
        <OperationList ops={ops} categories={PRO_CATEGORIES} limit={6} empty="Dictez votre première dépense avec le micro." />
      </section>
    </>
  );
}
