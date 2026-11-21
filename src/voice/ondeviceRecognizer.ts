/**
 * Moteur « sur l'appareil » : on enregistre la voix avec le micro, puis un modèle Whisper la transcrit
 * directement dans le navigateur (voir whisper.worker.ts). Marche partout où le micro est autorisé,
 * sans service externe : le son ne quitte pas l'appareil.
 */
import type { RecognizerEvents, VoiceErrorKind, VoiceRecognizer } from './types';

/** Taille approximative du téléchargement (une seule fois), pour informer l'utilisateur. */
export const ONDEVICE_MODEL_MB = 80;

const READY_KEY = 'pilottreso.whisperReady';

/** Le moteur a-t-il déjà été téléchargé sur cet appareil ? */
export function isOnDeviceModelCached(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

const VOLATILE_KEY = 'pilottreso.whisperVolatile';

/** Le navigateur refuse-t-il de conserver le moteur (il sera alors re-téléchargé à chaque fois) ? */
export function isOnDeviceStorageVolatile(): boolean {
  try {
    return localStorage.getItem(VOLATILE_KEY) === '1';
  } catch {
    return false;
  }
}

async function hasStoredModel(): Promise<boolean> {
  try {
    if (!('caches' in self)) return false;
    for (const name of await caches.keys()) {
      if ((await (await caches.open(name)).keys()).length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Demande au navigateur de ne pas effacer le moteur quand il manque de place. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* non supporté : sans conséquence */
  }
}

/* ───────── Communication avec le worker (partagé : le modèle reste chargé entre deux dictées) ───────── */

let worker: Worker | null = null;
let loadPromise: Promise<void> | null = null;
let loadHandlers: { resolve: () => void; reject: (e: Error) => void } | null = null;
const progressListeners = new Set<(percent: number) => void>();
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
let nextId = 1;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ type: string; percent?: number; id?: number; text?: string; message?: string }>) => {
    const m = e.data;
    if (m.type === 'progress') progressListeners.forEach((f) => f(m.percent ?? 0));
    else if (m.type === 'ready') loadHandlers?.resolve();
    else if (m.type === 'result' && m.id !== undefined) {
      pending.get(m.id)?.resolve(m.text ?? '');
      pending.delete(m.id);
    } else if (m.type === 'error') {
      const err = new Error(m.message ?? 'Erreur du moteur vocal');
      if (m.id !== undefined) {
        pending.get(m.id)?.reject(err);
        pending.delete(m.id);
      } else loadHandlers?.reject(err);
    }
  };
  w.onerror = (e) => loadHandlers?.reject(new Error(e.message || 'Erreur du moteur vocal'));
  worker = w;
  return w;
}

function loadModel(onProgress: (percent: number) => void): Promise<void> {
  progressListeners.add(onProgress);
  if (!loadPromise) {
    const w = getWorker();
    loadPromise = new Promise<void>((resolve, reject) => {
      loadHandlers = { resolve, reject };
      w.postMessage({ type: 'load' });
    });
    loadPromise.then(
      async () => {
        // On vérifie que le navigateur a réellement conservé le moteur (certains le refusent : mode privé,
        // nettoyage automatique...). Sinon il sera re-téléchargé à chaque ouverture et on le signale.
        const stored = await hasStoredModel();
        try {
          localStorage.setItem(READY_KEY, stored ? '1' : '0');
          localStorage.setItem(VOLATILE_KEY, stored ? '0' : '1');
        } catch {
          /* stockage indisponible */
        }
      },
      () => {
        loadPromise = null; // permet de réessayer
        worker?.terminate();
        worker = null;
      },
    );
  }
  return loadPromise.finally(() => progressListeners.delete(onProgress));
}

/**
 * Charge le moteur en arrière-plan (sans rien afficher) pour qu'il soit prêt quand on appuie sur le micro.
 * Sans effet si le moteur n'a jamais été téléchargé : le téléchargement ne se fait qu'avec l'accord de l'utilisateur.
 */
export function preloadOnDeviceModel(): void {
  if (!isOnDeviceModelCached()) return;
  loadModel(() => undefined).catch(() => undefined);
}

