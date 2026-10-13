/**
 * Small calculators used by the Financial Tools screen. Pure functions, integer cents.
 */
import { roundCents, type Cents } from './money';
import { scheduledRepayment } from './mortgage';

export interface RentVsBuyInput {
  priceCents: Cents;
  depositCents: Cents;
  /** Stamp duty, fees and other one-off purchase costs. */
  buyingCostsCents: Cents;
  rate: number;
  termYears: number;
  /** Rates, insurance, strata and maintenance per year, growing with inflation. */
  ownerCostsAnnualCents: Cents;
  rentWeeklyCents: Cents;
  rentGrowth: number;
  propertyGrowth: number;
  investmentReturn: number;
  inflation: number;
  /** Selling costs as a share of the sale price, applied when comparing at the horizon. */
  sellingCostRate: number;
  years: number;
}

export interface RentVsBuyYear {
  year: number;
  buyerWealthCents: Cents;
  renterWealthCents: Cents;
}

/**
 * Compare buying with renting and investing the difference.
 * The renter starts with the deposit and buying costs invested. Each month, whoever
 * has the lower housing cost invests the difference, so both spend the same on
 * housing-plus-saving. Buyer wealth = property value after selling costs − loan + investments.
 */
export function rentVsBuy(i: RentVsBuyInput): { years: RentVsBuyYear[]; breakEvenYear: number | null } {
  const loan = Math.max(0, i.priceCents - i.depositCents);
  const repayment = scheduledRepayment(loan, i.rate, i.termYears, 'monthly');
  const r = i.rate / 12;
  const invest = Math.pow(1 + i.investmentReturn, 1 / 12) - 1;
  let balance = loan;
  let value = i.priceCents;
  let buyerPortfolio = 0;
  let renterPortfolio = i.depositCents + i.buyingCostsCents;
  let rentMonthly = (i.rentWeeklyCents * 52) / 12;
  let ownerMonthly = i.ownerCostsAnnualCents / 12;
  const out: RentVsBuyYear[] = [];
  let breakEvenYear: number | null = null;
  for (let m = 1; m <= i.years * 12; m++) {
    const interest = balance * r;
    const pay = balance > 0 ? Math.min(repayment, balance + interest) : 0;
    balance = Math.max(0, balance + interest - pay);
    const buyerCost = pay + ownerMonthly;
    buyerPortfolio = buyerPortfolio * (1 + invest) + Math.max(0, rentMonthly - buyerCost);
    renterPortfolio = renterPortfolio * (1 + invest) + Math.max(0, buyerCost - rentMonthly);
    value *= Math.pow(1 + i.propertyGrowth, 1 / 12);
    if (m % 12 === 0) {
      const year = m / 12;
      const buyer = roundCents(value * (1 - i.sellingCostRate) - balance + buyerPortfolio);
      const renter = roundCents(renterPortfolio);
      out.push({ year, buyerWealthCents: buyer, renterWealthCents: renter });
      if (breakEvenYear === null && buyer >= renter) breakEvenYear = year;
      rentMonthly *= 1 + i.rentGrowth;
      ownerMonthly *= 1 + i.inflation;
    }
  }
  return { years: out, breakEvenYear };
}

export interface LeaveGapInput {
  /** Normal household take-home per month. */
  normalTakeHomeMonthlyCents: Cents;
  /** The person on leave's normal take-home per month. */
  personTakeHomeMonthlyCents: Cents;
  totalWeeks: number;
  employerPaidWeeks: number;
  /** Fraction of normal pay during employer-paid weeks (1 = full pay, 0.5 = half pay). */
  employerPayFraction: number;
  govPaidWeeks: number;
  /** Government pay per week after tax (the user enters it; rates change each July). */
  govWeeklyAfterTaxCents: Cents;
  monthlySpendingCents: Cents;
}

/**
 * Household income during a period of leave and the savings needed to cover any gap.
 * Employer and government weeks are assumed to run first, then unpaid weeks.
 */
export function leaveGap(i: LeaveGapInput) {
  const weekly = (i.personTakeHomeMonthlyCents * 12) / 52;
  const otherWeekly = ((i.normalTakeHomeMonthlyCents - i.personTakeHomeMonthlyCents) * 12) / 52;
  const spendWeekly = (i.monthlySpendingCents * 12) / 52;
  const employerWeeks = Math.min(i.employerPaidWeeks, i.totalWeeks);
  const govWeeks = Math.min(i.govPaidWeeks, Math.max(0, i.totalWeeks - employerWeeks));
  const unpaidWeeks = Math.max(0, i.totalWeeks - employerWeeks - govWeeks);
  const incomeDuring = employerWeeks * weekly * i.employerPayFraction + govWeeks * i.govWeeklyAfterTaxCents + i.totalWeeks * otherWeekly;
  const normalIncome = i.totalWeeks * (weekly + otherWeekly);
  const spending = i.totalWeeks * spendWeekly;
  const shortfall = Math.max(0, spending - incomeDuring);
  return {
    employerWeeks,
    govWeeks,
    unpaidWeeks,
    incomeDuringCents: roundCents(incomeDuring),
    incomeLostCents: roundCents(normalIncome - incomeDuring),
    spendingCents: roundCents(spending),
    savingsNeededCents: roundCents(shortfall),
    /** Weekly household income in the unpaid stretch, after the other partner's pay. */
    unpaidWeekIncomeCents: roundCents(otherWeekly),
  };
}

/** How many months current savings cover a given monthly outgoing. */
export function monthsCovered(savingsCents: Cents, monthlyCents: Cents): number | null {
  if (monthlyCents <= 0) return null;
  return savingsCents / monthlyCents;
}
