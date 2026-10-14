/**
 * The figures the AI assistant may talk about, computed by the app from what this person can
 * already see. The assistant receives these totals (never accounts, transactions, account
 * numbers or tokens) and refers to them by id; the app writes the numbers into its answer.
 */
import { addMonthKey } from './dates';
import { goalProgress } from './goals';
import { ASSET_GROUP_LABELS, LIABILITY_GROUP_LABELS } from './holdingCategories';
import type { Perspective, Transaction, WorkspaceData } from './types';

export type FactKind = 'money' | 'percent' | 'count' | 'months' | 'date';

export interface Fact {
  id: string;
  label: string;
  kind: FactKind;
  /** Cents for money, a fraction for percent (0.25 = 25%), a plain number otherwise; ISO for dates. */
  value: number | string;
}

export const MAX_FACTS = 120;

interface DerivedLike {
  today: string;
  currentMonth: string;
  names: Record<'me' | 'partner', string>;
  balance: Record<Perspective, import('./networth').BalanceSheet>;
  takeHomeMonthly: Record<'me' | 'partner', number>;
  completeMonths: string[];
  average: Record<Perspective, { consumption: number; essential: number; income: number; housing: number; monthsWithData: number }>;
}

export function buildFacts(data: WorkspaceData, d: DerivedLike, perspective: Perspective, transactions: Transaction[]): Fact[] {
  const facts: Fact[] = [];
  const add = (id: string, label: string, kind: FactKind, value: number | string | null | undefined) => {
    if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
    facts.push({ id, label, kind, value });
  };
  const who = perspective === 'household' ? 'Household' : d.names[perspective];
  const b = d.balance[perspective];

  add('today', 'Today', 'date', d.today);
  add('net_worth', `${who} net worth`, 'money', b.netWorthCents);
  add('assets', `${who} total assets`, 'money', b.assetsCents);
  add('liabilities', `${who} total debts`, 'money', b.liabilitiesCents);
  add('liquid', `${who} cash and other liquid assets`, 'money', b.liquidCents);
  add('liquid_net', `${who} liquid assets minus credit cards and BNPL`, 'money', b.liquidNetWorthCents);
  add('investable', `${who} investments outside super`, 'money', b.investableCents);
  add('super', `${who} superannuation`, 'money', b.superCents);
  add('property_value', `${who} property value`, 'money', b.propertyValueCents);
  add('mortgage', `${who} mortgage balance`, 'money', b.mortgageCents);
  add('property_equity', `${who} property equity`, 'money', b.propertyEquityCents);
  add('stale_items', 'Balances that are out of date', 'count', b.staleCount);
  add('missing_items', 'Items without a value', 'count', b.missingCount);
  for (const [g, v] of Object.entries(b.assetGroups)) if (v) add(`asset_${g}`, `Assets: ${ASSET_GROUP_LABELS[g as keyof typeof ASSET_GROUP_LABELS]}`, 'money', v);
  for (const [g, v] of Object.entries(b.liabilityGroups)) if (v) add(`debt_${g}`, `Debts: ${LIABILITY_GROUP_LABELS[g as keyof typeof LIABILITY_GROUP_LABELS]}`, 'money', v);

  for (const p of ['me', 'partner'] as const) if (perspective === 'household' || perspective === p) add(`take_home_${p}`, `${d.names[p]} take-home pay per month (estimated from salary settings)`, 'money', d.takeHomeMonthly[p] || null);

  const avg = d.average[perspective];
  if (avg.monthsWithData > 0) {
    add('avg_months', 'Months of transactions the averages use', 'months', avg.monthsWithData);
    add('avg_income', 'Average monthly income received', 'money', avg.income);
    add('avg_spending', 'Average monthly spending', 'money', avg.consumption);
    add('avg_essential', 'Average monthly essential spending', 'money', avg.essential);
    add('avg_housing', 'Average monthly housing costs', 'money', avg.housing);
    if (avg.income > 0) {
      add('avg_left_over', 'Average monthly income left after spending', 'money', avg.income - avg.consumption);
      add('savings_rate', 'Share of income not spent', 'percent', (avg.income - avg.consumption) / avg.income);
    }
  }

  // Spending by category over the last three complete months, from transactions this person can see.
  const last = d.completeMonths.slice(-3);
  if (last.length) {
    const from = `${last[0]}-01`;
    const to = `${addMonthKey(last[last.length - 1] as never, 1)}-01`;
    const byCat = new Map<string, number>();
    for (const t of transactions) {
      if (t.date < from || t.date >= to || t.amountCents >= 0 || t.transfer !== 'none' || t.excluded || t.pending) continue;
      const k = t.categoryId ?? 'uncategorised';
      byCat.set(k, (byCat.get(k) ?? 0) - t.amountCents);
    }
    const names = new Map(data.categories.map((c) => [c.id, c.name]));
    [...byCat]
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, 12)
      .forEach(([cat, cents], i) => add(`cat_${i + 1}`, `Average monthly spending on ${names.get(cat) ?? 'uncategorised'} (last ${last.length} months)`, 'money', Math.round(cents / last.length)));
  }

  data.goals.slice(0, 10).forEach((g, i) => {
    const gp = goalProgress(g, data.holdings, d.today);
    add(`goal_${i + 1}_target`, `Goal "${g.name}": target`, 'money', g.targetCents);
    add(`goal_${i + 1}_saved`, `Goal "${g.name}": progress so far`, 'money', gp.currentCents);
    add(`goal_${i + 1}_needed`, `Goal "${g.name}": needed per month to finish on time`, 'money', gp.requiredMonthlyCents);
    add(`goal_${i + 1}_date`, `Goal "${g.name}": target date`, 'date', g.targetDate);
  });

  return facts.slice(0, MAX_FACTS);
}
