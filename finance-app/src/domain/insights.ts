/**
 * Insights engine. Every insight is produced by a deterministic rule over the user's own
 * data and carries the evidence and method used, so it can be inspected, dismissed or
 * corrected. No language model is involved.
 */
import { formatMoney, formatPercent, type Cents } from './money';
import type { BudgetReport } from './budget';
import type { GoalProgress } from './goals';
import type { BalanceSheet } from './networth';
import type { CashFlowSummary, RecurringCandidate } from './transactions';
import type { Category, Holding, PersonId, RecurringBill, Transaction } from './types';
import { annuityPayment } from './mortgage';
import { isMortgage } from './holdingCategories';
import { formatDate, type ISODate } from './dates';

export type InsightSeverity = 'positive' | 'info' | 'warning';

export interface Insight {
  id: string;
  title: string;
  detail: string;
  severity: InsightSeverity;
  evidence: { label: string; value: string }[];
  method: string;
  link?: { label: string; to: string };
}

export interface InsightContext {
  today: ISODate;
  names: Record<PersonId, string>;
  balance: BalanceSheet;
  /** Liquid assets roughly 30+ days ago, from history. */
  previousLiquid: { cents: Cents; date: ISODate; kind: 'recorded' | 'reconstructed' } | null;
  currentMonth: CashFlowSummary;
  monthProgress: number;
  averageByCategory: Map<string, Cents>; // average monthly spend (positive) over prior months
  monthsOfHistory: number;
  categories: Category[];
  recurring: RecurringCandidate[];
  bills: RecurringBill[];
  takeHomeMonthly: Record<PersonId, Cents>;
  essentialMonthlyCents: Cents;
  averageSurplusMonthlyCents: Cents | null;
  holdings: Holding[];
  goals: GoalProgress[];
  unusual: Transaction[];
  uncategorisedCount: number;
  budget: BudgetReport | null;
}

