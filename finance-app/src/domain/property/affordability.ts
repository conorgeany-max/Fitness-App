/**
 * Property purchase affordability for the household.
 *
 * This is an educational cash-flow analysis, NOT a lender serviceability assessment,
 * pre-approval, credit decision or financial advice. Lenders use their own expense
 * benchmarks, assessment rate buffers and income shading.
 *
 * The overall label is produced by transparent, configurable rules (see `THRESHOLDS`),
 * and every check that contributes to it is returned so the UI can show the reasoning.
 */
import { amortise, annuityPayment, estimateLmi } from '../mortgage';
import { roundCents, type Cents } from '../money';
import type { AustralianState, PersonId, PropertyPurchaseSettings } from '../types';
import { estimateRegistrationFees, estimateStampDuty, type DutyResult } from './stampDuty';

export interface AffordabilityThresholds {
  /** Housing costs / take-home pay at or below this is "comfortable". */
  comfortableHousingRatio: number;
  /** Above this the purchase is "stretched". */
  stretchedHousingRatio: number;
  comfortableBufferMonths: number;
  minimumBufferMonths: number;
  /** LVR above which the result cannot be better than "manageable". */
  highLvr: number;
  vacancyRate: number;
  propertyManagementRate: number;
}

export const DEFAULT_THRESHOLDS: AffordabilityThresholds = {
  comfortableHousingRatio: 0.3,
  stretchedHousingRatio: 0.4,
  comfortableBufferMonths: 6,
  minimumBufferMonths: 3,
  highLvr: 0.9,
  vacancyRate: 0.04,
  propertyManagementRate: 0.07,
};

export interface HouseholdFinancials {
  takeHomeMonthlyCents: Cents;
  takeHomeByPerson: Record<PersonId, Cents>;
  /** Non-housing living costs per month (current rent excluded). */
  livingCostsMonthlyCents: Cents;
  /** Portion of living costs that is essential. */
  essentialLivingMonthlyCents: Cents;
  liquidSavingsCents: Cents;
  otherDebtRepaymentsMonthlyCents: Cents;
  netWorthCents: Cents;
  /** Current rent being paid (monthly) — stops on purchase of an owner-occupied home. */
  currentRentMonthlyCents: Cents;
}

export interface PropertyCosts {
  priceCents: Cents;
  state: AustralianState | null;
  strataAnnualCents: Cents;
  councilRatesAnnualCents: Cents;
  waterAnnualCents: Cents;
  rentWeeklyCents: Cents;
  newHome?: boolean;
}

export interface MarketAssumptions {
  investmentReturn: number;
  propertyGrowth: number;
  inflation: number;
  rentGrowth: number;
}

export type AffordabilityLabel = 'comfortable' | 'manageable' | 'stretched' | 'not-supported';

export interface Check {
  id: string;
  label: string;
  value: string;
  threshold: string;
  result: 'pass' | 'warn' | 'fail';
  explanation: string;
}

export interface UpfrontItem {
  key: string;
  label: string;
  cents: Cents;
  basis: 'entered' | 'estimated' | 'calculated' | 'unavailable';
  note?: string;
}

export interface AffordabilityResult {
  label: AffordabilityLabel;
  headline: string;
  reasons: string[];
  checks: Check[];
  duty: DutyResult | null;
  upfront: UpfrontItem[];
  upfrontTotalCents: Cents;
  depositCents: Cents;
  baseLoanCents: Cents;
  loanCents: Cents;
  lmiCents: Cents;
  lmiCapitalised: boolean;
  lvr: number;
  repaymentMonthlyCents: Cents;
  stressRate: number;
  stressRepaymentMonthlyCents: Cents;
  housingCostsMonthlyCents: Cents;
  housingBreakdown: { label: string; cents: Cents }[];
  netRentMonthlyCents: Cents;
  takeHomeMonthlyCents: Cents;
  disposableMonthlyCents: Cents;
  disposableAtStressCents: Cents;
  savingsAfterSettlementCents: Cents;
  emergencyTargetCents: Cents;
  bufferMonths: number;
  housingRatio: number;
  singleIncome: { person: PersonId; disposableCents: Cents; monthsBufferLasts: number | null }[];
  netWorthAfterPurchaseCents: Cents;
  equity: { year: number; propertyValueCents: Cents; loanCents: Cents; equityCents: Cents }[];
  rentVsBuy: null | {
    years: number;
    buyerNetWealthCents: Cents;
    renterNetWealthCents: Cents;
    differenceCents: Cents;
    assumptions: string;
  };
  drivers: { label: string; impactMonthlyCents: Cents }[];
  toImprove: string[];
  rate: number;
}

