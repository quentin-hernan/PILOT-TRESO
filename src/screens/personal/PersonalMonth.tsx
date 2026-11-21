import { useState } from 'react';
import type { Operation } from '../../types';
import { PERSONAL_CATEGORIES } from '../../data/categories';
import { formatEuros } from '../../lib/money';
import { daysInMonth, formatMonthTitle, isSameDay, parisYMD, shiftMonth } from '../../lib/dates';
import { opsOfMonth, totals } from '../../lib/stats';
import { GroupedOperations } from '../../components/OperationList';
import { DailyBars } from '../../components/Bars';
import { Icon } from '../../components/Icon';

export function PersonalMonth({ ops }: { ops: Operation[] }) {
  const [offset, setOffset] = useState(0);
  const today = parisYMD(new Date());
  const { y, m } = shiftMonth(today.y, today.m, offset);
  const monthOps = opsOfMonth(ops, y, m);
  const { income, expense } = totals(monthOps);

  const perDay = Array.from({ length: daysInMonth(y, m) }, () => 0);
  for (const o of monthOps) if (o.kind === 'depense') perDay[parisYMD(o.date).d - 1] += o.amountCents;
  const todayIndex = isSameDay({ y, m, d: today.d }, today) ? today.d - 1 : null;

  return (
    <>
      <div className="month-nav">
        <button onClick={() => setOffset((o) => o - 1)} disabled={offset <= -2} aria-label="Mois précédent">
          <Icon name="chevLeft" />
        </button>
        <h2>{formatMonthTitle(y, m)}</h2>
        <button onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Mois suivant">
          <Icon name="chevRight" />
        </button>
      </div>

      <section className="summary">
        <div>
          <small>Encaissements</small>
          <b className="pos">+{formatEuros(income)}</b>
        </div>
        <div>
          <small>Dépenses</small>
          <b className="neg">−{formatEuros(expense)}</b>
        </div>
        <div>
          <small>Disponible</small>
          <b>{formatEuros(income - expense)}</b>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Dépenses par jour</h3>
        </div>
        <DailyBars values={perDay} todayIndex={offset === 0 ? todayIndex : null} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Opérations</h3>
          <span className="muted">{monthOps.length}</span>
        </div>
        <GroupedOperations ops={monthOps} categories={PERSONAL_CATEGORIES} />
      </section>
    </>
  );
}
