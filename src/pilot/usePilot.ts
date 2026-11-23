import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserContinuous,
  createRecognizer,
  getPreferredEngine,
  hasOnDeviceConsent,
  isBrowserEngineAvailable,
  isMicAllowedContext,
  isOnDeviceModelCached,
  isVoiceSetupDone,
  ondeviceContinuous,
  VOICE_ERROR_MESSAGES,
  type VoiceRecognizer,
} from '../voice/recognizer';
import { isNo, isRepeat, isUndo, isYes, stripWakeWord } from '../voice/wake';
import { speakable } from '../lib/answers';
import { frenchVoices, makeUtterance, saveVoiceUri, savedVoiceUri, type FrenchVoice } from './voice';
import { playAttention, playSuccess, playWake } from './sounds';
import type { AutoResult, PilotReply } from './execute';

/**
 * Pilot : écoute permanente SUR L'APPAREIL, activée uniquement par « Dis Pilot ».
 * Le micro reste ouvert (le son n'est ni envoyé ni conservé) et chaque phrase est transcrite localement ; seules les
 * phrases qui commencent par « Dis Pilot » sont exécutées, le reste est ignoré.
 * « Dis Pilot, j'ai dépensé 50 euros de carburant » : bip d'activation, la phrase s'affiche, l'ajout est fait tout de
 * suite (« ding ») ou, s'il manque une information, la fenêtre s'ouvre pour la compléter.
 */

export type PilotState = 'off' | 'starting' | 'listening' | 'busy' | 'paused' | 'error';

export interface PilotPanel {
  /** Ce que Pilot a compris (la commande). */
  heard: string;
  say: string;
  /** En attente d'un oui / non. */
  pending: boolean;
  /** « Je vous écoute… » : en attente de la commande après « Dis Pilot ». */
  waiting?: boolean;
  /** Une action vient d'être faite : un bouton « Annuler » est disponible. */
  undoable?: boolean;
  /** listening = micro ouvert après « Dis Pilot » ; thinking = Pilot traite ; result (défaut) = réponse. */
  phase?: 'listening' | 'thinking' | 'result';
  /** Texte provisoire pendant que vous parlez (bouton micro). */
  interim?: string;
  /** Proposition affichée sous la réponse (ex. « Répéter chaque mois (le 1) »). */
  offer?: string;
}

/** Moteur de l'écoute permanente : « ondevice » = privé, calculé sur l'appareil ; « browser » = rapide, mais le son passe par Google / Apple. */
export type ListenEngine = 'ondevice' | 'browser';

export interface PilotApi {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  state: PilotState;
  error: string | null;
  /** Niveau du micro de 0 à 4 (pour l'indicateur). */
  level: number;
  panel: PilotPanel | null;
  confirm: (yes: boolean) => void;
  undo: () => void;
  dismiss: () => void;
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  /** Sons : bip à l'activation, « ding » à l'ajout. */
  sounds: boolean;
  setSounds: (on: boolean) => void;
  /** Voix françaises disponibles sur l'appareil, et celle choisie (null = automatique : voix masculine naturelle). */
  voices: FrenchVoice[];
  voiceUri: string | null;
  setVoiceUri: (uri: string | null) => void;
  /** Fait entendre la voix actuelle. */
  sample: () => void;
  /** Affiche et exécute la réponse à une commande (utilisé aussi quand la fenêtre des informations manquantes se termine). */
  present: (reply: PilotReply, heard: string) => void;
  /** Pose une question à voix haute (informations manquantes), puis écoute la réponse (même sans écoute permanente). */
  ask: (text: string) => void;
  /** Exécute une phrase comme si elle avait été entendue (tests, ou saisie). */
  hear: (text: string) => void;
  /** Exécute directement une commande (sans « Dis Pilot ») : utilisé quand elle vient du bouton micro. */
  run: (command: string) => void;
  /** Bouton micro : écoute UNE commande tout de suite (sans « Dis Pilot »), avec le moteur le plus rapide de l'appareil. */
  talk: () => 'started' | 'needs-setup';
  /** Un appui sur le micro est en cours. */
  talking: boolean;
  stopTalking: () => void;
  /** Accepte la proposition affichée (« Répéter chaque mois »). */
  acceptOffer: () => void;
  listenEngine: ListenEngine;
  setListenEngine: (engine: ListenEngine) => void;
  /** La dictée du navigateur est disponible ici (Chrome, Edge, Safari). */
  browserAvailable: boolean;
  /** Téléphone ou appareil peu puissant : l'écoute permanente sur l'appareil y est lente. */
  weakDevice: boolean;
}

