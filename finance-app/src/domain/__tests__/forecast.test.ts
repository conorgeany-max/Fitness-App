import { describe, expect, it } from 'vitest';
import { PRESET_ASSUMPTIONS, runForecast, sensitivity, type ForecastInput } from '../forecast';
import { EMPTY_INCOME } from '../tax/salary';
import type { Assumptions } from '../types';

const flat: Assumptions = {
  ...PRESET_ASSUMPTIONS.base,
  inflation: 0,
  salaryGrowth: 0,
  investmentReturn: 0,
  investmentFees: 0,
  investmentTaxDrag: 0,
  superReturn: 0,
  cashRate: 0,
  propertyGrowth: 0,
  livingCostGrowth: 0,
  vehicleDepreciation: 0,
};

const me = { ...EMPTY_INCOME, residency: 'resident' as const, salaryCents: 10000000 };
const partner = { ...EMPTY_INCOME, residency: 'resident' as const, salaryCents: 8000000 };

function input(patch: Partial<ForecastInput> = {}): ForecastInput {
  return {
    startMonth: '2026-11',
    months: 120,
    people: { me, partner },
    opening: { cashCents: 2000000, investmentsCents: 0, superCents: { me: 0, partner: 0 }, propertyCents: 0, otherAssetsCents: 0, loans: [], helpDebtCents: { me: 0, partner: 0 }, otherLiabilitiesCents: 0 },
    assumptions: flat,
    events: [],
    livingCostsMonthlyCents: 600000,
    ...patch,
  };
}

describe('cash-flow forecast', () => {
  it('net worth grows by exactly net income minus spending plus super when returns are zero', () => {
    const r = runForecast(input({ months: 12 }));
    const p = r.points[11];
    const netIncome = r.points.reduce((a, x) => a + x.netIncomeCents, 0);
    const spend = r.points.reduce((a, x) => a + x.livingCostsCents, 0);
    const superIn = p.superCents;
    expect(p.netWorthCents).toBe(2000000 + netIncome - spend + superIn);
  });

  it('investing the surplus does not change net worth when returns are zero (no double counting)', () => {
    const invest = runForecast(input({ assumptions: { ...flat, surplusInvestShare: 1 } }));
    const cash = runForecast(input({ assumptions: { ...flat, surplusInvestShare: 0 } }));
    expect(invest.points[119].netWorthCents).toBe(cash.points[119].netWorthCents);
    expect(invest.points[119].investmentsCents).toBeGreaterThan(0);
  });

  it('employer super never becomes spendable cash', () => {
    const r = runForecast(input({ months: 1 }));
    expect(r.points[0].netIncomeCents).toBeLessThan(Math.round(18000000 / 12));
    expect(r.points[0].superCents).toBe(Math.round(Math.round(1200000 / 12) * 0.85) + Math.round(Math.round(960000 / 12) * 0.85));
  });

  it('income changes propagate into future cash flow', () => {
    const base = runForecast(input());
    const promo = runForecast(input({ events: [{ id: 'e', type: 'salary-change', person: 'me', date: '2027-07-01', mode: 'set', value: 15000000 }] }));
    expect(promo.points[0].netIncomeCents).toBe(base.points[0].netIncomeCents);
    const julyIdx = promo.points.findIndex((p) => p.month === '2027-07');
    expect(promo.points[julyIdx].netIncomeCents).toBeGreaterThan(base.points[julyIdx].netIncomeCents);
    expect(promo.points[119].netWorthCents).toBeGreaterThan(base.points[119].netWorthCents);
  });

  it('parental leave reduces income during leave and restores it after', () => {
    const r = runForecast(input({
      events: [{ id: 'pl', type: 'parental-leave', person: 'partner', start: '2027-03-01', totalWeeks: 52, employerPaidWeeks: 12, govPaidWeeks: 24, govWeeklyCents: 94860, returnFte: 0.6 }],
    }));
    const base = runForecast(input());
    const idx = (m: string) => r.points.findIndex((p) => p.month === m);
    expect(r.points[idx('2027-04')].netIncomeCents).toBe(base.points[idx('2027-04')].netIncomeCents); // employer-paid
    expect(r.points[idx('2027-08')].netIncomeCents).toBeLessThan(base.points[idx('2027-08')].netIncomeCents); // government pay
    expect(r.points[idx('2028-06')].netIncomeCents).toBeLessThan(base.points[idx('2028-06')].netIncomeCents); // part-time return
    expect(r.points[idx('2028-06')].netIncomeCents).toBeGreaterThan(r.points[idx('2027-12')].netIncomeCents);
  });

  it('records shortfalls when spending exceeds income and savings', () => {
    const r = runForecast(input({ livingCostsMonthlyCents: 2500000 }));
    expect(r.shortfallMonths).toBeGreaterThan(0);
    expect(r.firstShortfall).not.toBeNull();
  });

  it('mortgages amortise and a higher rate reduces net worth', () => {
    const loan = { id: 'l', name: 'Home loan', balanceCents: 50000000, annualRate: 0.06, monthlyRepaymentCents: 0, remainingYears: 30, kind: 'mortgage' as const };
    const withLoan = input({ opening: { ...input().opening, propertyCents: 80000000, loans: [loan] } });
    const r = runForecast(withLoan);
    expect(r.points[119].loansCents).toBeLessThan(50000000);
    const high = runForecast({ ...withLoan, assumptions: { ...flat, mortgageRateDelta: 0.02 } });
    expect(high.points[119].netWorthCents).toBeLessThan(r.points[119].netWorthCents);
  });

  it('runs a 30-year horizon and reports inflation-adjusted values', () => {
    const r = runForecast(input({ months: 360, assumptions: PRESET_ASSUMPTIONS.base }));
    expect(r.points).toHaveLength(360);
    expect(r.horizons.map((h) => h.years)).toEqual([1, 5, 10, 20, 30]);
    const last = r.points[359];
    expect(last.realNetWorthCents).toBeLessThan(last.netWorthCents);
    expect(r.warnings.join(' ')).toMatch(/carried forward/);
  });

  it('sensitivity analysis ranks drivers', () => {
    const s = sensitivity(input({ assumptions: PRESET_ASSUMPTIONS.base }), 10);
    expect(s.rows.length).toBeGreaterThan(3);
    const salary = s.rows.find((x) => x.label === 'Salary growth')!;
    expect(salary.highCents).toBeGreaterThan(salary.lowCents);
  });
});
