import type { Category, Operation, OperationKind } from '../types';
import { addDaysKey, dayKeyOfIso, keyOf, ymdOfKey, type Alert, type Forecast, type ForecastEvent } from './forecast';
import { daysInMonth } from './dates';
import { formatEuros } from './money';
import type { MonthlyBudget } from './monthly';

/** Réponses de Pilot aux questions : calculs sur les données de l'utilisateur, phrases en français. */

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth';

export interface Range {
  from: string;
  to: string;
  /** « ce mois-ci », « hier »… (pour construire la phrase) */
  label: string;
}

export function periodRange(period: Period, today: string): Range {
  const t = ymdOfKey(today);
  switch (period) {
    case 'today':
      return { from: today, to: today, label: "aujourd'hui" };
    case 'yesterday': {
      const y = addDaysKey(today, -1);
      return { from: y, to: y, label: 'hier' };
    }
    case 'week': {
      const dow = new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay(); // 0 = dimanche
      const sinceMonday = (dow + 6) % 7;
      return { from: addDaysKey(today, -sinceMonday), to: today, label: 'cette semaine' };
    }
    case 'lastMonth': {
      const total = t.y * 12 + (t.m - 1) - 1;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      return { from: keyOf({ y, m, d: 1 }), to: keyOf({ y, m, d: daysInMonth(y, m) }), label: 'le mois dernier' };
    }
    default:
      return { from: keyOf({ y: t.y, m: t.m, d: 1 }), to: today, label: 'ce mois-ci' };
  }
}

export function sumOps(ops: Operation[], kind: OperationKind, range: Range, categoryId?: string): { cents: number; count: number } {
  let cents = 0;
  let count = 0;
  for (const o of ops) {
    if (o.kind !== kind) continue;
    if (categoryId && o.categoryId !== categoryId) continue;
    const d = dayKeyOfIso(o.date);
    if (d < range.from || d > range.to) continue;
    cents += o.amountCents;
    count++;
  }
  return { cents, count };
}

const eur = (cents: number): string => formatEuros(cents);

const longDate = (key: string): string => {
  const p = ymdOfKey(key);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
};

export function answerBalance(balanceCents: number, fc: Forecast): string {
  let s = `Votre solde est de ${eur(balanceCents)}.`;
  if (fc.firstNegative) s += ` Attention : d'après vos échéances, il passerait sous zéro le ${longDate(fc.firstNegative)}.`;
  else s += ` Dans 30 jours, il devrait être de ${eur(fc.horizons[0].balanceCents)}.`;
  return s;
}

export function answerSpent(
  ops: Operation[],
  kind: OperationKind,
  period: Period,
  today: string,
  category: Category | undefined,
  professional: boolean,
): string {
  const range = periodRange(period, today);
  const { cents, count } = sumOps(ops, kind, range, category?.id);
  const verb = kind === 'depense' ? (professional ? 'décaissé' : 'dépensé') : professional ? 'encaissé' : 'reçu';
  const what = category ? ` en ${category.label.toLowerCase()}` : '';
  if (count === 0) return `Vous n'avez rien ${verb}${what} ${range.label}.`;
  return `Vous avez ${verb} ${eur(cents)}${what} ${range.label}, en ${count} opération${count > 1 ? 's' : ''}.`;
}

export function answerUpcoming(events: ForecastEvent[], today: string, days: number): string {
  const until = addDaysKey(today, days);
  const list = events.filter((e) => e.date <= until).slice(0, 4);
  const label = days <= 7 ? 'cette semaine' : `dans les ${days} prochains jours`;
  if (list.length === 0) return `Rien de prévu ${label}.`;
  const total = events.filter((e) => e.date <= until).length;
  const parts = list.map((e) => `${longDate(e.date)}, ${e.label}, ${e.cents < 0 ? 'moins' : 'plus'} ${eur(Math.abs(e.cents))}`);
  return `Prévu ${label} : ${parts.join(' ; ')}.${total > list.length ? ` Et ${total - list.length} autre${total - list.length > 1 ? 's' : ''}.` : ''}`;
}

export function answerForecast(fc: Forecast, days: 30 | 60 | 90): string {
  const h = fc.horizons.find((x) => x.days === days)!;
  let s = `Dans ${days} jours, votre solde devrait être de ${eur(h.balanceCents)}.`;
  if (fc.firstNegative) s += ` Attention : il passerait sous zéro le ${longDate(fc.firstNegative)}.`;
  return s;
}

export function answerMonthly(b: MonthlyBudget): string {
  if (b.incomeCents === 0) return "Aucun revenu ce mois-ci : je ne peux pas calculer votre budget. Ajoutez votre salaire.";
  if (b.budgetCents <= 0) return `Vos charges fixes, ${eur(b.fixedCents)}, dépassent vos revenus du mois, ${eur(b.incomeCents)}.`;
  const rest = b.remainingCents >= 0 ? `il vous reste ${eur(b.remainingCents)} à dépenser` : `vous avez dépassé de ${eur(-b.remainingCents)}`;
  return `Ce mois-ci, vos revenus sont de ${eur(b.incomeCents)} et vos charges fixes de ${eur(b.fixedCents)} : vous avez ${eur(b.budgetCents)} pour vivre. Vous avez dépensé ${eur(b.variableCents)}, ${rest}.`;
}

export function answerBudget(budgets: Map<string, number>, ops: Operation[], today: string, categories: Category[], category?: Category): string {
  const range = periodRange('month', today);
  if (category) {
    const budget = budgets.get(category.id);
    if (!budget) return `Vous n'avez pas fixé de budget pour ${category.label.toLowerCase()}.`;
    const used = sumOps(ops, 'depense', range, category.id).cents;
    return used > budget
      ? `Budget ${category.label.toLowerCase()} dépassé de ${eur(used - budget)} : ${eur(used)} dépensés sur ${eur(budget)}.`
      : `Il vous reste ${eur(budget - used)} sur votre budget ${category.label.toLowerCase()} de ${eur(budget)}.`;
  }
  const rows = categories.filter((c) => budgets.get(c.id));
  if (rows.length === 0) return "Vous n'avez fixé aucun budget. Dites par exemple : budget alimentation 400 euros.";
  const total = rows.reduce((s, c) => s + budgets.get(c.id)!, 0);
  const used = rows.reduce((s, c) => s + sumOps(ops, 'depense', range, c.id).cents, 0);
  const over = rows.filter((c) => sumOps(ops, 'depense', range, c.id).cents > budgets.get(c.id)!);
  let s = `Sur l'ensemble de vos budgets, ${eur(used)} dépensés sur ${eur(total)} ce mois-ci.`;
  if (over.length) s += ` Dépassé : ${over.map((c) => c.label.toLowerCase()).join(', ')}.`;
  return s;
}

export function answerAlerts(alerts: Alert[]): string {
  if (alerts.length === 0) return "Aucune alerte pour l'instant. Tout va bien.";
  const first = alerts.slice(0, 3).map((a) => a.title).join(' ; ');
  return `${alerts.length} alerte${alerts.length > 1 ? 's' : ''} : ${first}.${alerts.length > 3 ? ` Et ${alerts.length - 3} autre${alerts.length - 3 > 1 ? 's' : ''}.` : ''}`;
}

/** Texte lisible à voix haute (symboles remplacés par des mots). */
export function speakable(text: string): string {
  return text
    .replace(/[  ]/g, ' ')
    .replace(/−/g, 'moins ')
    .replace(/\+/g, 'plus ')
    .replace(/€/g, ' euros')
    .replace(/%/g, ' pour cent')
    .replace(/\s+/g, ' ')
    .trim();
}

