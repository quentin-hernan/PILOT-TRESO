import { describe, expect, it } from 'vitest';
import type { Operation, Recurring } from '../types';
import { habitualFlows, monthlyBudget } from './monthly';
import { forecast } from './forecast';

const today = '2026-11-20';
let n = 0;
const op = (date: string, kind: 'depense' | 'recette', euros: number, categoryId: string, label = 'x'): Operation => ({
  id: `o${n++}`,
  kind,
  amountCents: Math.round(euros * 100),
  categoryId,
  label,
  date: `${date}T10:00:00.000Z`,
});
const rec = (label: string, euros: number, day: number, kind: 'depense' | 'recette' = 'depense', categoryId = 'abonnements'): Recurring => ({
  id: label,
  label,
  amountCents: Math.round(euros * 100),
  kind,
  categoryId,
  dayOfMonth: day,
  active: true,
});

describe('budget du mois (revenus − charges fixes)', () => {
  it('salaire reçu, loyer payé, dépenses courantes', () => {
    const ops = [
      op('2026-11-01', 'recette', 2500, 'salaire', 'Salaire'),
      op('2026-11-02', 'depense', 750, 'logement', 'Loyer'),
      op('2026-11-05', 'depense', 265, 'credit', 'Crédit auto'),
      op('2026-11-10', 'depense', 80, 'alimentation'),
      op('2026-11-15', 'depense', 50, 'carburant'),
    ];
    const b = monthlyBudget(ops, [], today);
    expect(b.incomeCents).toBe(250000);
    expect(b.fixedCents).toBe(101500);
    expect(b.budgetCents).toBe(148500);
    expect(b.variableCents).toBe(13000);
    expect(b.remainingCents).toBe(135500);
  });

  it('ajoute les récurrences qui restent à passer ce mois-ci (revenu et charges)', () => {
    const ops = [op('2026-11-10', 'depense', 80, 'alimentation')];
    const recs = [rec('Salaire', 2500, 28, 'recette', 'salaire'), rec('Mutuelle', 42, 28, 'depense', 'sante'), rec('Netflix', 13.99, 3)];
    const b = monthlyBudget(ops, recs, today);
    expect(b.incomeToComeCents).toBe(250000); // le 28 : pas encore passé
    expect(b.fixedToComeCents).toBe(4200); // Mutuelle le 28 ; Netflix le 3 est déjà passé (rien à venir)
    expect(b.budgetCents).toBe(250000 - 4200);
  });

  it('une récurrence déjà passée ne compte pas deux fois', () => {
    const ops = [op('2026-11-03', 'depense', 13.99, 'abonnements', 'Netflix')];
    const b = monthlyBudget(ops, [rec('Netflix', 13.99, 3)], today);
    expect(b.fixedCents).toBe(1399);
    expect(b.variableCents).toBe(0); // l'opération vient de la récurrence : charge fixe, pas dépense courante
  });

  it('dépassement : reste négatif', () => {
    const ops = [op('2026-11-01', 'recette', 1000, 'salaire', 'Salaire'), op('2026-11-05', 'depense', 1200, 'alimentation')];
    expect(monthlyBudget(ops, [], today).remainingCents).toBe(-20000);
  });

  it('ignore les autres mois', () => {
    expect(monthlyBudget([op('2026-10-01', 'recette', 2500, 'salaire')], [], today).incomeCents).toBe(0);
  });
});

describe('dépenses habituelles (prévisions)', () => {
  const history = [
    op('2026-08-01', 'depense', 10, 'alimentation'),
    op('2026-08-15', 'depense', 300, 'alimentation'),
    op('2026-09-10', 'depense', 310, 'alimentation'),
    op('2026-10-10', 'depense', 290, 'alimentation'),
    op('2026-10-12', 'recette', 90, 'autre-recette'),
    op('2026-10-02', 'depense', 750, 'logement', 'Loyer'),
  ];

  it('moyenne des mois complets, hors opérations des récurrences', () => {
    const h = habitualFlows(history, [rec('Loyer', 750, 2, 'depense', 'logement')], today, true)!;
    // sept., oct. et août (données dès le 1er août) : 3 mois, 30+31+31 = 92 jours ; dépenses = 310 + 290 + 310 = 910
    expect(h.months).toBe(3);
    expect(Math.round(h.expenseDailyCents)).toBe(Math.round((91000 / 92)));
    expect(h.incomePerMonthCents).toBe(Math.round((9000 / 92) * 30));
  });

  it('sans les recettes pour le compte pro', () => {
    expect(habitualFlows(history, [], today, false)!.incomeDailyCents).toBe(0);
  });

  it('pas assez d\'historique : estimation sur le mois en cours, sinon rien', () => {
    const young = [op('2026-11-03', 'depense', 100, 'alimentation'), op('2026-11-12', 'depense', 100, 'alimentation')];
    const h = habitualFlows(young, [], today, true)!;
    expect(h.months).toBe(0);
    expect(h.expenseDailyCents).toBeCloseTo(20000 / 20);
    expect(habitualFlows(young, [], '2026-11-04', true)).toBeUndefined();
    expect(habitualFlows([], [], today, true)).toBeUndefined();
  });

  it('la prévision baisse chaque jour de ce qui passe d\'habitude', () => {
    const h = habitualFlows(history, [], today, false)!;
    const without = forecast({ balanceCents: 100000, recurrings: [], invoices: [], today });
    const withHabits = forecast({ balanceCents: 100000, recurrings: [], invoices: [], today, habitual: h });
    expect(without.horizons.map((x) => x.balanceCents)).toEqual([100000, 100000, 100000]);
    expect(withHabits.horizons[0].balanceCents).toBeLessThan(100000 - 25000);
    expect(withHabits.horizons[2].balanceCents).toBeLessThan(withHabits.horizons[0].balanceCents);
    expect(withHabits.habitual?.months).toBe(3);
  });
});
