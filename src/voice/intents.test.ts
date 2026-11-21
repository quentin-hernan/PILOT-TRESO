import { describe, expect, it } from 'vitest';
import { parseIntent, parseDueDate } from './intents';
import { isNo, isYes, stripWakeWord } from './wake';
import { parseCommand } from './parseCommand';

const today = { y: 2026, m: 11, d: 20 }; // vendredi
const perso = (t: string) => parseIntent(t, { account: 'particulier', today });
const pro = (t: string) => parseIntent(t, { account: 'professionnel', today });

describe('mot d’éveil « Dis Pilot »', () => {
  it.each([
    ['Dis Pilot', ''],
    ['Dis Pilot, j\'ai dépensé 50 euros de carburant', 'j\'ai dépensé 50 euros de carburant'],
    ['Dis pilote, quel est mon solde ?', 'quel est mon solde ?'],
    ['Dit Pilot ouvre les factures', 'ouvre les factures'],
    ['Dis-Pilot, annule', 'annule'],
    ['Dispilot solde', 'solde'],
    ['Hey Pilot montre les catégories', 'montre les catégories'],
    ['Pilot, budget alimentation 400 euros', 'budget alimentation 400 euros'],
    ['OK pilote ajoute une facture pour Dupont', 'ajoute une facture pour Dupont'],
    ['10 pilots, ouvre les catégories.', 'ouvre les catégories.'],
    ['Ok, pilots, quelle est mon solde?', 'quelle est mon solde?'],
    ['et pileau, ouvre les catégories.', 'ouvre les catégories.'],
    ['Pilote, quel est mon sol?', 'quel est mon sol?'],
    ["d'y pireau", ''],
    ['10 kilos, j\'ai dépensé 20 euros pour un truc.', 'j\'ai dépensé 20 euros pour un truc.'],
  ])('« %s »', (heard, rest) => {
    expect(stripWakeWord(heard)).toEqual({ woke: true, rest });
  });

  it('ne se déclenche pas en pleine conversation', () => {
    for (const p of ['le pilote de l\'avion a dit non', 'j\'ai dépensé 50 euros', 'mon pilote est arrivé', 'on a vu le pilot de la série', 'mon pilote est parti', 'le pilote dit non', '']) {
      expect(stripWakeWord(p).woke).toBe(false);
    }
  });

  it('oui / non', () => {
    expect(isYes('Oui, confirme')).toBe(true);
    expect(isYes('d\'accord')).toBe(true);
    expect(isNo('Non merci')).toBe(true);
    expect(isNo('annule')).toBe(true);
    expect(isYes('non')).toBe(false);
  });
});

describe('questions', () => {
  it.each([
    ['quel est mon solde', 'ask_balance'],
    ['combien il me reste sur mon compte', 'ask_balance'],
    ['qu\'est-ce que j\'ai comme solde', 'ask_balance'],
    ['quelle est mon sol', 'ask_balance'],
  ])('« %s »', (p, type) => expect(perso(p)?.type).toBe(type));

  it('dépenses par catégorie et période', () => {
    expect(perso('combien j\'ai dépensé en courses ce mois-ci')).toEqual({ type: 'ask_spent', kind: 'depense', categoryId: 'alimentation', period: 'month' });
    expect(perso('combien j\'ai dépensé hier')).toEqual({ type: 'ask_spent', kind: 'depense', categoryId: null, period: 'yesterday' });
    expect(perso('combien j\'ai dépensé en carburant cette semaine')).toEqual({ type: 'ask_spent', kind: 'depense', categoryId: 'carburant', period: 'week' });
    expect(perso('combien j\'ai dépensé le mois dernier')).toMatchObject({ period: 'lastMonth' });
  });

  it('recettes', () => {
    expect(perso('combien j\'ai gagné ce mois-ci')).toEqual({ type: 'ask_spent', kind: 'recette', categoryId: null, period: 'month' });
    expect(pro('combien j\'ai encaissé cette semaine')).toEqual({ type: 'ask_spent', kind: 'recette', categoryId: null, period: 'week' });
  });

  it('prévisions', () => {
    expect(perso('quel sera mon solde dans 60 jours')).toEqual({ type: 'ask_forecast', days: 60 });
    expect(perso('quelles sont mes prévisions à 90 jours')).toEqual({ type: 'ask_forecast', days: 90 });
    expect(perso('prévisions dans un mois')).toEqual({ type: 'ask_forecast', days: 30 });
  });

  it('budget restant', () => {
    expect(perso('combien il me reste en budget alimentation')).toEqual({ type: 'ask_budget', categoryId: 'alimentation' });
    expect(perso('où j\'en suis sur mon budget restaurant')).toEqual({ type: 'ask_budget', categoryId: 'restaurant' });
    expect(perso('où j\'en suis de mes budgets')).toEqual({ type: 'ask_budget', categoryId: null });
  });

  it('alertes et échéances', () => {
    expect(perso('est-ce que j\'ai des alertes')).toEqual({ type: 'ask_alerts' });
    expect(perso('qu\'est-ce qui tombe cette semaine')).toEqual({ type: 'ask_upcoming', days: 7 });
    expect(perso('quelles sont mes prochaines échéances')).toEqual({ type: 'ask_upcoming', days: 14 });
    expect(pro('qu\'est-ce que j\'ai à payer ce mois-ci')).toEqual({ type: 'ask_upcoming', days: 30 });
  });
});

describe('navigation', () => {
  it.each([
    ['ouvre les catégories', 'categories'],
    ['va à l\'accueil', 'home'],
    ['montre les récurrences', 'recurring'],
    ['affiche le mois', 'month'],
    ['montre les prévisions', 'home'],
    ['ouvre les factures', 'invoices'],
    ['va aux flux', 'flows'],
    ['ouvre l\'équipe', 'team'],
    ['ouvre la matrice', 'matrix'],
    ['affiche mes frais', 'all'],
  ])('« %s »', (p, target) => expect(pro(p)).toEqual({ type: 'navigate', target }));
});

