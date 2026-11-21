import type { IconName } from './components/Icon';

export type AccountType = 'particulier' | 'professionnel';
/** Auto-entrepreneur (seul) ou entreprise avec employés. */
export type ProMode = 'solo' | 'equipe';
/** Rôle de l'utilisateur dans une organisation professionnelle. */
export type ProRole = 'patron' | 'employe';
export type OperationKind = 'depense' | 'recette';

export interface Category {
  id: string;
  label: string;
  icon: IconName;
  color: string;
  kind: OperationKind;
  /** Budget mensuel en centimes (compte particulier, dépenses uniquement). */
  budgetCents?: number;
}

/** Tous les montants sont des entiers en centimes. */
export interface Operation {
  id: string;
  kind: OperationKind;
  amountCents: number;
  categoryId: string;
  label: string;
  /** Date ISO. Affichage en fuseau Europe/Paris. */
  date: string;
  /** Compte professionnel : qui a saisi l'opération. */
  author?: ProRole;
  /** Vient d'être ajoutée (sert uniquement à l'animation). */
  fresh?: boolean;
}

export interface Invoice {
  id: string;
  counterparty: string;
  label: string;
  amountCents: number;
  /** Échéance ISO. */
  dueDate: string;
  direction: 'a_encaisser' | 'a_payer';
  /** 'payee' = déjà encaissée / réglée. */
  status: 'en_attente' | 'payee';
}

export interface Recurring {
  id: string;
  label: string;
  amountCents: number;
  kind: OperationKind;
  categoryId: string;
  dayOfMonth: number;
  /** En pause = plus aucune opération créée. */
  active: boolean;
  /** Dernier jour (AAAA-MM-JJ) pour lequel les opérations ont été créées. */
  lastApplied?: string;
}

export interface OperationDraft {
  kind: OperationKind;
  amountCents: number;
  categoryId: string;
  label: string;
  /** Date ISO de l'opération. */
  date: string;
}
