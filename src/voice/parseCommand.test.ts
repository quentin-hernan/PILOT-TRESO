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
