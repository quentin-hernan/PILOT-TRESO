import { describe, expect, it } from 'vitest';
import type { Invoice, Operation, Recurring } from '../types';
import { PERSONAL_CATEGORIES } from '../data/categories';
import { buildAlerts, forecast, nextOccurrence, occurrences } from './forecast';

const today = '2026-11-20';
const rec = (p: Partial<Recurring>): Recurring => ({
  id: 'r',
  label: 'Test',
  amountCents: 10_000,
  kind: 'depense',
  categoryId: 'logement',
  dayOfMonth: 1,
  active: true,
  ...p,
});
const inv = (p: Partial<Invoice>): Invoice => ({
  id: 'i',
  counterparty: 'Client',
  label: '',
  amountCents: 5_000,
  dueDate: '2026-12-05T11:00:00.000Z',
  direction: 'a_encaisser',
  status: 'en_attente',
  ...p,
});

describe('occurrences', () => {
  it('exclut la date de départ et inclut la date de fin', () => {
    expect(occurrences(20, '2026-11-20', '2026-12-20')).toEqual(['2026-12-20']);
    expect(occurrences(21, '2026-11-20', '2026-11-21')).toEqual(['2026-11-21']);
  });
  it('un jour 31 devient le dernier jour des mois courts', () => {
    expect(occurrences(31, '2026-01-31', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrences(30, '2028-01-31', '2028-03-01')).toEqual(['2028-02-29']);
  });
  it('change d\'année correctement', () => {
    expect(occurrences(5, '2026-11-20', '2027-02-10')).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
  });
  it('prochaine occurrence', () => {
    expect(nextOccurrence(25, today)).toBe('2026-11-25');
    expect(nextOccurrence(2, today)).toBe('2026-12-02');
    expect(nextOccurrence(20, today)).toBe('2026-12-20');
  });
});

describe('forecast', () => {
  it('sans rien de prévu, le solde reste identique', () => {
    const f = forecast({ balanceCents: 100_000, recurrings: [], invoices: [], today });
    expect(f.horizons.map((h) => h.balanceCents)).toEqual([100_000, 100_000, 100_000]);
    expect(f.low.balanceCents).toBe(100_000);
  });
  it('compte les récurrences à venir (loyer le 2 : 3 passages en 90 jours)', () => {
    const f = forecast({ balanceCents: 300_000, recurrings: [rec({ amountCents: 75_000, dayOfMonth: 2 })], invoices: [], today });
    // 2 déc (J+12), 2 janv (J+43), 2 fév (J+74) ; 2 mars = J+102 hors horizon
    expect(f.horizons.map((h) => h.balanceCents)).toEqual([300_000 - 75_000, 300_000 - 150_000, 300_000 - 225_000]);
    expect(f.events).toHaveLength(3);
  });
  it('ignore les récurrences en pause', () => {
    const f = forecast({ balanceCents: 1000, recurrings: [rec({ active: false })], invoices: [], today });
    expect(f.events).toHaveLength(0);
  });
  it('compte les recettes récurrentes en positif', () => {
    const f = forecast({ balanceCents: 0, recurrings: [rec({ kind: 'recette', amountCents: 250_000, dayOfMonth: 1 })], invoices: [], today });
    expect(f.horizons[0].balanceCents).toBe(250_000);
  });
  it('factures : à venir comptées à leur échéance, réglées ignorées', () => {
    const f = forecast({
      balanceCents: 0,
      recurrings: [],
      invoices: [inv({ amountCents: 5_000 }), inv({ id: 'p', direction: 'a_payer', amountCents: 2_000, dueDate: '2026-12-10T11:00:00.000Z' }), inv({ id: 'x', status: 'payee', amountCents: 99_000 })],
      today,
    });
    expect(f.horizons[0].balanceCents).toBe(3_000);
  });
  it('facture à payer en retard comptée tout de suite ; à encaisser en retard non comptée', () => {
    const f = forecast({
      balanceCents: 10_000,
      recurrings: [],
      invoices: [inv({ direction: 'a_payer', amountCents: 4_000, dueDate: '2026-11-10T11:00:00.000Z' }), inv({ id: 'b', amountCents: 7_000, dueDate: '2026-11-01T11:00:00.000Z' })],
      today,
    });
    expect(f.series[0]).toBe(6_000);
    expect(f.overdueReceivableCents).toBe(7_000);
  });
  it('repère le point le plus bas', () => {
    const f = forecast({
      balanceCents: 50_000,
      recurrings: [rec({ amountCents: 80_000, dayOfMonth: 1 }), rec({ id: 'b', kind: 'recette', amountCents: 200_000, dayOfMonth: 5 })],
      invoices: [],
      today,
    });
    expect(f.firstNegative).toBe('2026-12-01');
    expect(f.low.date).toBe('2026-12-01');
    expect(f.low.balanceCents).toBe(-30_000);
  });
});

describe('alertes', () => {
  const op = (categoryId: string, cents: number): Operation => ({ id: categoryId, kind: 'depense', amountCents: cents, categoryId, label: '', date: '2026-11-10T11:00:00.000Z' });
  const base = forecast({ balanceCents: 100_000, recurrings: [], invoices: [], today });

  it('budget dépassé = danger, proche = avertissement, sinon rien', () => {
    const budgets = new Map([['alimentation', 45_000], ['carburant', 15_000], ['restaurant', 12_000]]);
    const alerts = buildAlerts({ ops: [op('alimentation', 46_000), op('carburant', 13_500), op('restaurant', 3_000)], budgets, categories: PERSONAL_CATEGORIES, forecast: base, today });
    expect(alerts.map((a) => a.id)).toEqual(['budget-over-alimentation', 'budget-near-carburant']);
    expect(alerts[0].level).toBe('danger');
  });
  it('solde prévu négatif', () => {
    const f = forecast({ balanceCents: 1_000, recurrings: [rec({ amountCents: 50_000, dayOfMonth: 25 })], invoices: [], today });
    const alerts = buildAlerts({ ops: [], categories: PERSONAL_CATEGORIES, forecast: f, today });
    expect(alerts[0].id).toBe('forecast-negative');
    expect(alerts[0].title).toContain('25 novembre');
  });
  it('factures : retard et échéances proches', () => {
    const invoices = [
      inv({ id: 'a', dueDate: '2026-11-15T11:00:00.000Z' }),
      inv({ id: 'b', direction: 'a_payer', dueDate: '2026-11-12T11:00:00.000Z' }),
      inv({ id: 'c', direction: 'a_payer', dueDate: '2026-11-23T11:00:00.000Z' }),
      inv({ id: 'd', direction: 'a_payer', dueDate: '2026-12-30T11:00:00.000Z' }),
      inv({ id: 'e', status: 'payee', dueDate: '2026-11-01T11:00:00.000Z' }),
    ];
    const alerts = buildAlerts({ ops: [], categories: [], invoices, forecast: base, today });
    expect(alerts.map((a) => a.id)).toEqual(['inv-late-b', 'inv-late-a', 'inv-soon-c']);
  });
});
