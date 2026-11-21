import type { Forecast } from '../lib/forecast';
import { diffDays, todayKey, ymdOfKey } from '../lib/forecast';
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
  const upcoming = forecast.events.filter((e) => e.date > today || e.source === 'facture').slice(0, 5);
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

      {upcoming.length > 0 && (
        <>
          <h4 className="fc-sub">Prochains mouvements prévus</h4>
          <ul className="fc-events">
            {upcoming.map((e, i) => (
              <li key={`${e.date}-${i}`}>
                <span className="muted">{shortDate(e.date)}</span>
                <span className="fc-label">{e.label}</span>
                <b className={e.cents < 0 ? 'neg' : 'pos'}>{formatSigned(e.cents)}</b>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small">
        Calculé à partir du solde actuel, de vos récurrences{professional ? ' et de vos factures en attente' : ''}. Les dépenses courantes qui ne sont
        pas récurrentes ne sont pas estimées.
        {forecast.overdueReceivableCents > 0 &&
          ` ${formatEuros(forecast.overdueReceivableCents)} de factures à encaisser en retard ne sont pas comptés.`}
      </p>
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
