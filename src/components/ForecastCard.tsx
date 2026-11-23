import type { Forecast } from '../lib/forecast';
import { addDaysKey, diffDays, todayKey, ymdOfKey } from '../lib/forecast';
import { formatEuros, formatEurosRound, formatSigned } from '../lib/money';
import { Icon } from './Icon';
import type { Alert } from '../lib/forecast';

const shortDate = (key: string): string => {
  const p = ymdOfKey(key);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

/** Courbe du solde prévu sur 90 jours. */
function Curve({ series }: { series: number[] }) {
  const W = 300;
  const H = 70;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const span = Math.max(1, max - min);
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  // courbe en paliers : le solde ne change que les jours où quelque chose se passe
  let d = `M0 ${y(series[0]).toFixed(1)}`;
  for (let i = 1; i < series.length; i++) d += ` H${x(i).toFixed(1)} V${y(series[i]).toFixed(1)}`;
  const negative = min < 0;
  return (
    <svg className="fc-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Évolution du solde prévu sur 90 jours">
      {negative && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="fc-zero" />}
      <path d={d} className="fc-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ForecastCard({ forecast, professional }: { forecast: Forecast; professional: boolean }) {
  const today = todayKey();
  const negative = forecast.low.balanceCents < 0;
  return (
    <section className="card">
      <div className="card-head">
        <h3>Prévisions de trésorerie</h3>
      </div>
      <div className="fc-tiles">
        {forecast.horizons.map((h) => (
          <div key={h.days}>
            <small>Dans {h.days} jours</small>
            <b className={h.balanceCents < 0 ? 'neg' : ''}>{formatEurosRound(h.balanceCents)}</b>
            <span className="muted">{shortDate(h.date)}</span>
          </div>
        ))}
      </div>
      <Curve series={forecast.series} />
      <p className={`small ${negative ? 'neg' : 'muted'}`}>
        Point le plus bas : <b>{formatEuros(forecast.low.balanceCents)}</b>
        {diffDays(today, forecast.low.date) > 0 ? ` le ${shortDate(forecast.low.date)}` : " aujourd'hui"}
      </p>

      <p className="muted small">
        Calculé à partir du solde actuel, de vos récurrences{professional ? ', de vos factures en attente' : ''} et de vos dépenses habituelles
        {forecast.habitual
          ? ` (en moyenne ${formatEuros(forecast.habitual.expensePerMonthCents)} par mois${forecast.habitual.incomePerMonthCents > 0 ? `, pour ${formatEuros(forecast.habitual.incomePerMonthCents)} de recettes habituelles` : ''}, d'après ${
              forecast.habitual.months > 0 ? `les ${forecast.habitual.months} dernier${forecast.habitual.months > 1 ? 's' : ''} mois` : 'ce mois-ci'
            })`
          : ' (pas encore assez d’historique pour les estimer)'}.
        {forecast.overdueReceivableCents > 0 &&
          ` ${formatEuros(forecast.overdueReceivableCents)} de factures à encaisser en retard ne sont pas comptés.`}
      </p>
    </section>
  );
}

/** « À venir » : les prochaines dépenses et recettes (récurrences, opérations prévues, factures), par date. */
export function UpcomingCard({ events, today, onRemovePlanned }: { events: Forecast['events']; today: string; onRemovePlanned?: (id: string) => void }) {
  const horizon = addDaysKey(today, 31);
  const list = events.filter((e) => e.date >= today && e.date <= horizon).slice(0, 8);
  const monthEnd = today.slice(0, 7);
  const monthTotal = events.filter((e) => e.date > today && e.date.slice(0, 7) === monthEnd).reduce((s, e) => s + e.cents, 0);
  const TAG: Record<string, string> = { recurrence: 'récurrent', facture: 'facture', prevu: 'prévu' };
  return (
    <section className="card upcoming">
      <div className="card-head">
        <h3>À venir</h3>
        <span className="muted">31 prochains jours</span>
      </div>
      {list.length === 0 ? (
        <p className="empty">Rien de prévu dans les 31 prochains jours.</p>
      ) : (
        <ul className="fc-events">
          {list.map((e, i) => (
            <li key={`${e.date}-${e.label}-${i}`}>
              <span className="muted">{shortDate(e.date)}</span>
              <span className="fc-label">
                {e.label} <em className={`tag tag-${e.source}`}>{TAG[e.source]}</em>
              </span>
              <b className={e.cents < 0 ? 'neg' : 'pos'}>
                {formatSigned(e.cents)}
                {e.source === 'prevu' && e.id && onRemovePlanned && (
                  <button className="mini-x" aria-label="Supprimer cette opération prévue" onClick={() => onRemovePlanned(e.id!)}>
                    ×
                  </button>
                )}
              </b>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <p className="muted small">
          D'ici la fin du mois : <b className={monthTotal < 0 ? 'neg' : 'pos'}>{formatSigned(monthTotal)}</b>
        </p>
      )}
    </section>
  );
}

export function AlertsCard({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <section className="card alerts" aria-label="Alertes">
      <div className="card-head">
        <h3>Alertes</h3>
        <span className="muted">{alerts.length}</span>
      </div>
      <ul>
        {alerts.slice(0, 6).map((a) => (
          <li key={a.id} className={`alert ${a.level}`}>
            <Icon name="alert" size={18} />
            <span>
              <b>{a.title}</b>
              <small>{a.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      {alerts.length > 6 && <p className="muted small">+ {alerts.length - 6} autre(s) alerte(s).</p>}
    </section>
  );
}
