/// <reference lib="webworker" />
/**
 * Moteur de reconnaissance vocale SUR L'APPAREIL (modèle Whisper, exécuté dans le navigateur).
 * - Fonctionne sur tous les navigateurs récents, y compris ceux sans dictée intégrée (Opera, Brave, Firefox, iPhone).
 * - Le son n'est envoyé à personne : il est transcrit localement.
 * - Le modèle (~80 Mo) est téléchargé une seule fois puis conservé par le navigateur.
 *
 * Il tourne dans un « worker » pour ne pas figer l'écran pendant le calcul.
 */
import { env, pipeline } from '@huggingface/transformers';

export const WHISPER_MODEL = 'Xenova/whisper-base';
/** Taille totale approximative des fichiers du modèle (mesurée : ~77 Mo). */
const EXPECTED_BYTES = 78_000_000;

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
type PipelineFactory = (
  task: string,
  model: string,
  options: Record<string, unknown>,
) => Promise<Transcriber>;

env.allowLocalModels = false;

// Plusieurs cœurs du processeur pour le calcul (possible quand la page est « isolée » : voir les en-têtes COOP / COEP).
if (self.crossOriginIsolated) {
  const cores = self.navigator.hardwareConcurrency || 4;
  (env.backends.onnx as { wasm?: { numThreads?: number } }).wasm = {
    ...((env.backends.onnx as { wasm?: object }).wasm ?? {}),
    numThreads: Math.max(2, Math.min(8, cores - 1)),
  };
}

let transcriber: Promise<Transcriber> | null = null;

function load(): Promise<Transcriber> {
  if (!transcriber) {
    // Avancement global : on additionne les fichiers du modèle.
    const files = new Map<string, { loaded: number; total: number }>();
    let best = 0; // l'avancement ne doit JAMAIS reculer
    transcriber = (pipeline as unknown as PipelineFactory)('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: 'q8', // version compressée : ~80 Mo au lieu de ~300 Mo
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          let loaded = 0;
          let total = 0;
          files.forEach((f) => {
            loaded += f.loaded;
            total += f.total;
          });
          // Les fichiers sont découverts au fil de l'eau : on divise par la taille attendue du modèle,
          // sinon la barre atteindrait 99 % sur les premiers petits fichiers puis repartirait de zéro.
          const percent = Math.min(99, Math.round((loaded / Math.max(total, EXPECTED_BYTES)) * 100));
          best = Math.max(best, percent);
          self.postMessage({ type: 'progress', percent: best });
        }
      },
    }).catch((e) => {
      transcriber = null; // permet de réessayer après un échec (ex. hors connexion)
      throw e;
    });
  }
  return transcriber;
}

self.onmessage = async (e: MessageEvent<{ type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array }>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      const asr = await load();
      // Échauffement à vide : sans lui, la toute première phrase dite serait nettement plus lente.
      try {
        await asr(new Float32Array(16000), { language: 'french', task: 'transcribe', max_new_tokens: 4 });
      } catch {
        /* sans conséquence */
      }
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'transcribe') {
      const asr = await load();
      // Une opération se dit en une phrase courte : on borne la longueur et on interdit les boucles de répétition.
      const out = await asr(msg.audio, {
        language: 'french',
        task: 'transcribe',
        max_new_tokens: 48,
        no_repeat_ngram_size: 3,
      });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      self.postMessage({ type: 'result', id: msg.id, text: text.trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
