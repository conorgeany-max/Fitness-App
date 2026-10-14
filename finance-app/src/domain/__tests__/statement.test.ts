import { describe, expect, it } from 'vitest';
import { findBalanceCandidates, findDate, findFundName, findStatementDate } from '../statement';

const STATEMENT = `
AustralianSuper   Member statement for the period 1 July 2025 to 30 June 2026
Opening balance at 1 July 2025 $84,210.15
Employer contributions $11,906.40   Contributions tax -$1,785.96
Insurance premiums -$412.00   Administration fees -$187.20
Investment returns $7,402.33
Closing balance at 30 June 2026 $101,133.72
Your account balance as at 30 June 2026 $101,133.72
`;

describe('super statement reader', () => {
  it('finds the closing balance, not the opening balance or fees', () => {
    const c = findBalanceCandidates(STATEMENT);
    expect(c[0]).toMatchObject({ valueCents: 101_133_72, label: 'Closing balance', date: '2026-06-30' });
    expect(c.map((x) => x.valueCents)).not.toContain(84_210_15);
    expect(c.map((x) => x.valueCents)).not.toContain(412_00);
  });

  it('returns nothing rather than guessing when no balance is labelled', () => {
    expect(findBalanceCandidates('Investment returns $7,402.33 Fees $187.20')).toEqual([]);
  });

  it('reads dates, the statement date and the fund', () => {
    expect(findDate('as at 30 June 2026')).toBe('2026-06-30');
    expect(findDate('31/12/2025')).toBe('2025-12-31');
    expect(findDate('31/02/2025')).toBeNull();
    expect(findStatementDate(STATEMENT)).toBe('2026-06-30');
    expect(findFundName(STATEMENT)).toBe('AustralianSuper');
  });
});