const ONE_OFF_KEYS = ['duty', 'registration', 'conveyancing', 'inspections', 'lmi', 'moving', 'furnishing'];

export function analyseAffordability(
  property: PropertyCosts,
  s: PropertyPurchaseSettings,
  hh: HouseholdFinancials,
  market: MarketAssumptions,
  thresholds: AffordabilityThresholds = DEFAULT_THRESHOLDS,
  opts: { searchImprovements?: boolean } = {},
): AffordabilityResult {
  const price = property.priceCents;
  const owner = s.intendedUse === 'owner-occupier';
  const takeHome = s.overrides.takeHomeMonthlyCents ?? hh.takeHomeMonthlyCents;
  const living = s.overrides.livingCostsMonthlyCents ?? hh.livingCostsMonthlyCents;
  const essentialLiving = s.overrides.livingCostsMonthlyCents != null
    ? roundCents(s.overrides.livingCostsMonthlyCents * (hh.livingCostsMonthlyCents > 0 ? hh.essentialLivingMonthlyCents / hh.livingCostsMonthlyCents : 0.7))
    : hh.essentialLivingMonthlyCents;
  const savings = s.overrides.savingsCents ?? hh.liquidSavingsCents;
  const otherDebts = s.overrides.otherDebtRepaymentsMonthlyCents ?? hh.otherDebtRepaymentsMonthlyCents;

  // ---- Upfront costs
  const deposit = Math.min(s.depositCents, price);
  let duty: DutyResult | null = null;
  const upfront: UpfrontItem[] = [{ key: 'deposit', label: 'Deposit', cents: deposit, basis: 'entered' }];
  if (s.stampDutyOverrideCents != null) {
    upfront.push({ key: 'duty', label: 'Stamp duty', cents: s.stampDutyOverrideCents, basis: 'entered' });
  } else if (property.state) {
    duty = estimateStampDuty({ state: property.state, priceCents: price, ownerOccupier: owner, firstHomeBuyer: s.firstHomeBuyer, newHome: property.newHome });
    upfront.push({
      key: 'duty',
      label: duty.concessionLabel ? `Stamp duty (${duty.concessionLabel})` : 'Stamp duty',
      cents: duty.dutyCents,
      basis: duty.supported ? 'calculated' : 'unavailable',
      note: duty.supported ? undefined : duty.notes[0],
    });
  } else {
    upfront.push({ key: 'duty', label: 'Stamp duty', cents: 0, basis: 'unavailable', note: 'Select the state to estimate stamp duty.' });
  }
  if (property.state) {
    const reg = estimateRegistrationFees(property.state, price);
    upfront.push({ key: 'registration', label: 'Transfer & mortgage registration', cents: reg.cents, basis: 'estimated', note: reg.note });
  }
  upfront.push({ key: 'conveyancing', label: 'Conveyancing & legal', cents: s.conveyancingCents, basis: 'entered' });
  upfront.push({ key: 'inspections', label: 'Building & pest inspections', cents: s.inspectionsCents, basis: 'entered' });

  const baseLoan = Math.max(0, price - deposit);
  let lmi = 0;
  let lmiNote = '';
  if (s.homeGuarantee) {
    lmiNote = 'Home Guarantee Scheme assumed — eligibility must be confirmed with a participating lender.';
  } else if (s.lmiOverrideCents != null) {
    lmi = s.lmiOverrideCents;
  } else {
    const est = estimateLmi(baseLoan, price);
    lmi = est.lmiCents;
    lmiNote = est.note;
  }
  const capitalise = s.capitaliseLmi && lmi > 0;
  if (lmi > 0 || lmiNote) {
    upfront.push({
      key: 'lmi',
      label: capitalise ? 'Lenders mortgage insurance (added to loan)' : 'Lenders mortgage insurance',
      cents: capitalise ? 0 : lmi,
      basis: s.lmiOverrideCents != null ? 'entered' : 'estimated',
      note: capitalise ? `${formatAud(lmi)} added to the loan. ${lmiNote}` : lmiNote,
    });
  }
  upfront.push({ key: 'moving', label: 'Moving costs', cents: s.movingCents, basis: 'entered' });
  upfront.push({ key: 'furnishing', label: 'Furnishing & set-up', cents: s.furnishingCents, basis: 'entered' });
  const upfrontTotal = upfront.reduce((a, u) => a + u.cents, 0);
  const loan = baseLoan + (capitalise ? lmi : 0);
  const lvr = price > 0 ? baseLoan / price : 0;

  // ---- Ongoing costs
  const monthlyRepayment = (rate: number, principal = loan) =>
    s.repaymentType === 'IO' ? roundCents((principal * rate) / 12) : Math.ceil(annuityPayment(principal, rate / 12, s.termYears * 12));
  const repayment = monthlyRepayment(s.interestRate);
  const stressRate = s.interestRate + s.stressBuffer;
  const stressRepayment = monthlyRepayment(stressRate);
  const maintenance = roundCents((price * s.maintenanceRate) / 12);
  const housingBreakdown = [
    { label: s.repaymentType === 'IO' ? 'Loan repayment (interest only)' : 'Loan repayment (P&I)', cents: repayment },
    { label: 'Council rates', cents: roundCents(property.councilRatesAnnualCents / 12) },
    { label: 'Water', cents: roundCents(property.waterAnnualCents / 12) },
    { label: 'Owners corporation / strata', cents: roundCents(property.strataAnnualCents / 12) },
    { label: 'Building insurance', cents: roundCents(s.buildingInsuranceAnnualCents / 12) },
    { label: `Maintenance (${(s.maintenanceRate * 100).toFixed(1)}% p.a.)`, cents: maintenance },
  ];
  const housing = housingBreakdown.reduce((a, b) => a + b.cents, 0);
  const nonRepaymentHousing = housing - repayment;
  const netRent = owner
    ? 0
    : roundCents(((property.rentWeeklyCents * 52) / 12) * (1 - thresholds.vacancyRate) * (1 - thresholds.propertyManagementRate));
  // Living costs exclude rent. Owner-occupiers stop paying their current rent; investors keep paying it.
  const disposable = takeHome + netRent - housing - living - otherDebts - (owner ? 0 : hh.currentRentMonthlyCents);
  const disposableAtStress = disposable - (stressRepayment - repayment);

  const savingsAfter = savings - upfrontTotal;
  const essentialMonthly = essentialLiving + housing + otherDebts - netRent;
  const emergencyTarget = essentialMonthly * s.emergencyFundMonths;
  const bufferMonths = essentialMonthly > 0 ? Math.max(0, savingsAfter) / essentialMonthly : Infinity;
  const housingRatio = takeHome > 0 ? housing / takeHome : Infinity;

  const singleIncome = (['me', 'partner'] as PersonId[])
    .filter((p) => hh.takeHomeByPerson[p] > 0)
    .map((p) => {
      const d = disposable - hh.takeHomeByPerson[p];
      return { person: p, disposableCents: d, monthsBufferLasts: d >= 0 ? null : Math.max(0, savingsAfter) / -d };
    });

  // ---- Wealth effects
  const sunkCosts = upfront.filter((u) => ONE_OFF_KEYS.includes(u.key)).reduce((a, u) => a + u.cents, 0) + (capitalise ? lmi : 0);
  const netWorthAfter = hh.netWorthCents - sunkCosts;
  const equity: AffordabilityResult['equity'] = [];
  const sched = loan > 0 && s.repaymentType === 'PI'
    ? amortise({ principalCents: loan, annualRate: s.interestRate, termYears: s.termYears, frequency: 'monthly', repaymentType: 'PI', startDate: '2000-01-01' })
    : null;
  for (const year of [0, 1, 5, 10, 20, 30]) {
    if (year > s.termYears) continue;
    const value = roundCents(price * Math.pow(1 + market.propertyGrowth, year));
    const bal = year === 0 ? loan : sched ? (sched.schedule[year * 12 - 1]?.closingCents ?? 0) : loan;
    equity.push({ year, propertyValueCents: value, loanCents: bal, equityCents: value - bal });
  }

  let rentVsBuy: AffordabilityResult['rentVsBuy'] = null;
  if (owner && hh.currentRentMonthlyCents > 0) {
    const years = 10;
    // Renter invests the upfront cash and, each month, any amount by which owning costs exceed rent.
    let renterPortfolio = upfrontTotal - s.furnishingCents - s.movingCents;
    let rent = hh.currentRentMonthlyCents;
    let ownCostsExRepay = nonRepaymentHousing;
    let buyerPortfolio = 0;
    const r = market.investmentReturn / 12;
    for (let m = 1; m <= years * 12; m++) {
      const ownCost = repayment + ownCostsExRepay;
      const diff = ownCost - rent;
      renterPortfolio = renterPortfolio * (1 + r) + Math.max(0, diff);
      buyerPortfolio = buyerPortfolio * (1 + r) + Math.max(0, -diff);
      if (m % 12 === 0) {
        rent = roundCents(rent * (1 + market.rentGrowth));
        ownCostsExRepay = roundCents(ownCostsExRepay * (1 + market.inflation));
      }
    }
    const eq10 = equity.find((e) => e.year === 10);
    const buyerWealth = (eq10?.equityCents ?? 0) + roundCents(buyerPortfolio);
    rentVsBuy = {
      years,
      buyerNetWealthCents: buyerWealth,
      renterNetWealthCents: roundCents(renterPortfolio),
      differenceCents: buyerWealth - roundCents(renterPortfolio),
      assumptions: `Property growth ${(market.propertyGrowth * 100).toFixed(1)}% p.a., investment return ${(market.investmentReturn * 100).toFixed(1)}% p.a. (before tax), rent growth ${(market.rentGrowth * 100).toFixed(1)}% p.a., ownership costs grow with inflation. Ignores selling costs, capital gains tax and tax on investment returns.`,
    };
  }

  // ---- Checks and label
  const checks: Check[] = [];
  const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
  const months = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} months` : 'no essential costs entered');
  checks.push({
    id: 'upfront',
    label: 'Cash to settle',
    value: formatAud(upfrontTotal),
    threshold: `Available: ${formatAud(savings)}`,
    result: savingsAfter >= 0 ? 'pass' : 'fail',
    explanation: savingsAfter >= 0 ? `Leaves ${formatAud(savingsAfter)} after settlement.` : `Short by ${formatAud(-savingsAfter)}.`,
  });
  checks.push({
    id: 'cashflow',
    label: 'Monthly surplus after purchase',
    value: formatAud(disposable),
    threshold: '≥ $0',
    result: disposable >= 0 ? 'pass' : 'fail',
    explanation: 'Take-home pay minus housing costs, living costs and other debt repayments.',
  });
  checks.push({
    id: 'stress',
    label: `Surplus at ${pct(stressRate)} interest`,
    value: formatAud(disposableAtStress),
    threshold: '≥ $0',
    result: disposableAtStress >= 0 ? 'pass' : 'warn',
    explanation: `Repayments rise to ${formatAud(stressRepayment)}/month at a rate ${pct(s.stressBuffer)} higher.`,
  });
  checks.push({
    id: 'ratio',
    label: 'Housing costs / take-home pay',
    value: pct(housingRatio),
    threshold: `≤ ${pct(thresholds.comfortableHousingRatio)} comfortable, > ${pct(thresholds.stretchedHousingRatio)} stretched`,
    result: housingRatio <= thresholds.comfortableHousingRatio ? 'pass' : housingRatio <= thresholds.stretchedHousingRatio ? 'warn' : 'fail',
    explanation: 'Includes repayments, rates, water, strata, insurance and maintenance.',
  });
  checks.push({
    id: 'buffer',
    label: 'Emergency buffer after settlement',
    value: months(bufferMonths),
    threshold: `≥ ${thresholds.comfortableBufferMonths} months comfortable, < ${thresholds.minimumBufferMonths} stretched`,
    result: bufferMonths >= thresholds.comfortableBufferMonths ? 'pass' : bufferMonths >= thresholds.minimumBufferMonths ? 'warn' : 'fail',
    explanation: `Months of essential costs (${formatAud(essentialMonthly)}/month) covered by remaining savings.`,
  });
  checks.push({
    id: 'lvr',
    label: 'Loan-to-value ratio',
    value: pct(lvr),
    threshold: `≤ 80% avoids LMI; > ${pct(thresholds.highLvr)} limits options`,
    result: lvr <= 0.8 ? 'pass' : lvr <= thresholds.highLvr ? 'warn' : 'fail',
    explanation: 'Base loan (before any capitalised LMI) divided by the purchase price.',
  });
  for (const si of singleIncome) {
    checks.push({
      id: `single-${si.person}`,
      label: `If ${si.person === 'me' ? 'your' : "your partner's"} income stopped`,
      value: si.disposableCents >= 0 ? `Surplus ${formatAud(si.disposableCents)}` : `Deficit ${formatAud(-si.disposableCents)}/month`,
      threshold: 'Buffer lasts ≥ 6 months',
      result: si.disposableCents >= 0 ? 'pass' : (si.monthsBufferLasts ?? 0) >= 6 ? 'warn' : 'fail',
      explanation:
        si.disposableCents >= 0
          ? 'The remaining income covers all costs.'
          : `Savings after settlement would last about ${(si.monthsBufferLasts ?? 0).toFixed(1)} months.`,
    });
  }

  const reasons: string[] = [];
  let label: AffordabilityLabel;
  if (savingsAfter < 0 || disposable < 0) {
    label = 'not-supported';
    if (savingsAfter < 0) reasons.push(`Upfront costs exceed available savings by ${formatAud(-savingsAfter)}.`);
    if (disposable < 0) reasons.push(`Costs exceed take-home pay by ${formatAud(-disposable)} a month.`);
  } else if (disposableAtStress < 0 || bufferMonths < thresholds.minimumBufferMonths || housingRatio > thresholds.stretchedHousingRatio) {
    label = 'stretched';
    if (disposableAtStress < 0) reasons.push(`A ${pct(s.stressBuffer)} rate rise would create a ${formatAud(-disposableAtStress)} monthly shortfall.`);
    if (bufferMonths < thresholds.minimumBufferMonths) reasons.push(`Only ${bufferMonths.toFixed(1)} months of essential costs would remain in savings.`);
    if (housingRatio > thresholds.stretchedHousingRatio) reasons.push(`Housing would take ${pct(housingRatio)} of take-home pay.`);
  } else if (
    housingRatio > thresholds.comfortableHousingRatio ||
    bufferMonths < thresholds.comfortableBufferMonths ||
    lvr > thresholds.highLvr ||
    singleIncome.some((si) => si.disposableCents < 0 && (si.monthsBufferLasts ?? 0) < 6)
  ) {
    label = 'manageable';
    if (housingRatio > thresholds.comfortableHousingRatio) reasons.push(`Housing costs are ${pct(housingRatio)} of take-home pay (above ${pct(thresholds.comfortableHousingRatio)}).`);
    if (bufferMonths < thresholds.comfortableBufferMonths) reasons.push(`The buffer after settlement covers ${bufferMonths.toFixed(1)} months (target ${thresholds.comfortableBufferMonths}).`);
    if (lvr > thresholds.highLvr) reasons.push(`A ${pct(lvr)} LVR leaves little equity if prices fall.`);
    for (const si of singleIncome) if (si.disposableCents < 0 && (si.monthsBufferLasts ?? 0) < 6) reasons.push(`Losing ${si.person === 'me' ? 'your' : "your partner's"} income would exhaust savings in ${(si.monthsBufferLasts ?? 0).toFixed(1)} months.`);
  } else {
    label = 'comfortable';
    reasons.push(`Surplus of ${formatAud(disposable)}/month remains, and ${formatAud(disposableAtStress)} at a ${pct(stressRate)} rate.`);
    reasons.push(`Housing costs are ${pct(housingRatio)} of take-home pay with ${bufferMonths.toFixed(1)} months of buffer.`);
  }
  const headline = {
    comfortable: 'Comfortable under current assumptions',
    manageable: 'Potentially manageable, but sensitive to assumptions',
    stretched: 'Stretched, with limited financial buffer',
    'not-supported': 'Not currently supported by the entered cash-flow assumptions',
  }[label];

  // ---- Drivers (effect on monthly surplus)
  const drivers = [
    { label: '+$50,000 purchase price', impactMonthlyCents: -(monthlyRepayment(s.interestRate, loan + 5_000_000) - repayment) - roundCents((5_000_000 * s.maintenanceRate) / 12) },
    { label: '+1% interest rate', impactMonthlyCents: -(monthlyRepayment(s.interestRate + 0.01) - repayment) },
    { label: '−10% household take-home pay', impactMonthlyCents: -roundCents(takeHome * 0.1) },
    { label: '+10% living costs', impactMonthlyCents: -roundCents(living * 0.1) },
  ].sort((a, b) => a.impactMonthlyCents - b.impactMonthlyCents);

  // ---- What would need to change
  const toImprove: string[] = [];
  if (label !== 'comfortable' && opts.searchImprovements !== false) {
    const comfortablePrice = maxPriceForLabel(property, s, hh, market, thresholds);
    if (comfortablePrice !== null && comfortablePrice < price) {
      toImprove.push(`A purchase price around ${formatAud(comfortablePrice)} would meet every "comfortable" check with the same deposit.`);
    } else if (comfortablePrice === null) {
      toImprove.push('No purchase price meets every "comfortable" check with the current deposit, income and expenses.');
    }
    if (savingsAfter < 0) toImprove.push(`Save an extra ${formatAud(-savingsAfter)} (or reduce the deposit and accept LMI) to fund settlement.`);
    if (disposableAtStress < 0) toImprove.push(`Reduce monthly spending by ${formatAud(-disposableAtStress)}, or increase income by the same after tax, to withstand a ${pct(s.stressBuffer)} rate rise.`);
    if (bufferMonths < thresholds.comfortableBufferMonths && Number.isFinite(bufferMonths)) {
      toImprove.push(`Keep an extra ${formatAud(Math.max(0, thresholds.comfortableBufferMonths * essentialMonthly - Math.max(0, savingsAfter)))} in savings to reach a ${thresholds.comfortableBufferMonths}-month buffer.`);
    }
    if (housingRatio > thresholds.comfortableHousingRatio && takeHome > 0) {
      const neededIncome = housing / thresholds.comfortableHousingRatio;
      toImprove.push(`Take-home pay of ${formatAud(roundCents(neededIncome))}/month would bring housing costs to ${pct(thresholds.comfortableHousingRatio)}.`);
    }
  }

  return {
    label,
    headline,
    reasons,
    checks,
    duty,
    upfront,
    upfrontTotalCents: upfrontTotal,
    depositCents: deposit,
    baseLoanCents: baseLoan,
    loanCents: loan,
    lmiCents: lmi,
    lmiCapitalised: capitalise,
    lvr,
    repaymentMonthlyCents: repayment,
    stressRate,
    stressRepaymentMonthlyCents: stressRepayment,
    housingCostsMonthlyCents: housing,
    housingBreakdown,
    netRentMonthlyCents: netRent,
    takeHomeMonthlyCents: takeHome,
    disposableMonthlyCents: disposable,
    disposableAtStressCents: disposableAtStress,
    savingsAfterSettlementCents: savingsAfter,
    emergencyTargetCents: emergencyTarget,
    bufferMonths,
    housingRatio,
    singleIncome,
    netWorthAfterPurchaseCents: netWorthAfter,
    equity,
    rentVsBuy,
    drivers,
    toImprove,
    rate: s.interestRate,
  };
}

/** Highest price (to the nearest $5,000) that is "comfortable", holding the deposit fixed. */
export function maxPriceForLabel(
  property: PropertyCosts,
  s: PropertyPurchaseSettings,
  hh: HouseholdFinancials,
  market: MarketAssumptions,
  thresholds: AffordabilityThresholds,
): Cents | null {
  const test = (priceCents: Cents) =>
    analyseAffordability({ ...property, priceCents }, s, hh, market, thresholds, { searchImprovements: false }).label === 'comfortable';
  let lo = s.depositCents; // a price equal to the deposit needs no loan
  let hi = Math.max(property.priceCents * 2, 100_000_00);
  if (!test(Math.max(lo, 10_000_00))) return null;
  for (let i = 0; i < 40 && hi - lo > 500_000; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 500_000) * 500_000;
}

function formatAud(cents: Cents): string {
  const v = Math.round(cents / 100);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-AU')}`;
}
