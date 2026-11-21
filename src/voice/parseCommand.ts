import type { AccountType, OperationKind } from '../types';
import { PERSONAL_CATEGORIES, PRO_CATEGORIES } from '../data/categories';
import { daysInMonth, makeDate, parisYMD, shiftMonth, type YMD } from '../lib/dates';
import { CATEGORY_KEYWORDS, EXPENSE_WORDS, INCOME_WORDS } from './dictionary';

/**
 * Analyseur de phrases dictées — AUCUNE IA : uniquement des règles et un dictionnaire de mots-clés.
 * Entrée : « j'ai dépensé 120 euros au restaurant hier »
 * Sortie : dépense, 12 000 centimes, catégorie « restaurant », date d'hier.
 */
export interface ParsedCommand {
  transcript: string;
  /** Toujours défini : dépense par défaut quand rien n'indique une recette. */
  kind: OperationKind;
  kindExplicit: boolean;
  amountCents: number | null;
  categoryId: string | null;
  /** Date ISO (maintenant si aucune date n'a été dite). */
  date: string;
  dateExplicit: boolean;
  /** Libellé détecté (ex. « chez Total »), vide sinon. */
  label: string;
  /** Mot de la catégorie tel que dit (ex. « loyer », « Crédit »), vide si aucune catégorie. */
  categoryWord: string;
  /** Phrase de type « tous les mois… » : c'est une récurrence, pas une opération ponctuelle. */
  recurring: boolean;
  /** Jour du mois dit pour une récurrence (« le 2 de chaque mois »), null sinon. */
  dayOfMonth: number | null;
}

/* ───────── Normalisation ───────── */

/** minuscules, sans accents, apostrophes -> espaces, « € » -> « euros », virgule décimale -> point. */
export function normalize(input: string): string {
  let s = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ')
    .replace(/€/g, ' euros ')
    .replace(/[  ]/g, ' ')
    .replace(/[-!?;:"«»()]/g, ' '); // « avant-hier » = « avant hier », « quatre-vingt » = « quatre vingt »
  s = s.replace(/(\d),(\d)/g, '$1.$2'); // 12,50 -> 12.50
  s = s.replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1'); // 2 500 -> 2500
  s = s.replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1'); // 2.500 -> 2500
  return s.replace(/\s+/g, ' ').trim();
}

/* ───────── Nombres écrits en lettres ───────── */

const UNITS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const TENS: Record<string, number> = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
const isNumberWord = (t: string) => t in UNITS || t in TENS || t === 'cent' || t === 'cents' || t === 'mille';

/** ["quatre","vingt","dix"] -> 90 ; ["mille","deux","cents"] -> 1200. */
export function wordsToNumber(tokens: string[]): number {
  let total = 0;
  let current = 0;
  let prev = '';
  for (const t of tokens) {
    if (t === 'et') continue;
    if (t in UNITS) current += UNITS[t];
    else if (t === 'vingt' || t === 'vingts') current += prev === 'quatre' ? 76 : 20; // quatre-vingt = 80
    else if (t in TENS) current += TENS[t];
    else if (t === 'cent' || t === 'cents') current = (current === 0 ? 1 : current) * 100;
    else if (t === 'mille') {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
    }
    prev = t;
  }
  return total + current;
}

/* ───────── Montant ───────── */

function parseAmount(text: string): number | null {
  // 1. Chiffres suivis de « euros » : « 50 euros », « 12.50 euros », « 12 euros 50 ».
  const withEuros = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:euros?|eur)\b(?:\s*(?:et\s*)?(\d{1,2})\b(?!\s*(?:euros?|eur|%)))?/);
  if (withEuros) {
    const euros = parseFloat(withEuros[1]);
    const centsPart = withEuros[2];
    if (centsPart !== undefined && !withEuros[1].includes('.')) return Math.round(euros * 100) + parseInt(centsPart, 10);
    return Math.round(euros * 100);
  }

  // 2. Nombre en lettres suivi de « euros » : « cent euros », « douze euros cinquante ».
  const tokens = text.replace(/-/g, ' ').split(' ');
  const euroIdx = tokens.findIndex((t) => t === 'euro' || t === 'euros');
  if (euroIdx > 0) {
    let start = euroIdx;
    while (start > 0 && (isNumberWord(tokens[start - 1]) || (tokens[start - 1] === 'et' && start - 2 >= 0 && isNumberWord(tokens[start - 2])))) start--;
    const run = tokens.slice(start, euroIdx);
    if (run.length > 0 && isNumberWord(run[0])) {
      const euros = wordsToNumber(run);
      const after: string[] = [];
      let j = euroIdx + 1;
      if (tokens[j] === 'et') j++;
      while (j < tokens.length && isNumberWord(tokens[j])) after.push(tokens[j++]);
      const cents = after.length ? wordsToNumber(after) : 0;
      return euros * 100 + (cents > 0 && cents < 100 ? cents : 0);
    }
  }

  // 3. Un seul nombre sans « euros » : « j'ai dépensé 50 de carburant ».
  const bare = text.match(/\d+(?:\.\d{1,2})?/);
  if (bare) return Math.round(parseFloat(bare[0]) * 100);
  return null;
}

