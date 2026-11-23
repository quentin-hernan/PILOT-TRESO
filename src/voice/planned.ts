import type { AccountType } from '../types';
import { keyOf } from '../lib/forecast';
import { parisYMD } from '../lib/dates';
import { parseDueDate } from './intents';
import { normalize, parseCommand, type ParsedCommand } from './parseCommand';

/**
 * Opération PRÉVUE : « le 28, j'ai 80 euros d'assurance », « le 15 décembre j'ai une échéance de 900 euros »,
 * « je dois payer 120 euros dans 10 jours ». La date est dans le FUTUR et la phrase n'est pas au passé : ce n'est pas encore
 * une opération, c'est une dépense (ou recette) à venir, qui deviendra réelle le jour dit.
 * (« j'ai payé 80 euros le 15 » reste une opération passée.)
 */

const PAST = /\b(j ai (depense|paye|achete|recu|touche|encaisse|regle|fait|vendu|retire|donne|verse|perdu)|ai ete|ce matin|hier|avant hier|vient de|viens de)\b/;
const FUTURE = /\b(je dois|je vais|j aurai|il faut que je|va tomber|vont tomber|prevu|prevue|prevus|echeance|prelevement|a payer|a encaisser|j ai|je paie|je paye|je touche|je recois)\b/;

export interface PlannedHit {
  /** Jour prévu (AAAA-MM-JJ), toujours après aujourd'hui. */
  dateKey: string;
  parsed: ParsedCommand;
}

export function detectPlanned(transcript: string, account: AccountType, now: Date = new Date()): PlannedHit | null {
  const t = normalize(transcript);
  if (PAST.test(t) || !FUTURE.test(t)) return null;
  const parsed = parseCommand(transcript, account, now);
  if (parsed.recurring || parsed.budget) return null; // « tous les mois… » = récurrence ; « budget… » = budget
  const today = parisYMD(now);
  const due = parseDueDate(t, today);
  if (!due.key || due.key <= keyOf(today)) return null;
  if (!parsed.amountCents && !parsed.categoryId) return null;
  return { dateKey: due.key, parsed };
}
