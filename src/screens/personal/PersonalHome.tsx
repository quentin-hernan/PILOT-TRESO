import type { Operation } from '../../types';
import type { Alert, Forecast } from '../../lib/forecast';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import type { MonthlyBudget } from '../../lib/monthly';
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
  /** Budget du mois calculé : revenus − charges fixes. */
  monthly: MonthlyBudget;
  alerts: Alert[];
  forecast: Forecast;
}

export function PersonalHome({ ops, openingCents, onDemo, onEditOpening, onSeeAll, monthly, alerts, forecast }: Props) {
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
          {monthly.budgetCents > 0 && (
            <span className="muted">
              {formatEuros(monthly.variableCents)} / {formatEuros(monthly.budgetCents)}
            </span>
          )}
        </div>
        {monthly.incomeCents === 0 ? (
          <p className="muted small">Aucun revenu ce mois-ci. Ajoutez votre salaire (ou une récurrence de salaire) : le budget se calcule tout seul.</p>
        ) : (
          <>
            <dl className="budget-lines">
              <div>
                <dt>
                  Revenus du mois
                  {monthly.incomeToComeCents > 0 && <small> dont {formatEuros(monthly.incomeToComeCents)} à venir</small>}
                </dt>
                <dd className="pos">+{formatEuros(monthly.incomeCents)}</dd>
              </div>
              <div>
                <dt>
                  Charges fixes
                  {monthly.fixedToComeCents > 0 && <small> dont {formatEuros(monthly.fixedToComeCents)} à venir</small>}
                </dt>
                <dd className="neg">−{formatEuros(monthly.fixedCents)}</dd>
              </div>
              <div className="total">
                <dt>Disponible pour vivre</dt>
                <dd>{formatEuros(monthly.budgetCents)}</dd>
              </div>
            </dl>
            {monthly.budgetCents > 0 && <Progress value={monthly.variableCents} max={monthly.budgetCents} />}
            <p className="muted small">
              {monthly.budgetCents <= 0
                ? 'Vos charges fixes dépassent vos revenus du mois.'
                : monthly.remainingCents >= 0
                  ? `Dépensé ${formatEuros(monthly.variableCents)} en dépenses courantes : il vous reste ${formatEuros(monthly.remainingCents)} ce mois-ci.`
                  : `Dépensé ${formatEuros(monthly.variableCents)} en dépenses courantes : budget dépassé de ${formatEuros(-monthly.remainingCents)}.`}
            </p>
          </>
        )}
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
