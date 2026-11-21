interface Props {
  onAdd: (kind: 'depense' | 'recette') => void;
  /** L'employé ne peut saisir que des dépenses. */
  expenseOnly?: boolean;
}

/** Boutons de démonstration : simulent une opération pour voir l'animation du solde. */
export function DemoBar({ onAdd, expenseOnly }: Props) {
  return (
    <div className="demo-bar">
      <span className="demo-tag">Démo</span>
      <button className="chip chip-neg" onClick={() => onAdd('depense')}>
        −100 €
      </button>
      {!expenseOnly && (
        <button className="chip chip-pos" onClick={() => onAdd('recette')}>
          +100 €
        </button>
      )}
    </div>
  );
}
