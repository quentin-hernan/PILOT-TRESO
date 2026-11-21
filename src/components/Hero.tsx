import type { ReactNode } from 'react';
import { AnimatedAmount } from './AnimatedAmount';

interface Props {
  label: string;
  cents: number;
  sub?: ReactNode;
  children?: ReactNode;
  inverse?: boolean;
  /** Petit lien d'action sous le solde (ex. modifier le solde de départ). */
  action?: ReactNode;
}

/** Grande carte de solde façon appli de banque. */
export function Hero({ label, cents, sub, children, inverse, action }: Props) {
  return (
    <section className="hero">
      <p className="hero-label">{label}</p>
      <AnimatedAmount cents={cents} className="hero-amount" inverse={inverse} />
      {sub && <p className="hero-sub">{sub}</p>}
      {action}
      {children}
    </section>
  );
}