function transcribe(audio: Float32Array): Promise<string> {
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

/* ───────── Audio ───────── */

/** Linéaire : ramène un enregistrement à 16 000 Hz si le navigateur n'a pas pu le faire. */
function resample(data: Float32Array, from: number, to = 16000): Float32Array {
  if (from === to) return data;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, data.length - 1);
    out[i] = data[i0] + (data[i1] - data[i0]) * (pos - i0);
  }
  return out;
}

async function decode(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext();
  }
  try {
    const audio = await ctx.decodeAudioData(bytes);
    return resample(audio.getChannelData(0).slice(), audio.sampleRate);
  } finally {
    void ctx.close();
  }
}

/** Amplifie un enregistrement faible (micro peu sensible) pour que le modèle l'entende correctement. */
function normalizeAudio(audio: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < audio.length; i++) max = Math.max(max, Math.abs(audio[i]));
  if (max < 0.0005 || max >= 0.5) return audio;
  const gain = Math.min(60, 0.6 / max);
  for (let i = 0; i < audio.length; i++) audio[i] *= gain;
  return audio;
}

/** Le modèle invente parfois du texte sur du silence : on écarte ces phrases connues. */
function clean(text: string): string {
  const t = text.trim();
  const low = t.toLowerCase();
  const ghosts = ['sous-titr', 'amara.org', "merci d'avoir regardé", 'abonnez-vous'];
  if (t.length < 2 || ghosts.some((g) => low.includes(g))) return '';
  // Boucle de répétition (« de la vie de la vie de la vie... ») : le modèle n'a rien compris.
  const words = low.split(' ').filter(Boolean);
  if (words.length >= 8) {
    const counts = new Map<string, number>();
    for (let i = 0; i + 2 < words.length; i++) {
      const g = words.slice(i, i + 3).join(' ');
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    if (Math.max(...counts.values()) >= 3) return '';
  }
  return t;
}

function mapMediaError(e: unknown): VoiceErrorKind {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'audio';
  return 'unknown';
}

// La détection de la voix s'adapte au micro : on mesure le bruit ambiant au début, la voix doit le dépasser nettement.
// Les micros peu sensibles (casques, ordinateurs portables) donnent des niveaux très bas : seuils volontairement bas.
const MIN_SPEECH_LEVEL = 0.002; // seuil minimum pour considérer que la personne se met à parler
const NOISE_FACTOR = 3; // la voix doit dépasser 3 fois le bruit ambiant
const KEEP_FACTOR = 0.6; // une fois lancée, la voix « continue » tant que le niveau reste au-dessus de 60 % du seuil
const WEAK_SIGNAL = 0.0015; // en dessous de ce pic, le micro est considéré comme muet
const SILENCE_MS = 1400; // fin de phrase : silence après avoir parlé
const WAIT_FOR_SPEECH_MS = 9000;
const MAX_MS = 20000;
const POLL_MS = 50;

export function ondeviceRecognizer(): VoiceRecognizer {
  let cancelled = false;
  let finishNow: (() => void) | null = null;
  let release: (() => void) | null = null;

  return {
    start(ev: RecognizerEvents) {
      cancelled = false;
      void (async () => {
        // Son brut + gain automatique : le filtre anti-bruit du navigateur écrase les voix faibles (il les prend pour du
        // bruit) et le modèle n'en a pas besoin. Le gain automatique relève les micros trop faibles.
        const constraints = { audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } };
        const openMic = async (): Promise<MediaStream | null> => {
          try {
            if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('insecure', 'SecurityError');
            return await navigator.mediaDevices.getUserMedia(constraints);
          } catch (e) {
            if (!cancelled) ev.onError(mapMediaError(e), e instanceof Error ? e.name : 'getUserMedia');
            return null;
          }
        };

        let stream: MediaStream | null;
        let engineReady: Promise<void> | null = null;

        if (!isOnDeviceModelCached()) {
          // Toute première fois (téléchargement) : autorisation du micro, puis téléchargement, puis micro.
          // (Le micro est refermé pendant le téléchargement, qui peut durer.)
          const probe = await openMic();
          if (!probe) return;
          probe.getTracks().forEach((t) => t.stop());
          if (cancelled) return;
          try {
            ev.onStatus?.({ phase: 'loading', percent: 0 });
            await loadModel((percent) => !cancelled && ev.onStatus?.({ phase: 'loading', percent }));
          } catch (e) {
            if (!cancelled) ev.onError('model', e instanceof Error ? e.message : 'model');
            return;
          }
          if (cancelled) return;
          stream = await openMic();
        } else {
          // Moteur déjà sur l'appareil : le micro s'ouvre TOUT DE SUITE (la voix n'est jamais perdue) ;
          // le moteur finit de se charger en parallèle (en général il l'est déjà : préchargé à l'ouverture de l'app).
          stream = await openMic();
          engineReady = loadModel(() => undefined);
          engineReady.catch(() => undefined); // l'erreur éventuelle est gérée au moment de transcrire
        }
        if (!stream) return;
        const micStream = stream;
        const stopStream = () => micStream.getTracks().forEach((t) => t.stop());
        release = stopStream;
        if (cancelled) {
          stopStream();
          return;
        }

        // 3. Enregistrement avec détection de fin de phrase.
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
        const recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

        const ctx = new AudioContext();
        try {
          await ctx.resume();
        } catch {
          /* certains navigateurs exigent un geste : on se rabat sur « Terminer » */
        }
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(micStream).connect(analyser);
        const level = new Float32Array(analyser.fftSize);

        const meterWorks = ctx.state === 'running';
        let speech = !meterWorks; // sans mesure du niveau on suppose qu'il y a eu de la voix
        let peak = 0;
        let noiseFloor = Infinity; // le plus bas niveau mesuré pendant la première seconde = bruit ambiant
        let lastVoice = performance.now();
        const t0 = performance.now();
        let finished = false;

        const timer = setInterval(() => {
          const now = performance.now();
          if (!meterWorks) {
            if (now - t0 > 12000) finishNow?.();
            return;
          }
          analyser.getFloatTimeDomainData(level);
          let sum = 0;
          for (let i = 0; i < level.length; i++) sum += level[i] * level[i];
          const rms = Math.sqrt(sum / level.length);
          peak = Math.max(peak, rms);
          ev.onLevel?.(rms);
          if (now - t0 < 1000) noiseFloor = Math.min(noiseFloor, rms);
          const threshold = Math.max(MIN_SPEECH_LEVEL, (Number.isFinite(noiseFloor) ? noiseFloor : 0) * NOISE_FACTOR);
          if (!speech) {
            if (rms > threshold) {
              speech = true;
              lastVoice = now;
            }
          } else if (rms > threshold * KEEP_FACTOR) {
            lastVoice = now; // les syllabes plus faibles ne comptent pas comme un silence
          }
          if ((speech && now - lastVoice > SILENCE_MS) || (!speech && now - t0 > WAIT_FOR_SPEECH_MS) || now - t0 > MAX_MS) finishNow?.();
        }, POLL_MS);

        finishNow = () => {
          if (finished) return;
          finished = true;
          clearInterval(timer);
          if (recorder.state !== 'inactive') recorder.stop();
        };
        release = () => {
          finished = true;
          clearInterval(timer);
          if (recorder.state !== 'inactive') recorder.stop();
          stopStream();
          void ctx.close();
        };

        recorder.onstop = async () => {
          stopStream();
          void ctx.close();
          if (cancelled) return;
          // Aucune voix nette détectée : si le micro a quand même capté un peu de signal, on tente la transcription
          // (micro très faible) ; s'il est totalement muet, on le dit clairement.
          if (!speech && peak < WEAK_SIGNAL) {
            ev.onError('silent', `micro muet (niveau max ${peak.toFixed(4)})`);
            return;
          }
          ev.onStatus?.({ phase: 'transcribing' });
          try {
            // Si le moteur n'avait pas fini de se charger pendant que vous parliez, on l'attend ici.
            if (engineReady) {
              try {
                await engineReady;
              } catch (e) {
                if (!cancelled) ev.onError('model', e instanceof Error ? e.message : 'model');
                return;
              }
            }
            const audio = await decode(new Blob(chunks, { type: recorder.mimeType }));
            const text = clean(await transcribe(normalizeAudio(audio)));
            if (cancelled) return;
            if (text) ev.onFinal(text, [text]);
            else ev.onError('no-speech', 'empty-transcript');
          } catch (e) {
            if (!cancelled) ev.onError('unknown', e instanceof Error ? e.message : 'transcription');
          }
        };

        recorder.start();
        ev.onStart?.();
      })();
    },
    stop() {
      finishNow?.();
    },
    abort() {
      cancelled = true;
      release?.();
      finishNow = null;
      release = null;
    },
  };
}
