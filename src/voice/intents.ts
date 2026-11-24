import type { AccountType, Invoice } from '../types';
import { daysInMonth, shiftMonth, type YMD } from '../lib/dates';
import { addDaysKey, keyOf } from '../lib/forecast';
import type { Period } from '../lib/answers';
import { detectCategory, normalize, parseAmount, wordsToNumber } from './parseCommand';

/**
 * « Pilot » : commandes qui ne sont pas de simples opérations (questions, navigation, annulation, factures,
 * récurrences…). AUCUNE IA : des règles sur le texte normalisé, comme pour les opérations dictées.
 * Les phrases d'opération (« j'ai dépensé 50 euros de carburant »), de récurrence et de budget ne passent PAS ici :
 * elles restent gérées par parseCommand.
 */

export type NavTarget = 'home' | 'month' | 'categories' | 'recurring' | 'invoices' | 'flows' | 'team' | 'matrix' | 'all';

export interface InvoiceVoiceDraft {
  direction: Invoice['direction'];
  counterparty: string;
  label: string;
  amountCents: number | null;
  /** AAAA-MM-JJ ou null si aucune date n'a été dite. */
  dueKey: string | null;
}

export type Intent =
  | { type: 'help' }
  | { type: 'navigate'; target: NavTarget }
  | { type: 'ask_balance' }
  | { type: 'ask_available' }
  | { type: 'ask_spent'; kind: 'depense' | 'recette'; categoryId: string | null; period: Period }
  | { type: 'ask_upcoming'; days: number }
  | { type: 'ask_forecast'; days: 30 | 60 | 90 }
  | { type: 'ask_budget'; categoryId: string | null }
  | { type: 'ask_alerts' }
  | { type: 'last_op'; action: 'delete' | 'edit' }
  | { type: 'invoice_new'; draft: InvoiceVoiceDraft }
  | { type: 'invoice_settle'; query: string; direction: Invoice['direction'] | null }
  | { type: 'recurring'; action: 'pause' | 'resume' | 'delete'; query: string }
  | { type: 'opening'; amountCents: number | null }
  | { type: 'direct_save'; on: boolean };

export interface IntentContext {
  account: AccountType;
  today: YMD;
}

/* ───────── Date d'échéance (dans le futur) ───────── */

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « le 30 novembre », « le 15 », « demain », « dans 15 jours », « fin de mois », « lundi prochain ». */
export function parseDueDate(text: string, today: YMD): { key: string | null; rest: string } {
  const todayKey = keyOf(today);
  const strip = (re: RegExp) => text.replace(re, ' ');
  let m: RegExpMatchArray | null;

  if ((m = text.match(/\bapres demain\b/))) return { key: addDaysKey(todayKey, 2), rest: strip(/\bapres demain\b/) };
  if ((m = text.match(/\bdemain\b/))) return { key: addDaysKey(todayKey, 1), rest: strip(/\bdemain\b/) };

  const inRe = /\bdans (\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente) (jours?|semaines?|mois)\b/;
  if ((m = text.match(inRe))) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : wordsToNumber([m[1]]);
    if (m[2].startsWith('mois')) {
      const s = shiftMonth(today.y, today.m, n);
      return { key: keyOf({ y: s.y, m: s.m, d: Math.min(today.d, daysInMonth(s.y, s.m)) }), rest: strip(inRe) };
    }
    return { key: addDaysKey(todayKey, m[2].startsWith('semaine') ? n * 7 : n), rest: strip(inRe) };
  }

  if ((m = text.match(/\b(?:a la )?fin (?:de|du) mois\b/))) {
    return { key: keyOf({ y: today.y, m: today.m, d: daysInMonth(today.y, today.m) }), rest: strip(/\b(?:a la )?fin (?:de|du) mois\b/) };
  }

  const monthRe = new RegExp(`\\b(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?\\b`);
  if ((m = text.match(monthRe))) {
    const d = parseInt(m[1], 10);
    const mo = MONTHS.indexOf(m[2]) + 1;
    let y = m[3] ? parseInt(m[3], 10) : today.y;
    if (!m[3] && keyOf({ y, m: mo, d }) < todayKey) y += 1;
    if (d >= 1 && d <= daysInMonth(y, mo)) return { key: keyOf({ y, m: mo, d }), rest: strip(monthRe) };
  }

  const dayRe = new RegExp(`\\b(${WEEKDAYS.join('|')})(?:\\s+prochain)?\\b`);
  if ((m = text.match(dayRe))) {
    const target = WEEKDAYS.indexOf(m[1]);
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    let ahead = (target - dow + 7) % 7;
    if (ahead === 0) ahead = 7;
    return { key: addDaysKey(todayKey, ahead), rest: strip(dayRe) };
  }

  const dayOnly = /\ble\s+(\d{1,2})(?:er)?\b(?!\s*(?:euros?|eur|%|h\b|heures?))/;
  if ((m = text.match(dayOnly))) {
    const d = parseInt(m[1], 10);
    if (d >= 1 && d <= 31) {
      let { y, m: mo } = today;
      if (d < today.d) ({ y, m: mo } = shiftMonth(y, mo, 1));
      if (d <= daysInMonth(y, mo)) return { key: keyOf({ y, m: mo, d }), rest: strip(dayOnly) };
    }
  }
  return { key: null, rest: text };
}