interface Options {
  /** Mettre l'écoute en pause (une fenêtre est ouverte, le micro y est utilisé). */
  blocked: boolean;
  /** Interprète une commande (après « Dis Pilot ») : l'exécute, la prépare, ou ouvre la fenêtre à compléter. */
  dispatch: (command: string) => PilotReply;
  /**
   * Une question est posée à l'écran (informations manquantes) : la phrase entendue est sa réponse, sans « Dis Pilot ».
   * Renvoie true si la phrase a été utilisée.
   */
  onAnswer?: (text: string) => boolean;
}

const ENABLED_KEY = 'pilottreso.pilot';
const SPEAK_KEY = 'pilottreso.pilotSpeak';
const SOUND_KEY = 'pilottreso.pilotSound';
const ENGINE_KEY = 'pilottreso.pilotEngine';
const UNDO_WINDOW_MS = 12_000;

const isWeakDevice = (): boolean =>
  typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.hardwareConcurrency ?? 8) <= 4);

const readEngine = (): ListenEngine => {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'browser' && isBrowserEngineAvailable() ? 'browser' : 'ondevice';
  } catch {
    return 'ondevice';
  }
};

const read = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const write = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* stockage indisponible */
  }
};

const asResult = (r: string | AutoResult): AutoResult => (typeof r === 'string' ? { say: r } : r);

