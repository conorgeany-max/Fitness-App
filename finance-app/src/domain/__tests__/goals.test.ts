import { describe, expect, it } from 'vitest';
import { allocateSurplus, goalProgress } from '../goals';
import { planDebts } from '../debt';
import { OWN_ME, OWN_JOINT } from '../ownership';
import { holding } from './fixtures';
import type { Goal } from '../types';

const goal = (p: Partial<Goal>): Goal => ({
  id: 'g', name: 'Deposit', type: 'home-deposit', targetCents: 10000000, targetDate: '2028-10-01', currentCents: 0, linkedHoldingIds: [], monthlyContributionCents: 300000, expectedReturn: 0, priority: 1, scope: 'household', createdAt: '', ...p,
});

describe('goals', () => {
  it('uses linked account balances for progress', () => {
    const sav = holding('savings', 40000, OWN_JOINT, { id: 'sav' });
    const p = goalProgress(goal({ linkedHoldingIds: ['sav'] }), [sav], '2026-10-01');
    expect(p.currentCents).toBe(4000000);
    expect(p.monthsLeft).toBe(24);
    expect(p.requiredMonthlyCents).toBe(250000);
    expect(p.onTrack).toBe(true);
  });

  it('measures debt goals by the reduction from the baseline', () => {
    const loan = holding('car-loan', 15000, OWN_ME, { id: 'car' });
    const p = goalProgress(goal({ type: 'debt-repayment', targetCents: 2000000, baselineCents: 2000000, linkedHoldingIds: ['car'] }), [loan], '2026-10-01');
    expect(p.currentCents).toBe(500000);
  });

  it('does not allocate the same dollar to two goals', () => {
    const a = goalProgress(goal({ id: 'a', name: 'A', priority: 1 }), [], '2026-10-01');
    const b = goalProgress(goal({ id: 'b', name: 'B', priority: 2 }), [], '2026-10-01');
    const r = allocateSurplus([b, a], 500000);
    expect(r.rows[0].goalId).toBe('a');
    expect(r.rows[0].fundedCents + r.rows[1].fundedCents).toBe(500000);
    expect(r.rows[1].shortfallCents).toBeGreaterThan(0);
    expect(r.overcommittedCents).toBe(100000);
  });

  it('warns when one account backs two goals', () => {
    const sav = holding('savings', 1000, OWN_JOINT, { id: 's' });
    const a = goalProgress(goal({ id: 'a', name: 'A', linkedHoldingIds: ['s'] }), [sav], '2026-10-01');
    const b = goalProgress(goal({ id: 'b', name: 'B', linkedHoldingIds: ['s'] }), [sav], '2026-10-01');
    expect(allocateSurplus([a, b], 0).sharedHoldingWarnings).toHaveLength(1);
  });
});

describe('debt planner', () => {
  const debts = [
    { id: 'cc', name: 'Card', balanceCents: 500000, annualRate: 0.2, minimumCents: 15000 },
    { id: 'car', name: 'Car', balanceCents: 1500000, annualRate: 0.08, minimumCents: 35000 },
    { id: 'pl', name: 'Loan', balanceCents: 200000, annualRate: 0.12, minimumCents: 10000 },
  ];
  it('avalanche never pays more interest than snowball', () => {
    const av = planDebts(debts, 50000, 'avalanche');
    const sn = planDebts(debts, 50000, 'snowball');
    expect(av.months).not.toBeNull();
    expect(av.totalInterestCents).toBeLessThanOrEqual(sn.totalInterestCents);
    expect(sn.payoffOrder[0].id).toBe('pl');
    expect(av.payoffOrder[0].id).toBe('cc');
  });
  it('extra payments shorten the plan', () => {
    expect(planDebts(debts, 50000, 'avalanche').months!).toBeLessThan(planDebts(debts, 0, 'minimum').months!);
  });
});
