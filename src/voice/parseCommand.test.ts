import { describe, expect, it } from 'vitest';
import { parseCommand, normalize, wordsToNumber } from './parseCommand';
import { parisYMD } from '../lib/dates';

// « Aujourd'hui » figé : vendredi 20 novembre 2026, 10 h (Paris).
const NOW = new Date('2026-11-20T09:00:00Z');
const day = (iso: string) => {
  const p = parisYMD(iso);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};
const perso = (t: string) => parseCommand(t, 'particulier', NOW);
const pro = (t: string) => parseCommand(t, 'professionnel', NOW);

describe('les 6 phrases de référence', () => {
  it("« j'ai dépensé 50 euros de carburant »", () => {
    const r = perso("j'ai dépensé 50 euros de carburant");
    expect(r).toMatchObject({ kind: 'depense', amountCents: 5000, categoryId: 'carburant', dateExplicit: false });
    expect(day(r.date)).toBe('2026-11-20');
  });

  it("« j'ai fait 85 euros de courses »", () => {
    expect(perso("j'ai fait 85 euros de courses")).toMatchObject({ kind: 'depense', amountCents: 8500, categoryId: 'alimentation' });
  });

  it("« j'ai reçu mon salaire de 2 500 euros »", () => {
    expect(perso("j'ai reçu mon salaire de 2 500 euros")).toMatchObject({ kind: 'recette', amountCents: 250000, categoryId: 'salaire' });
  });

  it("« j'ai payé 75 euros d'électricité »", () => {
    expect(perso("j'ai payé 75 euros d'électricité")).toMatchObject({ kind: 'depense', amountCents: 7500, categoryId: 'electricite' });
  });

  it("« j'ai dépensé 120 euros au restaurant hier »", () => {
    const r = perso("j'ai dépensé 120 euros au restaurant hier");
    expect(r).toMatchObject({ kind: 'depense', amountCents: 12000, categoryId: 'restaurant', dateExplicit: true });
    expect(day(r.date)).toBe('2026-11-19');
  });

  it("« j'ai vendu pour 100 euros » (professionnel)", () => {
    expect(pro("j'ai vendu pour 100 euros")).toMatchObject({ kind: 'recette', amountCents: 10000, categoryId: 'ventes' });
  });
});

describe('montants', () => {
  it.each([
    ['j’ai dépensé 12,50 euros de carburant', 1250],
    ['j’ai dépensé 12.50 euros de carburant', 1250],
    ['j’ai dépensé 12 euros 50 de carburant', 1250],
    ['j’ai dépensé 50€ de carburant', 5000],
    ['j’ai reçu 2500 euros de salaire', 250000],
    ['j’ai reçu 2 500,75 euros de salaire', 250075],
    ['j’ai dépensé cent euros de carburant', 10000],
    ['j’ai dépensé quatre-vingt-dix euros de carburant', 9000],
    ['j’ai dépensé soixante-quinze euros de carburant', 7500],
    ['j’ai dépensé quatre vingt euros de carburant', 8000],
    ['j’ai dépensé douze euros cinquante de carburant', 1250],
    ['j’ai dépensé mille deux cents euros de carburant', 120000],
    ['j’ai reçu deux mille cinq cents euros de salaire', 250000],
    ['j’ai dépensé vingt et un euros de carburant', 2100],
    ['j’ai dépensé 50 de carburant', 5000],
  ])('%s -> %i centimes', (phrase, cents) => {
    expect(perso(phrase).amountCents).toBe(cents);
  });

  it('ne confond pas « un plein » avec le chiffre 1', () => {
    expect(perso("j'ai fait un plein de 60 euros")).toMatchObject({ amountCents: 6000, categoryId: 'carburant' });
  });

  it('montant absent -> null (la fenêtre de confirmation le demandera)', () => {
    expect(perso("j'ai fait le plein").amountCents).toBeNull();
  });

  it('wordsToNumber', () => {
    expect(wordsToNumber(['quatre', 'vingt', 'dix'])).toBe(90);
    expect(wordsToNumber(['trois', 'cent', 'vingt'])).toBe(320);
    expect(wordsToNumber(['mille'])).toBe(1000);
  });
});

