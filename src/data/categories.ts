import type { AccountType, Category } from '../types';

// Palette sobre, dérivée du logo : bleu QS2H, noir, gris, avec deux verts pour les recettes.

/** Catégories du compte particulier (budgets mensuels en centimes). */
export const PERSONAL_CATEGORIES: Category[] = [
  { id: 'salaire', label: 'Salaire', icon: 'briefcase', color: '#0f7b50', kind: 'recette' },
  { id: 'autre-recette', label: 'Autre recette', icon: 'gift', color: '#4aa37e', kind: 'recette' },
  { id: 'logement', label: 'Logement', icon: 'home', color: '#15171a', kind: 'depense', budgetCents: 75000 },
  { id: 'alimentation', label: 'Alimentation', icon: 'cart', color: '#0b4a9b', kind: 'depense', budgetCents: 45000 },
  { id: 'carburant', label: 'Carburant', icon: 'fuel', color: '#2f6fbf', kind: 'depense', budgetCents: 15000 },
  { id: 'restaurant', label: 'Restaurant', icon: 'utensils', color: '#6a9bd8', kind: 'depense', budgetCents: 12000 },
  { id: 'electricite', label: 'Électricité', icon: 'bolt', color: '#4a5360', kind: 'depense', budgetCents: 9000 },
  { id: 'abonnements', label: 'Abonnements', icon: 'tv', color: '#8a939e', kind: 'depense', budgetCents: 3000 },
  { id: 'loisirs', label: 'Loisirs', icon: 'film', color: '#a9c4e8', kind: 'depense', budgetCents: 8000 },
  { id: 'sante', label: 'Santé', icon: 'cross', color: '#1c7c7d', kind: 'depense', budgetCents: 5000 },
  { id: 'transport', label: 'Transport', icon: 'train', color: '#3b4a5c', kind: 'depense', budgetCents: 6000 },
  { id: 'credit', label: 'Crédit', icon: 'bank', color: '#b4bcc6', kind: 'depense', budgetCents: 26500 },
];

/** Catégories du compte professionnel. */
export const PRO_CATEGORIES: Category[] = [
  { id: 'ventes', label: 'Ventes', icon: 'receipt', color: '#0f7b50', kind: 'recette' },
  { id: 'prestations', label: 'Prestations', icon: 'wrench', color: '#4aa37e', kind: 'recette' },
  { id: 'carburant', label: 'Carburant', icon: 'fuel', color: '#2f6fbf', kind: 'depense' },
  { id: 'achats', label: 'Achats', icon: 'box', color: '#0b4a9b', kind: 'depense' },
  { id: 'fournitures', label: 'Fournitures', icon: 'paperclip', color: '#8a939e', kind: 'depense' },
  { id: 'energie', label: 'Énergie', icon: 'bolt', color: '#4a5360', kind: 'depense' },
  { id: 'assurances', label: 'Assurances', icon: 'shield', color: '#15171a', kind: 'depense' },
  { id: 'telephone', label: 'Téléphone', icon: 'phone', color: '#6a9bd8', kind: 'depense' },
  { id: 'deplacements', label: 'Déplacements', icon: 'car', color: '#3b4a5c', kind: 'depense' },
];

export const categoriesFor = (account: AccountType): Category[] =>
  account === 'particulier' ? PERSONAL_CATEGORIES : PRO_CATEGORIES;
