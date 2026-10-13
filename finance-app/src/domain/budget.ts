/**
 * Budgets: actual vs budget by category, month-to-date projection and rollover.
 *
 * - Actual spending for a category = −(sum of signed amounts) for that category in the
 *   perspective, so refunds reduce actuals. Internal and partner transfers are excluded.
 * - Projection: fixed categories project to max(actual, budget) (the bill is expected to
 *   land once); variable categories project linearly by days elapsed.
 * - Rollover: unspent (or overspent) amounts from previous months since `startMonth`
 *   carry into the current month's available amount.
 */
import { addMonthKey, daysInMonth, monthKey, type ISODate, type MonthKey } from './dates';
import type { Cents } from './money';
import { summarise } from './transactions';
import type { BudgetLine, Category, Holding, Perspective, PlannedExpense, Transaction } from './types';

export interface BudgetRow {
  line: BudgetLine;
  category: Category;
  budgetCents: Cents;
  rolloverCents: Cents;
  availableCents: Cents;
  actualCents: Cents;
  projectedCents: Cents;
  plannedCents: Cents;
  remainingCents: Cents;
  status: 'under' | 'on-track' | 'at-risk' | 'over';
}

export interface BudgetReport {
  month: MonthKey;
  rows: BudgetRow[];
  totalBudgetCents: Cents;
  totalActualCents: Cents;
  totalProjectedCents: Cents;
  unbudgetedSpendCents: Cents;
  unbudgetedByCategory: { category: Category; cents: Cents }[];
  progressOfMonth: number;
}

export function monthProgress(month: MonthKey, today: ISODate): number {
  const tk = monthKey(today);
  if (tk > month) return 1;
  if (tk < month) return 0;
  const [y, m] = month.split('-').map(Number);
  return Number(today.slice(8, 10)) / daysInMonth(y, m);
}

function spentByCategory(
  transactions: Transaction[],
  categories: Category[],
  accounts: Holding[],
  perspective: Perspective,
  month: MonthKey,
): Map<string, Cents> {
  const s = summarise(transactions, categories, accounts, perspective, { month });
  const out = new Map<string, Cents>();
  for (const [id, amt] of s.byCategory) out.set(id, -amt);
  return out;
}

export function buildBudgetReport(
  lines: BudgetLine[],
  transactions: Transaction[],
  categories: Category[],
  accounts: Holding[],
  planned: PlannedExpense[],
  perspective: Perspective,
  month: MonthKey,
  today: ISODate,
): BudgetReport {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const progress = monthProgress(month, today);
  const spent = spentByCategory(transactions, categories, accounts, perspective, month);
  const scoped = lines.filter((l) => l.scope === perspective && catMap.has(l.categoryId));
  const rows: BudgetRow[] = [];
  const budgeted = new Set<string>();

  for (const line of scoped) {
    const category = catMap.get(line.categoryId)!;
    budgeted.add(line.categoryId);
    let rollover = 0;
    if (line.rollover && line.startMonth < month) {
      let m = line.startMonth;
      let guard = 0;
      while (m < month && guard++ < 120) {
        const prevSpent = spentByCategory(transactions, categories, accounts, perspective, m).get(line.categoryId) ?? 0;
        rollover += line.monthlyCents - prevSpent;
        m = addMonthKey(m, 1);
      }
    }
    const actual = spent.get(line.categoryId) ?? 0;
    const plannedCents = planned
      .filter((p) => !p.done && p.scope === perspective && p.categoryId === line.categoryId && monthKey(p.date) === month)
      .reduce((a, p) => a + p.amountCents, 0);
    const projectedBase = category.fixed ? Math.max(actual, line.monthlyCents) : progress > 0 ? Math.round(actual / progress) : actual;
    const projected = Math.max(projectedBase, actual + plannedCents);
    const available = line.monthlyCents + rollover;
    const status: BudgetRow['status'] =
      actual > available ? 'over' : projected > available ? 'at-risk' : actual < available * progress * 0.8 ? 'under' : 'on-track';
    rows.push({
      line,
      category,
      budgetCents: line.monthlyCents,
      rolloverCents: rollover,
      availableCents: available,
      actualCents: actual,
      projectedCents: projected,
      plannedCents,
      remainingCents: available - actual,
      status,
    });
  }

  const unbudgeted: { category: Category; cents: Cents }[] = [];
  for (const [id, cents] of spent) {
    const cat = catMap.get(id);
    if (!cat || cat.treatment !== 'expense' || budgeted.has(id) || cents <= 0) continue;
    unbudgeted.push({ category: cat, cents });
  }
  unbudgeted.sort((a, b) => b.cents - a.cents);

  return {
    month,
    rows: rows.sort((a, b) => b.availableCents - a.availableCents),
    totalBudgetCents: rows.reduce((a, r) => a + r.availableCents, 0),
    totalActualCents: rows.reduce((a, r) => a + r.actualCents, 0),
    totalProjectedCents: rows.reduce((a, r) => a + r.projectedCents, 0),
    unbudgetedSpendCents: unbudgeted.reduce((a, u) => a + u.cents, 0),
    unbudgetedByCategory: unbudgeted,
    progressOfMonth: progress,
  };
}

/** Annualise a monthly budget. */
export function annualBudget(lines: BudgetLine[], perspective: Perspective): Cents {
  return lines.filter((l) => l.scope === perspective).reduce((a, l) => a + l.monthlyCents * 12, 0);
}