export function generateInsights(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const catName = new Map(ctx.categories.map((c) => [c.id, c.name]));
  const monthId = ctx.today.slice(0, 7);

  // 1. Category spending above recent average (projected for the month).
  if (ctx.monthsOfHistory >= 2 && ctx.monthProgress >= 0.25) {
    for (const [catId, avg] of ctx.averageByCategory) {
      const cat = ctx.categories.find((c) => c.id === catId);
      if (!cat || cat.treatment !== 'expense' || cat.fixed || avg < 10000) continue;
      const actual = -(ctx.currentMonth.byCategory.get(catId) ?? 0);
      const projected = Math.round(actual / ctx.monthProgress);
      if (projected > avg * 1.2 && projected - avg > 5000) {
        out.push({
          id: `cat-high-${catId}-${monthId}`,
          title: `${cat.name} spending is running above your recent average`,
          detail: `At the current pace, ${cat.name.toLowerCase()} will reach about ${formatMoney(projected)} this month, compared with an average of ${formatMoney(avg)}.`,
          severity: 'warning',
          evidence: [
            { label: 'Spent so far this month', value: formatMoney(actual) },
            { label: 'Month elapsed', value: formatPercent(ctx.monthProgress, 0) },
            { label: 'Projected', value: formatMoney(projected) },
            { label: `Average (last ${ctx.monthsOfHistory} months)`, value: formatMoney(avg) },
          ],
          method: 'Projected = spent so far ÷ fraction of month elapsed. Flagged when 20% and $50 above the average of previous complete months.',
          link: { label: 'View transactions', to: `/transactions?category=${catId}` },
        });
      }
    }
  }

  // 2. Cash savings change.
  if (ctx.previousLiquid) {
    const delta = ctx.balance.liquidCents - ctx.previousLiquid.cents;
    if (Math.abs(delta) >= 10000) {
      out.push({
        id: `cash-change-${monthId}`,
        title: delta >= 0 ? `Cash savings are up ${formatMoney(delta)}` : `Cash savings are down ${formatMoney(-delta)}`,
        detail: `Liquid assets moved from ${formatMoney(ctx.previousLiquid.cents)} on ${formatDate(ctx.previousLiquid.date)} to ${formatMoney(ctx.balance.liquidCents)} now.`,
        severity: delta >= 0 ? 'positive' : 'info',
        evidence: [
          { label: 'Earlier', value: `${formatMoney(ctx.previousLiquid.cents)} (${ctx.previousLiquid.kind})` },
          { label: 'Now', value: formatMoney(ctx.balance.liquidCents) },
        ],
        method: 'Compares the sum of cash, savings, offset and term deposit balances with the earlier history point.',
        link: { label: 'Net worth history', to: '/net-worth' },
      });
    }
  }

  // 3. Recurring payments not yet tracked as bills.
  const tracked = ctx.bills.map((b) => (b.matchText ?? b.name).toUpperCase());
  for (const r of ctx.recurring.slice(0, 6)) {
    if (tracked.some((t) => r.key.includes(t) || t.includes(r.key))) continue;
    out.push({
      id: `recurring-${r.key}`,
      title: `${r.label} looks like a ${r.frequency} payment`,
      detail: `${r.occurrences} payments averaging ${formatMoney(r.averageCents, { cents: true })}. Next expected around ${formatDate(r.nextExpected)}.`,
      severity: 'info',
      evidence: [
        { label: 'Occurrences', value: String(r.occurrences) },
        { label: 'Average amount', value: formatMoney(r.averageCents, { cents: true }) },
        { label: 'Last paid', value: formatDate(r.lastDate) },
      ],
      method: 'Same merchant, at least 3 payments at a regular interval (±tolerance) with amounts within 15% of the average.',
      link: { label: 'Review bills', to: '/transactions?tab=bills' },
    });
  }

  // 4. Mortgage rate sensitivity.
  const mortgages = ctx.holdings.filter((h) => !h.archived && isMortgage(h.category) && (h.valueCents ?? 0) > 0 && h.loan?.annualRate);
  if (mortgages.length) {
    let extra = 0;
    for (const m of mortgages) {
      const bal = m.valueCents ?? 0;
      const rate = m.loan!.annualRate!;
      const years = m.loan?.maturityDate ? Math.max(1, (Date.parse(m.loan.maturityDate) - Date.parse(ctx.today)) / (365.25 * 864e5)) : 25;
      extra += annuityPayment(bal, (rate + 0.01) / 12, years * 12) - annuityPayment(bal, rate / 12, years * 12);
    }
    const extraC = Math.round(extra);
    const surplus = ctx.averageSurplusMonthlyCents;
    out.push({
      id: 'mortgage-rate-1pc',
      title: `A 1% rate rise would add about ${formatMoney(extraC)} a month to mortgage repayments`,
      detail:
        surplus !== null
          ? surplus > 0
            ? `That is ${formatPercent(extraC / surplus, 0)} of your recent average monthly surplus of ${formatMoney(surplus)}.`
            : `Your recent months show no surplus to absorb it.`
          : 'Import a few months of transactions to compare this with your surplus.',
      severity: surplus !== null && surplus > 0 && extraC / surplus < 0.25 ? 'info' : 'warning',
      evidence: mortgages.map((m) => ({ label: m.name, value: `${formatMoney(m.valueCents)} at ${formatPercent(m.loan!.annualRate!, 2)}` })),
      method: 'Difference between P&I repayments at the current rate and the rate + 1%, over the remaining term (25 years if no maturity date is recorded).',
      link: { label: 'Mortgage calculator', to: '/property?tab=mortgage' },
    });
  }

  // 5. Deposit goal sooner.
  for (const g of ctx.goals) {
    if (g.goal.type !== 'home-deposit' || g.complete || g.goal.monthlyContributionCents <= 0) continue;
    const boosted = g.goal.monthlyContributionCents + 50000;
    let bal = g.currentCents;
    let m = 0;
    while (bal < g.goal.targetCents && m < 1200) {
      bal = bal * (1 + g.goal.expectedReturn / 12) + boosted;
      m++;
    }
    if (g.projectedMonths !== null && m < g.projectedMonths) {
      out.push({
        id: `goal-faster-${g.goal.id}`,
        title: `Saving $500 more a month would reach "${g.goal.name}" ${g.projectedMonths - m} months sooner`,
        detail: `At ${formatMoney(g.goal.monthlyContributionCents)} a month you reach ${formatMoney(g.goal.targetCents)} in ${g.projectedMonths} months; at ${formatMoney(boosted)} it takes ${m} months.`,
        severity: 'info',
        evidence: [
          { label: 'Current progress', value: formatMoney(g.currentCents) },
          { label: 'Assumed return', value: formatPercent(g.goal.expectedReturn) },
        ],
        method: 'Monthly compounding at the goal’s assumed return with contributions at month end.',
        link: { label: 'Goals', to: '/tools?tab=goals' },
      });
    }
  }

  // 6. Income share.
  const thMe = ctx.takeHomeMonthly.me;
  const thPartner = ctx.takeHomeMonthly.partner;
  if (thMe > 0 && thPartner > 0) {
    const total = thMe + thPartner;
    const bigger: PersonId = thMe >= thPartner ? 'me' : 'partner';
    const share = ctx.takeHomeMonthly[bigger] / total;
    out.push({
      id: 'income-share',
      title: `${ctx.names[bigger]} contributes ${formatPercent(share, 0)} of household take-home pay`,
      detail: `Estimated take-home: ${ctx.names.me} ${formatMoney(thMe)}/month, ${ctx.names.partner} ${formatMoney(thPartner)}/month. This matters for single-income stress tests and parental leave planning.`,
      severity: 'info',
      evidence: [
        { label: ctx.names.me, value: formatMoney(thMe) },
        { label: ctx.names.partner, value: formatMoney(thPartner) },
      ],
      method: 'Estimated after-tax pay from each income profile using the current financial year’s tax ruleset.',
      link: { label: 'Income & tax', to: '/forecasts?tab=income' },
    });
  }

  // 7. Emergency buffer.
  if (ctx.essentialMonthlyCents > 0) {
    const months = ctx.balance.liquidCents / ctx.essentialMonthlyCents;
    out.push({
      id: 'emergency-buffer',
      title: `Liquid savings cover about ${months.toFixed(1)} months of essential expenses`,
      detail: `${formatMoney(ctx.balance.liquidCents)} in cash and deposits against essential spending of about ${formatMoney(ctx.essentialMonthlyCents)} a month.`,
      severity: months >= 6 ? 'positive' : months >= 3 ? 'info' : 'warning',
      evidence: [
        { label: 'Liquid assets', value: formatMoney(ctx.balance.liquidCents) },
        { label: 'Essential spending / month', value: formatMoney(ctx.essentialMonthlyCents) },
      ],
      method: 'Liquid assets ÷ average essential spending (essential categories plus loan repayments) over recent complete months.',
      link: { label: 'Emergency fund calculator', to: '/tools?tool=emergency' },
    });
  }

  // 8. Stale data.
  if (ctx.balance.staleCount > 0 || ctx.balance.missingCount > 0) {
    out.push({
      id: `stale-${monthId}-${ctx.balance.staleCount}-${ctx.balance.missingCount}`,
      title: `${ctx.balance.staleCount + ctx.balance.missingCount} balance${ctx.balance.staleCount + ctx.balance.missingCount === 1 ? '' : 's'} need updating`,
      detail: 'Stale or missing balances are still shown, but net worth may not reflect your current position.',
      severity: 'warning',
      evidence: [
        { label: 'Stale', value: String(ctx.balance.staleCount) },
        { label: 'Missing value or FX rate', value: String(ctx.balance.missingCount) },
      ],
      method: 'A balance is stale when it is older than the threshold for its source (Settings → Data freshness).',
      link: { label: 'Update balances', to: '/net-worth' },
    });
  }

  // 9. Uncategorised.
  if (ctx.uncategorisedCount > 0) {
    out.push({
      id: `uncat-${ctx.uncategorisedCount}`,
      title: `${ctx.uncategorisedCount} transaction${ctx.uncategorisedCount === 1 ? '' : 's'} need a category`,
      detail: 'Uncategorised spending is counted as discretionary until you review it.',
      severity: 'info',
      evidence: [{ label: 'Uncategorised', value: String(ctx.uncategorisedCount) }],
      method: 'Transactions with no category and no transfer status.',
      link: { label: 'Review', to: '/transactions?filter=uncategorised' },
    });
  }

  // 10. Budget overspend.
  if (ctx.budget) {
    for (const r of ctx.budget.rows.filter((x) => x.status === 'over' || x.status === 'at-risk').slice(0, 3)) {
      out.push({
        id: `budget-${r.category.id}-${monthId}`,
        title: r.status === 'over' ? `${r.category.name} is over budget` : `${r.category.name} is on track to exceed its budget`,
        detail: `${formatMoney(r.actualCents)} spent of ${formatMoney(r.availableCents)} available; projected ${formatMoney(r.projectedCents)} by month end.`,
        severity: 'warning',
        evidence: [
          { label: 'Budget', value: formatMoney(r.budgetCents) },
          { label: 'Rollover', value: formatMoney(r.rolloverCents) },
          { label: 'Spent', value: formatMoney(r.actualCents) },
        ],
        method: 'Projection: fixed categories use max(actual, budget); variable categories scale actual by the fraction of the month elapsed.',
        link: { label: 'Budget', to: '/transactions?tab=budget' },
      });
    }
  }

  // 11. Unusual transactions.
  for (const t of ctx.unusual.slice(0, 3)) {
    out.push({
      id: `unusual-${t.id}`,
      title: `Unusually large ${catName.get(t.categoryId ?? '')?.toLowerCase() ?? ''} transaction`,
      detail: `${t.description} — ${formatMoney(-t.amountCents, { cents: true })} on ${formatDate(t.date)}.`,
      severity: 'info',
      evidence: [{ label: 'Amount', value: formatMoney(-t.amountCents, { cents: true }) }],
      method: 'More than 3× the median for its category (with at least 5 prior transactions) and over $100.',
      link: { label: 'View', to: `/transactions?q=${encodeURIComponent(t.description.slice(0, 20))}` },
    });
  }

  // 12. High-interest debt.
  const cards = ctx.holdings.filter((h) => !h.archived && (h.category === 'credit-card' || h.category === 'bnpl' || h.category === 'personal-loan') && (h.valueCents ?? 0) > 0);
  const costly = cards.filter((h) => (h.loan?.annualRate ?? 0) >= 0.12);
  if (costly.length) {
    const total = costly.reduce((a, h) => a + (h.valueCents ?? 0), 0);
    const interest = Math.round(costly.reduce((a, h) => a + ((h.valueCents ?? 0) * (h.loan?.annualRate ?? 0)) / 12, 0));
    out.push({
      id: `high-interest-${total}`,
      title: `${formatMoney(total)} of high-interest debt costs about ${formatMoney(interest)} a month`,
      detail: 'Repaying debts above 12% p.a. is a guaranteed return equal to the interest rate. Compare strategies in the debt planner.',
      severity: 'warning',
      evidence: costly.map((h) => ({ label: h.name, value: `${formatMoney(h.valueCents)} at ${formatPercent(h.loan?.annualRate ?? 0)}` })),
      method: 'Balance × annual rate ÷ 12 for each card or loan with a recorded rate of 12% or more.',
      link: { label: 'Debt planner', to: '/tools?tool=debt' },
    });
  }

  return out;
}
