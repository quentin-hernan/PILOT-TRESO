import { describe, expect, it } from 'vitest';
import type { Operation, Recurring } from '../types';
import { balanceSince, endOfMonthAvailable } from './monthly';

const rec = (label: string, euros: number, day: number, kind: 'depense' | 'recette' = 'depense'): Recurring => ({
  id: label, label, amountCents: euros * 100, kind, categoryId: 'x', dayOfMonth: day, active: true,
});
const op = (date: string, kind: 'depense' | 'recette', euros: number): Operation => ({
  id: date + kind, kind, amountCents: euros * 100, categoryId: 'x', label: 'x', date: `${date}T10:00:00.000Z`,
});

// Les récurrences du document « Application » : salaire 2000 le 1er ; loyer 600 le 5 ; EDF 80 le 10 ; eau 20 le 12 ;
// crédit immobilier 900 le 15 ; téléphone 30 le 26 ; assurance 80 le 28.
const RECS = [
  rec('Salaire', 2000, 1, 'recette'),
  rec('Loyer', 600, 5),
  rec('EDF', 80, 10),
  rec('Eau', 20, 12),
  rec('Crédit immobilier', 900, 15),
  rec('Téléphone', 30, 26),
  rec('Assurance', 80, 28),
];

describe('document « Application » — exemple 1 : le 2 décembre, sans solde de départ', () => {
  it('le salaire du 1er est passé : disponible du mois = 2000 − 1710 = 290 €', () => {
    // Le 2 décembre : seul le salaire du 1er est passé (opération créée automatiquement). Solde actuel = 2000 €.
    const balance = balanceSince(0, null, [op('2026-12-01', 'recette', 2000)]);
    expect(balance).toBe(200000);
    const e = endOfMonthAvailable(balance, RECS, '2026-12-02');
    expect(e.expenseToComeCents).toBe(171000);
    expect(e.incomeToComeCents).toBe(0);
    expect(e.availableCents).toBe(29000); // 290 €
  });
});

describe('exemple 2 : solde de départ de 250 € renseigné le 23 novembre 2026', () => {
  it('disponible du mois = 250 − 30 (téléphone le 26) − 80 (assurance le 28) = 140 €', () => {
    const e = endOfMonthAvailable(25000, RECS, '2026-11-23');
    expect(e.count).toBe(2);
    expect(e.availableCents).toBe(14000); // 140 €
  });

  it('les opérations d\'avant le jour du solde de départ ne comptent plus', () => {
    const old = [op('2026-11-01', 'recette', 2000), op('2026-11-05', 'depense', 600), op('2026-11-10', 'depense', 80)];
    expect(balanceSince(25000, '2026-11-23', old)).toBe(25000);
    expect(balanceSince(25000, null, old)).toBe(25000 + 200000 - 60000 - 8000); // ancien comportement (sans date)
  });

  it('les opérations du jour même et d\'après comptent', () => {
    expect(balanceSince(25000, '2026-11-23', [op('2026-11-23', 'depense', 10), op('2026-11-24', 'depense', 5)])).toBe(25000 - 1000 - 500);
  });
});

describe('autres cas', () => {
  it('une récurrence qui tombe aujourd\'hui est déjà passée (elle est dans le solde)', () => {
    expect(endOfMonthAvailable(0, [rec('X', 10, 23)], '2026-11-23').count).toBe(0);
  });
  it('un jour 31 dans un mois de 30 jours tombe le 30', () => {
    expect(endOfMonthAvailable(0, [rec('Fin', 10, 31)], '2026-11-23').count).toBe(1);
  });
  it('les récurrences en pause sont ignorées', () => {
    expect(endOfMonthAvailable(0, [{ ...rec('P', 10, 28), active: false }], '2026-11-23').count).toBe(0);
  });
  it('début de mois : toutes les récurrences à venir comptent', () => {
    const e = endOfMonthAvailable(200000, RECS, '2026-12-01');
    expect(e.availableCents).toBe(200000 - 171000);
  });
});