/* ───────── Aides ───────── */

const has = (t: string, re: RegExp) => re.test(t);
const QUESTION = /\b(combien|quel|quelle|quels|quelles|est ce que|est ce qu|y a t il|dis moi|donne moi|montre moi|liste|ou j en suis|ou en suis je|qu est ce)\b/;
const HAS_AMOUNT = /\d|\beuros?\b/;

function periodOf(t: string): Period {
  if (/\b(aujourd hui|ce jour)\b/.test(t)) return 'today';
  if (/\bhier\b/.test(t)) return 'yesterday';
  if (/\b(cette semaine|semaine en cours|de la semaine)\b/.test(t)) return 'week';
  if (/\b(mois dernier|mois precedent)\b/.test(t)) return 'lastMonth';
  return 'month';
}

const NAV_VERBS = /\b(ouvre|ouvrir|va|vas|aller|affiche|afficher|montre|montrer|emmene|emmener|passe|passer|retourne|direction|accede|acceder)\b/;

const NAV_TARGETS: [RegExp, NavTarget][] = [
  [/\bmes frais\b/, 'all'],
  [/\brecurrences?\b|\brecurrents?\b|\bcharges fixes\b/, 'recurring'],
  [/\bfactures?\b|\becheances?\b/, 'invoices'],
  [/\bcategories?\b|\bbudgets?\b/, 'categories'],
  [/\bflux\b|\bencaissements?\b|\bdecaissements?\b|\bmouvements?\b/, 'flows'],
  [/\bequipe\b|\bemployes?\b/, 'team'],
  [/\bmatrice\b|\bexcel\b/, 'matrix'],
  [/\bprevisions?\b|\btresorerie\b|\baccueil\b|\bhome\b|\bprincipal\b|\btableau de bord\b|\balertes?\b/, 'home'],
  [/\bmois\b/, 'month'],
];

const STOP_NAMES = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'mon', 'ma', 'mes', 'de', 'du', 'des', 'd', 'au', 'aux', 'ce', 'cette', 'comme', 'est',
  'pour', 'chez', 'client', 'fournisseur', 'facture', 'societe', 'monsieur', 'madame', 'a', 'et', 'en', 'sur', 'ai', 'j', 'que',
]);

