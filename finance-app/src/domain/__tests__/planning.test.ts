import { describe, expect, it } from 'vitest';
import { allocationPlan, collectPositions, normaliseSymbol } from '../allocation';
import { computePayPlan, yearlyBillsMonthly } from '../payPlan';
import type { RecurringBill } from '../types';
import { holding, SETTINGS } from './fixtures';

const funds = (entries: [string, number][]) => new Map(entries.map(([s, dollars]) => [s, { label: s, valueCents: dollars * 100 }]));

describe('investment targets', () => {
  it('matches tickers however the broker writes them', () => {
    expect(normaliseSymbol('ASX:vgs')).toBe('VGS');
    expect(normaliseSymbol('VAS.AX')).toBe('VAS');
  });

  it('works out each gap and points the next buy at the biggest shortfall', () => {
    const r = allocationPlan(funds([['VGS', 4000], ['VAS', 6000]]), [{ symbol: 'VGS', percent: 60 }, { symbol: 'VAS', percent: 40 }], 0);
    expect(r.totalCents).toBe(10_000_00);
    expect(r.rows.find((x) => x.symbol === 'VGS')!.gapCents).toBe(2_000_00);
    expect(r.rows.find((x) => x.symbol === 'VAS')!.gapCents).toBe(-2_000_00);
    expect(r.nextSymbol).toBe('VGS');
  });

  it('splits a contribution to close gaps first, then by target, and never exceeds it', () => {
    const r = allocationPlan(funds([['VGS', 4000], ['VAS', 6000]]), [{ symbol: 'VGS', percent: 60 }, { symbol: 'VAS', percent: 40 }], 5_000_00);
    // After investing, the total is $15,000: VGS should reach $9,000 (needs $5,000), VAS $6,000 (needs $0).
    expect(r.rows.find((x) => x.symbol === 'VGS')!.suggestedCents).toBe(5_000_00);
    expect(r.rows.find((x) => x.symbol === 'VAS')!.suggestedCents).toBe(0);
    const big = allocationPlan(funds([['VGS', 4000], ['VAS', 6000]]), [{ symbol: 'VGS', percent: 60 }, { symbol: 'VAS', percent: 40 }], 10_000_00);
    expect(big.rows.reduce((a, x) => a + x.suggestedCents, 0)).toBe(10_000_00);
  });

  it('lists funds without a target and funds not yet held', () => {
    const r = allocationPlan(funds([['BHP', 1000]]), [{ symbol: 'VGS', percent: 100 }], 0);
    expect(r.rows.find((x) => x.symbol === 'BHP')!.targetShare).toBeNull();
    expect(r.rows.find((x) => x.symbol === 'VGS')!.valueCents).toBe(0);
  });

  it('counts only positions the viewer can see, at their ownership share', () => {
    const joint = holding('shares-au', 1000, { me: 50, partner: 50 }, { positions: [{ symbol: 'VAS', description: 'Vanguard Australian Shares', units: 10, valueCents: 1_000_00, currency: 'AUD' }] });
    const usd = holding('shares-intl', 500, { me: 100, partner: 0 }, { positions: [{ symbol: 'VOO', description: null, units: 1, valueCents: 500_00, currency: 'XYZ' }] });
    const { funds: f, unconverted } = collectPositions([joint, usd], 'me', SETTINGS);
    expect(f.get('VAS')!.valueCents).toBe(500_00);
    expect(unconverted).toEqual(['VOO']);
  });
});

describe('pay plan', () => {
  it('turns monthly amounts and percentages into per-pay transfers', () => {
    const r = computePayPlan(6_500_00, 'fortnightly', {
      lines: [
        { id: 'a', name: 'Savings', mode: 'percent', percent: 20, amountCents: 0, destinationHoldingId: null },
        { id: 'b', name: 'Holidays', mode: 'fixed', percent: 0, amountCents: 260_00, destinationHoldingId: null },
      ],
    });
    expect(r.rows[0].monthlyCents).toBe(1_300_00);
    expect(r.rows[1].perPayCents).toBe(120_00); // $260 a month = $120 a fortnight
    expect(r.leftoverMonthlyCents).toBe(4_940_00);
    expect(r.allocatedShare).toBeCloseTo(0.24);
  });

  it('works out a monthly set-aside for quarterly and yearly bills', () => {
    const bill = (amountCents: number, frequency: RecurringBill['frequency'], scope: RecurringBill['scope'], extra: Partial<RecurringBill> = {}): RecurringBill => ({ id: String(amountCents), name: 'x', amountCents, frequency, nextDate: '2026-11-01', categoryId: null, accountId: null, scope, kind: 'bill', active: true, ...extra });
    const bills = [bill(1_200_00, 'annually', 'me'), bill(300_00, 'quarterly', 'household'), bill(50_00, 'monthly', 'me'), bill(999_00, 'annually', 'partner'), bill(600_00, 'annually', 'me', { active: false })];
    // $100 + half of $100 = $150 a month.
    expect(yearlyBillsMonthly(bills, 'me')).toBe(150_00);
  });
});
