/**
 * Household cash-flow and net-worth forecast — monthly time step.
 *
 * Each month:
 *  1. Work out each person's pay for the month (salary growth at the review month,
 *     part-time, parental leave, income stops, bonus and salary-sacrifice changes).
 *  2. Estimate tax on an annualised basis using the ruleset for that financial year
 *     (the latest known ruleset is carried forward for future years — thresholds are not
 *     indexed, which is conservative because of bracket creep).
 *  3. Employer super and salary sacrifice go to super (less 15% contributions tax) — never
 *     to spendable cash.
 *  4. Cash receives net pay and rent; pays living costs (indexed), loan repayments and
 *     one-off expenses.
 *  5. A positive surplus first tops up the emergency fund (cash) to its target, then is
 *     split between investments and cash. A deficit is drawn from cash, then investments.
 *  6. Balances grow: investments (return − fees − tax drag), super, cash interest, property
 *     growth, vehicle depreciation. Loans amortise with interest on (balance − offset).
 *
 * Moving cash into investments is a transfer between assets, so it never reduces net
 * worth and is never also counted as an expense.
 */
import { addMonthKey, daysInMonth, diffDays, financialYear, makeISO, monthStart, type ISODate, type MonthKey } from './dates';
import { annuityPayment } from './mortgage';
import { roundCents, type Cents } from './money';
import { splitByOwnership } from './ownership';
import { rulesetForFinancialYear } from './tax/rulesets';
import { calculateTakeHome } from './tax/salary';
import type { Assumptions, IncomeProfile, PersonId, ScenarioEvent } from './types';

export interface ForecastLoan {
  id: string;
  name: string;
  balanceCents: Cents;
  annualRate: number;
  /** Contractual monthly repayment; if 0, it is calculated from remainingYears. */
  monthlyRepaymentCents: Cents;
  remainingYears: number;
  interestOnly?: boolean;
  /** Interest is charged on (balance − cash) for this loan. */
  offsetWithCash?: boolean;
  kind: 'mortgage' | 'other';
}

export interface ForecastOpening {
  cashCents: Cents;
  investmentsCents: Cents;
  superCents: Record<PersonId, Cents>;
  propertyCents: Cents;
  otherAssetsCents: Cents;
  loans: ForecastLoan[];
  helpDebtCents: Record<PersonId, Cents>;
  otherLiabilitiesCents: Cents;
}

export interface ForecastInput {
  startMonth: MonthKey;
  months: number;
  people: Record<PersonId, IncomeProfile>;
  opening: ForecastOpening;
  assumptions: Assumptions;
  events: ScenarioEvent[];
  livingCostsMonthlyCents: Cents;
}

export interface ForecastPoint {
  month: MonthKey;
  index: number;
  years: number;
  cashCents: Cents;
  investmentsCents: Cents;
  superCents: Cents;
  superByPerson: Record<PersonId, Cents>;
  propertyCents: Cents;
  otherAssetsCents: Cents;
  loansCents: Cents;
  helpDebtCents: Cents;
  otherLiabilitiesCents: Cents;
  assetsCents: Cents;
  liabilitiesCents: Cents;
  netWorthCents: Cents;
  realNetWorthCents: Cents;
  grossIncomeCents: Cents;
  netIncomeCents: Cents;
  netIncomeByPerson: Record<PersonId, Cents>;
  rentalIncomeCents: Cents;
  livingCostsCents: Cents;
  loanRepaymentsCents: Cents;
  oneOffCents: Cents;
  surplusCents: Cents;
  investedCents: Cents;
  employerSuperCents: Cents;
  shortfall: boolean;
  deflator: number;
}

export interface ForecastSummaryPoint {
  years: number;
  netWorthCents: Cents;
  realNetWorthCents: Cents;
  cashCents: Cents;
  liabilitiesCents: Cents;
}

