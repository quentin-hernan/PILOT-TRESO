import { useState, type ReactNode } from 'react';
import type { Invoice } from '../../types';
import type { PlanningApi } from '../../data/usePlanning';
import { PRO_CATEGORIES } from '../../data/categories';
import { daysUntil, formatShortDate } from '../../lib/dates';
import { formatEuros } from '../../lib/money';
import { Segmented } from '../../components/Segmented';
import { Icon } from '../../components/Icon';
import { InvoiceSheet } from '../../components/PlanSheets';
import { Recurrences } from '../Recurrences';

export function DueBadge({ dueDate }: { dueDate: string }) {
  const d = daysUntil(dueDate);
  if (d < 0) return <span className="pill pill-late">En retard de {-d} j</span>;
  if (d === 0) return <span className="pill pill-soon">Aujourd'hui</span>;
  if (d <= 7) return <span className="pill pill-soon">Dans {d} j</span>;
  return <span className="pill pill-todo">Le {formatShortDate(dueDate)}</span>;
}

export function InvoiceRow({ inv, onClick, action }: { inv: Invoice; onClick?: () => void; action?: ReactNode }) {
  const incoming = inv.direction === 'a_encaisser';
  const paid = inv.status === 'payee';
  return (
    <li className={`invoice ${onClick ? 'row-click' : ''} ${paid ? 'paused' : ''}`} onClick={onClick}>
      <span className="op-icon">
        <Icon name={incoming ? 'arrowDown' : 'arrowUp'} size={19} />
      </span>
      <span className="op-body">
        <span className="op-label">{inv.counterparty}</span>
        <span className="op-meta">{inv.label}</span>
        {action}
      </span>
      <span className="invoice-right">
        <span className={`op-amount ${incoming ? 'pos' : 'neg'}`}>
          {incoming ? '+' : '−'}
          {formatEuros(inv.amountCents)}
        </span>
        {paid ? <span className="pill pill-done">{incoming ? 'Encaissée' : 'Payée'}</span> : <DueBadge dueDate={inv.dueDate} />}
      </span>
    </li>
  );
}

type View = Invoice['direction'] | 'recurrents';

interface Props {
  planning: PlanningApi;
  /** Marque la facture comme réglée et crée l'opération correspondante. */
  onSettle: (inv: Invoice) => Promise<void>;
}

export function Invoices({ planning, onSettle }: Props) {
  const { invoices } = planning;
  const [view, setView] = useState<View>('a_encaisser');
  const [showPaid, setShowPaid] = useState(false);
  const [sheet, setSheet] = useState<{ inv?: Invoice } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = invoices.filter((i) => i.status === 'en_attente');
  const sum = (d: Invoice['direction']) => pending.filter((i) => i.direction === d).reduce((s, i) => s + i.amountCents, 0);
  const list =
    view === 'recurrents'
      ? []
      : invoices
          .filter((i) => i.direction === view && (showPaid || i.status === 'en_attente'))
          .sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === 'en_attente' ? -1 : 1));
  const paidCount = view === 'recurrents' ? 0 : invoices.filter((i) => i.direction === view && i.status === 'payee').length;

  const settle = async (inv: Invoice) => {
    setBusyId(inv.id);
    setError(null);
    try {
      await onSettle(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h2 className="screen-title">Factures & échéances</h2>

      <section className="summary two">
        <div>
          <small>À encaisser</small>
          <b className="pos">+{formatEuros(sum('a_encaisser'))}</b>
        </div>
        <div>
          <small>À payer</small>
          <b className="neg">−{formatEuros(sum('a_payer'))}</b>
        </div>
      </section>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'a_encaisser', label: 'À encaisser' },
          { value: 'a_payer', label: 'À payer' },
          { value: 'recurrents', label: 'Récurrents' },
        ]}
      />

      {view === 'recurrents' ? (
        <Recurrences
          recurrings={planning.recurrings}
          categories={PRO_CATEGORIES}
          professional
          onAdd={planning.addRecurring}
          onUpdate={planning.updateRecurring}
          onSetActive={planning.setRecurringActive}
          onRemove={planning.removeRecurring}
        />
      ) : (
        <>
          <div className="add-row">
            <button className="btn btn-primary btn-small" onClick={() => setSheet({})}>
              <Icon name="plus" size={16} /> Ajouter une facture
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <section className="card">
            {list.length === 0 ? (
              <p className="empty">{view === 'a_encaisser' ? 'Aucune facture à encaisser.' : 'Aucune facture à payer.'}</p>
            ) : (
              <ul className="ops">
                {list.map((i) => (
                  <InvoiceRow
                    key={i.id}
                    inv={i}
                    onClick={() => setSheet({ inv: i })}
                    action={
                      i.status === 'en_attente' && (
                        <span className="invoice-actions">
                          <button
                            className="btn btn-ghost btn-small"
                            disabled={busyId === i.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void settle(i);
                            }}
                          >
                            <Icon name="check" size={14} /> {busyId === i.id ? 'Enregistrement…' : i.direction === 'a_encaisser' ? 'Marquer encaissée' : 'Marquer payée'}
                          </button>
                        </span>
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {paidCount > 0 && (
              <button className="link" onClick={() => setShowPaid((v) => !v)}>
                {showPaid ? 'Masquer les factures réglées' : `Afficher les factures réglées (${paidCount})`}
              </button>
            )}
          </section>
          <p className="muted small">
            Marquer une facture comme réglée crée l’opération du jour dans vos flux et la retire des prévisions. Vous pourrez la corriger ensuite en la touchant.
          </p>
        </>
      )}

      {sheet && (
        <InvoiceSheet
          initial={sheet.inv}
          onSave={(d) => (sheet.inv ? planning.updateInvoice(sheet.inv.id, d) : planning.addInvoice({ ...d, direction: d.direction }))}
          onDelete={sheet.inv ? () => planning.removeInvoice(sheet.inv!.id) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
