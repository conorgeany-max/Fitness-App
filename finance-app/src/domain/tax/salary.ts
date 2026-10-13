/**
 * Salary package → take-home pay.
 *
 * Packages quoted "inclusive of super" (total remuneration) are converted to a base salary
 * first, so employer super is never treated as spendable income:
 *   base = package / (1 + SG rate), unless SG would exceed the maximum contribution base,
 *   in which case base = package − maximum SG.
 */
import { toCents, type Cents } from '../money';
import type { IncomeProfile, PayFrequency } from '../types';
import { calculateTax, type TaxResult } from './tax';
import type { TaxRuleset } from './rulesets';

export interface TakeHomeResult {
  /** Gross base salary excluding super. */
  baseSalaryCents: Cents;
  bonusCents: Cents;
  otherIncomeCents: Cents;
  grossIncomeCents: Cents;
  employerSuperCents: Cents;
  salarySacrificeCents: Cents;
  /** Super going into the fund before 15% contributions tax. */
  totalConcessionalCents: Cents;
  concessionalCapCents: Cents;
  exceedsConcessionalCap: boolean;
  taxableIncomeCents: Cents;
  tax: TaxResult;
  totalTaxCents: Cents;
  netAnnualCents: Cents;
  netMonthlyCents: Cents;
  netPerPayCents: Cents;
  payFrequency: PayFrequency;
  superRate: number;
  warnings: string[];
}

export const PAYS_PER_YEAR: Record<PayFrequency, number> = { weekly: 52, fortnightly: 26, monthly: 12 };

export function baseFromPackage(packageDollars: number, sgRate: number, maxBase: number): number {
  const base = packageDollars / (1 + sgRate);
  if (base <= maxBase) return base;
  return packageDollars - maxBase * sgRate;
}

export interface TakeHomeOptions {
  /** Scale salary/bonus for part-time (FTE 0-1). */
  fte?: number;
  /** Override annual salary (dollars, same basis as profile.packageIncludesSuper). */
  salaryOverrideDollars?: number;
  bonusOverrideDollars?: number;
  salarySacrificeOverrideDollars?: number;
  /** Extra taxable income for the year, e.g. rental income share (dollars). */
  extraTaxableDollars?: number;
  /** Non-taxable / separately taxed income treated as received (e.g. government parental leave pay is taxable — pass as extraTaxable). */
  familyIncomeForMls?: number;
}

export function calculateTakeHome(profile: IncomeProfile, ruleset: TaxRuleset, opts: TakeHomeOptions = {}): TakeHomeResult {
  const warnings: string[] = [];
  const fte = opts.fte ?? 1;
  const sg = profile.superRate ?? ruleset.super.guaranteeRate;
  const maxBase = ruleset.super.maxContributionBaseAnnual;
  const salary = (opts.salaryOverrideDollars ?? profile.salaryCents / 100) * fte;
  // Work in whole cents so a package like $112,000 incl. 12% super gives exactly $100,000.00.
  const base = Math.round((profile.packageIncludesSuper ? baseFromPackage(salary, sg, maxBase) : salary) * 100) / 100;
  const bonus = (opts.bonusOverrideDollars ?? profile.bonusAnnualCents / 100) * fte;
  const other = profile.otherTaxableIncomeAnnualCents / 100 + (opts.extraTaxableDollars ?? 0);
  const ote = base + (profile.bonusAttractsSuper ? bonus : 0);
  const employerSuper = Math.min(ote, maxBase) * sg;
  const sacrifice = Math.min(opts.salarySacrificeOverrideDollars ?? profile.salarySacrificeAnnualCents / 100, base + bonus);
  const deductions = profile.deductionsAnnualCents / 100;
  const taxable = Math.max(0, base + bonus + other - sacrifice - deductions);

  if (profile.residency === 'unknown') {
    warnings.push('Tax residency not set — estimate assumes Australian resident. Set residency for an accurate figure.');
  }
  const tax = calculateTax(
    {
      taxableIncome: taxable,
      resident: profile.residency !== 'non-resident',
      hasHelpDebt: profile.hasHelpDebt,
      reportableExtras: sacrifice,
      privateHospitalCover: profile.privateHospitalCover,
      familyIncomeForMls: opts.familyIncomeForMls,
    },
    ruleset,
  );
  const concessional = employerSuper + sacrifice;
  const cap = ruleset.super.concessionalCap;
  if (concessional > cap) {
    warnings.push(`Concessional super contributions ($${Math.round(concessional).toLocaleString('en-AU')}) exceed the $${cap.toLocaleString('en-AU')} cap (carry-forward of unused caps not modelled).`);
  }
  if (ruleset.status === 'provisional') warnings.push(`Uses provisional ${ruleset.financialYear} rules.`);

  const net = base + bonus + other - sacrifice - tax.totalTax;
  const freq = profile.payFrequency;
  return {
    baseSalaryCents: toCents(base),
    bonusCents: toCents(bonus),
    otherIncomeCents: toCents(other),
    grossIncomeCents: toCents(base + bonus + other),
    employerSuperCents: toCents(employerSuper),
    salarySacrificeCents: toCents(sacrifice),
    totalConcessionalCents: toCents(concessional),
    concessionalCapCents: toCents(cap),
    exceedsConcessionalCap: concessional > cap,
    taxableIncomeCents: toCents(taxable),
    tax,
    totalTaxCents: toCents(tax.totalTax),
    netAnnualCents: toCents(net),
    netMonthlyCents: toCents(net / 12),
    netPerPayCents: toCents(net / PAYS_PER_YEAR[freq]),
    payFrequency: freq,
    superRate: sg,
    warnings,
  };
}

export const EMPTY_INCOME: IncomeProfile = {
  salaryCents: 0,
  packageIncludesSuper: false,
  bonusAnnualCents: 0,
  bonusAttractsSuper: false,
  otherTaxableIncomeAnnualCents: 0,
  payFrequency: 'fortnightly',
  reviewMonth: 7,
  expectedAnnualIncrease: 0.03,
  salarySacrificeAnnualCents: 0,
  deductionsAnnualCents: 0,
  hasHelpDebt: false,
  residency: 'unknown',
  privateHospitalCover: true,
};
