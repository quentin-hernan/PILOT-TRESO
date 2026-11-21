import type { Operation } from '../../types';
import type { Alert, Forecast } from '../../lib/forecast';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import { formatEuros } from '../../lib/money';
import { formatMonthTitle, parisYMD } from '../../lib/dates';
import { opsOfMonth, signed, totals } from '../../lib/stats';
import { Hero } from '../../components/Hero';
import { DemoBar } from '../../components/DemoBar';
import { OperationList } from '../../components/OperationList';
import { Progress } from '../../components/Bars';
import { AlertsCard, ForecastCard } from '../../components/ForecastCard';

interface Props {
  ops: Operation[];
  /** Solde de départ (centimes). */
  openingCents: number;
  /** Fournis seulement en démonstration. */
  onDemo?: (kind: 'depense' | 'recette') => void;
  onEditOpening?: () => void;
  onSeeAll: () => void;
  /** Budget mensuel par catégorie. */
  budgets: Map<string, number>;
  alerts: Alert[];
  forecast: Forecast;
}

export function PersonalHome({ ops, openingCents, onDemo, onEditOpening, onSeeAll, budgets, alerts, forecast }: Props) {
  const budgetTotal = [...budgets.values()].reduce((s, v) => s + v, 0);
  const t = parisYMD(new Date());
  const monthKey = t.y * 12 + t.m;
  const { income, expense } = totals(opsOfMonth(ops, t.y, t.m));
  // Report = solde de départ + résultat de tous les mois précédents.
  const carry =
    openingCents +
    ops
      .filter((o) => {
        const p = parisYMD(o.date);
        return p.y * 12 + p.m < monthKey;
      })
      .reduce((s, o) => s + signed(o), 0);
  const available = carry + income - expense;

  return (
    <>
      <Hero
        label={`Disponible · ${formatMonthTitle(t.y, t.m)}`}
        cents={available}
        sub={`Report ${formatEuros(carry)} + recettes − dépenses`}
        action={
          onEditOpening && (
            <button className="hero-link" onClick={onEditOpening}>
              Modifier le solde de départ
            </button>
          )
        }
      >
        <div className="hero-tiles">
          <div>
            <small>Encaissé</small>
            <b className="pos-light">+{formatEuros(income)}</b>
          </div>
          <div>
            <small>Dépensé</small>
            <b className="neg-light">−{formatEuros(expense)}</b>
          </div>
        </div>
      </Hero>

      {onDemo && <DemoBar onAdd={onDemo} />}

      <AlertsCard alerts={alerts} />

      <section className="card">
        <div className="card-head">
          <h3>Budget du mois</h3>
          <span className="muted">
            {formatEuros(expense)} / {formatEuros(budgetTotal)}
          </span>
        </div>
        <Progress value={expense} max={budgetTotal} />
        <p className="muted small">
          {expense <= budgetTotal
            ? `Il vous reste ${formatEuros(budgetTotal - expense)} à dépenser dans le budget prévu.`
            : `Budget dépassé de ${formatEuros(expense - budgetTotal)}.`}
        </p>
      </section>

      <ForecastCard forecast={forecast} professional={false} />

      <section className="card">
        <div className="card-head">
          <h3>Dernières opérations</h3>
          <button className="link" onClick={onSeeAll}>
            Tout voir
          </button>
        </div>
        <OperationList ops={ops} categories={PERSONAL_CATEGORIES} limit={6} />
      </section>
    </>
  );
}
