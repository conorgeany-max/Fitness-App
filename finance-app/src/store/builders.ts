/**
 * Glue between the stored workspace and the pure calculation engines.
 */
import { addDays, monthKey, type ISODate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { buildBudgetReport } from '@/domain/budget';
import { runForecast, type ForecastInput, type ForecastResult } from '@/domain/forecast';
import { goalProgress } from '@/domain/goals';
import { buildHistorySeries } from '@/domain/history';
import { generateInsights, type Insight } from '@/domain/insights';
import { monthProgress } from '@/domain/budget';
import { EMPTY_INCOME } from '@/domain/tax/salary';
import { detectRecurring, unusualTransactions } from '@/domain/transactions';
import type { Perspective, Scenario, WorkspaceData } from '@/domain/types';
import type { HouseholdFinancials } from '@/domain/property/affordability';
import { derive, forecastOpening, listableTransactions, reportableTransactions, type Derived } from './derived';

export function buildForecastInput(data: WorkspaceData, scenario: Scenario, d: Derived, perspective: Perspective = 'household'): ForecastInput & { notes: string[] } {
  const opening = forecastOpening(data, perspective);
  const notes = [...opening.notes];
  const people = {
    me: perspective === 'partner' ? { ...EMPTY_INCOME } : data.people.me.income,
    partner: perspective === 'me' ? { ...EMPTY_INCOME } : data.people.partner.income,
  };
  let living = scenario.livingCostsMonthlyCents;
  if (living === null) {
    living = d.livingCosts.monthlyCents;
    if (d.livingCosts.basis === 'transactions') notes.push(`Living costs: average non-housing spending over the last ${d.livingCosts.months} complete month(s).`);
    else if (d.livingCosts.basis === 'budget') notes.push('Living costs: from your monthly budget (no transaction history yet).');
    else notes.push('No spending data yet — set living costs in the scenario for a meaningful forecast.');
    if (perspective !== 'household') living = Math.round(living / 2);
  }
  if (perspective !== 'household') notes.push('Individual forecasts split shared living costs 50/50 unless set in the scenario.');
  if (people.me.residency === 'unknown' || people.partner.residency === 'unknown') {
    if ((people.me.salaryCents > 0 && people.me.residency === 'unknown') || (people.partner.salaryCents > 0 && people.partner.residency === 'unknown')) {
      notes.push('Tax residency not set for at least one person — resident rates assumed.');
    }
  }
  return {
    // The forecast starts next month from today's balances.
    startMonth: nextMonth(d.currentMonth),
    months: scenario.horizonYears * 12,
    people,
    opening,
    assumptions: scenario.assumptions,
    events: scenario.events,
    livingCostsMonthlyCents: living,
    notes,
  };
}

function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

const forecastCache = new WeakMap<WorkspaceData, Map<string, ForecastResult & { notes: string[] }>>();

export function forecastFor(data: WorkspaceData, scenario: Scenario, perspective: Perspective = 'household'): ForecastResult & { notes: string[] } {
  let m = forecastCache.get(data);
  if (!m) {
    m = new Map();
    forecastCache.set(data, m);
  }
  const key = `${scenario.id}|${scenario.updatedAt}|${perspective}|${JSON.stringify(scenario.assumptions)}|${scenario.events.length}|${scenario.horizonYears}|${scenario.livingCostsMonthlyCents}`;
  const hit = m.get(key);
  if (hit) return hit;
  const d = derive(data);
  const input = buildForecastInput(data, scenario, d, perspective);
  const r = { ...runForecast(input), notes: input.notes };
  m.set(key, r);
  return r;
}

export function householdFinancials(_data: WorkspaceData, d: Derived): HouseholdFinancials & { basis: string[] } {
  const basis: string[] = [];
  const bs = d.balance.household;
  const takeHome = d.takeHomeMonthly.me + d.takeHomeMonthly.partner;
  if (!takeHome) basis.push('No income profiles set — add salaries under Forecasts → Income & tax.');
  else basis.push(`Take-home pay estimated with the ${d.ruleset.financialYear} tax ruleset.`);
  if (d.livingCosts.basis === 'transactions') basis.push(`Living costs: average non-housing spending over ${d.livingCosts.months} month(s) of transactions.`);
  else if (d.livingCosts.basis === 'budget') basis.push('Living costs: from your monthly budget.');
  else basis.push('No living-cost data — enter an override for a meaningful result.');
  if (d.loanRepaymentsMonthlyCents > 0) basis.push(`Existing loan repayments of ${formatMoney(d.loanRepaymentsMonthlyCents)}/month continue after the purchase. If you are selling your current home, set "Other debt repayments" to exclude them.`);
  const rentAvg = Math.round(
    d.completeMonths.reduce((a, m) => a - (d.monthly.household[d.months.indexOf(m)]?.byCategory.get('exp-rent') ?? 0), 0) / Math.max(1, d.completeMonths.length),
  );
  return {
    takeHomeMonthlyCents: takeHome,
    takeHomeByPerson: { ...d.takeHomeMonthly },
    livingCostsMonthlyCents: d.livingCosts.monthlyCents,
    essentialLivingMonthlyCents: d.livingCosts.essentialCents,
    liquidSavingsCents: bs.liquidCents,
    // Existing home loans keep being paid alongside a new purchase. If the purchase replaces
    // your current home (sell and buy), override this in the analysis.
    otherDebtRepaymentsMonthlyCents: d.otherDebtRepaymentsMonthlyCents + d.loanRepaymentsMonthlyCents,
    netWorthCents: bs.netWorthCents,
    currentRentMonthlyCents: Math.max(0, rentAvg),
    basis,
  };
}

export function insightsFor(data: WorkspaceData, perspective: Perspective): Insight[] {
  const d = derive(data);
  const balance = d.balance[perspective];
  const series = buildHistorySeries(data.snapshots, data.holdings, data.settings, perspective, monthKey(addDays(d.today, -62)), monthKey(addDays(d.today, -31)));
  const prev = series[series.length - 1];
  const avgByCat = new Map<string, number>();
  const complete = d.completeMonths;
  for (const m of complete) {
    const s = d.monthly[perspective][d.months.indexOf(m)];
    for (const [cat, amt] of s.byCategory) avgByCat.set(cat, (avgByCat.get(cat) ?? 0) - amt / complete.length);
  }
  const monthsWithData = complete.filter((m) => d.monthly[perspective][d.months.indexOf(m)].transactionCount > 0).length;
  const current = d.monthly[perspective][d.months.length - 1];
  const surplusMonths = complete.map((m) => d.monthly[perspective][d.months.indexOf(m)]).filter((s) => s.transactionCount > 0);
  const avgSurplus = surplusMonths.length ? Math.round(surplusMonths.reduce((a, s) => a + s.incomeCents - s.consumptionCents, 0) / surplusMonths.length) : null;
  const essential = d.average[perspective].essential + (perspective === 'household' ? d.loanRepaymentsMonthlyCents : 0);
  const insights = generateInsights({
    today: d.today,
    names: d.names,
    balance,
    previousLiquid: prev ? { cents: prev.liquidCents, date: prev.date, kind: prev.kind } : null,
    currentMonth: current,
    monthProgress: monthProgress(d.currentMonth, d.today),
    averageByCategory: avgByCat,
    monthsOfHistory: monthsWithData,
    categories: data.categories,
    recurring: detectRecurring(listableTransactions(data)),
    bills: data.bills,
    takeHomeMonthly: perspective === 'household' ? d.takeHomeMonthly : { me: 0, partner: 0 },
    essentialMonthlyCents: essential,
    averageSurplusMonthlyCents: avgSurplus,
    holdings: data.holdings.filter((h) => perspective === 'household' || h.ownership[perspective] > 0),
    goals: data.goals.filter((g) => perspective === 'household' || g.scope === perspective || g.scope === 'household').map((g) => goalProgress(g, data.holdings, d.today)),
    unusual: unusualTransactions(listableTransactions(data), data.categories, addDays(d.today, -30)),
    uncategorisedCount: d.uncategorisedCount,
    budget: data.budgets.some((b) => b.scope === perspective)
      ? buildBudgetReport(data.budgets, reportableTransactions(data), data.categories, data.holdings, data.plannedExpenses, perspective, d.currentMonth, d.today)
      : null,
  });
  return insights.filter((i) => !data.insights.dismissed[i.id]);
}

export function upcomingItems(data: WorkspaceData, perspective: Perspective, today: ISODate, days = 35) {
  const end = addDays(today, days);
  const items: { id: string; date: ISODate; name: string; amountCents: number; kind: 'bill' | 'subscription' | 'income' | 'planned' | 'detected' }[] = [];
  const step = (d: ISODate, f: string) => (f === 'weekly' ? addDays(d, 7) : f === 'fortnightly' ? addDays(d, 14) : f === 'monthly' ? addMonthsSafe(d, 1) : f === 'quarterly' ? addMonthsSafe(d, 3) : addMonthsSafe(d, 12));
  for (const b of data.bills) {
    if (!b.active || (perspective !== 'household' && b.scope !== perspective && b.scope !== 'household')) continue;
    let d = b.nextDate;
    let guard = 0;
    while (d < today && guard++ < 60) d = step(d, b.frequency);
    while (d <= end && guard++ < 120) {
      items.push({ id: `${b.id}-${d}`, date: d, name: b.name, amountCents: b.amountCents, kind: b.kind });
      d = step(d, b.frequency);
    }
  }
  for (const p of data.plannedExpenses) {
    if (p.done || p.date < today || p.date > end) continue;
    if (perspective !== 'household' && p.scope !== perspective && p.scope !== 'household') continue;
    items.push({ id: p.id, date: p.date, name: p.name, amountCents: p.amountCents, kind: 'planned' });
  }
  const tracked = data.bills.map((b) => (b.matchText ?? b.name).toUpperCase());
  for (const r of detectRecurring(listableTransactions(data))) {
    if (tracked.some((t) => r.key.includes(t) || t.includes(r.key))) continue;
    if (r.nextExpected >= today && r.nextExpected <= end) items.push({ id: `det-${r.key}`, date: r.nextExpected, name: r.label, amountCents: r.averageCents, kind: 'detected' });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function addMonthsSafe(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + m - 1 + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}
