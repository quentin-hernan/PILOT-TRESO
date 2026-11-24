import { describe, expect, it } from 'vitest';
import { parseCommand } from './parseCommand';
import { parseIntent } from './intents';

const NOW = new Date('2026-11-23T09:00:00Z');
const ctx = (account: 'particulier' | 'professionnel') => ({ account, today: { y: 2026, m: 11, d: 20 } }) as never;

describe('« recette » est bien une entrée d\'argent', () => {
  it.each([
    ['ajoute une recette de 300 euros', 30000],
    ['recette de 300 euros', 30000],
    ['nouvelle recette 120 euros', 12000],
    ["j'ai eu une recette de 90 euros de vente", 9000],
  ])('« %s »', (phrase, cents) => {
    for (const acc of ['particulier', 'professionnel'] as const) {
      const c = parseCommand(phrase, acc, NOW);
      expect(c.kind).toBe('recette');
      expect(c.amountCents).toBe(cents);
    }
  });
  it('salaire (particulier) reste une recette', () => {
    expect(parseCommand('ajoute un salaire de 2000 euros', 'particulier', NOW).kind).toBe('recette');
  });
});

describe('devis signé (professionnel)', () => {
  it('à encaisser', () => {
    expect(parseIntent('devis signé de 2000 euros pour Dupont le 30 novembre', ctx('professionnel'))).toMatchObject({
      type: 'invoice_new',
      draft: { direction: 'a_encaisser', counterparty: 'Dupont', amountCents: 200000, dueKey: '2026-11-30', label: 'Devis signé' },
    });
  });
  it('ajoute un devis accepté', () => {
    expect(parseIntent('ajoute un devis accepté de 800 euros pour Martin dans 10 jours', ctx('professionnel'))).toMatchObject({ type: 'invoice_new', draft: { direction: 'a_encaisser', amountCents: 80000 } });
  });
  it('devis fournisseur : à payer', () => {
    expect(parseIntent('devis fournisseur signé de 500 euros', ctx('professionnel'))).toMatchObject({ draft: { direction: 'a_payer' } });
  });
  it('pas pour un particulier', () => {
    expect(parseIntent('devis signé de 2000 euros', ctx('particulier'))).toBeNull();
  });
});
