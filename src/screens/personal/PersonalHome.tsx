import type { Operation } from '../../types';
import type { Alert, Forecast } from '../../lib/forecast';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import type { EndOfMonth, MonthlyBudget } from '../../lib/monthly';
import { formatEuros } from '../../lib/money';
import { parisYMD } from '../../lib/dates';
import { opsOfMonth, totals } from '../../lib/stats';
import { Hero } from '../../components/Hero';
import { DemoBar } from '../../components/DemoBar';
import { OperationList } from '../../components/OperationList';
import { Progress } from '../../components/Bars';
import { AlertsCard, ForecastCard, UpcomingCard } from '../../components/ForecastCard';
import { todayKey } from '../../lib/forecast';

interface Props {
  ops: Operation[];
  /** Solde actuel (centimes) : solde de départ + opérations depuis ce jour. */
  balanceCents: number;
  /** Disponible du mois : solde actuel + récurrences à venir jusqu'à la fin du mois. */
  endOfMonth: EndOfMonth;
  /** Fournis seulement en démonstration. */
  onDemo?: (kind: 'depense' | 'recette') => void;
  onEditOpening?: () => void;
  onSeeAll: () => void;
  /** Budget du mois calculé : revenus − charges fixes. */
  monthly: MonthlyBudget;
  alerts: Alert[];
  forecast: Forecast;
  /** Supprime une opération prévue. */
  onRemovePlanned?: (id: string) => void;
}

export function PersonalHome({ ops, balanceCents, endOfMonth, onDemo, onEditOpening, onSeeAll, monthly, alerts, forecast, onRemovePlanned }: Props) {
  const t = parisYMD(new Date());
  const { income, expense } = totals(opsOfMonth(ops, t.y, t.m));
  const monthName = new Date(Date.UTC(t.y, t.m - 1, 1)).toLocaleDateString('fr-FR', { timeZone: 'UTC', month: 'long' });
  const toCome = [
    endOfMonth.expenseToComeCents > 0 && `− ${formatEuros(endOfMonth.expenseToComeCents)} de dépenses à venir`,
    endOfMonth.incomeToComeCents > 0 && `+ ${formatEuros(endOfMonth.incomeToComeCents)} de recettes à venir`,
  ].filter(Boolean);

  return (
    <>
      <Hero
        label={`Disponible fin ${/^[aeiouhéèêôû]/i.test(monthName) ? "d'" : 'de '}${monthName}`}
        cents={endOfMonth.availableCents}
        sub={`Solde actuel ${formatEuros(balanceCents)}${toCome.length ? ' ' + toCome.join(' ') : ' · plus rien à passer ce mois-ci'}`}
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

      <UpcomingCard events={forecast.events} today={todayKey()} onRemovePlanned={onRemovePlanned} />

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
