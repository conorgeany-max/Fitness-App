import { describe, expect, it } from 'vitest';
import { calculateTax, helpRepayment, lowIncomeTaxOffset } from '../tax/tax';
import { rulesetForFinancialYear, rulesetById } from '../tax/rulesets';
import { baseFromPackage, calculateTakeHome, EMPTY_INCOME } from '../tax/salary';

const fy25 = rulesetById('AU-2025-26')!;
const fy26 = rulesetById('AU-2026-27')!;

describe('income tax (cross-checked against hand calculations of ATO rate tables)', () => {
  it('2025-26: $100,000 resident', () => {
    const r = calculateTax({ taxableIncome: 100000, resident: true, hasHelpDebt: false }, fy25);
    // 16% × (45,000 − 18,200) + 30% × (100,000 − 45,000) = 4,288 + 16,500
    expect(r.incomeTax).toBe(20788);
    expect(r.lito).toBe(0);
    expect(r.medicareLevy).toBe(2000);
    expect(r.totalTax).toBe(22788);
  });

  it('2026-27 uses the 15% rate', () => {
    const r = calculateTax({ taxableIncome: 100000, resident: true, hasHelpDebt: false }, fy26);
    expect(r.incomeTax).toBe(20520);
  });

  it('applies LITO and Medicare shade-in for low incomes', () => {
    expect(lowIncomeTaxOffset(30000, fy25)).toBe(700);
    expect(lowIncomeTaxOffset(40000, fy25)).toBe(575);
    expect(lowIncomeTaxOffset(50000, fy25)).toBe(250);
    expect(lowIncomeTaxOffset(70000, fy25)).toBe(0);
    const r = calculateTax({ taxableIncome: 30000, resident: true, hasHelpDebt: false }, fy25);
    expect(r.incomeTax).toBe(1888);
    expect(r.incomeTaxAfterOffsets).toBe(1188);
    expect(r.medicareLevy).toBeCloseTo((30000 - 28011) * 0.1, 2);
    expect(calculateTax({ taxableIncome: 18000, resident: true, hasHelpDebt: false }, fy25).totalTax).toBe(0);
  });

  it('foreign residents: no tax-free threshold, LITO or Medicare levy', () => {
    const r = calculateTax({ taxableIncome: 50000, resident: false, hasHelpDebt: false }, fy25);
    expect(r.totalTax).toBe(15000);
  });

  it('HELP uses the marginal repayment system', () => {
    expect(helpRepayment(60000, fy25.help)).toBe(0);
    expect(helpRepayment(100000, fy25.help)).toBe(4950);
    expect(helpRepayment(100000, fy26.help)).toBeCloseTo(4570.8, 2);
    expect(helpRepayment(150000, fy26.help)).toBeCloseTo(9028.35 + (150000 - 129717) * 0.17, 2);
    expect(helpRepayment(200000, fy26.help)).toBe(20000);
  });

  it('selects the versioned ruleset by financial year and flags fallbacks', () => {
    expect(rulesetForFinancialYear('2026-27')).toMatchObject({ exact: true });
    expect(rulesetForFinancialYear('2026-27').ruleset.id).toBe('AU-2026-27');
    const future = rulesetForFinancialYear('2031-32');
    expect(future.exact).toBe(false);
    expect(future.ruleset.id).toBe('AU-2027-28');
  });
});

describe('salary packages and take-home pay', () => {
  it('never treats employer super as spendable income for inclusive packages', () => {
    expect(baseFromPackage(112000, 0.12, 250000)).toBeCloseTo(100000, 6);
    const p = { ...EMPTY_INCOME, residency: 'resident' as const, salaryCents: 11200000, packageIncludesSuper: true };
    const r = calculateTakeHome(p, fy25);
    expect(r.baseSalaryCents).toBe(10000000);
    expect(r.employerSuperCents).toBe(1200000);
    expect(r.netAnnualCents).toBe(10000000 - 2278800);
  });

  it('exclusive packages add super on top', () => {
    const r = calculateTakeHome({ ...EMPTY_INCOME, residency: 'resident', salaryCents: 10000000 }, fy25);
    expect(r.baseSalaryCents).toBe(10000000);
    expect(r.employerSuperCents).toBe(1200000);
    expect(r.netMonthlyCents).toBe(Math.round((10000000 - 2278800) / 12));
  });

  it('salary sacrifice lowers taxable income and warns above the cap', () => {
    const r = calculateTakeHome({ ...EMPTY_INCOME, residency: 'resident', salaryCents: 20000000, salarySacrificeAnnualCents: 1000000 }, fy25);
    expect(r.taxableIncomeCents).toBe(19000000);
    expect(r.exceedsConcessionalCap).toBe(true);
  });

  it('caps SG at the maximum contribution base', () => {
    const r = calculateTakeHome({ ...EMPTY_INCOME, residency: 'resident', salaryCents: 40000000 }, fy26);
    expect(r.employerSuperCents).toBe(Math.round(270830 * 0.12 * 100));
  });

  it('warns when residency is unknown', () => {
    expect(calculateTakeHome({ ...EMPTY_INCOME, salaryCents: 5000000 }, fy25).warnings.join(' ')).toMatch(/residency/i);
  });
});
