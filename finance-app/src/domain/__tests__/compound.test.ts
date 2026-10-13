import { describe, expect, it } from 'vitest';
import { compound, futureValue, monthsToTarget, requiredMonthlyContribution } from '../compound';

const base = { startingCents: 1000000, contributionCents: 0, contributionFrequency: 'monthly' as const, contributionTiming: 'end' as const, contributionGrowth: 0, annualReturn: 0.05, compounding: 'annually' as const, annualFee: 0, earningsTaxRate: 0, inflation: 0, years: 10 };

describe('compound growth', () => {
  it('lump sum at 5% for 10 years = $16,288.95', () => {
    const r = compound(base);
    expect(Math.abs(r.finalCents - 1628895)).toBeLessThanOrEqual(2);
    expect(futureValue(1000000, 0.05, 10)).toBe(1628895);
    expect(r.totalContributionsCents).toBe(0);
  });

  it('monthly contributions match the annuity future value', () => {
    const r = compound({ ...base, startingCents: 0, contributionCents: 10000, compounding: 'monthly', annualReturn: 0.06 });
    // FV = 100 × ((1.005^120 − 1) / 0.005) = $16,387.93
    expect(Math.abs(r.finalCents - 1638793)).toBeLessThanOrEqual(5);
    expect(r.totalContributionsCents).toBe(1200000);
  });

  it('contributions and returns are not double-counted', () => {
    const zero = compound({ ...base, contributionCents: 50000, annualReturn: 0 });
    expect(zero.finalCents).toBe(1000000 + 50000 * 120);
    expect(zero.totalGrowthCents).toBe(0);
    const r = compound({ ...base, contributionCents: 50000, compounding: 'monthly' });
    expect(r.finalCents).toBe(1000000 + r.totalContributionsCents + r.totalGrowthCents);
  });

  it('supports negative returns, fees, tax and inflation', () => {
    const neg = compound({ ...base, annualReturn: -0.05, compounding: 'monthly' });
    expect(neg.finalCents).toBeLessThan(1000000);
    const fees = compound({ ...base, compounding: 'monthly', annualFee: 0.01 });
    const noFees = compound({ ...base, compounding: 'monthly' });
    expect(fees.finalCents).toBeLessThan(noFees.finalCents);
    const taxed = compound({ ...base, compounding: 'monthly', earningsTaxRate: 0.15 });
    expect(taxed.finalCents).toBeLessThan(noFees.finalCents);
    const real = compound({ ...base, inflation: 0.025 });
    expect(real.finalRealCents).toBeLessThan(real.finalCents);
  });

  it('effective annual compounding reproduces the annual rate exactly over a year', () => {
    const r = compound({ ...base, compounding: 'annually-effective', years: 1 });
    expect(Math.abs(r.finalCents - 1050000)).toBeLessThanOrEqual(1);
  });

  it('runs long horizons', () => {
    const r = compound({ ...base, years: 50, contributionCents: 100000, compounding: 'monthly', contributionGrowth: 0.03 });
    expect(r.years).toHaveLength(51);
    expect(Number.isFinite(r.finalCents)).toBe(true);
  });

  it('solves required contributions and time to target consistently', () => {
    const req = requiredMonthlyContribution(10000000, 1000000, 60, 0.04);
    const months = monthsToTarget(10000000, 1000000, req, 0.04);
    expect(months).toBe(60);
    expect(requiredMonthlyContribution(100, 200, 10, 0)).toBe(0);
  });
});