export interface ForecastResult {
  points: ForecastPoint[];
  horizons: ForecastSummaryPoint[];
  emergencyFundReachedMonth: MonthKey | null;
  shortfallMonths: number;
  firstShortfall: MonthKey | null;
  averageSavingsRateFirstYear: number | null;
  warnings: string[];
}

interface PersonState {
  salaryDollars: number; // annual, on the profile's basis (package or base)
  bonusDollars: number;
  sacrificeDollars: number;
  permanentFte: number;
}

/** Fraction of the month covered by [start, endExclusive). */
function overlapFraction(monthKey: MonthKey, start: ISODate, endExclusive: ISODate | null): number {
  const [y, m] = monthKey.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const ms = makeISO(y, m, 1);
  const me = makeISO(y, m, dim);
  const from = start > ms ? start : ms;
  let to = me;
  if (endExclusive) {
    const lastDay = addDaysISO(endExclusive, -1);
    if (lastDay < to) to = lastDay;
  }
  if (to < from) return 0;
  return Math.min(1, (diffDays(from, to) + 1) / dim);
}

function addDaysISO(d: ISODate, n: number): ISODate {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function weeksAfter(d: ISODate, weeks: number): ISODate {
  return addDaysISO(d, Math.round(weeks * 7));
}

export function runForecast(input: ForecastInput): ForecastResult {
  const a = input.assumptions;
  const people: PersonId[] = ['me', 'partner'];
  const warnings: string[] = [];
  const state: Record<PersonId, PersonState> = {
    me: { salaryDollars: input.people.me.salaryCents / 100, bonusDollars: input.people.me.bonusAnnualCents / 100, sacrificeDollars: input.people.me.salarySacrificeAnnualCents / 100, permanentFte: 1 },
    partner: { salaryDollars: input.people.partner.salaryCents / 100, bonusDollars: input.people.partner.bonusAnnualCents / 100, sacrificeDollars: input.people.partner.salarySacrificeAnnualCents / 100, permanentFte: 1 },
  };

  let cash = input.opening.cashCents;
  let investments = input.opening.investmentsCents;
  const superBal: Record<PersonId, number> = { ...input.opening.superCents };
  let property = input.opening.propertyCents;
  let otherAssets = input.opening.otherAssetsCents;
  const help: Record<PersonId, number> = { ...input.opening.helpDebtCents };
  const loans = input.opening.loans.map((l) => {
    const rate = Math.max(0, l.annualRate + a.mortgageRateDelta * (l.kind === 'mortgage' ? 1 : 0));
    const months = Math.max(1, Math.round(l.remainingYears * 12));
    const repayment = l.interestOnly
      ? roundCents((l.balanceCents * rate) / 12)
      : l.monthlyRepaymentCents > 0 && a.mortgageRateDelta === 0
        ? l.monthlyRepaymentCents
        : Math.ceil(annuityPayment(l.balanceCents, rate / 12, months));
    return { ...l, rate, repayment, balance: l.balanceCents };
  });
  let rentSaved = 0;

  const investMonthly = Math.pow(1 + a.investmentReturn - a.investmentFees - a.investmentTaxDrag, 1 / 12) - 1;
  const superMonthly = Math.pow(1 + a.superReturn, 1 / 12) - 1;
  const propertyMonthly = Math.pow(1 + a.propertyGrowth, 1 / 12) - 1;
  const vehicleMonthly = Math.pow(1 - a.vehicleDepreciation, 1 / 12) - 1;
  const cashMonthly = a.cashRate / 12;

  const points: ForecastPoint[] = [];
  let emergencyReached: MonthKey | null = null;
  let shortfalls = 0;
  let firstShortfall: MonthKey | null = null;
  let firstYearIncome = 0;
  let firstYearSpend = 0;

  for (let i = 0; i < input.months; i++) {
    const month = addMonthKey(input.startMonth, i);
    const date = monthStart(month);
    const calMonth = Number(month.slice(5, 7));
    const years = (i + 1) / 12;
    const { ruleset } = rulesetForFinancialYear(financialYear(date));

    // ---- Income events (permanent changes take effect from their month)
    for (const p of people) {
      const profile = input.people[p];
      if (i > 0 && calMonth === profile.reviewMonth) state[p].salaryDollars *= 1 + a.salaryGrowth;
    }
    for (const e of input.events) {
      if (e.type === 'salary-change' && e.date.slice(0, 7) === month) {
        state[e.person].salaryDollars = e.mode === 'set' ? e.value / 100 : state[e.person].salaryDollars * (1 + e.value);
      }
      if (e.type === 'bonus-change' && e.date.slice(0, 7) === month) state[e.person].bonusDollars = e.bonusAnnualCents / 100;
      if (e.type === 'super-change' && e.date.slice(0, 7) === month) state[e.person].sacrificeDollars = e.salarySacrificeAnnualCents / 100;
    }

    let grossTotal = 0;
    let netTotal = 0;
    let employerSuperTotal = 0;
    let rentalTotal = 0;
    const netByPerson: Record<PersonId, Cents> = { me: 0, partner: 0 };

    // Rental income split by ownership.
    const rentalShare: Record<PersonId, number> = { me: 0, partner: 0 };
    for (const e of input.events) {
      if (e.type !== 'rental-income') continue;
      const f = overlapFraction(month, e.start, e.end ?? null);
      if (f <= 0) continue;
      const amt = roundCents(e.monthlyCents * f);
      rentalTotal += amt;
      const split = splitByOwnership(amt, e.ownership);
      rentalShare.me += split.me;
      rentalShare.partner += split.partner;
    }

    for (const p of people) {
      const profile = input.people[p];
      const st = state[p];
      if (st.salaryDollars <= 0 && st.bonusDollars <= 0 && rentalShare[p] === 0 && profile.otherTaxableIncomeAnnualCents === 0) continue;
      // Work-pattern factor for this month.
      let fte = st.permanentFte;
      let govPay = 0;
      for (const e of input.events) {
        if (e.type === 'hours-change' && 'person' in e && e.person === p) {
          const f = overlapFraction(month, e.start, e.end ?? null);
          if (f > 0) fte = fte * (1 - f) + e.fte * f;
        }
        if (e.type === 'income-stop' && e.person === p) {
          const f = overlapFraction(month, e.start, e.end ?? null);
          if (f > 0) fte *= 1 - f;
        }
        if (e.type === 'parental-leave' && e.person === p) {
          const paidEnd = weeksAfter(e.start, e.employerPaidWeeks);
          const govEnd = weeksAfter(paidEnd, e.govPaidWeeks);
          const leaveEnd = weeksAfter(e.start, Math.max(e.totalWeeks, e.employerPaidWeeks + e.govPaidWeeks));
          const unpaidFrac = overlapFraction(month, paidEnd, leaveEnd);
          const govFrac = overlapFraction(month, paidEnd, govEnd);
          govPay += govFrac > 0 ? ((e.govWeeklyCents / 100) * 52 * govFrac) / 12 : 0;
          const after = overlapFraction(month, leaveEnd, null);
          // During employer-paid weeks pay continues; after the leave, the return FTE applies.
          fte = fte * Math.max(0, 1 - unpaidFrac - after) + e.returnFte * after;
          if (after >= 1) st.permanentFte = e.returnFte;
        }
      }
      const annualSalary = st.salaryDollars * fte;
      const annualBonus = st.bonusDollars * fte;
      const extraTaxable = (govPay + rentalShare[p] / 100) * 12;
      const th = calculateTakeHome({ ...profile, hasHelpDebt: profile.hasHelpDebt && help[p] > 0 }, ruleset, {
        salaryOverrideDollars: annualSalary,
        bonusOverrideDollars: annualBonus,
        salarySacrificeOverrideDollars: Math.min(st.sacrificeDollars, annualSalary + annualBonus),
        extraTaxableDollars: extraTaxable,
      });
      const net = roundCents(th.netAnnualCents / 12);
      const employerSuper = roundCents(th.employerSuperCents / 12);
      const sacrifice = roundCents(th.salarySacrificeCents / 12);
      const helpPaid = roundCents((th.tax.helpRepayment * 100) / 12);
      help[p] = Math.max(0, help[p] - helpPaid);
      superBal[p] += roundCents((employerSuper + sacrifice) * (1 - ruleset.super.contributionsTaxRate));
      grossTotal += roundCents(th.grossIncomeCents / 12);
      employerSuperTotal += employerSuper + sacrifice;
      // Net income includes this person's rental share already (it was taxable income).
      netByPerson[p] = net;
      netTotal += net;
    }

    // ---- Spending
    const deflator = Math.pow(1 + a.inflation, i / 12);
    const livingGrowth = Math.pow(1 + a.livingCostGrowth, i / 12);
    let living = roundCents(input.livingCostsMonthlyCents * livingGrowth);
    let oneOff = 0;
    for (const e of input.events) {
      if (e.type === 'living-cost-change') {
        const f = overlapFraction(month, e.start, e.end ?? null);
        if (f > 0) living += roundCents(e.monthlyDeltaCents * f * livingGrowth);
      }
      if (e.type === 'child') {
        const f = overlapFraction(month, e.date, null);
        if (f > 0) living += roundCents(e.monthlyCostCents * f * livingGrowth);
      }
      if (e.type === 'large-expense' && e.date.slice(0, 7) === month) oneOff += e.amountCents;
      if (e.type === 'property-purchase' && e.date.slice(0, 7) === month) {
        oneOff += e.depositCents + e.costsCents;
        property += e.priceCents;
        const loanAmt = Math.max(0, e.priceCents - e.depositCents);
        if (loanAmt > 0) {
          loans.push({
            id: e.id,
            name: e.label ?? 'New home loan',
            balanceCents: loanAmt,
            annualRate: e.rate,
            monthlyRepaymentCents: 0,
            remainingYears: e.termYears,
            kind: 'mortgage',
            offsetWithCash: !loans.some((l) => l.offsetWithCash),
            rate: Math.max(0, e.rate + a.mortgageRateDelta),
            repayment: Math.ceil(annuityPayment(loanAmt, Math.max(0, e.rate + a.mortgageRateDelta) / 12, e.termYears * 12)),
            balance: loanAmt,
          });
        }
        rentSaved += e.rentSavedMonthlyCents ?? 0;
      }
    }
    living = Math.max(0, living - roundCents(rentSaved * livingGrowth));

    // ---- Loans
    let repayments = 0;
    for (const l of loans) {
      if (l.balance <= 0) continue;
      const offset = l.offsetWithCash ? Math.max(0, Math.min(cash, l.balance)) : 0;
      const interest = roundCents(((l.balance - offset) * l.rate) / 12);
      const pay = l.interestOnly ? interest : Math.min(l.repayment, l.balance + interest);
      l.balance = l.balance + interest - pay;
      repayments += pay;
    }

    // ---- Cash flow
    const surplus = netTotal - living - repayments - oneOff;
    if (i < 12) {
      firstYearIncome += netTotal;
      firstYearSpend += living;
    }
    const essentialMonthly = living + repayments;
    const emergencyTarget = essentialMonthly * a.emergencyFundMonths;
    let invested = 0;
    // Cash earns interest except the part sitting in an offset (which saves interest instead).
    const offsetUsed = loans.some((l) => l.offsetWithCash && l.balance > 0)
      ? Math.min(Math.max(0, cash), loans.filter((l) => l.offsetWithCash).reduce((s, l) => s + Math.max(0, l.balance), 0))
      : 0;
    cash += roundCents(Math.max(0, cash - offsetUsed) * cashMonthly);
    if (surplus >= 0) {
      const toCash = Math.max(0, Math.min(surplus, emergencyTarget - cash));
      const rest = surplus - toCash;
      invested = roundCents(rest * a.surplusInvestShare);
      cash += toCash + (rest - invested);
      investments += invested;
    } else {
      cash += surplus;
      if (cash < 0 && investments > 0) {
        const sell = Math.min(investments, -cash);
        investments -= sell;
        cash += sell;
        invested = -sell;
      }
    }
    const shortfall = cash < 0;
    if (shortfall) {
      shortfalls += 1;
      firstShortfall ??= month;
    }
    if (!emergencyReached && cash >= emergencyTarget && emergencyTarget > 0) emergencyReached = month;

    // ---- Growth
    investments = Math.max(0, investments + roundCents(investments * investMonthly));
    for (const p of people) superBal[p] += roundCents(superBal[p] * superMonthly);
    property += roundCents(property * propertyMonthly);
    otherAssets += roundCents(otherAssets * vehicleMonthly);

    const loansTotal = loans.reduce((s, l) => s + Math.max(0, l.balance), 0);
    const helpTotal = help.me + help.partner;
    const superTotal = superBal.me + superBal.partner;
    const assets = cash + investments + superTotal + property + otherAssets;
    const liabilities = loansTotal + helpTotal + input.opening.otherLiabilitiesCents;
    const nw = assets - liabilities;
    points.push({
      month,
      index: i,
      years,
      cashCents: cash,
      investmentsCents: investments,
      superCents: superTotal,
      superByPerson: { me: superBal.me, partner: superBal.partner },
      propertyCents: property,
      otherAssetsCents: otherAssets,
      loansCents: loansTotal,
      helpDebtCents: helpTotal,
      otherLiabilitiesCents: input.opening.otherLiabilitiesCents,
      assetsCents: assets,
      liabilitiesCents: liabilities,
      netWorthCents: nw,
      realNetWorthCents: roundCents(nw / Math.pow(1 + a.inflation, years)),
      grossIncomeCents: grossTotal,
      netIncomeCents: netTotal,
      netIncomeByPerson: netByPerson,
      rentalIncomeCents: rentalTotal,
      livingCostsCents: living,
      loanRepaymentsCents: repayments,
      oneOffCents: oneOff,
      surplusCents: surplus,
      investedCents: invested,
      employerSuperCents: employerSuperTotal,
      shortfall,
      deflator,
    });
  }

  if (input.months > 12 && rulesetForFinancialYear(financialYear(monthStart(addMonthKey(input.startMonth, input.months - 1)))).exact === false) {
    warnings.push('Tax thresholds for future years are not yet known; the latest ruleset is carried forward without indexation.');
  }
  if (shortfalls > 0) warnings.push(`Cash goes negative in ${shortfalls} month(s) — spending exceeds income and available savings.`);

  const horizons = [1, 5, 10, 20, 30]
    .filter((y) => y * 12 <= input.months)
    .map((y) => {
      const p = points[y * 12 - 1];
      return { years: y, netWorthCents: p.netWorthCents, realNetWorthCents: p.realNetWorthCents, cashCents: p.cashCents, liabilitiesCents: p.liabilitiesCents };
    });
  return {
    points,
    horizons,
    emergencyFundReachedMonth: emergencyReached,
    shortfallMonths: shortfalls,
    firstShortfall,
    averageSavingsRateFirstYear: firstYearIncome > 0 ? (firstYearIncome - firstYearSpend) / firstYearIncome : null,
    warnings,
  };
}

export const PRESET_ASSUMPTIONS: Record<'base' | 'optimistic' | 'conservative', Assumptions> = {
  base: {
    inflation: 0.025,
    salaryGrowth: 0.03,
    investmentReturn: 0.065,
    investmentFees: 0.002,
    investmentTaxDrag: 0.005,
    superReturn: 0.06,
    cashRate: 0.035,
    propertyGrowth: 0.04,
    mortgageRateDelta: 0,
    livingCostGrowth: 0.025,
    vehicleDepreciation: 0.15,
    emergencyFundMonths: 6,
    surplusInvestShare: 0.7,
  },
  optimistic: {
    inflation: 0.025,
    salaryGrowth: 0.04,
    investmentReturn: 0.08,
    investmentFees: 0.002,
    investmentTaxDrag: 0.005,
    superReturn: 0.075,
    cashRate: 0.04,
    propertyGrowth: 0.06,
    mortgageRateDelta: -0.005,
    livingCostGrowth: 0.025,
    vehicleDepreciation: 0.12,
    emergencyFundMonths: 6,
    surplusInvestShare: 0.8,
  },
  conservative: {
    inflation: 0.035,
    salaryGrowth: 0.02,
    investmentReturn: 0.045,
    investmentFees: 0.003,
    investmentTaxDrag: 0.007,
    superReturn: 0.045,
    cashRate: 0.03,
    propertyGrowth: 0.02,
    mortgageRateDelta: 0.015,
    livingCostGrowth: 0.035,
    vehicleDepreciation: 0.18,
    emergencyFundMonths: 6,
    surplusInvestShare: 0.6,
  },
};

export interface SensitivityRow {
  label: string;
  lowLabel: string;
  highLabel: string;
  lowCents: Cents;
  highCents: Cents;
}

/** Net worth at `years` under ± variations of key assumptions. */
export function sensitivity(input: ForecastInput, years: number): { baseCents: Cents; rows: SensitivityRow[] } {
  const months = Math.min(input.months, years * 12);
  const run = (patch: Partial<Assumptions>, livingFactor = 1) =>
    runForecast({ ...input, months, assumptions: { ...input.assumptions, ...patch }, livingCostsMonthlyCents: roundCents(input.livingCostsMonthlyCents * livingFactor) })
      .points[months - 1]?.netWorthCents ?? 0;
  const a = input.assumptions;
  const base = run({});
  const rows: SensitivityRow[] = [
    { label: 'Salary growth', lowLabel: '−1% p.a.', highLabel: '+1% p.a.', lowCents: run({ salaryGrowth: a.salaryGrowth - 0.01 }), highCents: run({ salaryGrowth: a.salaryGrowth + 0.01 }) },
    { label: 'Investment & super returns', lowLabel: '−2% p.a.', highLabel: '+2% p.a.', lowCents: run({ investmentReturn: a.investmentReturn - 0.02, superReturn: a.superReturn - 0.02 }), highCents: run({ investmentReturn: a.investmentReturn + 0.02, superReturn: a.superReturn + 0.02 }) },
    { label: 'Interest rates', lowLabel: '+2% (higher)', highLabel: '−1% (lower)', lowCents: run({ mortgageRateDelta: a.mortgageRateDelta + 0.02 }), highCents: run({ mortgageRateDelta: a.mortgageRateDelta - 0.01 }) },
    { label: 'Living costs', lowLabel: '+10%', highLabel: '−10%', lowCents: run({}, 1.1), highCents: run({}, 0.9) },
    { label: 'Property growth', lowLabel: '−2% p.a.', highLabel: '+2% p.a.', lowCents: run({ propertyGrowth: a.propertyGrowth - 0.02 }), highCents: run({ propertyGrowth: a.propertyGrowth + 0.02 }) },
    { label: 'Inflation (living costs)', lowLabel: '+1% p.a.', highLabel: '−1% p.a.', lowCents: run({ livingCostGrowth: a.livingCostGrowth + 0.01 }), highCents: run({ livingCostGrowth: a.livingCostGrowth - 0.01 }) },
  ];
  rows.sort((x, y) => Math.abs(y.highCents - y.lowCents) - Math.abs(x.highCents - x.lowCents));
  return { baseCents: base, rows };
}
