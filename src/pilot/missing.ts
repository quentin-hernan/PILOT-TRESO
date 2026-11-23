import type { AccountType, Category, Invoice, OperationKind } from '../types';
import { formatEuros } from '../lib/money';
import { parseDueDate } from '../voice/intents';
import { categoriesFor } from '../data/categories';
import { detectCategory, normalize, parseAmount, wordsToNumber } from '../voice/parseCommand';
import type { YMD } from '../lib/dates';

/**
 * Ce que Pilot a compris d'une demande d'ajout, et ce qu'il lui manque encore. Quand il manque quelque chose, Pilot ne
 * rouvre pas un formulaire : il pose seulement la ou les questions utiles, au milieu de l'écran (réponse à la voix ou au toucher).
 */

export type SlotKey = 'amount' | 'category' | 'day' | 'counterparty' | 'dueDate';

export type Candidate =
  | { kind: 'op'; heard: string; opKind: OperationKind; amountCents: number | null; categoryId: string; label: string; date: string }
  | { kind: 'recurring'; heard: string; recKind: OperationKind; amountCents: number | null; categoryId: string; label: string; word: string; dayOfMonth: number | null }
  | { kind: 'budget'; heard: string; categoryId: string; amountCents: number | null; remove: boolean; note?: string }
  | { kind: 'opening'; heard: string; amountCents: number | null }
  | { kind: 'planned'; heard: string; opKind: OperationKind; amountCents: number | null; categoryId: string; label: string; dateKey: string }
  | { kind: 'invoice'; heard: string; direction: Invoice['direction']; counterparty: string; label: string; amountCents: number | null; dueKey: string | null };

export function missingSlots(c: Candidate): SlotKey[] {
  const out: SlotKey[] = [];
  switch (c.kind) {
    case 'op':
      if (!c.amountCents) out.push('amount');
      if (!c.categoryId) out.push('category');
      break;
    case 'recurring':
      if (!c.amountCents) out.push('amount');
      if (!c.categoryId) out.push('category');
      if (!c.dayOfMonth) out.push('day');
      break;
    case 'planned':
      if (!c.amountCents) out.push('amount');
      if (!c.categoryId) out.push('category');
      break;
    case 'budget':
      if (!c.categoryId) out.push('category');
      if (!c.remove && !c.amountCents) out.push('amount');
      break;
    case 'opening':
      if (!c.amountCents) out.push('amount');
      break;
    case 'invoice':
      if (!c.counterparty) out.push('counterparty');
      if (!c.amountCents) out.push('amount');
      if (!c.dueKey) out.push('dueDate');
      break;
  }
  return out;
}

export const QUESTIONS: Record<SlotKey, (c: Candidate) => string> = {
  amount: (c) => (c.kind === 'opening' ? 'Quel est votre solde aujourd’hui ?' : 'Quel montant ?'),
  category: () => 'Quelle catégorie ?',
  day: () => 'Quel jour du mois ?',
  counterparty: (c) => (c.kind === 'invoice' && c.direction === 'a_payer' ? 'Quel fournisseur ?' : 'Quel client ?'),
  dueDate: () => 'Quelle échéance ?',
};

/** Catégories proposables pour ce qui manque (dépense / recette, sans les charges fixes pour un budget). */
export function categoryChoices(c: Candidate, all: Category[]): Category[] {
  const kind: OperationKind = c.kind === 'op' || c.kind === 'planned' ? c.opKind : c.kind === 'recurring' ? c.recKind : 'depense';
  return all.filter((x) => x.kind === kind && !(c.kind === 'budget' && x.fixed));
}

/** Une phrase courte de ce qui est déjà compris : « Dépense · 50,00 € ». */
export function describe(c: Candidate, cats: Category[]): string {
  const cat = cats.find((x) => x.id === (c.kind === 'invoice' || c.kind === 'opening' ? '' : c.categoryId));
  const parts: string[] = [];
  switch (c.kind) {
    case 'op':
      parts.push(c.opKind === 'depense' ? 'Dépense' : 'Recette');
      break;
    case 'recurring':
      parts.push(c.recKind === 'depense' ? 'Récurrence · dépense' : 'Récurrence · recette');
      break;
    case 'planned':
      parts.push(`Prévu le ${c.dateKey.split('-').reverse().join('/')}`, c.opKind === 'depense' ? 'dépense' : 'recette');
      break;
    case 'budget':
      parts.push(c.remove ? 'Retirer un budget' : 'Budget mensuel');
      break;
    case 'opening':
      parts.push('Solde de départ');
      break;
    case 'invoice':
      parts.push(c.direction === 'a_payer' ? 'Facture à payer' : 'Facture à encaisser');
      if (c.counterparty) parts.push(c.counterparty);
      break;
  }
  if (cat) parts.push(cat.label);
  if (c.amountCents) parts.push(formatEuros(c.amountCents));
  if (c.kind === 'recurring' && c.dayOfMonth) parts.push(`le ${c.dayOfMonth} du mois`);
  if (c.kind === 'invoice' && c.dueKey) parts.push(`échéance le ${c.dueKey.split('-').reverse().join('/')}`);
  return parts.join(' · ');
}

