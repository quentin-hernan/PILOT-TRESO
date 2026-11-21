import { useState } from 'react';
import type { Category, Recurring } from '../types';
import type { RecurringDraft } from '../data/usePlanning';
import { formatEuros } from '../lib/money';
import { nextOccurrence, todayKey, ymdOfKey } from '../lib/forecast';
import { Icon } from '../components/Icon';
import { RecurringSheet } from '../components/PlanSheets';

interface Props {
  recurrings: Recurring[];
  categories: Category[];
  professional: boolean;
  onAdd: (d: RecurringDraft) => Promise<unknown>;
  onUpdate: (id: string, d: RecurringDraft) => Promise<void>;
  onSetActive: (id: string, active: boolean) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

const shortDate = (key: string): string => {
  const p = ymdOfKey(key);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

/** Liste des récurrences (compte particulier et professionnel) avec ajout / modification / pause / suppression. */
export function Recurrences({ recurrings, categories, professional, onAdd, onUpdate, onSetActive, onRemove }: Props) {
  const [sheet, setSheet] = useState<{ rec?: Recurring } | null>(null);
  const today = todayKey();

  const withNext = recurrings
    .map((r) => ({ r, next: nextOccurrence(r.dayOfMonth, today) }))
    .sort((a, b) => (a.r.active === b.r.active ? a.next.localeCompare(b.next) : a.r.active ? -1 : 1));
  const active = withNext.filter((x) => x.r.active);
  const thisMonthKey = today.slice(0, 7);
  const toPass = active.filter((x) => x.next.slice(0, 7) === thisMonthKey);
  const income = active.filter((x) => x.r.kind === 'recette').reduce((s, x) => s + x.r.amountCents, 0);
  const expense = active.filter((x) => x.r.kind === 'depense').reduce((s, x) => s + x.r.amountCents, 0);

  const Row = ({ r, next }: { r: Recurring; next: string }) => {
    const cat = categories.find((c) => c.id === r.categoryId);
    return (
      <li className={`row-click ${r.active ? '' : 'paused'}`} onClick={() => setSheet({ rec: r })}>
        <span className="op-icon">
          <Icon name={cat?.icon ?? 'dots'} size={19} />
        </span>
        <span className="op-body">
          <span className="op-label">{r.label}</span>
          <span className="op-meta">Le {r.dayOfMonth} de chaque mois</span>
        </span>
        <span className={`op-amount ${r.kind === 'recette' ? 'pos' : 'neg'}`}>
          {r.kind === 'recette' ? '+' : '−'}
          {formatEuros(r.amountCents)}
        </span>
        <span className={`pill ${r.active ? 'pill-todo' : 'pill-late'}`}>{r.active ? shortDate(next) : 'En pause'}</span>
      </li>
    );
  };

  return (
    <>
      <section className="summary two">
        <div>
          <small>{professional ? 'Encaissements fixes' : 'Revenus fixes'}</small>
          <b className="pos">+{formatEuros(income)}</b>
        </div>
        <div>
          <small>{professional ? 'Décaissements fixes' : 'Charges fixes'}</small>
          <b className="neg">−{formatEuros(expense)}</b>
        </div>
      </section>

      <div className="add-row">
        <button className="btn btn-primary btn-small" onClick={() => setSheet({})}>
          <Icon name="plus" size={16} /> Ajouter une récurrence
        </button>
      </div>

      {recurrings.length === 0 ? (
        <section className="card center-card">
          <p>Aucune récurrence. Ajoutez votre {professional ? 'loyer, vos assurances, abonnements…' : 'salaire, loyer, abonnements…'} : ils seront créés automatiquement chaque mois.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h3>Reste à passer ce mois-ci</h3>
              <span className="muted">{toPass.length}</span>
            </div>
            {toPass.length === 0 ? (
              <p className="empty">Tout est passé ce mois-ci.</p>
            ) : (
              <ul className="recurrings">
                {toPass.map((x) => (
                  <Row key={x.r.id} {...x} />
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Toutes les récurrences</h3>
              <span className="muted">{recurrings.length}</span>
            </div>
            <ul className="recurrings">
              {withNext.map((x) => (
                <Row key={x.r.id} {...x} />
              ))}
            </ul>
          </section>
        </>
      )}

      {sheet && (
        <RecurringSheet
          initial={sheet.rec}
          categories={categories}
          professional={professional}
          onSave={(d) => (sheet.rec ? onUpdate(sheet.rec.id, d) : onAdd(d))}
          onToggleActive={sheet.rec ? (a) => onSetActive(sheet.rec!.id, a) : undefined}
          onDelete={sheet.rec ? () => onRemove(sheet.rec!.id) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