describe('dates', () => {
  it.each([
    ['j’ai dépensé 20 euros de carburant avant-hier', '2026-11-18'],
    ['j’ai dépensé 20 euros de carburant le 15 novembre', '2026-11-15'],
    ['j’ai dépensé 20 euros de carburant le 5 novembre', '2026-11-05'],
    ['j’ai dépensé 20 euros de carburant le 1er novembre', '2026-11-01'],
    ['j’ai dépensé 20 euros de carburant le 15 décembre', '2025-12-15'], // pas dans le futur : année précédente
    ['j’ai dépensé 20 euros de carburant le 3 mars 2025', '2025-03-03'],
    ['j’ai dépensé 20 euros de carburant le 3', '2026-11-03'],
    ['j’ai dépensé 20 euros de carburant le 25', '2026-10-25'], // le 25 n'est pas encore passé : mois précédent
    ['j’ai dépensé 20 euros de carburant lundi', '2026-11-16'],
    ['j’ai dépensé 20 euros de carburant vendredi dernier', '2026-11-13'],
    ['j’ai dépensé 20 euros de carburant il y a 4 jours', '2026-11-16'],
    ['j’ai dépensé 20 euros de carburant ce matin', '2026-11-20'],
  ])('%s -> %s', (phrase, expected) => {
    expect(day(perso(phrase).date)).toBe(expected);
  });

  it('la date n’est pas prise pour le montant', () => {
    const r = perso('le 15 décembre j’ai dépensé 40 euros de carburant');
    expect(r.amountCents).toBe(4000);
  });
});

describe('dépense ou recette', () => {
  it.each([
    ['j’ai encaissé 300 euros', 'professionnel', 'recette'],
    ["j'ai touché 300 euros de prime", 'particulier', 'recette'],
    ['j’ai payé 300 euros de loyer', 'particulier', 'depense'],
    ['salaire 2000 euros', 'particulier', 'recette'], // pas de verbe : la catégorie décide
    ['courses 45 euros', 'particulier', 'depense'],
    ['j’ai acheté pour 210 euros de matériel', 'professionnel', 'depense'],
  ] as const)('%s', (phrase, account, kind) => {
    expect(parseCommand(phrase, account, NOW).kind).toBe(kind);
  });
});

describe('catégories', () => {
  it.each([
    ['j’ai payé 15 euros de pharmacie', 'particulier', 'sante'],
    ['j’ai dépensé 8 euros de péage', 'particulier', 'transport'],
    ['j’ai payé mon loyer 750 euros', 'particulier', 'logement'],
    ['j’ai payé 13,99 euros de netflix', 'particulier', 'abonnements'],
    ['j’ai payé 265 euros de crédit', 'particulier', 'credit'],
    ['j’ai dépensé 40 euros au resto', 'particulier', 'restaurant'],
    ['j’ai acheté pour 210 euros de matériel', 'professionnel', 'achats'],
    ['j’ai payé 118 euros d’assurance', 'professionnel', 'assurances'],
    ['j’ai fait une prestation de 800 euros', 'professionnel', 'prestations'],
    ['j’ai payé 30 euros de téléphone', 'professionnel', 'telephone'],
    ['j’ai dépensé 12 euros de péage', 'professionnel', 'deplacements'],
    ['j’ai acheté 50 euros de carburant', 'professionnel', 'carburant'], // « carburant » plus précis que « acheté »
  ] as const)('%s -> %s', (phrase, account, cat) => {
    expect(parseCommand(phrase, account, NOW).categoryId).toBe(cat);
  });

  it('catégorie inconnue -> null (l’utilisateur choisira)', () => {
    expect(perso("j'ai dépensé 20 euros pour un truc").categoryId).toBeNull();
  });

  it('les catégories du compte pro ne fuient pas vers le particulier (et inversement)', () => {
    expect(perso("j'ai vendu pour 100 euros").categoryId).toBeNull();
  });
});

describe('libellé', () => {
  it('« chez Total »', () => {
    expect(perso("j'ai dépensé 50 euros de carburant chez Total").label).toBe('Total');
  });
  it('pas de libellé sans « chez »', () => {
    expect(perso("j'ai dépensé 50 euros de carburant").label).toBe('');
  });
});

describe('normalisation', () => {
  it('retire accents, apostrophes et espaces insécables', () => {
    expect(normalize("J'ai payé 2 500 € d'électricité")).toBe('j ai paye 2500 euros d electricite');
  });
});

