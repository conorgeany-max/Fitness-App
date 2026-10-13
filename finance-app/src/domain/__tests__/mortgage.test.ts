import { describe, expect, it } from 'vitest';
import { amortise, annuityPayment, compareRefinance, estimateLmi, scheduledRepayment, toMonthly } from '../mortgage';

const base = { principalCents: 50000000, annualRate: 0.06, termYears: 30, frequency: 'monthly' as const, repaymentType: 'PI' as const, startDate: '2026-11-01' };

describe('mortgage amortisation', () => {
  it('matches the standard annuity repayment ($500k, 6%, 30 years = $2,997.75)', () => {
    expect(annuityPayment(500000, 0.005, 360)).toBeCloseTo(2997.75, 2);
    expect(scheduledRepayment(50000000, 0.06, 30, 'monthly')).toBe(299776); // rounded up to the cent
  });

  it('closes the loan at exactly zero and principal sums to the loan', () => {
    const r = amortise(base);
    const last = r.schedule[r.schedule.length - 1];
    expect(last.closingCents).toBe(0);
    expect(r.totalPrincipalCents).toBe(50000000);
    expect(r.periodsToRepay).toBe(360);
    // Interest + principal = total repaid; interest ≈ $579,191 (independent textbook value)
    expect(r.totalPaidCents).toBe(r.totalInterestCents + r.totalPrincipalCents);
    expect(r.totalInterestCents / 100).toBeGreaterThan(578900);
    expect(r.totalInterestCents / 100).toBeLessThan(579500);
  });

  it('splits each repayment into interest and principal correctly', () => {
    const r = amortise(base);
    expect(r.schedule[0].interestCents).toBe(250000); // 500,000 × 0.5%
    expect(r.schedule[0].principalCents).toBe(299776 - 250000);
    for (const row of r.schedule.slice(0, 50)) expect(row.openingCents - row.principalCents - row.extraCents).toBe(row.closingCents);
  });

  it('offset balances reduce interest and shorten the loan without changing the repayment', () => {
    const withOffset = amortise({ ...base, offsetCents: 5000000 });
    const without = amortise(base);
    expect(withOffset.initialRepaymentCents).toBe(without.initialRepaymentCents);
    expect(withOffset.schedule[0].interestCents).toBe(225000); // (500k − 50k) × 0.5%
    expect(withOffset.totalInterestCents).toBeLessThan(without.totalInterestCents);
    expect(withOffset.periodsToRepay).toBeLessThan(without.periodsToRepay);
  });

  it('extra repayments save interest and time', () => {
    const extra = amortise({ ...base, extraPerPeriodCents: 50000 });
    const without = amortise(base);
    expect(extra.totalInterestCents).toBeLessThan(without.totalInterestCents);
    expect(extra.periodsToRepay).toBeLessThan(300);
  });

  it('higher interest rates increase repayments', () => {
    expect(scheduledRepayment(50000000, 0.08, 30, 'monthly')).toBeGreaterThan(scheduledRepayment(50000000, 0.06, 30, 'monthly'));
    expect(Math.round(annuityPayment(500000, 0.08 / 12, 360) * 100) / 100).toBeCloseTo(3668.82, 2);
  });

  it('interest-only periods then revert to P&I over the remaining term', () => {
    const r = amortise({ ...base, repaymentType: 'IO', interestOnlyYears: 5 });
    expect(r.initialRepaymentCents).toBe(250000);
    expect(r.schedule[59].closingCents).toBe(50000000);
    expect(r.revertRepaymentCents).toBe(Math.ceil(annuityPayment(50000000, 0.005, 300)));
    expect(r.schedule[r.schedule.length - 1].closingCents).toBe(0);
  });

  it('introductory rates recalculate at the revert date', () => {
    const r = amortise({ ...base, intro: { annualRate: 0.05, years: 2 } });
    expect(r.initialRepaymentCents).toBe(scheduledRepayment(50000000, 0.05, 30, 'monthly'));
    expect(r.revertRepaymentCents).toBeGreaterThan(r.initialRepaymentCents);
    expect(r.periodsToRepay).toBe(360);
  });

  it('accelerated fortnightly repayments pay the loan off sooner', () => {
    const r = amortise({ ...base, frequency: 'fortnightly', accelerated: true });
    expect(r.initialRepaymentCents).toBe(Math.ceil(annuityPayment(50000000, 0.005, 360) / 2 - 1e-7));
    expect(r.yearsToRepay).toBeLessThan(26);
    expect(toMonthly(100000, 'fortnightly')).toBe(216667);
  });

  it('handles zero-rate and zero-principal loans', () => {
    expect(amortise({ ...base, annualRate: 0 }).initialRepaymentCents).toBe(Math.ceil(50000000 / 360));
    expect(amortise({ ...base, principalCents: 0 }).schedule).toHaveLength(0);
  });

  it('estimates LMI only above 80% LVR', () => {
    expect(estimateLmi(64000000, 80000000).lmiCents).toBe(0);
    expect(estimateLmi(72000000, 80000000).lmiCents).toBeGreaterThan(0);
  });

  it('refinance comparison reports savings and break-even', () => {
    const r = compareRefinance({ balanceCents: 50000000, remainingYears: 25, currentRate: 0.065, newRate: 0.059, switchingCostsCents: 100000, currentFeesAnnualCents: 0, newFeesAnnualCents: 0 });
    expect(r.monthlySavingCents).toBeGreaterThan(0);
    expect(r.breakEvenMonths).toBeGreaterThan(0);
  });
});