/* ───────── Date ───────── */

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const cmp = (a: YMD, b: YMD) => a.y * 10000 + a.m * 100 + a.d - (b.y * 10000 + b.m * 100 + b.d);
const addDays = (p: YMD, n: number): YMD => parisYMD(new Date(Date.UTC(p.y, p.m - 1, p.d + n, 11)));

function parseDate(text: string, today: YMD): { ymd: YMD | null; rest: string } {
  const strip = (re: RegExp) => text.replace(re, ' ');
  let m: RegExpMatchArray | null;

  if ((m = text.match(/\bavant hier\b/))) return { ymd: addDays(today, -2), rest: strip(/\bavant hier\b/) };
  if ((m = text.match(/\bhier\b/))) return { ymd: addDays(today, -1), rest: strip(/\bhier\b/) };
  if (/\b(aujourd hui|ce matin|ce soir|cet apres midi|tout a l heure)\b/.test(text)) {
    return { ymd: today, rest: strip(/\b(aujourd hui|ce matin|ce soir|cet apres midi|tout a l heure)\b/) };
  }

  if ((m = text.match(/\bil y a (\d{1,3}) jours?\b/))) return { ymd: addDays(today, -parseInt(m[1], 10)), rest: strip(/\bil y a \d{1,3} jours?\b/) };

  // « le 15 décembre », « 3 mars 2025 »
  const monthRe = new RegExp(`\\b(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?\\b`);
  if ((m = text.match(monthRe))) {
    const d = parseInt(m[1], 10);
    const mo = MONTHS.indexOf(m[2]) + 1;
    const explicitYear = m[3] ? parseInt(m[3], 10) : null;
    let y = explicitYear ?? today.y;
    let cand: YMD = { y, m: mo, d };
    if (d >= 1 && d <= daysInMonth(y, mo)) {
      if (!explicitYear && cmp(cand, today) > 0) {
        y -= 1;
        if (d <= daysInMonth(y, mo)) cand = { y, m: mo, d };
      }
      return { ymd: cand, rest: strip(monthRe) };
    }
  }

  // « lundi », « lundi dernier » : le plus récent dans le passé
  const dayRe = new RegExp(`\\b(${WEEKDAYS.join('|')})(?:\\s+(?:dernier|passe))?\\b`);
  if ((m = text.match(dayRe))) {
    const target = WEEKDAYS.indexOf(m[1]);
    const todayDow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    let back = (todayDow - target + 7) % 7;
    if (back === 0) back = 7;
    return { ymd: addDays(today, -back), rest: strip(dayRe) };
  }

  // « le 15 » : ce mois-ci, ou le mois précédent si le jour n'est pas encore passé
  const dayOnly = /\ble\s+(\d{1,2})(?:er)?\b(?!\s*(?:euros?|eur|%|h\b|heures?))/;
  if ((m = text.match(dayOnly))) {
    const d = parseInt(m[1], 10);
    if (d >= 1 && d <= 31) {
      let { y, m: mo } = today;
      if (d > today.d) ({ y, m: mo } = shiftMonth(y, mo, -1));
      if (d <= daysInMonth(y, mo)) return { ymd: { y, m: mo, d }, rest: strip(dayOnly) };
    }
  }
  return { ymd: null, rest: text };
}

