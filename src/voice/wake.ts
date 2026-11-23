import { normalize } from './parseCommand';

/**
 * Mot d'éveil « Dis Pilot ». On accepte seulement au tout début de la phrase (pour ne pas se déclencher quand quelqu'un parle
 * d'un pilote dans une conversation).
 *
 * Le moteur de transcription entend « Dis Pilot » de bien des façons (mesuré : « 10 pilots », « et pileau », « Ok, pilots »,
 * « Pilote »). On accepte le mot « pilot » sous ses formes courantes, précédé au plus d'un petit mot d'appel.
 */
const WAKE_WORD = '(?:pilot|pilote|pilotte|pilots|pilotes|pilott|pillot|pillote|pilo|pileau|pileaux|pilaud|pylot|pireau|pireaux|pirot|pirote|pilau)';
const WAKE_FILLER = '(?:dis|dit|di|dix|10|hey|hei|he|ok|okay|salut|bonjour|ah|oh|eh|et|des|de|ti|d y|dy)';
// « Dis Pilot » en tête de phrase est parfois transcrit « 10 kilos » (mesuré)
const WAKE = new RegExp('^(?:(?:' + WAKE_FILLER + '\\s*)?' + WAKE_WORD + '|(?:10|dix)\\s*kilos?)$');

export interface WakeResult {
  woke: boolean;
  /** La suite de la phrase, avec ses majuscules et accents d'origine (vide si seulement « Dis Pilot »). */
  rest: string;
}

export function stripWakeWord(transcript: string): WakeResult {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const head = normalize(words.slice(0, n).join(' ')).replace(/[,.:]/g, '').replace(/\s+/g, ' ').trim();
    // « dis pilot » et « dispilot » : l'espace est facultatif
    if (WAKE.test(head) || WAKE.test(head.replace(' ', ''))) {
      return { woke: true, rest: words.slice(n).join(' ').replace(/^[\s,.:;!?-]+/, '').trim() };
    }
  }
  return { woke: false, rest: transcript.trim() };
}

export const isYes = (t: string): boolean => /^(oui|ouais|yes|ok|okay|d accord|confirme|confirmer|valide|valider|vas y|c est bon|affirmatif|exact|bien sur)\b/.test(normalize(t));
/** « annule », « oups », « c'est faux » : dit juste après une action de Pilot. */
export const isUndo = (t: string): boolean => /^(annule|annuler|oups|c est faux|non c est faux|retire ca|supprime ca|efface ca|defais ca|pas ca)\b/.test(normalize(t));

/** « répète », « chaque mois », « oui » : accepte la proposition faite par Pilot. */
export const isRepeat = (t: string): boolean => /^(repete|repeter|oui repete|chaque mois|tous les mois|et chaque mois|oui chaque mois|oui|ok|d accord)\b/.test(normalize(t));

export const isNo = (t: string): boolean => /^(non|nan|annule|annuler|laisse tomber|stop|surtout pas|pas du tout|ne fais rien)\b/.test(normalize(t));
