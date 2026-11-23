import type { Invoice, Operation, PlannedOp, ProRole, Recurring } from '../types';
import { daysInMonth, makeDate, parisYMD, shiftMonth } from '../lib/dates';

/** Report du mois précédent (compte particulier), en centimes. */
export const PERSONAL_CARRY_CENTS = 12_000;
/** Solde de départ du compte professionnel, en centimes. */
export const PRO_OPENING_CENTS = 840_000;

interface Seed {
  day: number;
  kind: 'depense' | 'recette';
  euros: number;
  cat: string;
  label: string;
  /** Montant fixe d'un mois à l'autre (salaire, loyer...). */
  fixed?: boolean;
  author?: ProRole;
}

/** Génère 3 mois de données (mois courant jusqu'à aujourd'hui seulement). */
function build(seeds: Seed[], prefix: string): Operation[] {
  const t = parisYMD(new Date());
  const ops: Operation[] = [];
  for (const offset of [-2, -1, 0]) {
    const { y, m } = shiftMonth(t.y, t.m, offset);
    seeds.forEach((s, i) => {
      if (offset === 0 && s.day > t.d) return;
      const day = Math.min(s.day, daysInMonth(y, m));
      const wobble = s.fixed ? 1 : 1 + (((i * 7 + offset * 3 + 21) % 7) - 3) / 40;
      ops.push({
        id: `${prefix}-${offset}-${i}`,
        kind: s.kind,
        amountCents: Math.round(s.euros * wobble * 100),
        categoryId: s.cat,
        label: s.label,
        date: makeDate(y, m, day).toISOString(),
        author: s.author,
      });
    });
  }
  return ops.sort((a, b) => b.date.localeCompare(a.date));
}

export const personalSeeds: Seed[] = [
  { day: 1, kind: 'recette', euros: 2500, cat: 'salaire', label: 'Salaire', fixed: true },
  { day: 2, kind: 'depense', euros: 750, cat: 'logement', label: 'Loyer', fixed: true },
  { day: 3, kind: 'depense', euros: 13.99, cat: 'abonnements', label: 'Netflix', fixed: true },
  { day: 3, kind: 'depense', euros: 9.99, cat: 'abonnements', label: 'Spotify', fixed: true },
  { day: 4, kind: 'depense', euros: 86.4, cat: 'alimentation', label: 'Courses Carrefour' },
  { day: 5, kind: 'depense', euros: 265, cat: 'credit', label: 'Crédit auto', fixed: true },
  { day: 6, kind: 'depense', euros: 54.2, cat: 'carburant', label: 'Plein Total' },
  { day: 7, kind: 'depense', euros: 32, cat: 'restaurant', label: 'Déjeuner' },
  { day: 9, kind: 'depense', euros: 75, cat: 'electricite', label: 'EDF' },
  { day: 10, kind: 'depense', euros: 42.15, cat: 'alimentation', label: 'Marché' },
  { day: 12, kind: 'depense', euros: 24, cat: 'loisirs', label: 'Cinéma' },
  { day: 13, kind: 'depense', euros: 48.5, cat: 'restaurant', label: 'Pizzeria' },
  { day: 15, kind: 'depense', euros: 63.8, cat: 'alimentation', label: 'Courses' },
  { day: 16, kind: 'depense', euros: 49, cat: 'carburant', label: 'Plein' },
  { day: 17, kind: 'depense', euros: 22.5, cat: 'sante', label: 'Pharmacie' },
  { day: 18, kind: 'depense', euros: 27, cat: 'restaurant', label: 'Burger' },
  { day: 19, kind: 'depense', euros: 31.2, cat: 'alimentation', label: 'Boulangerie' },
  { day: 20, kind: 'depense', euros: 20, cat: 'transport', label: 'Pass transport' },
];

