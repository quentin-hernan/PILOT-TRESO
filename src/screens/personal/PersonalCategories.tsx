import { useState } from 'react';
import type { Category, Operation } from '../../types';
import type { PlanningApi } from '../../data/usePlanning';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import { formatEuros } from '../../lib/money';
import { formatMonthTitle, parisYMD } from '../../lib/dates';
import { byCategory, opsOfMonth } from '../../lib/stats';
import { Progress, StackedShare } from '../../components/Bars';
import { BudgetSheet } from '../../components/PlanSheets';
import { Icon } from '../../components/Icon';

export function PersonalCategories({ ops, planning }: { ops: Operation[]; planning: PlanningApi }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const t = parisYMD(new Date());
  const monthOps = opsOfMonth(ops, t.y, t.m);
  const spent = byCategory(monthOps, 'depense', PERSONAL_CATEGORIES);
  const spentById = new Map(spent.map((s) => [s.category.id, s.cents]));
  const { budgets } = planning;

  const expenseCats = PERSONAL_CATEGORIES.filter((c) => c.kind === 'depense');
  const budgeted = expenseCats
    .filter((c) => budgets.get(c.id))
    .sort((a, b) => (spentById.get(b.id) ?? 0) / budgets.get(b.id)! - (spentById.get(a.id) ?? 0) / budgets.get(a.id)!);
  const unbudgeted = expenseCats.filter((c) => !budgets.get(c.id));

  return (
    <>
      <h2 className="screen-title">Catégories</h2>
      <p className="muted">{formatMonthTitle(t.y, t.m)}</p>

      <section className="card">
        <div className="card-head">
          <h3>Répartition des dépenses</h3>
        </div>
        <StackedShare items={spent} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Budget par catégorie</h3>
          <span className="muted small">Touchez une ligne pour la modifier</span>
        </div>
        {budgeted.length === 0 && <p className="empty">Aucun budget fixé. Choisissez une catégorie ci-dessous.</p>}
        <ul className="budgets">
          {budgeted.map((c) => {
            const budget = budgets.get(c.id)!;
            const used = spentById.get(c.id) ?? 0;
            const left = budget - used;
            return (
              <li key={c.id} className="row-click" onClick={() => setEditing(c)}>
                <div className="catbar-head">
                  <span className="cat-name">
                    <Icon name={c.icon} size={16} /> {c.label}
                  </span>
                  <span>
                    <b>{formatEuros(used)}</b> <span className="muted">/ {formatEuros(budget)}</span>
                  </span>
                </div>
                <Progress value={used} max={budget} />
                <small className={left < 0 ? 'neg' : 'muted'}>{left >= 0 ? `Reste ${formatEuros(left)}` : `Dépassé de ${formatEuros(-left)}`}</small>
              </li>
            );
          })}
        </ul>
      </section>

      {unbudgeted.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Sans budget</h3>
          </div>
          <ul className="budgets">
            {unbudgeted.map((c) => (
              <li key={c.id} className="row-click" onClick={() => setEditing(c)}>
                <div className="catbar-head">
                  <span className="cat-name">
                    <Icon name={c.icon} size={16} /> {c.label}
                  </span>
                  <span>
                    <span className="muted">{formatEuros(spentById.get(c.id) ?? 0)} ce mois-ci</span> · <span className="link-text">Définir</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <BudgetSheet
          category={editing}
          currentCents={budgets.get(editing.id)}
          onSave={(cents) => planning.setBudget(editing.id, cents)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
