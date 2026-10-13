/**
 * Australian individual income tax estimate for one financial year.
 *
 * Included: resident / foreign-resident marginal rates, low income tax offset (LITO),
 * Medicare levy with the low-income shade-in, optional Medicare levy surcharge, and HELP
 * compulsory repayments.
 *
 * Not included (disclosed in the UI): other offsets (SAPTO, private health rebate,
 * zone/dependant offsets), family Medicare levy reductions, capital gains, franking credits,
 * working holiday maker rates, Division 293 tax, PAYG withholding timing differences.
 */
import type { Bracket, HelpTier, TaxRuleset } from './rulesets';

export interface TaxInput {
  /** Taxable income in dollars. */
  taxableIncome: number;
  resident: boolean;
  hasHelpDebt: boolean;
  /** Reportable super contributions + other repayment-income items, in dollars. */
  reportableExtras?: number;
  privateHospitalCover?: boolean;
  /** Combined family income for MLS purposes (dollars). Omit for singles. */
  familyIncomeForMls?: number;
}

export interface TaxResult {
  taxableIncome: number;
  incomeTax: number;
  lito: number;
  incomeTaxAfterOffsets: number;
  medicareLevy: number;
  medicareSurcharge: number;
  helpRepayment: number;
  totalTax: number;
  marginalRate: number;
  averageRate: number;
  rulesetId: string;
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function bracketTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i].above;
    const hi = i + 1 < brackets.length ? brackets[i + 1].above : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * brackets[i].rate;
  }
  return round2(tax);
}

export function marginalRate(income: number, brackets: Bracket[]): number {
  let rate = 0;
  for (const b of brackets) if (income > b.above) rate = b.rate;
  return rate;
}

export function lowIncomeTaxOffset(income: number, r: TaxRuleset): number {
  const { max, fullTo, firstTaperTo, firstTaperRate, secondTaperRate } = r.lito;
  if (income <= fullTo) return max;
  if (income <= firstTaperTo) return round2(max - (income - fullTo) * firstTaperRate);
  const afterFirst = max - (firstTaperTo - fullTo) * firstTaperRate;
  return Math.max(0, round2(afterFirst - (income - firstTaperTo) * secondTaperRate));
}

export function medicareLevy(income: number, r: TaxRuleset): number {
  const { rate, lowerThreshold, upperThreshold, shadeInRate } = r.medicare;
  if (income <= lowerThreshold) return 0;
  const full = income * rate;
  if (income <= upperThreshold) return round2(Math.min(full, (income - lowerThreshold) * shadeInRate));
  return round2(full);
}

export function medicareSurcharge(mlsIncome: number, familyIncome: number | undefined, r: TaxRuleset): number {
  const tiers = familyIncome !== undefined ? r.medicareSurcharge.familyTiers : r.medicareSurcharge.singleTiers;
  const testIncome = familyIncome ?? mlsIncome;
  let rate = 0;
  for (const t of tiers) if (testIncome > t.above) rate = t.rate;
  return round2(mlsIncome * rate);
}

export function helpRepayment(repaymentIncome: number, tiers: HelpTier[]): number {
  let applicable: HelpTier | null = null;
  for (const t of tiers) if (repaymentIncome > t.above) applicable = t;
  if (!applicable) return 0;
  if (applicable.mode === 'total') return round2(repaymentIncome * applicable.rate);
  return round2(applicable.base + (repaymentIncome - applicable.above) * applicable.rate);
}

export function calculateTax(input: TaxInput, r: TaxRuleset): TaxResult {
  // The ATO assesses taxable income in whole dollars (cents are ignored).
  const income = Math.max(0, Math.floor(input.taxableIncome));
  const brackets = input.resident ? r.residentBrackets : r.nonResidentBrackets;
  const incomeTax = bracketTax(income, brackets);
  const lito = input.resident ? Math.min(incomeTax, lowIncomeTaxOffset(income, r)) : 0;
  const afterOffsets = round2(incomeTax - lito);
  const ml = input.resident ? medicareLevy(income, r) : 0;
  const mlsIncome = income + (input.reportableExtras ?? 0);
  const mls = input.resident && input.privateHospitalCover === false ? medicareSurcharge(mlsIncome, input.familyIncomeForMls, r) : 0;
  const help = input.hasHelpDebt ? helpRepayment(income + (input.reportableExtras ?? 0), r.help) : 0;
  const total = round2(afterOffsets + ml + mls + help);
  return {
    taxableIncome: income,
    incomeTax,
    lito,
    incomeTaxAfterOffsets: afterOffsets,
    medicareLevy: ml,
    medicareSurcharge: mls,
    helpRepayment: help,
    totalTax: total,
    marginalRate: marginalRate(income, brackets) + (input.resident && income > r.medicare.upperThreshold ? r.medicare.rate : 0),
    averageRate: income > 0 ? total / income : 0,
    rulesetId: r.id,
  };
}