/* ───────── Nature (dépense / recette) et catégorie ───────── */

function hasWord(text: string, w: string): boolean {
  return new RegExp(`\\b${w}\\b`).test(text);
}

function firstWordIndex(text: string, words: string[]): number {
  let best = -1;
  for (const w of words) {
    const m = new RegExp(`\\b${w}\\b`).exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

function detectKind(text: string): OperationKind | null {
  const e = firstWordIndex(text, EXPENSE_WORDS);
  const i = firstWordIndex(text, INCOME_WORDS);
  if (e === -1 && i === -1) return null;
  if (e === -1) return 'recette';
  if (i === -1) return 'depense';
  return i < e ? 'recette' : 'depense';
}

function detectCategory(text: string, account: AccountType, kind: OperationKind | null): { id: string; word: string } | null {
  const categories = account === 'particulier' ? PERSONAL_CATEGORIES : PRO_CATEGORIES;
  let best: { id: string; len: number; pos: number; word: string } | null = null;
  for (const [id, words] of Object.entries(CATEGORY_KEYWORDS[account])) {
    const cat = categories.find((c) => c.id === id);
    if (!cat || (kind && cat.kind !== kind)) continue;
    for (const w of words) {
      const m = new RegExp(`\\b${w}\\b`).exec(text);
      if (!m) continue;
      if (!best || w.length > best.len || (w.length === best.len && m.index < best.pos)) best = { id, len: w.length, pos: m.index, word: w };
    }
  }
  return best ? { id: best.id, word: best.word } : null;
}

/** « chez Total » -> « Total » (depuis le texte d'origine, pour garder les majuscules). */
function detectLabel(transcript: string): string {
  const m = transcript.match(/\bchez\s+([\p{L}0-9][\p{L}0-9'’-]*(?:\s+[\p{L}0-9][\p{L}0-9'’-]*){0,2})/iu);
  if (!m) return '';
  const words = m[1].split(/\s+/).filter((w) => !/^(hier|aujourd|avant|le|la|les|pour|de|du|des)$/i.test(w));
  const label = words.join(' ');
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

/* ───────── Récurrence (« tous les mois… ») ───────── */

const RECURRING_PHRASES: RegExp[] = [
  /\b(?:tous|chaque) (?:les )?mois\b/g,
  /\bpar mois\b/g,
  /\bmensuel(?:le|les|lement)?\b/g,
  /\brecurrent(?:e|es|s)?\b/g,
  /\brecurrence\b/g,
  /\bchaque (?:le )?\d{1,2}(?:er)?\b(?!\s*(?:euros?|eur|%))/g,
  /\btous les \d{1,2}(?:er)? (?:du mois\b)?/g,
];

/** Jour du mois dit avec la phrase de récurrence. Renvoie aussi le texte restant sans ces expressions. */
function extractRecurrence(text: string): { recurring: boolean; day: number | null; rest: string } {
  const recurring = RECURRING_PHRASES.some((re) => new RegExp(re.source).test(text));
  if (!recurring) return { recurring: false, day: null, rest: text };

  const dayPatterns: { re: RegExp; day: (m: RegExpMatchArray) => number }[] = [
    { re: /\b(?:le|du|au)\s+(\d{1,2})(?:er|e)?\s+(?:de |du )?(?:chaque |tous les )?mois\b/, day: (m) => parseInt(m[1], 10) },
    { re: /\b(?:chaque|tous les)\s+(?:le\s+)?(\d{1,2})(?:er)?\b(?!\s*(?:euros?|eur|%|h\b|heures?))/, day: (m) => parseInt(m[1], 10) },
    { re: /\b(?:en )?fin (?:de|du) mois\b/, day: () => 31 },
    { re: /\b(?:en )?debut (?:de|du) mois\b/, day: () => 1 },
    { re: /\bmilieu (?:de|du) mois\b/, day: () => 15 },
    { re: /\ble premier\b/, day: () => 1 },
    { re: /\ble\s+(\d{1,2})(?:er)?\b(?!\s*(?:euros?|eur|%|h\b|heures?))/, day: (m) => parseInt(m[1], 10) },
  ];
  let day: number | null = null;
  let rest = text;
  for (const p of dayPatterns) {
    const m = rest.match(p.re);
    if (!m) continue;
    const d = p.day(m);
    if (d >= 1 && d <= 31) {
      day = d;
      rest = rest.replace(p.re, ' ');
      break;
    }
  }
  for (const re of RECURRING_PHRASES) rest = rest.replace(re, ' ');
  return { recurring: true, day, rest: rest.replace(/\s+/g, ' ').trim() };
}

/** Retrouve, dans la phrase d'origine, les mots (avec leurs accents) qui correspondent au mot-clé de la catégorie. */
function originalWords(transcript: string, keyword: string): string {
  const words = transcript.split(/\s+/);
  const n = keyword.split(' ').length;
  for (let i = 0; i + n <= words.length; i++) {
    const chunk = words.slice(i, i + n).join(' ');
    if (normalize(chunk) === keyword) return chunk.replace(/[.,;!?]+$/g, '');
  }
  return keyword;
}

/* ───────── Point d'entrée ───────── */

export function parseCommand(transcript: string, account: AccountType, now: Date = new Date()): ParsedCommand {
  const normalized = normalize(transcript);
  const today = parisYMD(now);

  const rec = extractRecurrence(normalized);
  // Une récurrence n'a pas de date d'opération : « le 2 » est le jour du mois, pas une date passée.
  const { ymd, rest } = rec.recurring ? { ymd: null, rest: rec.rest } : parseDate(normalized, today);
  const amountCents = parseAmount(rest);

  const explicitKind = detectKind(rest);
  let found = detectCategory(rest, account, explicitKind);
  let kind: OperationKind = explicitKind ?? 'depense';
  if (!explicitKind) {
    // Pas de verbe : la catégorie décide (« salaire » -> recette).
    const any = detectCategory(rest, account, null);
    if (any) {
      const cats = account === 'particulier' ? PERSONAL_CATEGORIES : PRO_CATEGORIES;
      kind = cats.find((c) => c.id === any.id)!.kind;
      found = any;
    } else if (rec.recurring && /\b(tombe|tombent|rentre|rentrent|arrive|arrivent|verse|versent|credite)\b/.test(rest)) {
      // « tous les mois j'ai 2 500 euros qui tombent » : de l'argent qui arrive.
      kind = 'recette';
    }
  }
  if (hasWord(rest, 'achete') && !explicitKind) kind = 'depense';
  const categoryId = found?.id ?? null;

  const date = !ymd || cmp(ymd, today) === 0 ? now.toISOString() : makeDate(ymd.y, ymd.m, ymd.d).toISOString();

  return {
    transcript,
    kind,
    kindExplicit: explicitKind !== null,
    amountCents: amountCents && amountCents > 0 ? amountCents : null,
    categoryId,
    date,
    dateExplicit: ymd !== null,
    label: detectLabel(transcript),
    categoryWord: found ? originalWords(transcript, found.word) : '',
    recurring: rec.recurring,
    dayOfMonth: rec.day,
  };
}