describe('récurrences dictées', () => {
  const rec = (t: string, account: 'particulier' | 'professionnel' = 'particulier') => parseCommand(t, account, NOW);

  it.each([
    ['tous les mois le 2 loyer 750 euros', { amountCents: 75000, categoryId: 'logement', dayOfMonth: 2, kind: 'depense' }],
    ['le 2 de chaque mois loyer 750 euros', { amountCents: 75000, categoryId: 'logement', dayOfMonth: 2, kind: 'depense' }],
    ['chaque 5 crédit auto 265 euros', { amountCents: 26500, categoryId: 'credit', dayOfMonth: 5, kind: 'depense' }],
    ['tous les mois le 1er je reçois mon salaire de 2 500 euros', { amountCents: 250000, categoryId: 'salaire', dayOfMonth: 1, kind: 'recette' }],
    ['abonnement netflix 13,99 euros chaque mois le 3', { amountCents: 1399, categoryId: 'abonnements', dayOfMonth: 3, kind: 'depense' }],
    ['mensuel 45 euros de mutuelle le 28', { amountCents: 4500, categoryId: 'sante', dayOfMonth: 28, kind: 'depense' }],
    ['en fin de mois tous les mois 120 euros assurance habitation', { amountCents: 12000, categoryId: 'logement', dayOfMonth: 31, kind: 'depense' }],
  ])('« %s »', (phrase, expected) => {
    expect(rec(phrase)).toMatchObject({ recurring: true, ...expected });
  });

  it('« tous les mois j\'ai 800 euros qui tombent » : recette, jour et catégorie à compléter', () => {
    expect(rec("tous les mois j'ai 800 euros qui tombent")).toMatchObject({ recurring: true, kind: 'recette', amountCents: 80000, dayOfMonth: null, categoryId: null });
  });

  it('le jour dit n\'est pas pris pour un montant ni pour une date passée', () => {
    const r = rec('chaque 5 loyer 750 euros');
    expect(r.amountCents).toBe(75000);
    expect(r.dateExplicit).toBe(false);
  });

  it('professionnel : « tous les mois le 9 assurance pro 118 euros »', () => {
    expect(rec('tous les mois le 9 assurance pro 118 euros', 'professionnel')).toMatchObject({ recurring: true, dayOfMonth: 9, amountCents: 11800, categoryId: 'assurances' });
  });

  it('garde le mot dit, avec ses accents, pour le libellé', () => {
    expect(rec('chaque mois le 5 crédit auto 265 euros').categoryWord).toBe('crédit');
    expect(rec('tous les mois le 2 loyer 750 euros').categoryWord).toBe('loyer');
  });

  it('une opération ordinaire n\'est jamais une récurrence', () => {
    for (const p of ["j'ai dépensé 50 euros de carburant", "j'ai payé mon abonnement netflix 13 euros", "j'ai payé 75 euros d'électricité le 15 novembre", 'hier 20 euros de courses']) {
      expect(rec(p).recurring).toBe(false);
    }
  });
});

describe('budgets dictés', () => {
  const b = (t: string) => parseCommand(t, 'particulier', NOW);

  it.each([
    ['budget alimentation 400 euros', 'alimentation', 40000],
    ['mets le budget restaurant à 100 euros', 'restaurant', 10000],
    ["fixe un budget de 150 euros pour le carburant", 'carburant', 15000],
    ['tous les mois budget loisirs 80 euros', 'loisirs', 8000],
    ['plafond courses 350 euros', 'alimentation', 35000],
  ])('« %s »', (phrase, cat, cents) => {
    expect(b(phrase)).toMatchObject({ budget: true, budgetRemove: false, categoryId: cat, amountCents: cents, recurring: false });
  });

  it('retrait : « enlève le budget loisirs »', () => {
    expect(b('enlève le budget loisirs')).toMatchObject({ budget: true, budgetRemove: true, categoryId: 'loisirs', amountCents: null });
  });

  it('catégorie ou montant manquant : à compléter', () => {
    expect(b('budget 200 euros')).toMatchObject({ budget: true, categoryId: null, amountCents: 20000 });
    expect(b('budget alimentation')).toMatchObject({ budget: true, categoryId: 'alimentation', amountCents: null });
  });

  it('une charge fixe est reconnue (pour être refusée en budget)', () => {
    expect(b('budget logement 700 euros').categoryId).toBe('logement');
  });

  it('jamais pour une opération ordinaire ni pour le compte professionnel', () => {
    expect(b("j'ai dépensé 50 euros de carburant").budget).toBe(false);
    expect(parseCommand('budget carburant 100 euros', 'professionnel', NOW).budget).toBe(false);
  });
});
