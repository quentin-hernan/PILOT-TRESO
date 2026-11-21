import type { CategoryTotal } from '../lib/stats';
import { formatEuros, formatEurosRound } from '../lib/money';
import { Icon } from './Icon';

/** Barre de progression : vert, orange puis rouge selon le niveau. */
export function Progress({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? value / max : 0;
  const tone = ratio > 1 ? 'over' : ratio >= 0.85 ? 'warn' : 'ok';
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}

/** Répartition en une seule barre colorée + légende. */
export function StackedShare({ items }: { items: CategoryTotal[] }) {
  const total = items.reduce((s, i) => s + i.cents, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="stacked">
        {items.map((i) => (
          <span key={i.category.id} style={{ width: `${(i.cents / total) * 100}%`, background: i.category.color }} />
        ))}
      </div>
      <ul className="legend">
        {items.slice(0, 6).map((i) => (
          <li key={i.category.id}>
            <span className="dot" style={{ background: i.category.color }} />
            {i.category.label} <b>{Math.round((i.cents / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Une ligne par catégorie, avec barre relative. */
export function CategoryBars({ items }: { items: CategoryTotal[] }) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  if (items.length === 0) return <p className="empty">Rien à afficher.</p>;
  return (
    <ul className="catbars">
      {items.map((i) => (
        <li key={i.category.id}>
          <div className="catbar-head">
            <span className="cat-name">
              <Icon name={i.category.icon} size={16} /> {i.category.label}
            </span>
            <b>{formatEuros(i.cents)}</b>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${(i.cents / max) * 100}%`, background: i.category.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Mini histogramme des dépenses par jour du mois. */
export function DailyBars({ values, todayIndex }: { values: number[]; todayIndex: number | null }) {
  const max = Math.max(1, ...values);
  return (
    <div className="daily" aria-label="Dépenses par jour">
      {values.map((v, i) => (
        <div key={i} className="daily-col" title={`${i + 1} : ${formatEurosRound(v)}`}>
          <span className={`daily-bar ${i === todayIndex ? 'today' : ''}`} style={{ height: `${Math.max(v > 0 ? 6 : 2, (v / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
