import type { Operation, PlannedOp, Recurring } from '../types';
import { FIXED_CATEGORY_IDS } from '../data/categories';
import { daysInMonth } from './dates';
import { dayKeyOfIso, occurrences, ymdOfKey } from './forecast';
import { normalize } from '../voice/parseCommand';

/**
 * Calculs « du mois » : budget automatique (revenus − charges fixes) et habitudes de dépenses.
 * Une opération créée par une récurrence reprend son libellé et son montant : c'est ainsi qu'on la reconnaît.
 */

export const matchesRecurring = (o: Operation, recurrings: Recurring[]): boolean =>
  recurrings.some((r) => r.kind === o.kind && r.amountCents === o.amountCents && normalize(r.label) === normalize(o.label));

export interface MonthlyBudget {
  /** Recettes du mois : déjà encaissées + récurrences de recette encore à venir. */
  incomeCents: number;
  /** dont encore à venir (récurrences non passées) */
  incomeToComeCents: number;
  /** Charges fixes du mois : récurrences et catégories fixes (logement, électricité, crédit), passées + à venir. */
  fixedCents: number;
  fixedToComeCents: number;
  /** Ce qui reste pour vivre : revenus − charges fixes. */
  budgetCents: number;
  /** Dépenses courantes du mois (hors charges fixes). */
  variableCents: number;
  /** Budget − dépenses courantes (négatif = dépassé). */
  remainingCents: number;
}

