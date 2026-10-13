/**
 * Mortgage amortisation.
 *
 * Convention (documented in docs/CALCULATIONS.md):
 * - Rates are nominal annual rates. The periodic rate is annual / periods-per-year
 *   (12 monthly, 26 fortnightly, 52 weekly). This is the standard periodic approximation;
 *   Australian lenders usually accrue interest daily and debit it monthly, so real
 *   statements differ slightly.
 * - The scheduled repayment is the standard annuity payment, rounded UP to the next cent.
 * - Interest each period is charged on (balance − offset), rounded to the nearest cent.
 * - Offset balances and extra repayments do not change the scheduled repayment; they
 *   shorten the loan. The final repayment is reduced so the loan closes at exactly $0.
 * - "Accelerated" fortnightly/weekly repayments pay half/quarter of the monthly
 *   repayment each fortnight/week, i.e. the equivalent of 13 monthly repayments a year.
 * - Interest-only periods: repayment = interest only. Afterwards the P&I repayment is
 *   recalculated over the remaining term. An introductory rate likewise triggers a
 *   recalculation at the revert date over the remaining contractual term.
 */
import { addDays, addMonths, type ISODate } from './dates';
import { roundCents, type Cents } from './money';

export type RepaymentFrequency = 'monthly' | 'fortnightly' | 'weekly';

export const PERIODS_PER_YEAR: Record<RepaymentFrequency, number> = { monthly: 12, fortnightly: 26, weekly: 52 };

export interface LoanInput {
  principalCents: Cents;
  annualRate: number;
  termYears: number;
  frequency: RepaymentFrequency;
  /** Pay half/quarter of the monthly repayment fortnightly/weekly. */
  accelerated?: boolean;
  repaymentType: 'PI' | 'IO';
  /** Interest-only period in years (when repaymentType is IO). */
  interestOnlyYears?: number;
  intro?: { annualRate: number; years: number } | null;
  offsetCents?: Cents;
  /** Monthly addition to the offset balance (e.g. savings), applied each period pro rata. */
  offsetGrowthMonthlyCents?: Cents;
  extraPerPeriodCents?: Cents;
  /** One-off lump sums by period number (1-based). */
  lumpSums?: { period: number; amountCents: Cents }[];
  startDate: ISODate;
  ongoingFeeMonthlyCents?: Cents;
  ongoingFeeAnnualCents?: Cents;
  upfrontFeesCents?: Cents;
}

export interface ScheduleRow {
  period: number;
  date: ISODate;
  rate: number;
  openingCents: Cents;
  offsetCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  extraCents: Cents;
  repaymentCents: Cents;
  closingCents: Cents;
  feesCents: Cents;
}

export interface AmortisationResult {
  schedule: ScheduleRow[];
  /** Initial scheduled repayment per period (excluding extras). */
  initialRepaymentCents: Cents;
  /** Repayment after any IO/intro period ends. */
  revertRepaymentCents: Cents | null;
  totalInterestCents: Cents;
  totalPrincipalCents: Cents;
  totalExtraCents: Cents;
  totalFeesCents: Cents;
  totalPaidCents: Cents;
  periodsToRepay: number;
  contractualPeriods: number;
  payoffDate: ISODate;
  yearsToRepay: number;
  frequency: RepaymentFrequency;
}

/** Standard annuity repayment for a principal over n periods at periodic rate r. */
export function annuityPayment(principal: number, periodicRate: number, periods: number): number {
  if (periods <= 0) return principal;
  if (periodicRate === 0) return principal / periods;
  return (principal * periodicRate) / (1 - Math.pow(1 + periodicRate, -periods));
}

function ceilCents(x: number): Cents {
  return Math.ceil(x - 1e-7);
}

function stepDate(start: ISODate, frequency: RepaymentFrequency, period: number): ISODate {
  if (frequency === 'monthly') return addMonths(start, period);
  return addDays(start, period * (frequency === 'fortnightly' ? 14 : 7));
}

export function scheduledRepayment(principalCents: Cents, annualRate: number, termYears: number, frequency: RepaymentFrequency, accelerated = false): Cents {
  if (accelerated && frequency !== 'monthly') {
    const monthly = annuityPayment(principalCents, annualRate / 12, Math.round(termYears * 12));
    return ceilCents(monthly / (frequency === 'fortnightly' ? 2 : 4));
  }
  const ppy = PERIODS_PER_YEAR[frequency];
  return ceilCents(annuityPayment(principalCents, annualRate / ppy, Math.round(termYears * ppy)));
}

