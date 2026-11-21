import type { Category, Invoice, Operation, Recurring } from '../types';
import { daysInMonth, parisYMD, type YMD } from './dates';
import { formatEuros } from './money';
import { opsOfMonth } from './stats';

/* ───────── Dates « civiles » (AAAA-MM-JJ), sans heure ni fuseau ───────── */

export const keyOf = ({ y, m, d }: YMD): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const ymdOfKey = (k: string): YMD => ({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)), d: Number(k.slice(8, 10)) });

const utc = (k: string): number => {
  const p = ymdOfKey(k);
  return Date.UTC(p.y, p.m - 1, p.d);
};

export const addDaysKey = (k: string, n: number): string => {
  const t = new Date(utc(k) + n * 86_400_000);
  return keyOf({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
};

export const diffDays = (fromKey: string, toKey: string): number => Math.round((utc(toKey) - utc(fromKey)) / 86_400_000);

export const todayKey = (): string => keyOf(parisYMD(new Date()));

/** Date AAAA-MM-JJ d'un horodatage (jour à Paris). */
export const dayKeyOfIso = (iso: string): string => keyOf(parisYMD(iso));

/** Jour réel d'une récurrence dans un mois : le 31 devient le 28 / 29 / 30 dans les mois plus courts. */
export const effectiveDay = (dayOfMonth: number, y: number, m: number): number => Math.min(dayOfMonth, daysInMonth(y, m));

/** Dates (AAAA-MM-JJ) où la récurrence tombe, strictement après `afterKey` et jusqu'à `uptoKey` inclus. */
export function occurrences(dayOfMonth: number, afterKey: string, uptoKey: string): string[] {
  const out: string[] = [];
  const a = ymdOfKey(afterKey);
  const u = ymdOfKey(uptoKey);
  let y = a.y;
  let m = a.m;
  while (y * 12 + m <= u.y * 12 + u.m) {
    const key = keyOf({ y, m, d: effectiveDay(dayOfMonth, y, m) });
    if (key > afterKey && key <= uptoKey) out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Prochaine date d'une récurrence (aujourd'hui exclu si `afterToday`). */
export function nextOccurrence(dayOfMonth: number, today: string): string {
  return occurrences(dayOfMonth, today, addDaysKey(today, 62))[0];
}

/* ───────── Prévision de trésorerie ───────── */

export interface ForecastEvent {
  date: string;
  cents: number; // signé : + encaissement, − décaissement
  label: string;
  source: 'recurrence' | 'facture';
}

export interface ForecastPoint {
  days: number;
  date: string;
  balanceCents: number;
}

export interface Forecast {
  horizons: ForecastPoint[];
  /** Premier jour où le solde passe sous zéro (absent s'il reste positif). */
  firstNegative?: string;
  /** Solde le plus bas des 90 jours. */
  low: { date: string; balanceCents: number };
  /** Solde jour par jour, de aujourd'hui (indice 0) à J+90. */
  series: number[];
  events: ForecastEvent[];
  /** Factures à encaisser en retard : NON comptées dans la prévision (prudence). */
  overdueReceivableCents: number;
}

export const HORIZONS = [30, 60, 90] as const;

interface ForecastInput {
  /** Solde actuel (centimes). */
  balanceCents: number;
  recurrings: Recurring[];
  invoices: Invoice[];
  today: string;
}

/**
 * Solde estimé à 30 / 60 / 90 jours : solde actuel + récurrences à venir + factures en attente.
 * Les dépenses courantes non récurrentes ne sont pas devinées : seul ce qui est prévu est compté.
 * Les factures à payer en retard sont comptées dès aujourd'hui ; celles à encaisser en retard ne le sont pas.
 */
export function forecast({ balanceCents, recurrings, invoices, today }: ForecastInput): Forecast {
  const end = addDaysKey(today, 90);
  const events: ForecastEvent[] = [];

  for (const r of recurrings) {
    if (!r.active) continue;
    for (const date of occurrences(r.dayOfMonth, today, end)) {
      events.push({ date, cents: r.kind === 'recette' ? r.amountCents : -r.amountCents, label: r.label, source: 'recurrence' });
    }
  }

  let overdueReceivableCents = 0;
  for (const inv of invoices) {
    if (inv.status === 'payee') continue;
    const due = dayKeyOfIso(inv.dueDate);
    const incoming = inv.direction === 'a_encaisser';
    if (due < today) {
      if (incoming) {
        overdueReceivableCents += inv.amountCents;
        continue;
      }
      events.push({ date: today, cents: -inv.amountCents, label: inv.counterparty, source: 'facture' });
    } else if (due <= end) {
      events.push({ date: due, cents: incoming ? inv.amountCents : -inv.amountCents, label: inv.counterparty, source: 'facture' });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const delta = new Array<number>(91).fill(0);
  for (const e of events) delta[diffDays(today, e.date)] += e.cents;

  const series: number[] = [];
  let running = balanceCents;
  for (let i = 0; i <= 90; i++) {
    running += delta[i];
    series.push(running);
  }

  let lowIdx = 0;
  series.forEach((v, i) => {
    if (v < series[lowIdx]) lowIdx = i;
  });

  const negIdx = series.findIndex((v) => v < 0);

  return {
    firstNegative: negIdx >= 0 ? addDaysKey(today, negIdx) : undefined,
    horizons: HORIZONS.map((days) => ({ days, date: addDaysKey(today, days), balanceCents: series[days] })),
    low: { date: addDaysKey(today, lowIdx), balanceCents: series[lowIdx] },
    series,
    events,
    overdueReceivableCents,
  };
}

/* ───────── Alertes ───────── */

export interface Alert {
  id: string;
  level: 'warn' | 'danger';
  title: string;
  detail: string;
}

interface AlertInput {
  ops: Operation[];
  /** Budget mensuel par catégorie (centimes) — compte particulier. */
  budgets?: Map<string, number>;
  categories: Category[];
  invoices?: Invoice[];
  forecast: Forecast;
  today: string;
}

const longDate = (key: string): string => {
  const p = ymdOfKey(key);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });
};

/** Budgets approchés / dépassés, solde prévu négatif, factures en retard ou proches. Les plus graves d'abord. */
export function buildAlerts({ ops, budgets, categories, invoices = [], forecast: f, today }: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const t = ymdOfKey(today);

  if (f.firstNegative) {
    const days = diffDays(today, f.firstNegative);
    alerts.push({
      id: 'forecast-negative',
      level: 'danger',
      title: days === 0 ? 'Solde prévu négatif dès aujourd’hui' : `Solde prévu négatif le ${longDate(f.firstNegative)}`,
      detail: `Au plus bas, il descendrait à ${formatEuros(f.low.balanceCents)} (${longDate(f.low.date)}) d’après vos récurrences et vos échéances.`,
    });
  }

  if (budgets) {
    const spent = new Map<string, number>();
    for (const o of opsOfMonth(ops, t.y, t.m)) {
      if (o.kind === 'depense') spent.set(o.categoryId, (spent.get(o.categoryId) ?? 0) + o.amountCents);
    }
    for (const c of categories) {
      const budget = budgets.get(c.id);
      if (!budget || c.kind !== 'depense') continue;
      const used = spent.get(c.id) ?? 0;
      if (used >= budget) {
        alerts.push({
          id: `budget-over-${c.id}`,
          level: 'danger',
          title: used > budget ? `Budget ${c.label} dépassé` : `Budget ${c.label} atteint`,
          detail: `${formatEuros(used)} dépensés pour un budget de ${formatEuros(budget)}.`,
        });
      } else if (used >= budget * 0.85) {
        alerts.push({
          id: `budget-near-${c.id}`,
          level: 'warn',
          title: `Budget ${c.label} bientôt atteint`,
          detail: `Il reste ${formatEuros(budget - used)} sur ${formatEuros(budget)}.`,
        });
      }
    }
  }

  for (const inv of invoices) {
    if (inv.status === 'payee') continue;
    const d = diffDays(today, dayKeyOfIso(inv.dueDate));
    const incoming = inv.direction === 'a_encaisser';
    if (d < 0) {
      alerts.push({
        id: `inv-late-${inv.id}`,
        level: incoming ? 'warn' : 'danger',
        title: incoming ? `À relancer : ${inv.counterparty}` : `Paiement en retard : ${inv.counterparty}`,
        detail: `${formatEuros(inv.amountCents)} — échéance dépassée de ${-d} jour${-d > 1 ? 's' : ''}.`,
      });
    } else if (d <= 7 && !incoming) {
      alerts.push({
        id: `inv-soon-${inv.id}`,
        level: 'warn',
        title: `À payer ${d === 0 ? 'aujourd’hui' : `dans ${d} jour${d > 1 ? 's' : ''}`} : ${inv.counterparty}`,
        detail: formatEuros(inv.amountCents),
      });
    }
  }

  const rank = { danger: 0, warn: 1 } as const;
  return alerts.sort((a, b) => rank[a.level] - rank[b.level]);
}