describe('dernière opération', () => {
  it('supprimer / modifier / annuler', () => {
    expect(perso('supprime la dernière opération')).toEqual({ type: 'last_op', action: 'delete' });
    expect(perso('annule la dernière dépense')).toEqual({ type: 'last_op', action: 'delete' });
    expect(perso('modifie la dernière opération')).toEqual({ type: 'last_op', action: 'edit' });
    expect(perso('annule')).toEqual({ type: 'last_op', action: 'delete' });
    expect(perso('oups')).toEqual({ type: 'last_op', action: 'delete' });
  });
});

describe('factures (professionnel)', () => {
  it('nouvelle facture : montant, client, échéance', () => {
    expect(pro('ajoute une facture de 500 euros pour Dupont le 30 novembre')).toEqual({
      type: 'invoice_new',
      draft: { direction: 'a_encaisser', counterparty: 'Dupont', label: '', amountCents: 50000, dueKey: '2026-11-30' },
    });
    expect(pro('crée une facture à payer de 430 euros fournisseur Métro dans 10 jours')).toEqual({
      type: 'invoice_new',
      draft: { direction: 'a_payer', counterparty: 'Métro', label: '', amountCents: 43000, dueKey: '2026-11-30' },
    });
  });

  it('nouvelle facture : champs manquants laissés vides', () => {
    expect(pro('ajoute une facture')).toMatchObject({ type: 'invoice_new', draft: { counterparty: '', amountCents: null, dueKey: null } });
  });

  it('facture réglée', () => {
    expect(pro('marque la facture Dupont comme payée')).toMatchObject({ type: 'invoice_settle', query: 'dupont' });
    expect(pro('j\'ai encaissé la facture Bernard')).toMatchObject({ type: 'invoice_settle', query: 'bernard', direction: 'a_encaisser' });
    expect(pro('la facture Métro est payée')).toMatchObject({ type: 'invoice_settle', query: 'metro', direction: 'a_payer' });
  });

  it('une dépense « facture » avec montant reste une opération', () => {
    expect(pro('j\'ai payé la facture d\'électricité 75 euros')).toBeNull();
  });

  it('inactif pour le compte particulier', () => {
    expect(perso('ajoute une facture de 500 euros pour Dupont')).toBeNull();
  });
});

describe('récurrences : pause, reprise, suppression', () => {
  it.each([
    ['mets en pause le loyer', 'pause', 'loyer'],
    ['mets netflix en pause', 'pause', 'netflix'],
    ['reprends l\'abonnement netflix', 'resume', 'netflix'],
    ['supprime la récurrence mutuelle', 'delete', 'mutuelle'],
    ['arrête l\'abonnement spotify', 'delete', 'spotify'],
  ])('« %s »', (p, action, query) => expect(perso(p)).toEqual({ type: 'recurring', action, query }));
});

describe('réglages', () => {
  it('solde de départ', () => {
    expect(perso('mets mon solde de départ à 1500 euros')).toEqual({ type: 'opening', amountCents: 150000 });
  });
  it('enregistrement direct', () => {
    expect(perso('active l\'enregistrement direct')).toEqual({ type: 'direct_save', on: true });
    expect(perso('désactive l\'enregistrement direct')).toEqual({ type: 'direct_save', on: false });
  });
  it('aide', () => {
    expect(perso('que sais-tu faire')).toEqual({ type: 'help' });
  });
});

describe('ne détourne pas les phrases d’opération, de récurrence et de budget', () => {
  it.each([
    "j'ai dépensé 50 euros de carburant",
    "j'ai reçu mon salaire de 2 500 euros",
    'tous les mois le 2 loyer 750 euros',
    'budget alimentation 400 euros',
    'enlève le budget loisirs',
    "tous les mois j'ai 800 euros qui tombent",
    "j'ai payé mon abonnement netflix 13 euros",
    'hier 20 euros de courses',
  ])('« %s »', (p) => {
    expect(perso(p)).toBeNull();
    expect(parseCommand(p, 'particulier').amountCents ?? parseCommand(p, 'particulier').budgetRemove).toBeTruthy();
  });
});

describe('date d’échéance', () => {
  it.each([
    ['le 30 novembre', '2026-11-30'],
    ['le 5 janvier', '2027-01-05'],
    ['le 25', '2026-11-25'],
    ['le 5', '2026-12-05'],
    ['demain', '2026-11-21'],
    ['dans 15 jours', '2026-12-05'],
    ['dans 2 semaines', '2026-12-04'],
    ['dans un mois', '2026-12-20'],
    ['lundi prochain', '2026-11-23'],
    ['fin de mois', '2026-11-30'],
  ])('« %s »', (p, key) => expect(parseDueDate(p, today).key).toBe(key));
});

describe("catégories avec petite faute d'orthographe du moteur vocal", () => {
  const perso = (x: string) => parseCommand(x, 'particulier', new Date('2026-11-20T09:00:00Z'));
  it('« carburent » = carburant, « restaurants » = restaurant', () => {
    expect(perso('carburent').categoryId).toBe('carburant');
    expect(perso("j'ai dépensé 50 euros de carburent").categoryId).toBe('carburant');
    expect(perso('electricite').categoryId).toBe('electricite');
  });
  it('ne devine pas n\'importe quoi', () => {
    for (const w of ['bonjour', 'maison', 'voiture', 'fromage']) expect(perso(w).categoryId).toBeNull();
  });
});
