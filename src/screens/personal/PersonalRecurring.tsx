import type { PlanningApi } from '../../data/usePlanning';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import { Recurrences } from '../Recurrences';

export function PersonalRecurring({ planning }: { planning: PlanningApi }) {
  return (
    <>
      <h2 className="screen-title">Récurrences</h2>
      <p className="muted">Salaire, crédit, abonnements : ce qui revient chaque mois, créé automatiquement.</p>
      <Recurrences
        recurrings={planning.recurrings}
        categories={PERSONAL_CATEGORIES}
        professional={false}
        onAdd={planning.addRecurring}
        onUpdate={planning.updateRecurring}
        onSetActive={planning.setRecurringActive}
        onRemove={planning.removeRecurring}
      />
    </>
  );
}
