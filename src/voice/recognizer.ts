/**
 * Module de reconnaissance vocale — ISOLÉ pour pouvoir être remplacé.
 *
 * L'application ne connaît que l'interface `VoiceRecognizer` (voir types.ts). Deux moteurs sont fournis :
 *  - « navigateur » : la dictée intégrée de Chrome / Edge / Safari (rapide ; le son passe par Google / Microsoft / Apple) ;
 *  - « sur l'appareil » : un modèle Whisper exécuté dans le navigateur (marche partout, le son reste sur l'appareil,
 *    téléchargement unique d'environ 80 Mo).
 * Pour ajouter ou remplacer un moteur, il suffit de l'ajouter dans `createRecognizer()`.
 */
import { browserRecognizer, isBrowserEngineAvailable } from './browserRecognizer';
import { ondeviceRecognizer, preloadOnDeviceModel } from './ondeviceRecognizer';
import type { VoiceRecognizer } from './types';

export * from './types';
export {
  ONDEVICE_MODEL_MB,
  isOnDeviceModelCached,
  isOnDeviceStorageVolatile,
  requestPersistentStorage,
  downloadOnDeviceModel,
  ondeviceContinuous,
  type ContinuousEvents,
} from './ondeviceRecognizer';
export { browserContinuous, isBrowserEngineAvailable } from './browserRecognizer';

export type VoiceEngine = 'browser' | 'ondevice';

const ENGINE_KEY = 'pilottreso.voiceEngine';
const CONSENT_KEY = 'pilottreso.ondeviceConsent';

/** Moteur utilisé : le choix de l'utilisateur, sinon le navigateur s'il sait faire, sinon l'appareil. */
export function getPreferredEngine(): VoiceEngine {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(ENGINE_KEY);
  } catch {
    /* stockage indisponible */
  }
  if (saved === 'ondevice') return 'ondevice';
  if (saved === 'browser' && isBrowserEngineAvailable()) return 'browser';
  return isBrowserEngineAvailable() ? 'browser' : 'ondevice';
}

export function setPreferredEngine(engine: VoiceEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* stockage indisponible : le choix vaut pour cette session uniquement */
  }
}

/** L'utilisateur a-t-il accepté le téléchargement du moteur sur l'appareil ? */
export function hasOnDeviceConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function giveOnDeviceConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Configuration unique de la dictée (téléchargement du moteur si besoin + test du micro).
 * Une fois faite pour un moteur, on ne la redemande plus.
 */
export function isVoiceSetupDone(engine: VoiceEngine): boolean {
  try {
    return localStorage.getItem(`pilottreso.voiceSetup.${engine}`) === '1';
  } catch {
    return false;
  }
}

export function markVoiceSetupDone(engine: VoiceEngine): void {
  try {
    localStorage.setItem(`pilottreso.voiceSetup.${engine}`, '1');
  } catch {
    /* stockage indisponible : la configuration sera redemandée */
  }
}

/**
 * À appeler à l'ouverture de l'application : prépare le moteur en arrière-plan pour que le micro réponde
 * instantanément. Ne fait rien tant que la configuration unique n'est pas terminée.
 */
export function warmUpVoiceEngine(): void {
  if (getPreferredEngine() === 'ondevice' && isVoiceSetupDone('ondevice') && hasOnDeviceConsent()) preloadOnDeviceModel();
}

/** Le navigateur autorise-t-il le micro sur cette page ? (HTTPS ou localhost uniquement) */
export function isMicAllowedContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Point d'entrée unique : c'est ici qu'on changerait / ajouterait un moteur de reconnaissance. */
export function createRecognizer(engine: VoiceEngine = getPreferredEngine()): VoiceRecognizer {
  return engine === 'ondevice' ? ondeviceRecognizer() : browserRecognizer();
}
