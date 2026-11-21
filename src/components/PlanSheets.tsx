import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Category, Invoice, Recurring } from '../types';
import type { InvoiceVoiceDraft } from '../voice/intents';
import type { InvoiceDraft, RecurringDraft } from '../data/usePlanning';
import { centsToInput, parseEurosToCents } from '../lib/money';
import { dayKeyOfIso, todayKey } from '../lib/forecast';
import { Icon } from './Icon';

/** Habillage commun : fond, fermeture par Échap, gestion de l'attente et des erreurs. */
function Shell({ title, label, children, onClose }: { title: string; label: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Affichée directement dans <body> : une fenêtre dessinée à l'intérieur d'un écran animé resterait sous la barre du bas.
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="review">
          <h3>{title}</h3>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Boutons du bas : Supprimer (avec confirmation) ou Annuler, puis Enregistrer. */
function Footer({
  busy,
  valid,
  error,
  onSave,
  onClose,
  onDelete,
  saveLabel = 'Enregistrer',
}: {
  busy: boolean;
  valid: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
  saveLabel?: string;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="actions">
        {onDelete ? (
          confirm ? (
            <button className="btn btn-danger" disabled={busy} onClick={onDelete}>
              Confirmer la suppression
            </button>
          ) : (
            <button className="btn btn-ghost danger-text" disabled={busy} onClick={() => setConfirm(true)}>
              Supprimer
            </button>
          )
        ) : (
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
        )}
        <button className="btn btn-primary" disabled={!valid || busy} onClick={onSave}>
          <Icon name="check" size={18} />
          {busy ? 'Enregistrement…' : saveLabel}
        </button>
      </div>
    </>
  );
}

function useAction(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const AmountField = ({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) => (
  <label className="field">
    <span>Montant</span>
    <div className="amount-input">
      <input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
      <i>€</i>
    </div>
  </label>
);

/* ───────── Récurrence ───────── */

/** Ce que la dictée a compris d'une récurrence (champs vides = à compléter). */
export interface RecurringPrefill {
  heard: string;
  kind: Recurring['kind'];
  amountCents: number | null;
  categoryId: string;
  label: string;
  dayOfMonth: number | null;
}

interface RecurringProps {
  initial?: Recurring;
  prefill?: RecurringPrefill;
  categories: Category[];
  professional: boolean;
  onSave: (d: RecurringDraft) => Promise<unknown>;
  onToggleActive?: (active: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function RecurringSheet({ initial, prefill, categories, professional, onSave, onToggleActive, onDelete, onClose }: RecurringProps) {
  const [kind, setKind] = useState<Recurring['kind']>(initial?.kind ?? prefill?.kind ?? 'depense');
  const [label, setLabel] = useState(initial?.label ?? prefill?.label ?? '');
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : prefill?.amountCents ? centsToInput(prefill.amountCents) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? prefill?.categoryId ?? '');
  const [day, setDay] = useState(initial ? String(initial.dayOfMonth) : prefill ? (prefill.dayOfMonth ? String(prefill.dayOfMonth) : '') : String(new Date().getDate()));
  const { busy, error, run } = useAction(onClose);

  const cats = categories.filter((c) => c.kind === kind);
  const effectiveCategory = cats.some((c) => c.id === categoryId) ? categoryId : '';
  const cents = parseEurosToCents(amount);
  const dayNum = Number(day);
  const valid = cents !== null && label.trim() !== '' && effectiveCategory !== '' && Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31;

  const missing = prefill
    ? [
        !prefill.amountCents && 'le montant',
        !prefill.categoryId && 'la catégorie',
        !prefill.dayOfMonth && 'le jour du mois',
        !prefill.label && 'le libellé',
      ].filter(Boolean)
    : [];

  const save = () =>
    run(() => onSave({ label: label.trim(), kind, amountCents: cents!, categoryId: effectiveCategory, dayOfMonth: dayNum }));

  return (
    <Shell title={initial ? 'Modifier la récurrence' : 'Nouvelle récurrence'} label="Récurrence" onClose={onClose}>
      {prefill && <p className="phrase small">Entendu : « {prefill.heard} »</p>}
      {missing.length > 0 && <p className="hint-warn">Je n’ai pas compris {missing.join(' ni ')} : complétez ci-dessous.</p>}
      <div className="segmented kind">
        <button className={kind === 'depense' ? 'on neg-on' : ''} onClick={() => setKind('depense')}>
          {professional ? 'Décaissement' : 'Dépense'}
        </button>
        <button className={kind === 'recette' ? 'on pos-on' : ''} onClick={() => setKind('recette')}>
          {professional ? 'Encaissement' : 'Recette'}
        </button>
      </div>
      <label className="field">
        <span>Libellé</span>
        <input placeholder={kind === 'depense' ? 'Ex. Loyer' : 'Ex. Salaire'} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={!initial} />
      </label>
      <AmountField value={amount} onChange={setAmount} />
      <label className="field">
        <span>Catégorie</span>
        <select value={effectiveCategory} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="" disabled>
            Choisir une catégorie
          </option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Jour du mois (1 à 31)</span>
        <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </label>
      <p className="sim-note">
        L’opération est créée automatiquement à cette date, chaque mois (le 31 devient le dernier jour des mois plus courts). Les dates déjà
        passées ne sont pas recréées.
      </p>
      {initial && onToggleActive && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => void run(() => onToggleActive(!initial.active))}>
          {initial.active ? 'Mettre en pause' : 'Reprendre cette récurrence'}
        </button>
      )}
      <Footer busy={busy} valid={valid} error={error} onSave={save} onClose={onClose} onDelete={onDelete && (() => void run(onDelete))} />
    </Shell>
  );
}

/* ───────── Facture ───────── */

interface InvoiceProps {
  initial?: Invoice;
  /** Ce que la dictée a compris (champs vides = à compléter). */
  prefill?: InvoiceVoiceDraft & { heard: string };
  onSave: (d: InvoiceDraft) => Promise<unknown>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function InvoiceSheet({ initial, prefill, onSave, onDelete, onClose }: InvoiceProps) {
  const [direction, setDirection] = useState<Invoice['direction']>(initial?.direction ?? prefill?.direction ?? 'a_encaisser');
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? prefill?.counterparty ?? '');
  const [label, setLabel] = useState(initial?.label ?? prefill?.label ?? '');
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : prefill?.amountCents ? centsToInput(prefill.amountCents) : '');
  const [dueKey, setDueKey] = useState(initial ? dayKeyOfIso(initial.dueDate) : prefill?.dueKey ?? todayKey());
  const missing = prefill ? [!prefill.counterparty && (prefill.direction === 'a_payer' ? 'le fournisseur' : 'le client'), !prefill.amountCents && 'le montant', !prefill.dueKey && 'la date d’échéance'].filter(Boolean) : [];
  const { busy, error, run } = useAction(onClose);

  const cents = parseEurosToCents(amount);
  const valid = cents !== null && counterparty.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(dueKey);

  const save = () => run(() => onSave({ counterparty: counterparty.trim(), label: label.trim(), amountCents: cents!, dueKey, direction }));

  return (
    <Shell title={initial ? 'Modifier la facture' : 'Nouvelle facture ou échéance'} label="Facture" onClose={onClose}>
      {prefill && <p className="phrase small">Entendu : « {prefill.heard} »</p>}
      {missing.length > 0 && <p className="hint-warn">Je n’ai pas compris {missing.join(' ni ')} : complétez ci-dessous.</p>}
      <div className="segmented kind">
        <button className={direction === 'a_encaisser' ? 'on pos-on' : ''} onClick={() => setDirection('a_encaisser')}>
          À encaisser
        </button>
        <button className={direction === 'a_payer' ? 'on neg-on' : ''} onClick={() => setDirection('a_payer')}>
          À payer
        </button>
      </div>
      <label className="field">
        <span>{direction === 'a_encaisser' ? 'Client' : 'Fournisseur'}</span>
        <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} autoFocus={!initial} />
      </label>
      <label className="field">
        <span>Référence ou objet (facultatif)</span>
        <input placeholder="Ex. Facture F-2026-050" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <AmountField value={amount} onChange={setAmount} />
      <label className="field">
        <span>Date d’échéance</span>
        <input type="date" value={dueKey} onChange={(e) => setDueKey(e.target.value)} />
      </label>
      <Footer busy={busy} valid={valid} error={error} onSave={save} onClose={onClose} onDelete={onDelete && (() => void run(onDelete))} />
    </Shell>
  );
}

/* ───────── Budget d'une catégorie ───────── */

/** Ce que la dictée a compris d'un budget (champs vides = à compléter). */
export interface BudgetPrefill {
  heard: string;
  categoryId: string;
  amountCents: number | null;
  remove: boolean;
  /** Remarque à afficher (ex. « Logement est une charge fixe »). */
  note?: string;
}

interface BudgetProps {
  /** Catégorie déjà choisie (touche sur une ligne). Sinon, `choices` + liste déroulante. */
  category?: Category;
  choices?: Category[];
  prefill?: BudgetPrefill;
  budgets: Map<string, number>;
  onSave: (categoryId: string, cents: number | null) => Promise<void>;
  onClose: () => void;
}

export function BudgetSheet({ category, choices = [], prefill, budgets, onSave, onClose }: BudgetProps) {
  const [categoryId, setCategoryId] = useState(category?.id ?? prefill?.categoryId ?? '');
  const [amount, setAmount] = useState(
    prefill ? (prefill.amountCents ? centsToInput(prefill.amountCents) : '') : category && budgets.get(category.id) ? centsToInput(budgets.get(category.id)!) : '',
  );
  const { busy, error, run } = useAction(onClose);

  const selected = category ?? choices.find((c) => c.id === categoryId);
  const currentCents = selected ? budgets.get(selected.id) : undefined;
  const empty = amount.trim() === '';
  const cents = parseEurosToCents(amount);
  // Dictée « fixe le budget… » : le montant est obligatoire. Retrait : montant vide.
  const mustHaveAmount = Boolean(prefill) && !prefill!.remove;
  const valid = Boolean(selected) && (empty ? !mustHaveAmount : cents !== null);

  const missing = prefill
    ? [!prefill.categoryId && 'la catégorie', !prefill.remove && !prefill.amountCents && 'le montant'].filter(Boolean)
    : [];

  return (
    <Shell title={selected ? `Budget — ${selected.label}` : 'Budget mensuel'} label="Budget mensuel" onClose={onClose}>
      {prefill && <p className="phrase small">Entendu : « {prefill.heard} »</p>}
      {prefill?.note && <p className="hint-warn">{prefill.note}</p>}
      {!prefill?.note && missing.length > 0 && <p className="hint-warn">Je n’ai pas compris {missing.join(' ni ')} : complétez ci-dessous.</p>}
      {!category && (
        <label className="field">
          <span>Catégorie</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Choisir une catégorie
            </option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="sim-note">Le plafond de dépenses que vous vous fixez chaque mois pour cette catégorie. Vous serez alerté à 85 % et au dépassement.</p>
      <AmountField value={amount} onChange={setAmount} autoFocus={!prefill} />
      <small className="muted">Laissez vide pour retirer le budget de cette catégorie.</small>
      <Footer
        busy={busy}
        valid={valid}
        error={error}
        onSave={() => void run(() => onSave(selected!.id, empty ? null : cents))}
        onClose={onClose}
        saveLabel={empty && currentCents ? 'Retirer le budget' : 'Enregistrer'}
      />
    </Shell>
  );
}
