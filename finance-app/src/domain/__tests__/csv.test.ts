import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, parseCsv, toCsv } from '../csv';
import { parseLooseDate } from '../dates';

describe('CSV import', () => {
  it('parses quoted fields and CRLF', () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\r\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
  });

  it('guesses mapping for a headed debit/credit statement', () => {
    const rows = parseCsv('Date,Description,Debit,Credit,Balance\n13/10/2026,WOOLWORTHS,42.50,,1000\n14/10/2026,SALARY,,3000.00,4000');
    const m = guessMapping(rows);
    expect(m.hasHeader).toBe(true);
    const parsed = applyMapping(rows, m);
    expect(parsed[0]).toMatchObject({ date: '2026-10-13', description: 'WOOLWORTHS', amountCents: -4250 });
    expect(parsed[1].amountCents).toBe(300000);
  });

  it('guesses mapping for a headerless signed-amount statement', () => {
    const rows = parseCsv('01/09/2026,-12.50,"CAFE NERO MELBOURNE",+1000.00\n02/09/2026,+2500.00,"PAYROLL ACME",+3500.00');
    const parsed = applyMapping(rows, guessMapping(rows));
    expect(parsed[0]).toMatchObject({ date: '2026-09-01', amountCents: -1250, description: 'CAFE NERO MELBOURNE' });
  });

  it('reports rows it cannot parse instead of guessing', () => {
    const rows = parseCsv('Date,Description,Amount\nnot a date,X,1.00\n01/01/2026,Y,abc');
    const parsed = applyMapping(rows, guessMapping(rows));
    expect(parsed[0].error).toMatch(/date/);
    expect(parsed[1].error).toMatch(/amount/);
  });

  it('uses Australian day-first dates', () => {
    expect(parseLooseDate('03/04/2026')).toBe('2026-04-03');
    expect(parseLooseDate('31/02/2026')).toBeNull();
    expect(parseLooseDate('5 Oct 2026')).toBe('2026-10-05');
  });

  it('exports CSV safely', () => {
    expect(toCsv([['=cmd()', 'a,b', -5]])).toBe(`'=cmd(),"a,b",-5`);
  });
});
