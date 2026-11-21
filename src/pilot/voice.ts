/**
 * Voix de Pilot : on choisit par défaut une voix française MASCULINE et la plus naturelle possible parmi celles de l'appareil.
 * Les navigateurs n'indiquent pas le sexe d'une voix : on s'appuie sur les prénoms connus des voix système.
 */

const MALE = /\b(paul|henri|claude|thomas|nicolas|antoine|jean|mathieu|remy|rémy|lucas|daniel|bernard|guillaume|vivienne? ?male|male|masculin|homme|fr-fr-x-(?:frb|fra-network|vlf))\b/i;
const FEMALE = /\b(hortense|julie|denise|eloise|éloise|amelie|amélie|marie|audrey|virginie|celine|céline|brigitte|female|feminin|féminin|femme|google fran[cç]ais|fr-fr-x-(?:frc|frd))\b/i;
const NATURAL = /(natural|neural|online|premium|enhanced|wavenet|studio)/i;

export interface FrenchVoice {
  voice: SpeechSynthesisVoice;
  label: string;
  /** Voix reconnue comme masculine (d'après son nom). */
  male: boolean;
  natural: boolean;
}

export function frenchVoices(): FrenchVoice[] {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('fr'))
    .map((v) => ({
      voice: v,
      label: `${v.name.replace(/^Microsoft /, '')}${v.lang && v.lang.toLowerCase() !== 'fr-fr' ? ` (${v.lang})` : ''}`,
      male: MALE.test(v.name) && !FEMALE.test(v.name),
      natural: NATURAL.test(v.name),
    }));
}

/** Meilleure voix par défaut : masculine d'abord, puis naturelle, puis française de France. */
export function defaultVoice(voices: FrenchVoice[]): FrenchVoice | undefined {
  const score = (v: FrenchVoice) => (v.male ? 100 : 0) + (v.natural ? 30 : 0) + (v.voice.lang.toLowerCase() === 'fr-fr' ? 5 : 0) - (FEMALE.test(v.voice.name) ? 50 : 0) + (v.voice.localService ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

const KEY = 'pilottreso.pilotVoice';

export function savedVoiceUri(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveVoiceUri(uri: string | null): void {
  try {
    if (uri) localStorage.setItem(KEY, uri);
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Voix à utiliser : le choix de l'utilisateur, sinon la meilleure voix masculine disponible. */
export function pickVoice(): FrenchVoice | undefined {
  const voices = frenchVoices();
  const saved = savedVoiceUri();
  return voices.find((v) => v.voice.voiceURI === saved) ?? defaultVoice(voices);
}

/** Prépare un énoncé avec la voix choisie : débit un peu posé, ton légèrement grave si la voix est masculine. */
export function makeUtterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  const v = pickVoice();
  if (v) {
    u.voice = v.voice;
    u.lang = v.voice.lang;
    if (v.male) u.pitch = 0.92;
  }
  u.rate = 0.98;
  return u;
}
