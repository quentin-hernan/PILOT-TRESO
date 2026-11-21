import { useContext } from 'react';
import type { Category, Operation } from '../types';
import { OperationSelectContext } from './OperationContext';
import { formatDayLabel } from '../lib/dates';
import { formatSigned } from '../lib/money';
import { signed } from '../lib/stats';
import { Icon } from './Icon';

interface Props {
  ops: Operation[];
  categories: Category[];
  limit?: number;
  showAuthor?: boolean;
  empty?: string;
}

export function OperationList({ ops, categories, limit, showAuthor, empty }: Props) {
  const onSelect = useContext(OperationSelectContext);
  const list = limit ? ops.slice(0, limit) : ops;
  if (list.length === 0) return <p className="empty">{empty ?? 'Aucune opération. Appuyez sur le micro pour en ajouter une.'}</p>;

  return (
    <ul className="ops">
      {list.map((o) => {
        const cat = categories.find((c) => c.id === o.categoryId);
        const amount = signed(o);
        return (
          <li
            key={o.id}
            className={`op ${o.fresh ? 'op-fresh' : ''} ${onSelect ? 'op-click' : ''}`}
            {...(onSelect
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `Modifier ${o.label}`,
                  onClick: () => onSelect(o),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(o);
                    }
                  },
                }
              : {})}
          >
            <span className="op-icon">
              <Icon name={cat?.icon ?? 'dots'} size={19} />
            </span>
            <span className="op-body">
              <span className="op-label">{o.label}</span>
              <span className="op-meta">
                {cat?.label ?? 'Autre'} · {formatDayLabel(o.date)}
                {showAuthor && o.author && (
                  <span className={`badge badge-${o.author}`}>{o.author === 'employe' ? 'Employé' : 'Patron'}</span>
                )}
              </span>
            </span>
            <span className={`op-amount ${amount < 0 ? 'neg' : 'pos'}`}>{formatSigned(amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Opérations regroupées par jour. */
export function GroupedOperations({ ops, categories, showAuthor }: Omit<Props, 'limit' | 'empty'>) {
  if (ops.length === 0) return <p className="empty">Aucune opération ce mois-ci.</p>;
  const groups: { label: string; ops: Operation[] }[] = [];
  for (const o of ops) {
    const label = formatDayLabel(o.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.ops.push(o);
    else groups.push({ label, ops: [o] });
  }
  return (
    <div className="groups">
      {groups.map((g) => (
        <div key={g.label}>
          <h4 className="group-title">{g.label}</h4>
          <OperationList ops={g.ops} categories={categories} showAuthor={showAuthor} />
        </div>
      ))}
    </div>
  );
}
