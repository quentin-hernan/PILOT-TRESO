import { describe, expect, it } from 'vitest';
import { applyAnswer, describe as describeCandidate, missingSlots, QUESTIONS, type Candidate } from './missing';
import { PERSONAL_CATEGORIES } from '../data/categories';

const ctx = { account: 'particulier' as const, today: { y: 2026, m: 11, d: 20 } };
const proCtx = { account: 'professionnel' as const, today: ctx.today };

const op = (p: Partial<Extract<Candidate, { kind: 'op' }>> = {}): Candidate => ({ kind: 'op', heard: 'x', opKind: 'depense', amountCents: null, categoryId: '', label: '', date: '2026-11-20T10:00:00.000Z', ...p });
const rec = (p: Partial<Extract<Candidate, { kind: 'recurring' }>> = {}): Candidate => ({ kind: 'recurring', heard: 'x', recKind: 'depense', amountCents: null, categoryId: '', label: '', word: '', dayOfMonth: null, ...p });
const inv = (p: Partial<Extract<Candidate, { kind: 'invoice' }>> = {}): Candidate => ({ kind: 'invoice', heard: 'x', direction: 'a_encaisser', counterparty: '', label: '', amountCents: null, dueKey: null, ...p });

describe('ce qui manque', () => {
  it('opération : seulement le montant et/ou la catégorie', () => {
    expect(missingSlots(op())).toEqual(['amount', 'category']);
    expect(missingSlots(op({ amountCents: 5000 }))).toEqual(['category']);
    expect(missingSlots(op({ categoryId: 'carburant' }))).toEqual(['amount']);
    expect(missingSlots(op({ amountCents: 5000, categoryId: 'carburant' }))).toEqual([]);
  });
  it('récurrence : le jour du mois en plus', () => {
    expect(missingSlots(rec({ amountCents: 75000, categoryId: 'logement' }))).toEqual(['day']);
  });
  it('budget : montant facultatif pour un retrait', () => {
    expect(missingSlots({ kind: 'budget', heard: '', categoryId: 'loisirs', amountCents: null, remove: true })).toEqual([]);
    expect(missingSlots({ kind: 'budget', heard: '', categoryId: '', amountCents: 10000, remove: false })).toEqual(['category']);
  });
  it('facture : client, montant, échéance', () => {
    expect(missingSlots(inv())).toEqual(['counterparty', 'amount', 'dueDate']);
    expect(QUESTIONS.counterparty(inv({ direction: 'a_payer' }))).toBe('Quel fournisseur ?');
  });
});

describe('réponses à la voix', () => {
  it('« carburant » complète la catégorie', () => {
    const r = applyAnswer(op({ amountCents: 5000 }), 'carburant', ctx);
    expect(r.filled).toEqual(['category']);
    expect(missingSlots(r.candidate)).toEqual([]);
    expect((r.candidate as { categoryId: string }).categoryId).toBe('carburant');
  });
  it('« 50 euros » complète le montant', () => {
    const r = applyAnswer(op({ categoryId: 'carburant' }), '50 euros', ctx);
    expect((r.candidate as { amountCents: number }).amountCents).toBe(5000);
  });
  it('montant et catégorie d’un coup : « 40 euros de courses »', () => {
    const r = applyAnswer(op(), '40 euros de courses', ctx);
    expect(r.filled.sort()).toEqual(['amount', 'category']);
    expect(missingSlots(r.candidate)).toEqual([]);
  });
  it('une récurrence : « le 5 »', () => {
    const r = applyAnswer(rec({ amountCents: 75000, categoryId: 'logement' }), 'le 5', ctx);
    expect((r.candidate as { dayOfMonth: number }).dayOfMonth).toBe(5);
  });
  it('le jour dit ne devient pas un montant', () => {
    const r = applyAnswer(rec({ categoryId: 'logement' }), 'le 2', ctx);
    expect(r.filled).toEqual(['day']);
    expect((r.candidate as { amountCents: number | null }).amountCents).toBeNull();
  });
  it('facture : le client, puis l’échéance', () => {
    let r = applyAnswer(inv({ amountCents: 50000, dueKey: '2026-11-30' }), 'Dupont', proCtx);
    expect((r.candidate as { counterparty: string }).counterparty).toBe('Dupont');
    r = applyAnswer(inv({ counterparty: 'Dupont', amountCents: 50000 }), 'le 30 novembre', proCtx);
    expect((r.candidate as { dueKey: string }).dueKey).toBe('2026-11-30');
    expect((r.candidate as { amountCents: number }).amountCents).toBe(50000); // pas écrasé
  });
  it('le nom affiché sur le bouton suffit : « Électricité », « Abonnements »', () => {
    expect((applyAnswer(op({ amountCents: 5000 }), 'Électricité', ctx).candidate as { categoryId: string }).categoryId).toBe('electricite');
    expect((applyAnswer(op({ amountCents: 5000 }), 'les abonnements', ctx).candidate as { categoryId: string }).categoryId).toBe('abonnements');
    expect((applyAnswer(op({ amountCents: 5000 }), 'Autre recette', ctx).filled)).toEqual([]); // recette : pas une dépense
  });
  it('montant dit en lettres, avec ou sans « euros »', () => {
    expect((applyAnswer(op({ categoryId: 'carburant' }), 'cinquante', ctx).candidate as { amountCents: number }).amountCents).toBe(5000);
    expect((applyAnswer(op({ categoryId: 'carburant' }), 'vingt cinq euros', ctx).candidate as { amountCents: number }).amountCents).toBe(2500);
    expect((applyAnswer(op({ categoryId: 'carburant' }), '12 euros 50', ctx).candidate as { amountCents: number }).amountCents).toBe(1250);
    expect((applyAnswer(op({ categoryId: 'carburant' }), 'cent', ctx).candidate as { amountCents: number }).amountCents).toBe(10000);
  });
  it('une réponse sans rapport ne remplit rien', () => {
    expect(applyAnswer(op({ amountCents: 5000 }), 'euh je ne sais pas', ctx).filled).toEqual([]);
  });
});

describe('résumé', () => {
  it('ce qui est déjà compris', () => {
    const d = describeCandidate(op({ amountCents: 5000 }), PERSONAL_CATEGORIES);
    expect(d).toContain('Dépense');
    expect(d).toContain('50,00');
    expect(describeCandidate(rec({ amountCents: 75000, categoryId: 'logement', dayOfMonth: 2 }), PERSONAL_CATEGORIES)).toContain('le 2 du mois');
  });
});