export function usePilot({ blocked, dispatch, onAnswer }: Options): PilotApi {
  const [enabled, setEnabledState] = useState(() => read(ENABLED_KEY, false));
  const [speakReplies, setSpeakRepliesState] = useState(() => read(SPEAK_KEY, true));
  const [sounds, setSoundsState] = useState(() => read(SOUND_KEY, true));
  const [state, setState] = useState<PilotState>(enabled ? 'starting' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [panel, setPanel] = useState<PilotPanel | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  /** « Dis Pilot » vient d'être entendu : Pilot travaille (voyant bleu). */
  const [awake, setAwake] = useState(false);
  const [voices, setVoices] = useState<FrenchVoice[]>(() => frenchVoices());
  const [voiceUri, setVoiceUriState] = useState<string | null>(() => savedVoiceUri());
  const [listenEngine, setListenEngineState] = useState<ListenEngine>(readEngine);
  /** Un appui sur le micro est en cours (l'écoute permanente est alors suspendue). */
  const [talking, setTalking] = useState(false);
  const talkRef = useRef<VoiceRecognizer | null>(null);
  const offerRef = useRef<{ run: () => Promise<AutoResult>; until: number } | null>(null);

  const pending = useRef<(() => Promise<string>) | null>(null);
  const undoRef = useRef<{ run: () => Promise<string>; until: number } | null>(null);
  const armedUntil = useRef(0);
  const latest = useRef({ dispatch, speakReplies, sounds, onAnswer, permanentOn: enabled });
  latest.current = { dispatch, speakReplies, sounds, onAnswer, permanentOn: enabled };
  const talkNow = useRef<(() => 'started' | 'needs-setup') | null>(null);
  /** « Dis Pilot » a déjà été repéré pendant que l'utilisateur parlait (le bip et le micro sont déjà affichés). */
  const peekOpen = useRef(false);
  const listenerRef = useRef<{ stop: () => void; setPaused: (paused: boolean) => void } | null>(null);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    write(ENABLED_KEY, on);
    if (on) setError(null);
    else {
      pending.current = null;
      undoRef.current = null;
      setPanel(null);
      setAwake(false);
    }
  }, []);

  const setSpeakReplies = useCallback((on: boolean) => {
    setSpeakRepliesState(on);
    write(SPEAK_KEY, on);
    if (!on) window.speechSynthesis?.cancel();
  }, []);

  const setListenEngine = useCallback((engine: ListenEngine) => {
    setListenEngineState(engine);
    try {
      localStorage.setItem(ENGINE_KEY, engine);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  const setSounds = useCallback((on: boolean) => {
    setSoundsState(on);
    write(SOUND_KEY, on);
  }, []);

  // Les voix du navigateur se chargent en différé : on met la liste à jour quand elles arrivent.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoices(frenchVoices());
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
    return () => synth.removeEventListener?.('voiceschanged', refresh);
  }, []);

  const setVoiceUri = useCallback((uri: string | null) => {
    setVoiceUriState(uri);
    saveVoiceUri(uri);
  }, []);

  /** Lit la réponse à voix haute ; l'écoute est suspendue pendant ce temps pour que Pilot ne s'entende pas lui-même. */
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Après une question : ouvre le micro pour la réponse (une seule fois). */
  const listenForAnswer = useRef<(() => void) | null>(null);
  const speak = useCallback((text: string) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!latest.current.speakReplies || !synth || !text) return;
    synth.cancel();
    const u = makeUtterance(speakable(text));
    const finish = () => {
      if (speakTimer.current) clearTimeout(speakTimer.current);
      setTimeout(() => {
        setSpeaking(false);
        listenForAnswer.current?.();
      }, 150);
    };
    u.onend = finish;
    u.onerror = finish;
    setSpeaking(true);
    synth.speak(u);
    // garde-fou : si le navigateur ne signale jamais la fin de la lecture, on reprend l'écoute quand même
    if (speakTimer.current) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => {
      setSpeaking(false);
      listenForAnswer.current?.();
    }, 2500 + text.length * 90);
  }, []);

  const sample = useCallback(() => speak('Bonjour, je suis Pilot. Voici ma voix.'), [speak]);

  const show = useCallback(
    (next: PilotPanel, spoken?: string) => {
      setPanel({ phase: 'result', ...next });
      const text = spoken ?? next.say;
      if (text) speak(text);
    },
    [speak],
  );

  /** Affiche le résultat d'une action faite, avec un « ding », et garde de quoi l'annuler quelques secondes. */
  const showDone = useCallback(
    (heard: string, result: AutoResult) => {
      undoRef.current = result.undo ? { run: result.undo, until: Date.now() + UNDO_WINDOW_MS } : null;
      offerRef.current = result.offer ? { run: result.offer.run, until: Date.now() + UNDO_WINDOW_MS } : null;
      if (latest.current.sounds && result.undo) playSuccess();
      show(
        { heard, say: result.say, pending: false, undoable: Boolean(result.undo), offer: result.offer?.label },
        result.spoken ?? (result.offer ? "C'est fait. Voulez-vous le répéter chaque mois ?" : "C'est fait."),
      );
    },
    [show],
  );

  /** Affiche la réponse à une commande et exécute l'action qu'elle contient. */
  const present = useCallback(
    async (reply: PilotReply, command: string) => {
      undoRef.current = null; // « annule » ne vise que la toute dernière action, pas une plus ancienne
      offerRef.current = null;
      if (reply.silent) {
        // il manquait une information : une question s'affiche au milieu de l'écran (ou une fenêtre s'est ouverte)
        setAwake(false);
        setPanel(null);
        if (latest.current.sounds) playAttention();
        return;
      }
      pending.current = reply.confirm?.run ?? null;
      if (reply.auto) setPanel({ heard: command, say: reply.say, pending: false, phase: 'thinking' });
      else show({ heard: command, say: reply.say, pending: Boolean(reply.confirm) });
      if (reply.auto) {
        try {
          showDone(command, asResult(await reply.auto()));
        } catch (e) {
          show({ heard: command, say: e instanceof Error ? e.message : "Je n'ai pas pu faire ça.", pending: false });
        }
      }
      setAwake(false);
    },
    [show, showDone],
  );

  const execute = useCallback(
    async (command: string) => {
      let reply: PilotReply;
      try {
        reply = latest.current.dispatch(command);
      } catch (e) {
        setAwake(false);
        show({ heard: command, say: e instanceof Error ? e.message : "Je n'ai pas pu faire ça.", pending: false });
        return;
      }
      await present(reply, command);
    },
    [present, show],
  );

  const confirm = useCallback(
    async (yes: boolean) => {
      const run = pending.current;
      pending.current = null;
      if (!run) return;
      if (!yes) {
        show({ heard: '', say: "D'accord, j'annule.", pending: false });
        return;
      }
      try {
        const say = await run();
        if (latest.current.sounds) playSuccess();
        show({ heard: '', say, pending: false });
      } catch (e) {
        show({ heard: '', say: e instanceof Error ? e.message : "Je n'ai pas pu le faire.", pending: false });
      }
    },
    [show],
  );

  const undo = useCallback(async () => {
    const u = undoRef.current;
    undoRef.current = null;
    if (!u || Date.now() > u.until) return;
    try {
      show({ heard: '', say: await u.run(), pending: false });
    } catch (e) {
      show({ heard: '', say: e instanceof Error ? e.message : "Je n'ai pas pu annuler.", pending: false });
    }
  }, [show]);

  const acceptOffer = useCallback(async () => {
    const o = offerRef.current;
    offerRef.current = null;
    if (!o || Date.now() > o.until) return;
    try {
      showDone('', await o.run());
    } catch (e) {
      show({ heard: '', say: e instanceof Error ? e.message : "Je n'ai pas pu le faire.", pending: false });
    }
  }, [show, showDone]);

  /**
   * Une phrase a été entendue (ou saisie). Seules celles qui commencent par « Dis Pilot » comptent,
   * sauf quand elle vient du bouton micro (`direct`) : elle est alors forcément une commande.
   */
  const hear = useCallback(
    (text: string, direct = false) => {
      if (import.meta.env.DEV) console.debug('[pilot] entendu :', text);
      if (pending.current) {
        if (isYes(text)) return void confirm(true);
        if (isNo(text)) return void confirm(false);
      }
      const peeked = peekOpen.current;
      peekOpen.current = false;
      const w = stripWakeWord(text);
      // une question est posée à l'écran : cette phrase en est la réponse (sauf si c'est une nouvelle commande « Dis Pilot… »)
      if (!w.woke && latest.current.onAnswer?.(text)) return;
      // « annule » juste après une action de Pilot : annule cette action
      if (!w.woke && undoRef.current && Date.now() < undoRef.current.until && isUndo(text)) return void undo();
      // « répète » / « oui » juste après une proposition (« Répéter chaque mois ? »)
      if (!w.woke && offerRef.current && Date.now() < offerRef.current.until && isRepeat(text)) return void acceptOffer();

      let command: string | null = null;
      if (w.woke) {
        if (latest.current.sounds && !peeked) playWake(); // déjà fait dès « Dis Pilot » si l'aperçu l'a repéré
        if (!w.rest) {
          armedUntil.current = Date.now() + 10_000;
          pending.current = null;
          setAwake(true);
          setPanel({ heard: '', say: 'Je vous écoute…', pending: false, waiting: true, phase: 'listening' });
          return;
        }
        command = w.rest;
      } else if (Date.now() < armedUntil.current || direct) {
        command = text;
      }
      if (!command) {
        // pas de « Dis Pilot » : conversation ordinaire, ignorée (et on ferme le micro ouvert à tort par l'aperçu)
        if (peeked) {
          setPanel(null);
          setAwake(false);
        }
        return;
      }
      armedUntil.current = 0;
      pending.current = null;
      setAwake(true);
      // ce que Pilot a compris s'affiche tout de suite, avant même la réponse
      setPanel({ heard: command, say: '', pending: false, phase: 'thinking' });
      void execute(command);
    },
    [confirm, execute, undo, acceptOffer],
  );
  const hearRef = useRef(hear);
  hearRef.current = hear;

  /** Bouton micro : écoute une commande tout de suite, avec le moteur le plus rapide (navigateur si possible). */
  const talk = useCallback((): 'started' | 'needs-setup' => {
    const engine = getPreferredEngine();
    if (!isMicAllowedContext()) {
      show({ heard: '', say: VOICE_ERROR_MESSAGES.insecure, pending: false });
      return 'started';
    }
    // première utilisation d'un moteur : la configuration unique (autorisation du micro, téléchargement) se fait dans la fenêtre d'avant
    if (!isVoiceSetupDone(engine) || (engine === 'ondevice' && (!isOnDeviceModelCached() || !hasOnDeviceConsent()))) return 'needs-setup';
    talkRef.current?.abort();
    window.speechSynthesis?.cancel();
    pending.current = null;
    armedUntil.current = 0;
    setTalking(true);
    setAwake(true);
    if (latest.current.sounds) playWake();
    setPanel({ heard: '', say: '', pending: false, waiting: true, phase: 'listening' });
    const r = createRecognizer(engine);
    talkRef.current = r;
    let lastBucket = 0;
    const end = () => {
      setTalking(false);
      talkRef.current = null;
    };
    r.start({
      onLevel: (rms) => {
        const bucket = Math.min(4, Math.floor(rms * 40));
        if (bucket !== lastBucket) {
          lastBucket = bucket;
          setLevel(bucket);
        }
      },
      onInterim: (t) => setPanel((p) => (p?.phase === 'listening' ? { ...p, interim: t } : p)),
      onStatus: (s) => s.phase === 'transcribing' && setPanel((p) => (p?.phase === 'listening' ? { ...p, interim: 'J’analyse…' } : p)),
      onFinal: (text) => {
        end();
        hearRef.current(text, true);
      },
      onError: (kind) => {
        end();
        setAwake(false);
        show({ heard: '', say: kind === 'no-speech' ? "Je n'ai rien entendu. Appuyez sur le micro, puis parlez." : VOICE_ERROR_MESSAGES[kind], pending: false });
      },
    });
    return 'started';
  }, [show]);
  talkNow.current = talk;

  // L'écoute elle-même : démarre quand Pilot est activé, se met en pause quand une fenêtre est ouverte ou pendant la réponse vocale.
  useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    if (blocked || talking) {
      setState('paused');
      return;
    }
    setState('starting');
    let lastBucket = 0;
    const useBrowser = listenEngine === 'browser';
    // l'aperçu (« Dis Pilot » repéré avant la fin) double le calcul : inutile et coûteux sur téléphone avec le moteur de l'appareil
    const skipPeek = !useBrowser && isWeakDevice();
    const listener = (useBrowser ? browserContinuous : ondeviceContinuous)({
      onStart: () => setState('listening'),
      onLevel: (rms) => {
        const bucket = Math.min(4, Math.floor(rms * 40));
        if (bucket !== lastBucket) {
          lastBucket = bucket;
          setLevel(bucket);
        }
      },
      onBusy: setBusy,
      // « Dis Pilot » repéré dès le début de la phrase : le micro s'ouvre tout de suite, avant la fin de la commande
      onPeek: skipPeek ? undefined : (text) => {
        if (!stripWakeWord(text).woke || peekOpen.current) return;
        peekOpen.current = true;
        setAwake(true);
        if (latest.current.sounds) playWake();
        setPanel({ heard: '', say: '', pending: false, waiting: true, phase: 'listening' });
      },
      onText: (text) => hearRef.current(text),
      onError: (kind, code) => {
        setError(`${VOICE_ERROR_MESSAGES[kind]} (${code})`);
        setState('error');
        setEnabledState(false);
        write(ENABLED_KEY, false);
      },
    });
    listenerRef.current = listener;
    return () => {
      listenerRef.current = null;
      listener.stop();
    };
  }, [enabled, blocked, talking, listenEngine]);

  // Pendant que Pilot parle : sourdine instantanée (le micro reste ouvert, la reprise est immédiate : on peut répondre tout de suite)
  useEffect(() => {
    listenerRef.current?.setPaused(speaking);
  }, [speaking]);

  // Le panneau de réponse disparaît tout seul (sauf s'il attend un oui / non ou une commande).
  useEffect(() => {
    if (!panel || panel.pending || panel.waiting) return;
    const t = setTimeout(() => setPanel(null), panel.undoable ? UNDO_WINDOW_MS - 1000 : 9000);
    return () => clearTimeout(t);
  }, [panel]);

  // « Je vous écoute… » expire au bout de 10 s.
  useEffect(() => {
    if (!panel?.waiting) return;
    const t = setTimeout(() => {
      setPanel((p) => (p?.waiting ? null : p));
      setAwake(false);
    }, 10_000);
    return () => clearTimeout(t);
  }, [panel]);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  return {
    enabled,
    setEnabled,
    state: enabled && speaking && state === 'listening' ? 'paused' : enabled && (busy || awake) && state === 'listening' ? 'busy' : state,
    error,
    level,
    panel,
    confirm: (yes) => void confirm(yes),
    undo: () => void undo(),
    dismiss: () => {
      pending.current = null;
      offerRef.current = null;
      talkRef.current?.abort();
      talkRef.current = null;
      setTalking(false);
      setPanel(null);
      setAwake(false);
    },
    speakReplies,
    setSpeakReplies,
    sounds,
    setSounds,
    voices,
    voiceUri,
    setVoiceUri,
    sample,
    talk,
    talking,
    stopTalking: () => talkRef.current?.stop(),
    acceptOffer: () => void acceptOffer(),
    listenEngine,
    setListenEngine,
    browserAvailable: isBrowserEngineAvailable(),
    weakDevice: isWeakDevice(),
    present: (reply, heard) => void present(reply, heard),
    ask: (text) => {
      // sans écoute permanente, le micro s'ouvre tout seul une fois la question posée : on répond directement
      listenForAnswer.current = () => {
        listenForAnswer.current = null;
        if (!latest.current.permanentOn && latest.current.onAnswer && !talkRef.current) talkNow.current?.();
      };
      if (latest.current.speakReplies && window.speechSynthesis) speak(text);
      else {
        const f = listenForAnswer.current;
        listenForAnswer.current = null;
        f();
      }
    },
    hear: (text) => hear(text),
    run: (command) => void execute(command),
  };
}