export function amortise(input: LoanInput): AmortisationResult {
  const ppy = PERIODS_PER_YEAR[input.frequency];
  const n = Math.round(input.termYears * ppy);
  const ioPeriods = input.repaymentType === 'IO' ? Math.min(n, Math.round((input.interestOnlyYears ?? 5) * ppy)) : 0;
  const introPeriods = input.intro ? Math.min(n, Math.round(input.intro.years * ppy)) : 0;
  const rateAt = (p: number) => (input.intro && p <= introPeriods ? input.intro.annualRate : input.annualRate);
  const feePerPeriod = ((input.ongoingFeeMonthlyCents ?? 0) * 12 + (input.ongoingFeeAnnualCents ?? 0)) / ppy;
  const lumps = new Map<number, Cents>();
  for (const l of input.lumpSums ?? []) lumps.set(l.period, (lumps.get(l.period) ?? 0) + l.amountCents);

  let balance = input.principalCents;
  let offset = input.offsetCents ?? 0;
  const offsetGrowthPerPeriod = ((input.offsetGrowthMonthlyCents ?? 0) * 12) / ppy;
  let repayment: Cents =
    ioPeriods > 0 ? 0 : scheduledRepayment(balance, rateAt(1), input.termYears, input.frequency, input.accelerated);
  const initialRepayment = ioPeriods > 0 ? roundCents((balance * rateAt(1)) / ppy) : repayment;
  let revertRepayment: Cents | null = null;

  const schedule: ScheduleRow[] = [];
  let totalInterest = 0;
  let totalPrincipal = 0;
  let totalExtra = 0;
  let totalFees = input.upfrontFeesCents ?? 0;
  let feeCarry = 0;
  let p = 0;
  const maxPeriods = n + ppy * 50; // safety guard (e.g. repayment below interest)

  while (balance > 0 && p < maxPeriods) {
    p += 1;
    const rate = rateAt(p);
    const r = rate / ppy;
    const remaining = Math.max(1, n - (p - 1));

    // Recalculate the repayment at the end of an IO period or intro period.
    if (ioPeriods > 0 && p === ioPeriods + 1) {
      repayment = ceilCents(annuityPayment(balance, r, remaining));
      revertRepayment = repayment;
    } else if (introPeriods > 0 && p === introPeriods + 1 && p > ioPeriods) {
      repayment = ceilCents(annuityPayment(balance, r, remaining));
      revertRepayment = repayment;
    }

    const opening = balance;
    const effectiveOffset = Math.min(offset, opening);
    const interest = roundCents((opening - effectiveOffset) * r);
    let due: Cents;
    if (p <= ioPeriods) due = interest;
    else due = repayment;
    let principalPart = Math.max(0, due - interest);
    let extra = (p > ioPeriods ? input.extraPerPeriodCents ?? 0 : 0) + (lumps.get(p) ?? 0);

    // Final period: pay off exactly.
    if (opening + interest <= due + extra) {
      principalPart = opening;
      extra = 0;
      due = opening + interest;
    } else if (principalPart + extra > opening) {
      extra = opening - principalPart;
    }

    balance = opening - principalPart - extra;
    // If the repayment does not cover interest, unpaid interest capitalises.
    if (due < interest) balance += interest - due;

    feeCarry += feePerPeriod;
    const fee = roundCents(feeCarry);
    feeCarry -= fee;

    totalInterest += interest;
    totalPrincipal += principalPart;
    totalExtra += extra;
    totalFees += fee;
    schedule.push({
      period: p,
      date: stepDate(input.startDate, input.frequency, p),
      rate,
      openingCents: opening,
      offsetCents: effectiveOffset,
      interestCents: interest,
      principalCents: principalPart,
      extraCents: extra,
      repaymentCents: due + extra,
      closingCents: balance,
      feesCents: fee,
    });
    offset += offsetGrowthPerPeriod;
  }

  const last = schedule[schedule.length - 1];
  return {
    schedule,
    initialRepaymentCents: initialRepayment,
    revertRepaymentCents: revertRepayment,
    totalInterestCents: totalInterest,
    totalPrincipalCents: totalPrincipal + totalExtra,
    totalExtraCents: totalExtra,
    totalFeesCents: totalFees,
    totalPaidCents: totalInterest + totalPrincipal + totalExtra + totalFees,
    periodsToRepay: schedule.length,
    contractualPeriods: n,
    payoffDate: last ? last.date : input.startDate,
    yearsToRepay: schedule.length / ppy,
    frequency: input.frequency,
  };
}

