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

  it('states without a ruleset are reported as unsupported', () => {
    const r = estimateStampDuty({ state: 'WA', priceCents: 60000000, ownerOccupier: true, firstHomeBuyer: false });
    expect(r.supported).toBe(false);
    expect(r.status).toBe('unsupported');
  });
});