/** Valeur saisie à l'écran pour un champ manquant. */
export function applyField(c: Candidate, key: SlotKey, value: string | number): Candidate {
  const next = { ...c } as Candidate;
  if (key === 'amount' && typeof value === 'number') (next as { amountCents: number | null }).amountCents = value;
  if (key === 'category' && typeof value === 'string' && next.kind !== 'invoice' && next.kind !== 'opening') next.categoryId = value;
  if (key === 'day' && next.kind === 'recurring' && typeof value === 'number') next.dayOfMonth = value;
  if (key === 'counterparty' && next.kind === 'invoice' && typeof value === 'string') next.counterparty = value;
  if (key === 'dueDate' && next.kind === 'invoice' && typeof value === 'string') next.dueKey = value;
  if (key === 'category' && next.kind === 'op' && typeof value === 'string') next.label = next.label || '';
  return next;
}

const NAME_STOP = new Set(['le', 'la', 'les', 'un', 'une', 'mon', 'ma', 'de', 'du', 'des', 'd', 'pour', 'chez', 'client', 'fournisseur', 'c', 'est', 'cest', 'ce', 'societe', 'monsieur', 'madame']);

/** Réponse dite à voix haute à une question : remplit ce qui manque (peut en remplir plusieurs d'un coup). */
export function applyAnswer(c: Candidate, text: string, ctx: { account: AccountType; today: YMD }): { candidate: Candidate; filled: SlotKey[] } {
  const missing = missingSlots(c);
  const t = normalize(text);
  let next = c;
  const filled: SlotKey[] = [];
  const fill = (key: SlotKey, value: string | number) => {
    next = applyField(next, key, value);
    filled.push(key);
  };

  // Échéance d'abord : « le 30 novembre » ne doit pas être pris pour un montant
  let rest = t;
  if (missing.includes('dueDate')) {
    const d = parseDueDate(t, ctx.today);
    if (d.key) {
      fill('dueDate', d.key);
      rest = d.rest;
    }
  }
  if (missing.includes('category')) {
    const kind: OperationKind = c.kind === 'op' || c.kind === 'planned' ? c.opKind : c.kind === 'recurring' ? c.recKind : 'depense';
    // le nom affiché sur le bouton (« Électricité », « Abonnements ») compte aussi, en plus des mots-clés
    const byLabel = categoriesFor(ctx.account).find((x) => x.kind === kind && !(c.kind === 'budget' && x.fixed) && new RegExp('\\b' + normalize(x.label) + '\\b').test(rest));
    const cat = byLabel ? { id: byLabel.id } : detectCategory(rest, ctx.account, kind);
    if (cat) fill('category', cat.id);
  }
  if (missing.includes('day')) {
    const m = rest.match(/\b(?:le\s+)?(\d{1,2})(?:er)?\b(?!\s*(?:euros?|eur))/);
    const d = m ? parseInt(m[1], 10) : /\bpremier\b/.test(rest) ? 1 : /\bfin (?:de|du) mois\b/.test(rest) ? 31 : null;
    if (d && d >= 1 && d <= 31 && !(missing.includes('amount') && /euros?/.test(rest))) fill('day', d);
  }
  if (missing.includes('amount')) {
    // sans « euros » : un nombre seul est un montant, sauf s'il sert déjà de jour
    const usedAsDay = filled.includes('day');
    let cents = usedAsDay && !/euros?/.test(rest) ? null : parseAmount(rest);
    if (!cents && !usedAsDay) {
      // nombre dit en lettres sans « euros » : « cinquante », « vingt cinq »
      const words = rest.split(' ').filter((w) => w && w !== 'et' && w !== 'de' && w !== 'euros' && w !== 'euro');
      const n = words.length > 0 && words.length <= 5 ? wordsToNumber(words) : 0;
      if (n > 0) cents = n * 100;
    }
    if (cents && cents > 0) fill('amount', cents);
  }
  if (missing.includes('counterparty') && filled.length === 0) {
    // ce qui reste est le nom : « Dupont », « pour Dupont », « chez Martin »
    const words = text.trim().split(/\s+/).filter((w) => w && !NAME_STOP.has(normalize(w)) && !/\d/.test(w));
    const name = words.slice(0, 3).join(' ').replace(/[.,;!?]+$/g, '');
    if (name) fill('counterparty', name.charAt(0).toUpperCase() + name.slice(1));
  }
  return { candidate: next, filled };
}
