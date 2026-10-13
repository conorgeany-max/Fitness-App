/**
 * Derived household figures shared by many screens. Pure functions of the workspace,
 * memoised per data object so screens can call them freely.
 */
import { useMemo } from 'react';
import { addMonthKey, financialYear, monthKey, todayISO, type MonthKey } from '@/domain/dates';
import { categoryMeta, isMortgage } from '@/domain/holdingCategories';
import { computeBalanceSheet, visibilityFor, type BalanceSheet, type VisibilityMode } from '@/domain/networth';
import { amountForPerspective } from '@/domain/ownership';
import { rulesetForFinancialYear, type TaxRuleset } from '@/domain/tax/rulesets';
import { calculateTakeHome, type TakeHomeResult } from '@/domain/tax/salary';
import { averageMonthlySpending, summarise, type CashFlowSummary } from '@/domain/transactions';
import { toMonthly } from '@/domain/mortgage';
import type { ForecastOpening } from '@/domain/forecast';
import type { Cents } from '@/domain/money';
import type { Holding, Perspective, PersonId, Transaction, WorkspaceData } from '@/domain/types';
import { useApp } from './store';

export interface Derived {
  today: string;
  currentMonth: MonthKey;
  names: Record<PersonId, string>;
  balance: Record<Perspective, BalanceSheet>;
  ruleset: TaxRuleset;
  rulesetExact: boolean;
  takeHome: Record<PersonId, TakeHomeResult | null>;
  takeHomeMonthly: Record<PersonId, Cents>;
  accounts: Holding[];
  /** Summaries for the last 12 months (oldest first), per perspective. */
  monthly: Record<Perspective, CashFlowSummary[]>;
  months: MonthKey[];
  completeMonths: MonthKey[];
  average: Record<Perspective, ReturnType<typeof averageMonthlySpending>>;
  /** Estimated consumption spending per month excluding housing costs, and its basis. */
  livingCosts: { monthlyCents: Cents; essentialCents: Cents; basis: 'transactions' | 'budget' | 'none'; months: number };
  loanRepaymentsMonthlyCents: Cents;
  otherDebtRepaymentsMonthlyCents: Cents;
  uncategorisedCount: number;
}

const cache = new WeakMap<WorkspaceData, Map<string, Derived>>();

function incomeIsSet(p: WorkspaceData['people'][PersonId]): boolean {
  return p.income.salaryCents > 0 || p.income.bonusAnnualCents > 0 || p.income.otherTaxableIncomeAnnualCents > 0;
}

export function derive(data: WorkspaceData, today = todayISO()): Derived {
  let byDay = cache.get(data);
  if (!byDay) {
    byDay = new Map();
    cache.set(data, byDay);
  }
  const hit = byDay.get(today);
  if (hit) return hit;

  const names = { me: data.people.me.name || 'Me', partner: data.people.partner.name || 'Partner' };
  const s = data.settings;
  const balance = {
    household: computeBalanceSheet(data.holdings, 'household', s, today),
    me: computeBalanceSheet(data.holdings, 'me', s, today),
    partner: computeBalanceSheet(data.holdings, 'partner', s, today),
  };
  const fy = s.taxYearOverride ?? financialYear(today);
  const { ruleset, exact } = rulesetForFinancialYear(fy);
  const takeHome: Record<PersonId, TakeHomeResult | null> = { me: null, partner: null };
  for (const p of ['me', 'partner'] as PersonId[]) {
    if (incomeIsSet(data.people[p])) takeHome[p] = calculateTakeHome(data.people[p].income, ruleset);
  }
  const takeHomeMonthly = { me: takeHome.me?.netMonthlyCents ?? 0, partner: takeHome.partner?.netMonthlyCents ?? 0 };

  const accounts = data.holdings.filter((h) => !h.archived && categoryMeta(h.category).account);
  const currentMonth = monthKey(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonthKey(currentMonth, i - 11));
  const completeMonths = months.slice(-4, -1);
  const monthly = {} as Record<Perspective, CashFlowSummary[]>;
  const average = {} as Derived['average'];
  // Transactions in a partner's private, unshared accounts are left out of every total,
  // matching how the balance sheet treats those accounts.
  const txns = reportableTransactions(data);
  for (const p of ['household', 'me', 'partner'] as Perspective[]) {
    monthly[p] = months.map((m) => summarise(txns, data.categories, data.holdings, p, { month: m }));
    average[p] = averageMonthlySpending(txns, data.categories, data.holdings, p, completeMonths);
  }

  // Living costs (excluding housing) for forecasts and affordability.
  let livingCosts: Derived['livingCosts'];
  const avg = average.household;
  if (avg.monthsWithData >= 1 && avg.consumption > 0) {
    livingCosts = {
      monthlyCents: Math.max(0, avg.consumption - avg.housing),
      essentialCents: Math.max(0, avg.essential - avg.housing),
      basis: 'transactions',
      months: avg.monthsWithData,
    };
  } else {
    const budget = data.budgets.filter((b) => b.scope === 'household');
    const catMap = new Map(data.categories.map((c) => [c.id, c]));
    const total = budget.filter((b) => !['exp-housing', 'exp-rent'].includes(b.categoryId) && catMap.get(b.categoryId)?.treatment === 'expense').reduce((a, b) => a + b.monthlyCents, 0);
    const essential = budget.filter((b) => !['exp-housing', 'exp-rent'].includes(b.categoryId) && catMap.get(b.categoryId)?.essential).reduce((a, b) => a + b.monthlyCents, 0);
    livingCosts = total > 0 ? { monthlyCents: total, essentialCents: essential, basis: 'budget', months: 0 } : { monthlyCents: 0, essentialCents: 0, basis: 'none', months: 0 };
  }

  let loanRepayments = 0;
  let otherDebtRepayments = 0;
  for (const h of data.holdings) {
    if (h.archived || h.kind !== 'liability' || !h.loan?.repaymentCents) continue;
    const m = toMonthly(h.loan.repaymentCents, h.loan.repaymentFrequency ?? 'monthly');
    if (isMortgage(h.category)) loanRepayments += m;
    else otherDebtRepayments += m;
  }

  const result: Derived = {
    today,
    currentMonth,
    names,
    balance,
    ruleset,
    rulesetExact: exact,
    takeHome,
    takeHomeMonthly,
    accounts,
    monthly,
    months,
    completeMonths,
    average,
    livingCosts,
    loanRepaymentsMonthlyCents: loanRepayments,
    otherDebtRepaymentsMonthlyCents: otherDebtRepayments,
    uncategorisedCount: listableTransactions(data).filter((t) => !t.excluded && !t.categoryId && t.transfer === 'none').length,
  };
  byDay.set(today, result);
  return result;
}