/** Nom du client / fournisseur dit dans la phrase d'origine (garde les majuscules). */
function counterpartyOf(transcript: string): string {
  const cap = transcript.match(
    /\b(?:pour|de|du|chez|client|fournisseur|au nom de)\s+(?:le client |la societe |l'entreprise |monsieur |madame |m\. |mme )?(\p{Lu}[\p{L}0-9'’-]+(?:\s+\p{Lu}[\p{L}0-9'’-]+){0,2})/u,
  );
  if (cap) return cap[1].trim();
  const low = transcript.match(/\b(?:pour|client|fournisseur|chez)\s+(\p{L}[\p{L}'’-]+)/iu);
  if (low && !STOP_NAMES.has(normalize(low[1])) && !/\d/.test(low[1])) return low[1].charAt(0).toUpperCase() + low[1].slice(1);
  return '';
}

/** Ce qui reste d'une phrase une fois les mots de commande retirés : sert à retrouver une facture / récurrence par son nom. */
function queryOf(t: string, drop: RegExp): string {
  return t
    .replace(drop, ' ')
    .split(' ')
    .filter((w) => w && !STOP_NAMES.has(w) && !/^(payee?|reglee?|encaissee?|paye|regle|encaisse|marque|marquer|passe|mets|met|mettre|pause|recurrence|recurrent|abonnement|prelevement|s|il|te|plait)$/.test(w))
    .join(' ')
    .trim();
}

/* ───────── Analyse ───────── */

export function parseIntent(transcript: string, ctx: IntentContext): Intent | null {
  const t = normalize(transcript);
  if (!t) return null;
  const pro = ctx.account === 'professionnel';

  // Aide
  if (has(t, /\b(aide|aide moi|que sais tu faire|que peux tu faire|qu est ce que tu sais faire|quelles sont les commandes|liste des commandes)\b/)) return { type: 'help' };

  // Enregistrement direct
  if (has(t, /\benregistrement direct\b/)) {
    const off = has(t, /\b(desactive|desactiver|coupe|couper|enleve|enlever|arrete|arreter|stop|annule|sans)\b/);
    return { type: 'direct_save', on: !off };
  }

  // Solde de départ
  const setsOpening =
    (has(t, /\bsolde (de depart|initial)\b/) && has(t, /\b(mets|met|mettre|modifie|modifier|fixe|fixer|regle|regler|change|changer|renseigne|renseigner|saisis|est de|est a|c est|a)\b/)) ||
    // « mon solde actuel est de 250 euros »
    (has(t, /\bsolde( actuel)?\b/) && has(t, /\b(est de|est a|est egal a|fixe|fixer|mets|met|mettre|regle|regler|renseigne|renseigner)\b/) && HAS_AMOUNT.test(t) && !QUESTION.test(t));
  if (setsOpening) {
    const cents = parseAmount(t);
    return { type: 'opening', amountCents: cents !== null && has(t, /\b(moins|negatif|decouvert)\b/) ? -cents : cents };
  }

  // Dernière opération
  if (has(t, /\b(derniere|dernier)\b/) && has(t, /\b(operation|depense|recette|ligne|saisie|paiement|encaissement|decaissement)\b/)) {
    if (has(t, /\b(modifie|modifier|corrige|corriger|change|changer|edite|editer|ouvre|ouvrir|rectifie)\b/)) return { type: 'last_op', action: 'edit' };
    if (has(t, /\b(supprime|supprimer|efface|effacer|annule|annuler|retire|retirer|enleve|enlever)\b/)) return { type: 'last_op', action: 'delete' };
  }
  if (/^(annule|annuler|oups|supprime ca|efface ca|annule ca|annule le|annule la|annule tout ca)$/.test(t)) return { type: 'last_op', action: 'delete' };

  // Factures (compte professionnel)
  if (pro && has(t, /\bfactures?\b/)) {
    const settle = has(t, /\b(payee|reglee|encaissee|paye|regle|encaisse|payer|regler|encaisser)\b/);
    if (settle && (has(t, /\b(marque|marquer)\b/) || !HAS_AMOUNT.test(t))) {
      const direction = has(t, /\b(encaissee|encaisse|encaisser)\b/) ? 'a_encaisser' : has(t, /\b(payee|paye|payer|reglee|regle|regler)\b/) ? 'a_payer' : null;
      return { type: 'invoice_settle', query: queryOf(t, /\b(la|ma|mon|une)\b/g), direction };
    }
    if (has(t, /\b(ajoute|ajouter|cree|creer|nouvelle|enregistre|enregistrer|ajout)\b/)) {
      const direction: Invoice['direction'] = has(t, /\b(a payer|fournisseur|je dois|a regler|a rembourser)\b/) ? 'a_payer' : 'a_encaisser';
      const { key, rest } = parseDueDate(t, ctx.today);
      return {
        type: 'invoice_new',
        draft: { direction, counterparty: counterpartyOf(transcript), label: '', amountCents: parseAmount(rest), dueKey: key },
      };
    }
  }

  // Devis signé / accepté (compte professionnel) : argent à recevoir (ou à payer pour un devis fournisseur) à une échéance
  if (pro && has(t, /\bdevis\b/) && has(t, /\b(signe|signes|signee|signees|accepte|accepts|accepter|valide|validee|ajoute|ajouter|cree|creer|nouveau|enregistre|enregistrer|ajout)\b/)) {
    const direction: Invoice['direction'] = has(t, /\b(a payer|fournisseur|je dois|a regler)\b/) ? 'a_payer' : 'a_encaisser';
    const { key, rest } = parseDueDate(t, ctx.today);
    return {
      type: 'invoice_new',
      draft: { direction, counterparty: counterpartyOf(transcript), label: 'Devis signé', amountCents: parseAmount(rest), dueKey: key },
    };
  }

  // Récurrences : pause, reprise, suppression
  if (has(t, /\b(en pause|suspends|suspendre|interromps|interrompre)\b/) && !has(t, /\bfactures?\b/)) {
    return { type: 'recurring', action: 'pause', query: queryOf(t, /\b(en pause|suspends|suspendre|interromps|interrompre)\b/g) };
  }
  if (has(t, /\b(reprends|reprendre|reactive|reactiver|relance|relancer|remets en route|remettre en route)\b/) && !has(t, /\bfactures?\b/) && !HAS_AMOUNT.test(t)) {
    return { type: 'recurring', action: 'resume', query: queryOf(t, /\b(reprends|reprendre|reactive|reactiver|relance|relancer|remets en route|remettre en route)\b/g) };
  }
  if (has(t, /\b(supprime|supprimer|efface|effacer|retire|retirer|arrete|arreter|stoppe|stopper)\b/) && has(t, /\b(recurrence|recurrent|recurrente|prelevement permanent|abonnement)\b/)) {
    return { type: 'recurring', action: 'delete', query: queryOf(t, /\b(supprime|supprimer|efface|effacer|retire|retirer|arrete|arreter|stoppe|stopper)\b/g) };
  }

  // Questions
  const asks = QUESTION.test(t);

  const spentKind = has(t, /\b(depense|depenses|depenser|paye|claque|debourse|sorti|coute)\b/) ? 'depense' : has(t, /\b(gagne|encaisse|recu|touche|rentre|percu|recette|recettes|encaissements?)\b/) ? 'recette' : null;
  if (spentKind && (has(t, /\bcombien\b/) || has(t, /\b(total|somme|montant)\b/)) && !HAS_AMOUNT.test(t.replace(/\b(30|60|90)\b/g, ''))) {
    const cat = detectCategory(t, ctx.account, spentKind);
    return { type: 'ask_spent', kind: spentKind, categoryId: cat?.id ?? null, period: periodOf(t) };
  }

  const forecastDays = has(t, /\b(30|trente|un mois|1 mois)\b/) ? 30 : has(t, /\b(60|soixante|deux mois|2 mois)\b/) ? 60 : has(t, /\b(90|quatre vingt dix|trois mois|3 mois)\b/) ? 90 : null;
  if (has(t, /\b(previsions?|prevoir|sera|serai|aurai|devrait etre)\b/) && (forecastDays || (asks && !NAV_VERBS.test(t)))) {
    return { type: 'ask_forecast', days: (forecastDays ?? 30) as 30 | 60 | 90 };
  }

  if ((has(t, /\bbudgets?\b/) || has(t, /\bil me reste\b/)) && (asks || has(t, /\b(reste|ou j en suis)\b/)) && !HAS_AMOUNT.test(t)) {
    const cat = detectCategory(t, ctx.account, 'depense');
    // « il me reste X sur mon compte » parle du solde ; sans le mot « budget », une catégorie est nécessaire.
    if (has(t, /\bbudgets?\b/) || (cat && !has(t, /\b(compte|banque)\b/))) return { type: 'ask_budget', categoryId: cat?.id ?? null };
  }

  if (has(t, /\balertes?\b/) && (asks || has(t, /\b(des|y a|ai je|j ai)\b/)) && !NAV_VERBS.test(t)) return { type: 'ask_alerts' };

  // « disponible du mois » : ce qui restera à la fin du mois une fois les récurrences passées
  if (has(t, /\bdisponible\b/) && !NAV_VERBS.test(t)) return { type: 'ask_available' };

  // « solde » est parfois transcrit « sol » (fin de mot coupée)
  if ((has(t, /\b(solde|tresorerie)\b/) || has(t, /\b(mon|le) sol\b/)) && !NAV_VERBS.test(t)) return { type: 'ask_balance' };
  if (has(t, /\bcombien (il me reste|j ai)\b/) && has(t, /\b(compte|banque)\b/)) return { type: 'ask_balance' };

  if (
    (has(t, /\b(prochains?|prochaines?|a venir|prevu|prevus|prevues|prelevements?)\b/) && has(t, /\b(echeances?|prelevements?|depenses?|paiements?|mouvements?|recurrences?|factures?)\b/) && !NAV_VERBS.test(t)) ||
    (has(t, /\b(tombe|tombent)\b/) && asks && !HAS_AMOUNT.test(t)) ||
    (has(t, /\ba (payer|encaisser)\b/) && asks)
  ) {
    return { type: 'ask_upcoming', days: has(t, /\bsemaine\b/) ? 7 : has(t, /\bmois\b/) ? 30 : 14 };
  }

  // Navigation
  if (NAV_VERBS.test(t) && !HAS_AMOUNT.test(t)) {
    for (const [re, target] of NAV_TARGETS) if (re.test(t)) return { type: 'navigate', target };
  }
  return null;
}
