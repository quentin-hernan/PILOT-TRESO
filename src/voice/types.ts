/** Contrat commun à tous les moteurs de reconnaissance vocale. */

export type VoiceErrorKind =
  | 'unsupported' // navigateur sans dictée intégrée (Opera, Brave, Firefox...)
  | 'insecure' // page en http:// : le navigateur interdit le micro
  | 'permission' // micro refusé
  | 'no-speech' // rien entendu
  | 'network' // pas de connexion / service de transcription injoignable
  | 'audio' // micro introuvable
  | 'silent' // le micro n'envoie aucun son (coupé, mauvais micro, volume à zéro)
  | 'model' // moteur sur l'appareil impossible à charger
  | 'unknown';

export type RecognizerStatus =
  | { phase: 'loading'; percent: number } // téléchargement / chargement du moteur sur l'appareil
  | { phase: 'transcribing' };

export interface RecognizerEvents {
  /** Le moteur écoute réellement. */
  onStart?: () => void;
  /** Avancement (moteur sur l'appareil). */
  onStatus?: (status: RecognizerStatus) => void;
  /** Niveau sonore capté par le micro (0 à ~0,3), pour afficher un indicateur (moteur sur l'appareil). */
  onLevel?: (level: number) => void;
  /** Texte provisoire pendant que l'utilisateur parle (moteur du navigateur). */
  onInterim: (text: string) => void;
  /** Résultat final + variantes alternatives (meilleure d'abord). */
  onFinal: (text: string, alternatives: string[]) => void;
  /** `code` = code technique brut (utile pour comprendre un blocage). */
  onError: (kind: VoiceErrorKind, code: string) => void;
}

export interface VoiceRecognizer {
  start: (events: RecognizerEvents) => void;
  /** Arrête l'écoute et rend le résultat obtenu jusque-là. */
  stop: () => void;
  /** Arrête sans rendre de résultat. */
  abort: () => void;
}

/** Texte d'aide en français pour chaque type d'erreur. */
export const VOICE_ERROR_MESSAGES: Record<VoiceErrorKind, string> = {
  unsupported:
    "La dictée intégrée n'existe pas sur ce navigateur (Opera, Brave, Firefox...). Utilisez la dictée sur l'appareil ci-dessous, ou la saisie manuelle.",
  insecure:
    "Le navigateur bloque le micro car cette page n'est pas sécurisée (adresse en http://). Sur le PC : localhost fonctionne. Sur un téléphone : lancez « npm run dev:https » sur le PC et ouvrez l'adresse https:// affichée.",
  permission: "Le micro est bloqué. Autorisez-le dans les réglages du site (icône à gauche de l'adresse), puis réessayez.",
  'no-speech': "Je n'ai rien entendu. Appuyez sur « Réessayer » et parlez après l'écoute.",
  network:
    "La dictée du navigateur a besoin d'internet (le son est transcrit par Google ou Apple) et n'est pas disponible ici. Utilisez la dictée sur l'appareil, ou la saisie manuelle.",
  audio: 'Aucun micro détecté sur cet appareil.',
  silent:
    "Je n'entends aucun son : le micro est coupé, ce n'est pas le bon micro, ou son volume est à zéro. Vérifiez le micro choisi dans les réglages du navigateur (cadenas à côté de l'adresse > Microphone) et dans Windows (Paramètres > Système > Son > Entrée), puis réessayez.",
  model: "Le moteur vocal n'a pas pu être chargé. Une connexion internet est nécessaire la première fois (téléchargement unique).",
  unknown: 'La dictée a échoué. Réessayez, essayez la dictée sur l\'appareil, ou utilisez la saisie manuelle.',
};
