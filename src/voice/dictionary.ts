import type { AccountType } from '../types';

/**
 * Dictionnaire de mots-clés : phrase dictée -> catégorie.
 * Les mots sont écrits en minuscules, SANS accents ni apostrophes (le texte est normalisé avant la comparaison).
 * Quand plusieurs catégories correspondent, la mot-clé le plus long l'emporte (le plus précis).
 * Pour enrichir la reconnaissance, il suffit d'ajouter des mots ici.
 */
export const CATEGORY_KEYWORDS: Record<AccountType, Record<string, string[]>> = {
  particulier: {
    // recettes
    salaire: ['salaire', 'ma paie', 'la paie', 'fiche de paie', 'traitement'],
    'autre-recette': ['remboursement', 'cadeau', 'prime', 'allocation', 'allocations', 'caf', 'pension'],
    // dépenses
    logement: ['loyer', 'logement', 'charges', 'copropriete', 'assurance habitation', 'assurance', 'assurances', 'taxe fonciere'],
    alimentation: [
      'courses', 'course', 'supermarche', 'carrefour', 'leclerc', 'auchan', 'lidl', 'intermarche', 'boulangerie',
      'marche', 'nourriture', 'alimentation', 'epicerie', 'boucherie', 'fruits', 'legumes', 'primeur',
    ],
    carburant: ['carburant', 'essence', 'gasoil', 'gazole', 'diesel', 'plein', 'sp95', 'sp98'],
    restaurant: ['restaurant', 'resto', 'restau', 'pizzeria', 'brasserie', 'burger', 'mcdo', 'kebab', 'sushi', 'repas', 'cafe'],
    electricite: ['electricite', 'edf', 'courant', 'electrique', 'gaz', 'energie', 'engie', 'eau', 'veolia', 'suez'],
    abonnements: ['abonnement', 'abonnements', 'netflix', 'spotify', 'canal', 'disney', 'amazon prime', 'youtube', 'forfait', 'internet', 'box', 'telephone', 'mobile', 'portable'],
    loisirs: ['loisir', 'loisirs', 'cinema', 'sortie', 'concert', 'sport', 'jeux', 'jeu', 'theatre', 'musee'],
    sante: ['sante', 'pharmacie', 'medecin', 'docteur', 'dentiste', 'mutuelle', 'medicament', 'medicaments', 'hopital', 'opticien', 'kine'],
    transport: ['transport', 'transports', 'train', 'sncf', 'bus', 'metro', 'tram', 'navigo', 'pass', 'taxi', 'uber', 'parking', 'peage', 'autoroute'],
    credit: ['credit', 'pret', 'emprunt', 'mensualite', 'immobilier'],
  },
  professionnel: {
    // encaissements
    ventes: ['vente', 'ventes', 'vendu', 'vendre', 'comptoir', 'caisse'],
    prestations: ['prestation', 'prestations', 'intervention', 'chantier', 'mission', 'depannage'],
    // décaissements
    carburant: ['carburant', 'essence', 'gasoil', 'gazole', 'diesel', 'plein'],
    achats: ['achat', 'achats', 'achete', 'materiel', 'marchandise', 'marchandises', 'stock', 'matiere', 'matieres', 'outillage'],
    fournitures: ['fournitures', 'fourniture', 'papeterie', 'bureau', 'cartouche', 'cartouches', 'consommables'],
    energie: ['electricite', 'edf', 'gaz', 'eau', 'energie', 'courant'],
    assurances: ['assurance', 'assurances', 'rc pro', 'garantie'],
    telephone: ['telephone', 'mobile', 'forfait', 'internet', 'box', 'orange', 'sfr', 'bouygues', 'portable'],
    deplacements: ['deplacement', 'deplacements', 'peage', 'parking', 'train', 'sncf', 'taxi', 'hotel', 'hebergement', 'restaurant', 'repas', 'resto', 'avion', 'billet'],
  },
};

/** Verbes / mots qui indiquent une dépense. */
export const EXPENSE_WORDS = [
  'depense', 'depenser', 'depenses', 'paye', 'payer', 'achete', 'acheter', 'regle', 'regler', 'debourse', 'debourser', 'sorti',
];

/** Verbes / mots qui indiquent une recette (encaissement). */
export const INCOME_WORDS = [
  'recu', 'recois', 'recevoir', 'encaisse', 'encaisser', 'vendu', 'vendre', 'gagne', 'gagner', 'touche', 'toucher', 'rentre', 'percu',
  'recette', 'recettes', 'revenu', 'revenus', 'rentree', 'rentrees', 'encaissement', 'encaissements', 'gain', 'gains',
];