/** Annual summary of a schedule for charts and tables. */
export function yearlySummary(result: AmortisationResult): {
  year: number;
  interestCents: Cents;
  principalCents: Cents;
  closingCents: Cents;
}[] {
  const ppy = PERIODS_PER_YEAR[result.frequency];
  const out: { year: number; interestCents: Cents; principalCents: Cents; closingCents: Cents }[] = [];
  for (const row of result.schedule) {
    const year = Math.ceil(row.period / ppy);
    let y = out[year - 1];
    if (!y) {
      y = { year, interestCents: 0, principalCents: 0, closingCents: 0 };
      out[year - 1] = y;
    }
    y.interestCents += row.interestCents;
    y.principalCents += row.principalCents + row.extraCents;
    y.closingCents = row.closingCents;
  }
  return out.filter(Boolean);
}

/** Convert a repayment at one frequency to a monthly equivalent (x * ppy / 12). */
export function toMonthly(amountCents: Cents, frequency: RepaymentFrequency): Cents {
  return roundCents((amountCents * PERIODS_PER_YEAR[frequency]) / 12);
}

/** Lenders mortgage insurance — rough indicative estimate only. */
export interface LmiBand {
  maxLvr: number;
  premiumRate: number;
}

export const LMI_ESTIMATE_BANDS: LmiBand[] = [
  { maxLvr: 0.8, premiumRate: 0 },
  { maxLvr: 0.85, premiumRate: 0.009 },
  { maxLvr: 0.9, premiumRate: 0.018 },
  { maxLvr: 0.95, premiumRate: 0.032 },
  { maxLvr: 1, premiumRate: 0.045 },
];

export function estimateLmi(loanCents: Cents, priceCents: Cents, bands: LmiBand[] = LMI_ESTIMATE_BANDS): { lmiCents: Cents; lvr: number; note: string } {
  if (priceCents <= 0) return { lmiCents: 0, lvr: 0, note: 'No price entered.' };
  const lvr = loanCents / priceCents;
  if (lvr <= 0.8 + 1e-9) return { lmiCents: 0, lvr, note: 'LVR at or below 80%: LMI not usually required.' };
  const band = bands.find((b) => lvr <= b.maxLvr + 1e-9) ?? bands[bands.length - 1];
  return {
    lmiCents: roundCents(loanCents * band.premiumRate),
    lvr,
    note: `Indicative only: ${(band.premiumRate * 100).toFixed(1)}% of the loan for LVR up to ${(band.maxLvr * 100).toFixed(0)}%. Actual premiums vary by insurer, lender, loan size and state stamp duty on the premium — get a lender quote.`,
  };
}

export interface RefinanceInput {
  balanceCents: Cents;
  remainingYears: number;
  currentRate: number;
  newRate: number;
  switchingCostsCents: Cents;
  currentFeesAnnualCents: Cents;
  newFeesAnnualCents: Cents;
}

export function compareRefinance(i: RefinanceInput) {
  const start = '2000-01-01';
  const cur = amortise({ principalCents: i.balanceCents, annualRate: i.currentRate, termYears: i.remainingYears, frequency: 'monthly', repaymentType: 'PI', startDate: start, ongoingFeeAnnualCents: i.currentFeesAnnualCents });
  const neu = amortise({ principalCents: i.balanceCents, annualRate: i.newRate, termYears: i.remainingYears, frequency: 'monthly', repaymentType: 'PI', startDate: start, ongoingFeeAnnualCents: i.newFeesAnnualCents, upfrontFeesCents: i.switchingCostsCents });
  const monthlySaving = cur.initialRepaymentCents + Math.round(i.currentFeesAnnualCents / 12) - (neu.initialRepaymentCents + Math.round(i.newFeesAnnualCents / 12));
  const breakEvenMonths = monthlySaving > 0 ? Math.ceil(i.switchingCostsCents / monthlySaving) : null;
  return {
    current: cur,
    refinanced: neu,
    monthlySavingCents: monthlySaving,
    lifetimeSavingCents: cur.totalPaidCents - neu.totalPaidCents,
    breakEvenMonths,
  };
}
