/**
 * Moteur « navigateur » : reconnaissance vocale intégrée (Web Speech API, fr-FR).
 * ATTENTION (confidentialité) : sur Chrome / Edge / Safari, le son est envoyé à Google / Microsoft / Apple
 * pour être transcrit, et la dictée ne marche pas hors connexion.
 */
import type { RecognizerEvents, VoiceErrorKind, VoiceRecognizer } from './types';

/* Types minimaux de la Web Speech API (absents de lib.dom selon les versions). */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Navigateurs qui exposent l'API mais n'ont pas le service de transcription (la dictée y échoue). */
function isKnownUnsupportedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return ua.includes('OPR/') || ua.includes('OPT/') || ua.includes('Opera') || Boolean((navigator as unknown as { brave?: unknown }).brave);
}

export function isBrowserEngineAvailable(): boolean {
  return getCtor() !== null && !isKnownUnsupportedBrowser();
}

function mapError(code: string): VoiceErrorKind {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'audio-capture':
      return 'audio';
    default:
      return 'unknown';
  }
}

export function browserRecognizer(): VoiceRecognizer {
  const Ctor = getCtor();
  let current: SpeechRecognitionLike | null = null;
  let aborted = false;

  return {
    start(events: RecognizerEvents) {
      if (!Ctor) {
        events.onError('unsupported', 'unsupported');
        return;
      }
      aborted = false;
      let finalText = '';
      let alternatives: string[] = [];
      let failed = false;

      const r = new Ctor();
      current = r;
      r.lang = 'fr-FR';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 3;

      r.onstart = () => events.onStart?.();
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript;
            alternatives = [];
            for (let k = 0; k < res.length; k++) alternatives.push(res[k].transcript);
          } else {
            interim += res[0].transcript;
          }
        }
        events.onInterim((finalText + interim).trim());
      };
      r.onerror = (e) => {
        if (aborted || e.error === 'aborted') return;
        failed = true;
        events.onError(mapError(e.error), e.error);
      };
      r.onend = () => {
        if (aborted || failed) return;
        const text = finalText.trim();
        if (text) events.onFinal(text, alternatives.length ? alternatives : [text]);
        else events.onError('no-speech', 'no-speech');
      };
      try {
        r.start();
      } catch {
        events.onError('unknown', 'start-failed');
      }
    },
    stop() {
      current?.stop();
    },
    abort() {
      aborted = true;
      current?.abort();
    },
  };
}

/* ───────── Écoute permanente via le navigateur (option « rapide ») ───────── */

import type { ContinuousEvents } from './ondeviceRecognizer';

/**
 * Écoute continue avec la dictée intégrée du navigateur (Chrome, Edge, Safari) : très rapide, et le début de la phrase
 * (« Dis Pilot… ») est reconnu pendant que l'on parle. ATTENTION : tout ce qui est dit est envoyé à Google / Apple pour être
 * transcrit tant que l'écoute est active ; sur Android, Chrome peut émettre un petit bip à chaque relance.
 */
export function browserContinuous(ev: ContinuousEvents): { stop: () => void; setPaused: (paused: boolean) => void } {
  const Ctor = getCtor();
  let stopped = false;
  let paused = false;
  let current: SpeechRecognitionLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInterim = '';

  if (!Ctor) {
    queueMicrotask(() => ev.onError('unsupported', 'unsupported'));
    return { stop() {}, setPaused() {} };
  }

  const start = () => {
    if (stopped) return;
    const r = new Ctor();
    current = r;
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => ev.onStart?.();
    r.onresult = (e) => {
      if (paused) return; // Pilot parle : on écarte ce qui est entendu (sinon il s'entendrait lui-même)
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) {
          lastInterim = '';
          ev.onText(text);
        } else if (text !== lastInterim) {
          lastInterim = text;
          ev.onPeek?.(text); // texte provisoire : « Dis Pilot » est repéré avant la fin de la phrase
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // normal : on relance
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network') {
        stopped = true;
        ev.onError(mapError(e.error), e.error);
      }
    };
    r.onend = () => {
      if (stopped) return;
      timer = setTimeout(start, 200); // le navigateur coupe l'écoute de temps en temps : on la relance aussitôt
    };
    try {
      r.start();
    } catch {
      timer = setTimeout(start, 600);
    }
  };
  start();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      current?.abort();
    },
    setPaused(value: boolean) {
      paused = value;
    },
  };
}
