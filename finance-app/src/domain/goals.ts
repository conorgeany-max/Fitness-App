/**
 * Financial goals: progress, required contributions and competing allocations.
 */
import { requiredMonthlyContribution, monthsToTarget } from './compound';
import { addMonths, diffMonths, type ISODate } from './dates';
import { categoryMeta } from './holdingCategories';
import type { Cents } from './money';
import { amountForPerspective } from './ownership';
import type { Goal, Holding } from './types';

export interface GoalProgress {
  goal: Goal;
  currentCents: Cents;
  basis: 'manual' | 'linked-assets' | 'linked-debt';
  fraction: number;
  remainingCents: Cents;
  monthsLeft: number;
  requiredMonthlyCents: Cents;
  projectedMonths: number | null;
  projectedDate: ISODate | null;
  onTrack: boolean;
  complete: boolean;
}

export function goalProgress(goal: Goal, holdings: Holding[], today: ISODate): GoalProgress {
  const linked = holdings.filter((h) => goal.linkedHoldingIds.includes(h.id) && !h.archived);
  let current = goal.currentCents;
  let basis: GoalProgress['basis'] = 'manual';
  if (linked.length) {
    const assets = linked.filter((h) => categoryMeta(h.category).kind === 'asset');
    const debts = linked.filter((h) => categoryMeta(h.category).kind === 'liability');
    if (debts.length && !assets.length) {
      const owed = debts.reduce((a, h) => a + amountForPerspective(h.valueCents ?? 0, h.ownership, goal.scope), 0);
      current = Math.max(0, (goal.baselineCents ?? owed) - owed);
      basis = 'linked-debt';
    } else {
      current = assets.reduce((a, h) => a + amountForPerspective(h.valueCents ?? 0, h.ownership, goal.scope), 0);
      basis = 'linked-assets';
    }
  }
  const monthsLeft = Math.max(0, diffMonths(today, goal.targetDate));
  const remaining = Math.max(0, goal.targetCents - current);
  const required = requiredMonthlyContribution(goal.targetCents, current, monthsLeft, goal.expectedReturn);
  const projected = monthsToTarget(goal.targetCents, current, goal.monthlyContributionCents, goal.expectedReturn);
  const complete = current >= goal.targetCents;
  return {
    goal,
    currentCents: current,
    basis,
    fraction: goal.targetCents > 0 ? Math.min(1, current / goal.targetCents) : 0,
    remainingCents: remaining,
    monthsLeft,
    requiredMonthlyCents: required,
    projectedMonths: projected,
    projectedDate: projected === null ? null : addMonths(today, projected),
    onTrack: complete || (projected !== null && projected <= monthsLeft),
    complete,
  };
}

export interface AllocationRow {
  goalId: string;
  name: string;
  priority: number;
  requiredCents: Cents;
  plannedCents: Cents;
  fundedCents: Cents;
  shortfallCents: Cents;
}

/**
 * Allocate a monthly surplus across goals in priority order (then by target date).
 * A dollar can only be allocated once: when required contributions exceed the surplus,
 * lower-priority goals are left short.
 */
export function allocateSurplus(progress: GoalProgress[], monthlySurplusCents: Cents): {
  rows: AllocationRow[];
  totalRequiredCents: Cents;
  totalPlannedCents: Cents;
  unallocatedCents: Cents;
  overcommittedCents: Cents;
  sharedHoldingWarnings: string[];
} {
  const active = progress.filter((p) => !p.complete);
  const ordered = [...active].sort((a, b) => a.goal.priority - b.goal.priority || a.goal.targetDate.localeCompare(b.goal.targetDate));
  let left = Math.max(0, monthlySurplusCents);
  const rows: AllocationRow[] = ordered.map((p) => {
    const funded = Math.min(left, p.requiredMonthlyCents);
    left -= funded;
    return {
      goalId: p.goal.id,
      name: p.goal.name,
      priority: p.goal.priority,
      requiredCents: p.requiredMonthlyCents,
      plannedCents: p.goal.monthlyContributionCents,
      fundedCents: funded,
      shortfallCents: p.requiredMonthlyCents - funded,
    };
  });
  const totalRequired = rows.reduce((a, r) => a + r.requiredCents, 0);
  const totalPlanned = rows.reduce((a, r) => a + r.plannedCents, 0);

  // The same savings account linked to two goals would count the same dollars twice.
  const owners = new Map<string, string[]>();
  for (const p of active) for (const id of p.goal.linkedHoldingIds) owners.set(id, [...(owners.get(id) ?? []), p.goal.name]);
  const warnings = [...owners.values()].filter((names) => names.length > 1).map((names) => `${names.join(' and ')} are linked to the same account, so its balance is counted towards both. Split the balance or link separate accounts.`);

  return {
    rows,
    totalRequiredCents: totalRequired,
    totalPlannedCents: totalPlanned,
    unallocatedCents: left,
    overcommittedCents: Math.max(0, totalPlanned - Math.max(0, monthlySurplusCents)),
    sharedHoldingWarnings: warnings,
  };
}

export interface GoalOption {
  label: string;
  monthsToGoal: number | null;
  date: ISODate | null;
  monthlyCents: Cents;
}

/** Compare ways of reaching a goal faster. */
export function goalOptions(p: GoalProgress, today: ISODate, extraMonthlyCents: Cents, investedReturn: number): GoalOption[] {
  const g = p.goal;
  const make = (label: string, monthly: Cents, ret: number): GoalOption => {
    const m = monthsToTarget(g.targetCents, p.currentCents, monthly, ret);
    return { label, monthsToGoal: m, date: m === null ? null : addMonths(today, m), monthlyCents: monthly };
  };
  return [
    make('Current plan', g.monthlyContributionCents, g.expectedReturn),
    make(`Save ${Math.round(extraMonthlyCents / 100)} more a month`, g.monthlyContributionCents + extraMonthlyCents, g.expectedReturn),
    make(`Invest at ${(investedReturn * 100).toFixed(1)}% (not guaranteed)`, g.monthlyContributionCents, investedReturn),
    { label: 'Contribution needed for target date', monthsToGoal: p.monthsLeft, date: g.targetDate, monthlyCents: p.requiredMonthlyCents },
  ];
}
