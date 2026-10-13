/**
 * Debt repayment planner: avalanche (highest rate first) vs snowball (smallest balance first).
 * Monthly simulation; interest = balance × rate / 12 rounded to cents; minimum payments are
 * paid on every debt, the extra budget plus any freed-up minimums go to the target debt.
 */
import { roundCents, type Cents } from './money';

export interface DebtInput {
  id: string;
  name: string;
  balanceCents: Cents;
  annualRate: number;
  minimumCents: Cents;
}

export interface DebtPlanResult {
  strategy: 'avalanche' | 'snowball' | 'minimum';
  months: number | null;
  totalInterestCents: Cents;
  totalPaidCents: Cents;
  payoffOrder: { id: string; name: string; month: number }[];
  balances: { month: number; totalCents: Cents }[];
}

export function planDebts(debts: DebtInput[], extraMonthlyCents: Cents, strategy: DebtPlanResult['strategy']): DebtPlanResult {
  const state = debts.filter((d) => d.balanceCents > 0).map((d) => ({ ...d, balance: d.balanceCents }));
  const budget = state.reduce((a, d) => a + d.minimumCents, 0) + (strategy === 'minimum' ? 0 : extraMonthlyCents);
  let interestTotal = 0;
  let paidTotal = 0;
  const payoffOrder: DebtPlanResult['payoffOrder'] = [];
  const balances: DebtPlanResult['balances'] = [{ month: 0, totalCents: state.reduce((a, d) => a + d.balance, 0) }];
  let month = 0;
  while (state.some((d) => d.balance > 0) && month < 1200) {
    month += 1;
    for (const d of state) {
      if (d.balance <= 0) continue;
      const i = roundCents((d.balance * d.annualRate) / 12);
      d.balance += i;
      interestTotal += i;
    }
    let available = budget;
    for (const d of state) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minimumCents, d.balance, available);
      d.balance -= pay;
      available -= pay;
      paidTotal += pay;
    }
    const open = state.filter((d) => d.balance > 0);
    open.sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.annualRate - a.annualRate || a.balance - b.balance));
    for (const d of open) {
      if (available <= 0) break;
      const pay = Math.min(available, d.balance);
      d.balance -= pay;
      available -= pay;
      paidTotal += pay;
    }
    for (const d of state) {
      if (d.balance <= 0 && !payoffOrder.some((p) => p.id === d.id)) payoffOrder.push({ id: d.id, name: d.name, month });
    }
    balances.push({ month, totalCents: state.reduce((a, d) => a + Math.max(0, d.balance), 0) });
    // Guard against minimums that never cover interest.
    if (month > 12 && balances[month].totalCents >= balances[month - 12].totalCents) {
      return { strategy, months: null, totalInterestCents: interestTotal, totalPaidCents: paidTotal, payoffOrder, balances };
    }
  }
  return { strategy, months: state.some((d) => d.balance > 0) ? null : month, totalInterestCents: interestTotal, totalPaidCents: paidTotal, payoffOrder, balances };
}
