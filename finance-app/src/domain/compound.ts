/**
 * Compound growth with regular contributions — monthly time step.
 *
 * - `annualReturn` is the assumed gross return. With compounding "monthly" the monthly rate
 *   is annualReturn / 12 (nominal convention). With "annually-effective" the monthly rate is
 *   (1 + annualReturn)^(1/12) − 1, so 12 months compound to exactly annualReturn.
 *   With "annually" growth is credited once a year on the balance at that time.
 * - Fees (% p.a. of balance) and tax on earnings (% of positive earnings) reduce growth.
 * - Contributions are added at the start or end of each contribution period. They are
 *   counted once as contributions; growth = final − starting − contributions.
 * - Inflation-adjusted values divide by (1 + inflation)^(years elapsed).
 * Returns are not guaranteed; negative return assumptions are supported.
 */
import { roundCents, type Cents } from './money';

export type ContributionFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';
export type Compounding = 'monthly' | 'annually-effective' | 'annually';

export interface CompoundInput {
  startingCents: Cents;
  contributionCents: Cents;
  contributionFrequency: ContributionFrequency;
  contributionTiming: 'start' | 'end';
  /** Annual increase applied to the contribution amount each year. */
  contributionGrowth: number;
  annualReturn: number;
  compounding: Compounding;
  annualFee: number;
  /** Tax rate applied to earnings (e.g. 0.15 for super accumulation, simplified). */
  earningsTaxRate: number;
  inflation: number;
  years: number;
}

export interface CompoundYear {
  year: number;
  balanceCents: Cents;
  realBalanceCents: Cents;
  contributionsCents: Cents; // cumulative contributions (excl. starting balance)
  growthCents: Cents; // cumulative net growth
  feesCents: Cents; // cumulative fees
  taxCents: Cents; // cumulative tax on earnings
}

export interface CompoundResult {
  years: CompoundYear[];
  finalCents: Cents;
  finalRealCents: Cents;
  totalContributionsCents: Cents;
  totalGrowthCents: Cents;
  totalFeesCents: Cents;
  totalTaxCents: Cents;
}

const CONTRIB_PER_YEAR: Record<ContributionFrequency, number> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annually: 1 };

export function compound(input: CompoundInput): CompoundResult {
  const months = Math.round(input.years * 12);
  const perYear = CONTRIB_PER_YEAR[input.contributionFrequency];
  const monthlyRate =
    input.compounding === 'monthly' ? input.annualReturn / 12 : input.compounding === 'annually-effective' ? Math.pow(1 + input.annualReturn, 1 / 12) - 1 : 0;
  const monthlyFee = input.annualFee / 12;

  let balance = input.startingCents;
  let contributions = 0;
  let fees = 0;
  let tax = 0;
  const years: CompoundYear[] = [{ year: 0, balanceCents: balance, realBalanceCents: balance, contributionsCents: 0, growthCents: 0, feesCents: 0, taxCents: 0 }];

  // Spread contributions across months: weekly/fortnightly contributions are converted to
  // an exact per-month amount (perYear / 12 per month); quarterly/annual land in specific months.
  for (let m = 1; m <= months; m++) {
    const yearIndex = Math.floor((m - 1) / 12);
    const contribThisPeriod = input.contributionCents * Math.pow(1 + input.contributionGrowth, yearIndex);
    let contribThisMonth = 0;
    const monthInYear = ((m - 1) % 12) + 1;
    if (perYear >= 12) contribThisMonth = (contribThisPeriod * perYear) / 12;
    else if (perYear === 4 && monthInYear % 3 === (input.contributionTiming === 'start' ? 1 : 0)) contribThisMonth = contribThisPeriod;
    else if (perYear === 1 && monthInYear === (input.contributionTiming === 'start' ? 1 : 12)) contribThisMonth = contribThisPeriod;
    const contrib = roundCents(contribThisMonth);

    if (input.contributionTiming === 'start') {
      balance += contrib;
      contributions += contrib;
    }

    if (input.compounding !== 'annually') {
      const gross = balance * monthlyRate;
      const taxOnEarnings = gross > 0 ? gross * input.earningsTaxRate : 0;
      const earn = roundCents(gross - taxOnEarnings);
      tax += roundCents(taxOnEarnings);
      balance += earn;
    }
    const fee = roundCents(Math.max(0, balance) * monthlyFee);
    balance -= fee;
    fees += fee;

    if (input.contributionTiming === 'end') {
      balance += contrib;
      contributions += contrib;
    }

    if (m % 12 === 0 || m === months) {
      if (input.compounding === 'annually') {
        // Simple annual crediting on the year-end balance (contributions made during the year
        // earn nothing until the next year).
        const gross = balance * input.annualReturn * ((m % 12 === 0 ? 12 : m % 12) / 12);
        const taxOnEarnings = gross > 0 ? gross * input.earningsTaxRate : 0;
        balance += roundCents(gross - taxOnEarnings);
        tax += roundCents(taxOnEarnings);
      }
      const y = m / 12;
      const deflator = Math.pow(1 + input.inflation, y);
      years.push({
        year: Math.round(y * 100) / 100,
        balanceCents: balance,
        realBalanceCents: roundCents(balance / deflator),
        contributionsCents: contributions,
        growthCents: balance - input.startingCents - contributions,
        feesCents: fees,
        taxCents: tax,
      });
    }
  }
  const last = years[years.length - 1];
  return {
    years,
    finalCents: last.balanceCents,
    finalRealCents: last.realBalanceCents,
    totalContributionsCents: contributions,
    totalGrowthCents: last.balanceCents - input.startingCents - contributions,
    totalFeesCents: fees,
    totalTaxCents: tax,
  };
}

/** Future value of a lump sum (closed form), useful for cross-checks. */
export function futureValue(presentCents: Cents, annualRate: number, years: number, periodsPerYear = 1): Cents {
  return roundCents(presentCents * Math.pow(1 + annualRate / periodsPerYear, years * periodsPerYear));
}

/** Monthly contribution required to reach a target, given a monthly-compounded return. */
export function requiredMonthlyContribution(targetCents: Cents, currentCents: Cents, months: number, annualReturn: number): Cents {
  if (months <= 0) return Math.max(0, targetCents - currentCents);
  const r = annualReturn / 12;
  const fvCurrent = currentCents * Math.pow(1 + r, months);
  const gap = targetCents - fvCurrent;
  if (gap <= 0) return 0;
  if (r === 0) return Math.ceil(gap / months);
  return Math.ceil((gap * r) / (Math.pow(1 + r, months) - 1));
}

/** Months to reach a target with a monthly contribution (null if never within 100 years). */
export function monthsToTarget(targetCents: Cents, currentCents: Cents, monthlyCents: Cents, annualReturn: number): number | null {
  if (currentCents >= targetCents) return 0;
  const r = annualReturn / 12;
  let bal = currentCents;
  for (let m = 1; m <= 1200; m++) {
    bal = bal * (1 + r) + monthlyCents;
    if (bal >= targetCents) return m;
  }
  return null;
}

/** Real value of a future amount in today's dollars. */
export function toRealCents(nominalCents: Cents, inflation: number, years: number): Cents {
  return roundCents(nominalCents / Math.pow(1 + inflation, years));
}
