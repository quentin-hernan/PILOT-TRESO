import type { Category, Operation, OperationKind } from '../types';
import { isInMonth } from './dates';

export const signed = (o: Operation): number => (o.kind === 'recette' ? o.amountCents : -o.amountCents);

export const opsOfMonth = (ops: Operation[], y: number, m: number): Operation[] =>
  ops.filter((o) => isInMonth(o.date, y, m));

export function totals(ops: Operation[]): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const o of ops) {
    if (o.kind === 'recette') income += o.amountCents;
    else expense += o.amountCents;
  }
  return { income, expense };
}

export interface CategoryTotal {
  category: Category;
  cents: number;
}

export function byCategory(ops: Operation[], kind: OperationKind, categories: Category[]): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const o of ops) {
    if (o.kind !== kind) continue;
    map.set(o.categoryId, (map.get(o.categoryId) ?? 0) + o.amountCents);
  }
  return [...map.entries()]
    .map(([id, cents]) => ({ category: categories.find((c) => c.id === id)!, cents }))
    .filter((x) => x.category)
    .sort((a, b) => b.cents - a.cents);
}
