/** Petits sons de Pilot (générés, aucun fichier) : activation et confirmation d'un ajout. */

function tones(notes: { freq: number; start: number; dur: number; gain?: number }[]): void {
  try {
    const ctx = new AudioContext();
    const end = Math.max(...notes.map((n) => n.start + n.dur)) + 0.1;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      const t0 = ctx.currentTime + n.start;
      const peak = n.gain ?? 0.12;
      // attaque rapide, décroissance douce : un « ding » net sans claquement
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.02);
    }
    setTimeout(() => void ctx.close(), end * 1000 + 200);
  } catch {
    /* pas de son possible : sans importance */
  }
}

/** « Dis Pilot » entendu : Pilot écoute. Deux notes montantes, courtes. */
export const playWake = (): void =>
  tones([
    { freq: 660, start: 0, dur: 0.11 },
    { freq: 880, start: 0.09, dur: 0.16 },
  ]);

/** Ajout enregistré : petit « ding » clair à deux notes. */
export const playSuccess = (): void =>
  tones([
    { freq: 988, start: 0, dur: 0.18, gain: 0.14 },
    { freq: 1319, start: 0.12, dur: 0.38, gain: 0.14 },
  ]);

/** Il manque une information (la fenêtre s'ouvre) : une note douce descendante. */
export const playAttention = (): void =>
  tones([
    { freq: 740, start: 0, dur: 0.14 },
    { freq: 554, start: 0.12, dur: 0.22 },
  ]);