export const proSeeds: Seed[] = [
  { day: 1, kind: 'recette', euros: 1250, cat: 'ventes', label: 'Vente — Client Martin' },
  { day: 2, kind: 'depense', euros: 380, cat: 'achats', label: 'Achat matériel' },
  { day: 4, kind: 'recette', euros: 840, cat: 'prestations', label: 'Prestation Dupont' },
  { day: 5, kind: 'depense', euros: 72.3, cat: 'carburant', label: 'Carburant camionnette' },
  { day: 7, kind: 'recette', euros: 600, cat: 'ventes', label: 'Vente — Client Leroy' },
  { day: 9, kind: 'depense', euros: 118, cat: 'assurances', label: 'Assurance pro', fixed: true },
  { day: 10, kind: 'depense', euros: 64.9, cat: 'fournitures', label: 'Fournitures bureau' },
  { day: 12, kind: 'recette', euros: 1450, cat: 'prestations', label: 'Prestation Garnier' },
  { day: 14, kind: 'depense', euros: 68.4, cat: 'carburant', label: 'Essence — tournée', author: 'employe' },
  { day: 16, kind: 'depense', euros: 29.99, cat: 'telephone', label: 'Forfait mobile', fixed: true },
  { day: 17, kind: 'recette', euros: 395, cat: 'ventes', label: 'Vente — comptoir' },
  { day: 18, kind: 'depense', euros: 210, cat: 'achats', label: 'Achat marchandises' },
  { day: 19, kind: 'depense', euros: 55, cat: 'carburant', label: 'Essence — livraison', author: 'employe' },
  { day: 20, kind: 'depense', euros: 18.5, cat: 'deplacements', label: 'Péage', author: 'employe' },
];

export const initialPersonalOps = (): Operation[] => build(personalSeeds, 'p');
export const initialProOps = (): Operation[] => build(proSeeds, 'x');

export const personalRecurrings: Recurring[] = [
  { id: 'r1', label: 'Salaire', amountCents: 250_000, kind: 'recette', categoryId: 'salaire', dayOfMonth: 1, active: true },
  { id: 'r2', label: 'Loyer', amountCents: 75_000, kind: 'depense', categoryId: 'logement', dayOfMonth: 2, active: true },
  { id: 'r3', label: 'Netflix', amountCents: 1_399, kind: 'depense', categoryId: 'abonnements', dayOfMonth: 3, active: true },
  { id: 'r4', label: 'Crédit auto', amountCents: 26_500, kind: 'depense', categoryId: 'credit', dayOfMonth: 5, active: true },
  { id: 'r5', label: 'Électricité', amountCents: 7_500, kind: 'depense', categoryId: 'electricite', dayOfMonth: 9, active: true },
  { id: 'r6', label: 'Assurance habitation', amountCents: 2_450, kind: 'depense', categoryId: 'logement', dayOfMonth: 25, active: true },
  { id: 'r7', label: 'Mutuelle', amountCents: 4_200, kind: 'depense', categoryId: 'sante', dayOfMonth: 28, active: true },
];

export const proRecurrings: Recurring[] = [
  { id: 'pr1', label: 'Assurance pro', amountCents: 11_800, kind: 'depense', categoryId: 'assurances', dayOfMonth: 9, active: true },
  { id: 'pr2', label: 'Forfait mobile', amountCents: 2_999, kind: 'depense', categoryId: 'telephone', dayOfMonth: 16, active: true },
];

/** Une dépense prévue d'exemple (démonstration), dans une dizaine de jours. */
export const initialPlanned = (): PlannedOp[] => [
  { id: 'pl1', kind: 'depense', amountCents: 65_000, categoryId: 'logement', label: 'Taxe foncière', date: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10) },
];

function dueIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export const initialInvoices = (): Invoice[] => [
  { id: 'i1', counterparty: 'Client Bernard', label: 'Facture F-2026-041', amountCents: 85_000, dueDate: dueIn(-4), direction: 'a_encaisser', status: 'en_attente' },
  { id: 'i2', counterparty: 'Client Durand', label: 'Facture F-2026-045', amountCents: 120_000, dueDate: dueIn(6), direction: 'a_encaisser', status: 'en_attente' },
  { id: 'i3', counterparty: 'Client Petit', label: 'Facture F-2026-047', amountCents: 46_000, dueDate: dueIn(21), direction: 'a_encaisser', status: 'en_attente' },
  { id: 'i4', counterparty: 'Fournisseur Métro', label: 'Facture M-88213', amountCents: 43_000, dueDate: dueIn(3), direction: 'a_payer', status: 'en_attente' },
  { id: 'i5', counterparty: 'Loyer atelier', label: 'Échéance mensuelle', amountCents: 65_000, dueDate: dueIn(10), direction: 'a_payer', status: 'en_attente' },
  { id: 'i6', counterparty: 'EDF Pro', label: 'Facture énergie', amountCents: 14_200, dueDate: dueIn(14), direction: 'a_payer', status: 'en_attente' },
];