/**
 * How each account's transactions may be shown to the active user:
 * full (listed), aggregate (in totals only) or hidden (private and not shared).
 */
export function accountVisibility(data: WorkspaceData): Map<string, VisibilityMode> {
  const m = new Map<string, VisibilityMode>();
  for (const h of data.holdings) m.set(h.id, h.archived ? 'full' : visibilityFor(h, 'household', data.settings));
  return m;
}

const reportableCache = new WeakMap<WorkspaceData, Transaction[]>();
/** Transactions that count towards totals (excludes partners' private, unshared accounts). */
export function reportableTransactions(data: WorkspaceData): Transaction[] {
  const hit = reportableCache.get(data);
  if (hit) return hit;
  const vis = accountVisibility(data);
  const out = data.transactions.filter((t) => !t.accountId || vis.get(t.accountId) !== 'hidden');
  reportableCache.set(data, out);
  return out;
}

/** Transactions the active user may see line by line. */
export function listableTransactions(data: WorkspaceData): Transaction[] {
  const vis = accountVisibility(data);
  return data.transactions.filter((t) => !t.accountId || (vis.get(t.accountId) ?? 'full') === 'full');
}

export function useDerived(): Derived {
  const data = useApp((s) => s.data);
  return useMemo(() => derive(data), [data]);
}

export function usePerspective(): Perspective {
  return useApp((s) => s.ui.perspective);
}

/** Build forecast opening balances from the current balance sheet (household view). */
export function forecastOpening(data: WorkspaceData, perspective: Perspective = 'household'): ForecastOpening & { notes: string[] } {
  const notes: string[] = [];
  const bs = computeBalanceSheet(data.holdings, perspective, data.settings, todayISO());
  const opening: ForecastOpening & { notes: string[] } = {
    cashCents: bs.assetGroups.cash,
    investmentsCents: bs.assetGroups.investments,
    superCents: { me: 0, partner: 0 },
    propertyCents: bs.assetGroups.property,
    otherAssetsCents: bs.assetGroups.other,
    loans: [],
    helpDebtCents: { me: 0, partner: 0 },
    otherLiabilitiesCents: 0,
    notes,
  };
  for (const item of bs.items) {
    const h = item.holding;
    if (item.fullValueCents === null) continue;
    const meta = categoryMeta(h.category);
    if (meta.group === 'super') {
      opening.superCents.me += amountForPerspective(item.fullValueCents, h.ownership, 'me') * (perspective === 'partner' ? 0 : 1);
      opening.superCents.partner += amountForPerspective(item.fullValueCents, h.ownership, 'partner') * (perspective === 'me' ? 0 : 1);
    }
    if (meta.kind !== 'liability') continue;
    if (h.category === 'help-debt') {
      opening.helpDebtCents.me += perspective === 'partner' ? 0 : amountForPerspective(item.fullValueCents, h.ownership, 'me');
      opening.helpDebtCents.partner += perspective === 'me' ? 0 : amountForPerspective(item.fullValueCents, h.ownership, 'partner');
      continue;
    }
    if (h.loan?.annualRate !== undefined && item.attributedCents > 0) {
      const years = h.loan.maturityDate ? Math.max(0.5, (Date.parse(h.loan.maturityDate) - Date.now()) / (365.25 * 864e5)) : isMortgage(h.category) ? 25 : 5;
      opening.loans.push({
        id: h.id,
        name: h.name,
        balanceCents: item.attributedCents,
        annualRate: h.loan.annualRate,
        monthlyRepaymentCents: perspective === 'household' && h.loan.repaymentCents ? toMonthly(h.loan.repaymentCents, h.loan.repaymentFrequency ?? 'monthly') : 0,
        remainingYears: years,
        interestOnly: h.loan.repaymentType === 'IO',
        offsetWithCash: (h.loan.offsetAccountIds?.length ?? 0) > 0,
        kind: isMortgage(h.category) ? 'mortgage' : 'other',
      });
      if (!h.loan.maturityDate) notes.push(`${h.name}: no maturity date recorded — assumed ${years} years remaining.`);
    } else {
      opening.otherLiabilitiesCents += item.attributedCents;
      if (item.attributedCents > 0 && !['credit-card', 'bnpl'].includes(h.category)) notes.push(`${h.name}: no interest rate recorded — held constant in forecasts.`);
    }
  }
  // Cards/BNPL are treated as constant balances (assumed paid in full each month).
  return opening;
}
