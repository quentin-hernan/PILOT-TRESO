import { useEffect, useRef, useState } from 'react';
import { formatSigned, splitEuros } from '../lib/money';

interface Props {
  cents: number;
  className?: string;
  /** Pour un cumul de dépenses : si le total monte, la pastille s'affiche en négatif (rouge). */
  inverse?: boolean;
}

/**
 * Affiche un montant qui "roule" vers sa nouvelle valeur quand il change,
 * avec une pastille +100 € / −100 € qui s'envole et un flash de couleur.
 */
export function AnimatedAmount({ cents, className, inverse }: Props) {
  const [shown, setShown] = useState(cents);
  const [delta, setDelta] = useState<{ id: number; cents: number } | null>(null);
  const target = useRef(cents);
  const current = useRef(cents);
  const raf = useRef(0);
  const counter = useRef(0);

  useEffect(() => {
    if (cents === target.current) return;
    const from = current.current;
    const diff = cents - target.current;
    target.current = cents;
    setDelta({ id: ++counter.current, cents: diff });

    cancelAnimationFrame(raf.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = cents;
      setShown(cents);
      return;
    }
    const start = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      current.current = Math.round(from + (cents - from) * eased);
      setShown(current.current);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [cents]);

  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 1600);
    return () => clearTimeout(t);
  }, [delta]);

  const { main, dec } = splitEuros(shown);
  const deltaCents = delta ? (inverse ? -delta.cents : delta.cents) : 0;
  const tone = delta ? (deltaCents < 0 ? 'neg' : 'pos') : '';

  return (
    <span className={`amount ${className ?? ''}`}>
      <span className="amount-main">{main}</span>
      <span className="amount-dec">{dec}</span>
      {delta && (
        <span key={delta.id} className={`delta delta-${tone}`} aria-live="polite">
          {formatSigned(deltaCents)}
        </span>
      )}
    </span>
  );
}
