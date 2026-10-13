import { describe, expect, it } from 'vitest';
import { leaveGap, monthsCovered, rentVsBuy } from '../tools';

const base = {
  priceCents: 800_000_00,
  depositCents: 160_000_00,
  buyingCostsCents: 45_000_00,
  rate: 0.06,
  termYears: 30,
  ownerCostsAnnualCents: 8_000_00,
  rentWeeklyCents: 600_00,
  rentGrowth: 0.03,
  propertyGrowth: 0.04,
  investmentReturn: 0.06,
  inflation: 0.025,
  sellingCostRate: 0.025,
  years: 30,
};

describe('rent vs buy', () => {
  it('gives the renter the deposit and costs to invest at the start', () => {
    const r = rentVsBuy({ ...base, years: 1 });
    // After one year the renter has the starting capital plus returns and the cost difference invested.
    expect(r.years[0].renterWealthCents).toBeGreaterThan(205_000_00);
  });

  it('favours buying when property growth is much higher, and renting when it is zero', () => {
    const high = rentVsBuy({ ...base, propertyGrowth: 0.07 });
    const none = rentVsBuy({ ...base, propertyGrowth: 0 });
    const last = (x: ReturnType<typeof rentVsBuy>) => x.years[x.years.length - 1];
    expect(last(high).buyerWealthCents).toBeGreaterThan(last(high).renterWealthCents);
    expect(last(none).buyerWealthCents).toBeLessThan(last(none).renterWealthCents);
  });

  it('pays the loan off by the end of the term', () => {
    const r = rentVsBuy({ ...base, propertyGrowth: 0, sellingCostRate: 0, rentWeeklyCents: 0, ownerCostsAnnualCents: 0, investmentReturn: 0 });
    // Buyer wealth = full property value with no loan left, and no investments when rent is zero.
    expect(r.years[29].buyerWealthCents).toBe(800_000_00);
  });
});

describe('leave gap', () => {
  it('counts employer, government and unpaid weeks and the other partner’s income', () => {
    const g = leaveGap({
      normalTakeHomeMonthlyCents: 13_000_00,
      personTakeHomeMonthlyCents: 5_200_00,
      totalWeeks: 52,
      employerPaidWeeks: 12,
      employerPayFraction: 1,
      govPaidWeeks: 24,
      govWeeklyAfterTaxCents: 800_00,
      monthlySpendingCents: 9_000_00,
    });
    expect(g.employerWeeks).toBe(12);
    expect(g.govWeeks).toBe(24);
    expect(g.unpaidWeeks).toBe(16);
    const weekly = (5_200_00 * 12) / 52;
    const other = (7_800_00 * 12) / 52;
    expect(g.incomeDuringCents).toBe(Math.round(12 * weekly + 24 * 800_00 + 52 * other));
    expect(g.spendingCents).toBe(9_000_00 * 12);
    expect(g.savingsNeededCents).toBe(Math.max(0, g.spendingCents - g.incomeDuringCents));
  });

  it('caps paid weeks at the total leave', () => {
    const g = leaveGap({ normalTakeHomeMonthlyCents: 10_000_00, personTakeHomeMonthlyCents: 5_000_00, totalWeeks: 10, employerPaidWeeks: 14, employerPayFraction: 1, govPaidWeeks: 20, govWeeklyAfterTaxCents: 800_00, monthlySpendingCents: 0 });
    expect(g.employerWeeks).toBe(10);
    expect(g.govWeeks).toBe(0);
    expect(g.unpaidWeeks).toBe(0);
  });
});

describe('months covered', () => {
  it('divides savings by monthly outgoings', () => {
    expect(monthsCovered(30_000_00, 5_000_00)).toBe(6);
    expect(monthsCovered(1, 0)).toBeNull();
  });
});
