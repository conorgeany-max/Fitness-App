import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, parseMoney, roundCents, toBaseCurrency, toCents } from '../money';

describe('money', () => {
  it('rounds half away from zero, absorbing float error', () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(1.4999)).toBe(1);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(roundCents(-0)).toBe(0);
  });

  it('allocates so parts always sum to the total', () => {
    for (const total of [1, 99, 100, 101, 33333, -33333, 123456789]) {
      for (const w of [[50, 50], [70, 30], [33.33, 66.67], [1, 2, 3]]) {
        const parts = allocate(total, w);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
    expect(allocate(101, [50, 50])).toEqual([51, 50]);
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });

  it('formats AUD with Australian conventions', () => {
    expect(formatMoney(123456789)).toBe('$1,234,568');
    expect(formatMoney(-1250, { cents: true })).toBe('-$12.50');
    expect(formatMoney(5000, { signed: true })).toBe('+$50');
    expect(formatMoney(null)).toBe('—');
  });

  it('parses user-entered amounts', () => {
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(parseMoney('(45.00)')).toBe(-4500);
    expect(parseMoney('-12')).toBe(-1200);
    expect(parseMoney('850k')).toBe(85000000);
    expect(parseMoney('1.2m')).toBe(120000000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('converts foreign currency only when a rate exists', () => {
    expect(toBaseCurrency(10000, 'USD', { USD: { audPerUnit: 1.5, asOf: '2026-10-01', source: 'manual' } })).toBe(15000);
    expect(toBaseCurrency(10000, 'EUR', {})).toBeNull();
    expect(toBaseCurrency(10000, 'AUD', {})).toBe(10000);
  });
});
