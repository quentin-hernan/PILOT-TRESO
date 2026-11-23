import { describe, expect, it } from 'vitest';
import { detectPlanned } from './planned';

// Aujourd'hui : lundi 23 novembre 2026
const NOW = new Date('2026-11-23T09:00:00Z');
const hit = (t: string, account: 'particulier' | 'professionnel' = 'particulier') => detectPlanned(t, account, NOW);

describe('opérations prévues à une date future', () => {
  it.each([
    ["le 28 j'ai 80 euros d'assurance", '2026-11-28', 8000, 'logement'],
    ["j'ai une dépense de 80 euros d'assurance le 28", '2026-11-28', 8000, 'logement'],
    ["le 15 décembre j'ai 900 euros de crédit", '2026-12-15', 90000, 'credit'],
    ['je dois payer 120 euros de carburant dans 10 jours', '2026-12-03', 12000, 'carburant'],
    ["j'ai une échéance de 650 euros de loyer le 5 janvier", '2027-01-05', 65000, 'logement'],
    ['le 30 j\'ai 45 euros de mutuelle', '2026-11-30', 4500, 'sante'],
  ])('« %s »', (phrase, dateKey, cents, cat) => {
    const h = hit(phrase)!;
    expect(h).not.toBeNull();
    expect(h.dateKey).toBe(dateKey);
    expect(h.parsed.amountCents).toBe(cents);
    expect(h.parsed.categoryId).toBe(cat);
  });

  it('recette prévue', () => {
    const h = hit('je dois recevoir 500 euros de remboursement le 29')!;
    expect(h.parsed.kind).toBe('recette');
    expect(h.dateKey).toBe('2026-11-29');
  });

  it('pas prévu : passé, aujourd\'hui, sans date, ou autre type de phrase', () => {
    for (const p of [
      "j'ai payé 80 euros d'assurance le 15",
      "j'ai dépensé 50 euros de carburant hier",
      "j'ai dépensé 50 euros de carburant",
      "j'ai 50 euros de carburant",
      'tous les mois le 28 assurance 80 euros', // récurrence
      'budget alimentation 400 euros',
      '50 euros de carburant le 28', // aucun verbe : on ne devine pas
    ]) {
      expect(hit(p), p).toBeNull();
    }
  });
});
