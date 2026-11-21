const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurRound = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** 123456 -> "1 234,56 €" */
export const formatEuros = (cents: number): string => eur.format(cents / 100);

/** Sans décimales, pour les graphiques. */
export const formatEurosRound = (cents: number): string => eurRound.format(cents / 100);

/** 10000 -> "+100,00 €" ; -10000 -> "−100,00 €" */
export const formatSigned = (cents: number): string =>
  (cents < 0 ? '−' : '+') + eur.format(Math.abs(cents) / 100);

/** Sépare "1 234" et ",56 €" pour afficher les décimales en plus petit. */
export function splitEuros(cents: number): { main: string; dec: string } {
  const s = eur.format(cents / 100);
  const i = s.lastIndexOf(',');
  return { main: s.slice(0, i), dec: s.slice(i) };
}

/** "12,5" ou "12.50" -> 1250 ; null si invalide. */
export function parseEurosToCents(input: string): number | null {
  const n = parseFloat(input.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Comme parseEurosToCents, mais accepte 0 et les montants négatifs (solde de départ). */
export function parseSignedEurosToCents(input: string): number | null {
  const n = parseFloat(input.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** 4200 -> "42,00" (pour préremplir un champ). */
export const centsToInput = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',');
