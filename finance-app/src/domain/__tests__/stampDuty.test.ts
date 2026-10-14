import { describe, expect, it } from 'vitest';
import { estimateStampDuty, vicGeneralDuty, vicPprDuty } from '../property/stampDuty';

const vic = (price: number, opts: Partial<{ ownerOccupier: boolean; firstHomeBuyer: boolean }> = {}) =>
  estimateStampDuty({ state: 'VIC', priceCents: price * 100, ownerOccupier: false, firstHomeBuyer: false, ...opts });

describe('stamp duty', () => {
  it('VIC general rates', () => {
    expect(vicGeneralDuty(20000)).toBeCloseTo(280, 6);
    expect(vicGeneralDuty(100000)).toBeCloseTo(2150, 6);
    expect(vic(800000).dutyCents).toBe(4307000);
    expect(vicGeneralDuty(1000000)).toBeCloseTo(55000, 6);
    expect(vicGeneralDuty(2500000)).toBeCloseTo(142500, 6);
  });

  it('VIC principal place of residence concession', () => {
    expect(vicPprDuty(500000)).toBeCloseTo(21970, 6);
    expect(vic(500000, { ownerOccupier: true }).dutyCents).toBe(2197000);
    expect(vic(700000, { ownerOccupier: true }).dutyCents).toBe(vic(700000).dutyCents);
  });

  it('VIC first home buyer exemption and sliding concession', () => {
    expect(vic(600000, { ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBe(0);
    expect(vic(675000, { ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBe(1778500);
    expect(vic(750000, { ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBe(vic(750000).dutyCents);
    // Investors are not eligible.
    expect(vic(500000, { firstHomeBuyer: true }).dutyCents).toBe(vic(500000).dutyCents);
  });

  it('NSW uses its own scale, not Victorian rates', () => {
    const r = estimateStampDuty({ state: 'NSW', priceCents: 90000000, ownerOccupier: true, firstHomeBuyer: false });
    expect(r.dutyCents).toBe(3468700);
    expect(r.dutyCents).not.toBe(vic(900000).dutyCents);
    expect(estimateStampDuty({ state: 'NSW', priceCents: 75000000, ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBe(0);
  });

  it('QLD home concession', () => {
    const r = estimateStampDuty({ state: 'QLD', priceCents: 70000000, ownerOccupier: true, firstHomeBuyer: false });
    expect(r.dutyCents).toBe(1735000);
    expect(estimateStampDuty({ state: 'QLD', priceCents: 70000000, ownerOccupier: false, firstHomeBuyer: false }).dutyCents).toBe(2452500);
  });

  it('other states use their own published scales', () => {
    const at = (state: 'SA' | 'WA' | 'TAS' | 'NT', price: number) => estimateStampDuty({ state, priceCents: price * 100, ownerOccupier: true, firstHomeBuyer: false }).dutyCents / 100;
    expect(at('SA', 500000)).toBe(21330);
    expect(at('WA', 500000)).toBe(17765);
    expect(at('TAS', 500000)).toBe(18248);
    expect(at('NT', 500000)).toBe(23929);
    // NT switches from the formula to a flat 4.95% at $525,000 with no jump.
    expect(Math.abs(at('NT', 525000) - at('NT', 525100))).toBeLessThan(10);
  });

  it('ACT: investor and owner-occupier scales, home buyer concession, and no estimate above $1m', () => {
    expect(estimateStampDuty({ state: 'ACT', priceCents: 58000000, ownerOccupier: false, firstHomeBuyer: false }).dutyCents).toBe(1485600);
    expect(estimateStampDuty({ state: 'ACT', priceCents: 58000000, ownerOccupier: true, firstHomeBuyer: false }).dutyCents).toBe(1186400);
    expect(estimateStampDuty({ state: 'ACT', priceCents: 90000000, ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBe(0);
    expect(estimateStampDuty({ state: 'ACT', priceCents: 120000000, ownerOccupier: true, firstHomeBuyer: false }).supported).toBe(false);
  });

  it('SA exempts first home buyers of new homes only', () => {
    expect(estimateStampDuty({ state: 'SA', priceCents: 60000000, ownerOccupier: true, firstHomeBuyer: true, newHome: true }).dutyCents).toBe(0);
    expect(estimateStampDuty({ state: 'SA', priceCents: 60000000, ownerOccupier: true, firstHomeBuyer: true }).dutyCents).toBeGreaterThan(0);
  });
});
