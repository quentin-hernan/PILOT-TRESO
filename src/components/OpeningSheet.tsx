import { useEffect, useState } from 'react';
import { centsToInput, parseSignedEurosToCents } from '../lib/money';
import { Icon } from './Icon';

interface Props {
  currentCents: number;
  personal: boolean;
  onSave: (cents: number) => Promise<void>;
  onClose: () => void;
}

/** Fenêtre de réglage du solde de départ. */
export function OpeningSheet({ currentCents, personal, onSave, onClose }: Props) {
  const [value, setValue] = useState(centsToInput(currentCents));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseSignedEurosToCents(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(cents);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Solde de départ" onClick={(e) => e.stopPropagation()}>
        <div className="review">
          <h3>Solde de départ</h3>
          <p className="sim-note">
            {personal
              ? 'Le solde de votre compte au moment où vous commencez à utiliser PILOT’TRESO. Les opérations s’ajoutent ensuite à ce montant.'
              : 'La trésorerie de votre entreprise au moment où vous commencez à utiliser PILOT’TRESO. Les opérations s’ajoutent ensuite à ce montant.'}
          </p>
          <label className="field">
            <span>Montant</span>
            <div className="amount-input">
              <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              <i>€</i>
            </div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" disabled={cents === null || busy} onClick={save}>
              <Icon name="check" size={18} />
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
