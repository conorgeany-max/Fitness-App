import { describe, expect, it } from 'vitest';
import { buildBudgetReport, monthProgress } from '../budget';
import { DEFAULT_CATEGORIES } from '../categories';
import { OWN_JOINT } from '../ownership';
import { holding, txn } from './fixtures';
import type { BudgetLine } from '../types';

const acc = holding('transaction', 0, OWN_JOINT, { id: 'j' });
const line = (categoryId: string, dollars: number, rollover = false): BudgetLine => ({ id: categoryId, categoryId, scope: 'household', monthlyCents: dollars * 100, rollover, startMonth: '2026-08' });

describe('budgets', () => {
  it('compares actual with budget and projects month-to-date spending', () => {
    const t = [txn('1', '2026-10-05', -300, 'j', { categoryId: 'exp-groceries' }), txn('2', '2026-10-10', 50, 'j', { categoryId: 'exp-groceries' })];
    const r = buildBudgetReport([line('exp-groceries', 800)], t, DEFAULT_CATEGORIES, [acc], [], 'household', '2026-10', '2026-10-15');
    const row = r.rows[0];
    expect(row.actualCents).toBe(25000);
    expect(row.projectedCents).toBe(Math.round(25000 / (15 / 31)));
    expect(row.status).toBe('under'); // well below the pace of the budget
    expect(monthProgress('2026-10', '2026-10-15')).toBeCloseTo(15 / 31, 6);
  });

  it('carries unspent and overspent amounts forward when rollover is on', () => {
    const t = [txn('a', '2026-08-10', -100, 'j', { categoryId: 'exp-eating' }), txn('b', '2026-09-10', -400, 'j', { categoryId: 'exp-eating' })];
    const r = buildBudgetReport([line('exp-eating', 300, true)], t, DEFAULT_CATEGORIES, [acc], [], 'household', '2026-10', '2026-10-01');
    expect(r.rows[0].rolloverCents).toBe(20000 - 10000);
    expect(r.rows[0].availableCents).toBe(40000);
  });

  it('flags overspending and lists unbudgeted categories', () => {
    const t = [txn('a', '2026-10-02', -900, 'j', { categoryId: 'exp-groceries' }), txn('b', '2026-10-03', -60, 'j', { categoryId: 'exp-travel' })];
    const r = buildBudgetReport([line('exp-groceries', 800)], t, DEFAULT_CATEGORIES, [acc], [], 'household', '2026-10', '2026-10-05');
    expect(r.rows[0].status).toBe('over');
    expect(r.unbudgetedByCategory[0].category.id).toBe('exp-travel');
  });
});
