import { useState } from 'react';
import type { Operation, ProMode } from '../../types';
import { PRO_CATEGORIES } from '../../data/categories';
import { formatEuros } from '../../lib/money';
import { formatMonthTitle, parisYMD } from '../../lib/dates';
import { byCategory, opsOfMonth, totals } from '../../lib/stats';
import { Segmented } from '../../components/Segmented';
import { CategoryBars } from '../../components/Bars';
import { GroupedOperations } from '../../components/OperationList';

type Filter = 'tout' | 'recette' | 'depense';

export function ProFlows({ ops, mode }: { ops: Operation[]; mode: ProMode }) {
  const [filter, setFilter] = useState<Filter>('tout');
  const t = parisYMD(new Date());
  const monthOps = opsOfMonth(ops, t.y, t.m);
  const { income, expense } = totals(monthOps);
  const shown = filter === 'tout' ? monthOps : monthOps.filter((o) => o.kind === filter);

  return (
    <>
      <h2 className="screen-title">Encaissements & décaissements</h2>
      <p className="muted">{formatMonthTitle(t.y, t.m)}</p>

      <section className="summary">
        <div>
          <small>Encaissements</small>
          <b className="pos">+{formatEuros(income)}</b>
        </div>
        <div>
          <small>Décaissements</small>
          <b className="neg">−{formatEuros(expense)}</b>
        </div>
        <div>
          <small>Résultat</small>
          <b className={income - expense >= 0 ? 'pos' : 'neg'}>{formatEuros(income - expense)}</b>
        </div>
      </section>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'tout', label: 'Tout' },
          { value: 'recette', label: 'Encaissements' },
          { value: 'depense', label: 'Décaissements' },
        ]}
      />

      {filter !== 'tout' && (
        <section className="card">
          <div className="card-head">
            <h3>Par catégorie</h3>
          </div>
          <CategoryBars items={byCategory(monthOps, filter, PRO_CATEGORIES)} />
        </section>
      )}

      <section className="card">
        <GroupedOperations ops={shown} categories={PRO_CATEGORIES} showAuthor={mode === 'equipe'} />
      </section>
    </>
  );
}