export function monthlyBudget(ops: Operation[], recurrings: Recurring[], today: string, planned: PlannedOp[] = []): MonthlyBudget {
  const month = today.slice(0, 7);
  const monthOps = ops.filter((o) => dayKeyOfIso(o.date).slice(0, 7) === month);
  const monthEnd = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`;

  let income = 0;
  let fixed = 0;
  let variable = 0;
  for (const o of monthOps) {
    if (o.kind === 'recette') income += o.amountCents;
    else if (FIXED_CATEGORY_IDS.has(o.categoryId) || matchesRecurring(o, recurrings)) fixed += o.amountCents;
    else variable += o.amountCents;
  }

  // Récurrences encore à venir ce mois-ci (et pas déjà saisies à la main)
  let incomeToCome = 0;
  let fixedToCome = 0;
  for (const r of recurrings) {
    if (!r.active) continue;
    const upcoming = occurrences(r.dayOfMonth, today, monthEnd).length > 0;
    if (!upcoming) continue;
    const already = monthOps.some((o) => o.kind === r.kind && o.amountCents === r.amountCents && normalize(o.label) === normalize(r.label));
    if (already) continue;
    if (r.kind === 'recette') incomeToCome += r.amountCents;
    else fixedToCome += r.amountCents;
  }

  // Opérations prévues à une date précise ce mois-ci (ex. « le 28, 80 € d'assurance »)
  for (const p of planned) {
    if (p.date <= today || p.date > monthEnd) continue;
    if (p.kind === 'recette') incomeToCome += p.amountCents;
    else fixedToCome += p.amountCents;
  }

  const incomeCents = income + incomeToCome;
  const fixedCents = fixed + fixedToCome;
  const budgetCents = incomeCents - fixedCents;
  return {
    incomeCents,
    incomeToComeCents: incomeToCome,
    fixedCents,
    fixedToComeCents: fixedToCome,
    budgetCents,
    variableCents: variable,
    remainingCents: budgetCents - variable,
  };
}

export interface HabitualFlows {
  /** Dépenses habituelles non récurrentes, par jour et par mois (moyenne des mois précédents). */
  expenseDailyCents: number;
  incomeDailyCents: number;
  expensePerMonthCents: number;
  incomePerMonthCents: number;
  /** Nombre de mois complets utilisés (0 = estimation sur le mois en cours). */
  months: number;
}

/**
 * Ce qui passe « d'habitude » chaque mois en dehors des récurrences (courses, carburant, restaurants…) : moyenne des
 * 3 derniers mois complets. Sert aux prévisions, en plus des récurrences et des factures connues.
 */
export function habitualFlows(ops: Operation[], recurrings: Recurring[], today: string, includeIncome: boolean): HabitualFlows | undefined {
  if (ops.length === 0) return undefined;
  const t = ymdOfKey(today);
  const curIdx = t.y * 12 + (t.m - 1);
  const keyIdx = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1;

  let first = today;
  for (const o of ops) {
    const d = dayKeyOfIso(o.date);
    if (d < first) first = d;
  }
  const firstIdx = keyIdx(first);
  const firstDay = Number(first.slice(8, 10));

  // un mois compte s'il est complet ET si on avait déjà des données au début de ce mois
  const months: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const idx = curIdx - k;
    if (idx > firstIdx || (idx === firstIdx && firstDay <= 5)) months.push(idx);
  }

  const free = ops.filter((o) => !matchesRecurring(o, recurrings));
  const sum = (kind: Operation['kind'], pick: (idx: number, day: number) => boolean) =>
    free.filter((o) => o.kind === kind && pick(keyIdx(dayKeyOfIso(o.date)), Number(dayKeyOfIso(o.date).slice(8, 10)))).reduce((s, o) => s + o.amountCents, 0);

  let days: number;
  let exp: number;
  let inc: number;
  if (months.length > 0) {
    days = months.reduce((n, idx) => n + daysInMonth(Math.floor(idx / 12), (idx % 12) + 1), 0);
    exp = sum('depense', (idx) => months.includes(idx));
    inc = sum('recette', (idx) => months.includes(idx));
  } else if (t.d >= 7) {
    days = t.d;
    exp = sum('depense', (idx) => idx === curIdx);
    inc = sum('recette', (idx) => idx === curIdx);
  } else {
    return undefined;
  }
  const expenseDaily = exp / days;
  const incomeDaily = includeIncome ? inc / days : 0;
  return {
    expenseDailyCents: expenseDaily,
    incomeDailyCents: incomeDaily,
    expensePerMonthCents: Math.round(expenseDaily * 30),
    incomePerMonthCents: Math.round(incomeDaily * 30),
    months: months.length,
  };
}

/* ───────── Solde et « disponible fin de mois » ───────── */

/**
 * Solde actuel : solde de départ + opérations à partir du jour du solde de départ.
 * Le solde de départ est le solde d'un jour précis : ce qui s'est passé avant n'en fait plus partie.
 * (Sans date de départ — anciens comptes — toutes les opérations comptent.)
 */
export function balanceSince(openingCents: number, openingDate: string | null, ops: Operation[]): number {
  let total = openingCents;
  for (const o of ops) {
    if (openingDate && dayKeyOfIso(o.date) < openingDate) continue;
    total += o.kind === 'recette' ? o.amountCents : -o.amountCents;
  }
  return total;
}

export interface EndOfMonth {
  /** Solde actuel. */
  balanceCents: number;
  /** Ce que vaudra le solde à la fin du mois, une fois toutes les récurrences à venir passées. */
  availableCents: number;
  incomeToComeCents: number;
  expenseToComeCents: number;
  /** Nombre de récurrences et d'opérations prévues encore à passer ce mois-ci. */
  count: number;
}

/**
 * « Disponible du mois » : solde actuel + recettes récurrentes à venir − dépenses récurrentes à venir, jusqu'à la fin du mois.
 * Seules les récurrences comptent (pas de dépenses courantes estimées) : c'est ce qui est SÛR de passer.
 */
export function endOfMonthAvailable(balanceCents: number, recurrings: Recurring[], today: string, planned: PlannedOp[] = []): EndOfMonth {
  const month = today.slice(0, 7);
  const monthEnd = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`;
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const r of recurrings) {
    if (!r.active) continue;
    const n = occurrences(r.dayOfMonth, today, monthEnd).length; // une récurrence tombe au plus une fois par mois
    if (n === 0) continue;
    count++;
    if (r.kind === 'recette') income += r.amountCents;
    else expense += r.amountCents;
  }
  for (const p of planned) {
    if (p.date <= today || p.date > monthEnd) continue;
    count++;
    if (p.kind === 'recette') income += p.amountCents;
    else expense += p.amountCents;
  }
  return { balanceCents, availableCents: balanceCents + income - expense, incomeToComeCents: income, expenseToComeCents: expense, count };
}
