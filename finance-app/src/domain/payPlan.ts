/**
 * The pay plan: where each person's take-home pay goes each payday (bills account, spending,
 * savings pots, investing), in fixed amounts or percentages. What's left stays in the everyday
 * account. The app shows the transfers to set up in the bank; it never moves money itself.
 */
import { roundCents, type Cents } from './money';
import type { PayFrequency, PersonId, RecurringBill } from './types';

export interface PayPlanLine {
  id: string;
  name: string;
  mode: 'fixed' | 'percent';
  /** Monthly amount when mode is fixed. */
  amountCents: Cents;
  /** Percent of take-home pay when mode is percent, 0–100. */
  percent: number;
  /** Where the money goes (an account in the app), if set. */
  destinationHoldingId: string | null;
}

export interface PayPlan {
  lines: PayPlanLine[];
}

export interface PayPlanRow {
  line: PayPlanLine;
  monthlyCents: Cents;
  perPayCents: Cents;
}

export interface PayPlanResult {
  rows: PayPlanRow[];
  takeHomeMonthlyCents: Cents;
  takeHomePerPayCents: Cents;
  allocatedMonthlyCents: Cents;
  leftoverMonthlyCents: Cents;
  leftoverPerPayCents: Cents;
  /** Fraction of take-home pay the plan sets aside (savings and pots), 0 when there's no income. */
  allocatedShare: number;
}

export const PAYS_PER_MONTH: Record<PayFrequency, number> = { weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1 };

export function computePayPlan(takeHomeMonthlyCents: Cents, frequency: PayFrequency, plan: PayPlan | undefined): PayPlanResult {
  const perPay = (monthly: Cents) => roundCents(monthly / PAYS_PER_MONTH[frequency]);
  const rows = (plan?.lines ?? []).map((line) => {
    const monthlyCents = line.mode === 'percent' ? roundCents((takeHomeMonthlyCents * Math.max(0, line.percent)) / 100) : Math.max(0, line.amountCents);
    return { line, monthlyCents, perPayCents: perPay(monthlyCents) };
  });
  const allocatedMonthlyCents = rows.reduce((a, r) => a + r.monthlyCents, 0);
  const leftoverMonthlyCents = takeHomeMonthlyCents - allocatedMonthlyCents;
  return {
    rows,
    takeHomeMonthlyCents,
    takeHomePerPayCents: perPay(takeHomeMonthlyCents),
    allocatedMonthlyCents,
    leftoverMonthlyCents,
    leftoverPerPayCents: perPay(leftoverMonthlyCents),
    allocatedShare: takeHomeMonthlyCents > 0 ? allocatedMonthlyCents / takeHomeMonthlyCents : 0,
  };
}

const MONTHS_PER: Partial<Record<RecurringBill['frequency'], number>> = { quarterly: 3, annually: 12 };

/**
 * Monthly amount to put aside so quarterly and yearly bills (rego, insurance, rates) are covered
 * when they fall due. A person's own bills count in full, household bills half each.
 */
export function yearlyBillsMonthly(bills: RecurringBill[], person: PersonId): Cents {
  let total = 0;
  for (const b of bills) {
    const months = MONTHS_PER[b.frequency];
    if (!months || !b.active || b.kind === 'income') continue;
    const share = b.scope === person ? 1 : b.scope === 'household' ? 0.5 : 0;
    total += (Math.abs(b.amountCents) * share) / months;
  }
  return roundCents(total);
}
