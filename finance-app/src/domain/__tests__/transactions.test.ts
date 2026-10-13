import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, BUILTIN_RULES } from '../categories';
import { applyCategorisation, detectRecurring, detectTransfers, mergeTransactions, summarise } from '../transactions';
import { OWN_JOINT, OWN_ME, OWN_PARTNER } from '../ownership';
import { holding, txn } from './fixtures';
import type { CategoryRule } from '../types';

const myAcc = holding('transaction', 1000, OWN_ME, { id: 'acc-me' });
const mySavings = holding('savings', 1000, OWN_ME, { id: 'acc-me-sav' });
const partnerAcc = holding('transaction', 1000, OWN_PARTNER, { id: 'acc-partner' });
const joint = holding('transaction', 1000, OWN_JOINT, { id: 'acc-joint' });
const accounts = [myAcc, mySavings, partnerAcc, joint];

describe('cash-flow summaries', () => {
  const txns = [
    txn('1', '2026-09-01', 5000, 'acc-me', { categoryId: 'inc-salary' }),
    txn('2', '2026-09-01', 4000, 'acc-partner', { categoryId: 'inc-salary' }),
    txn('3', '2026-09-03', -1000, 'acc-me', { transfer: 'internal', transferPairId: '4' }),
    txn('4', '2026-09-03', 1000, 'acc-me-sav', { transfer: 'internal', transferPairId: '3' }),
    txn('5', '2026-09-05', -800, 'acc-me', { transfer: 'between-partners', transferPairId: '6' }),
    txn('6', '2026-09-05', 800, 'acc-partner', { transfer: 'between-partners', transferPairId: '5' }),
    txn('7', '2026-09-06', -300, 'acc-joint', { categoryId: 'exp-groceries' }),
    txn('8', '2026-09-07', -200, 'acc-me', { categoryId: 'exp-eating' }),
    txn('9', '2026-09-08', 50, 'acc-me', { categoryId: 'exp-eating' }), // refund
    txn('10', '2026-09-09', -1500, 'acc-me', { categoryId: 'mov-investment' }),
    txn('11', '2026-09-10', -700, 'acc-joint', { categoryId: 'mov-debt' }),
  ];

  it('transfers do not inflate household income or spending', () => {
    const s = summarise(txns, DEFAULT_CATEGORIES, accounts, 'household', { month: '2026-09' });
    expect(s.incomeCents).toBe(900000);
    expect(s.essentialCents).toBe(30000);
    expect(s.discretionaryCents).toBe(15000);
    expect(s.consumptionCents).toBe(45000);
    expect(s.partnerTransfersInCents).toBe(0);
    expect(s.partnerTransfersOutCents).toBe(0);
  });

  it('partner transfers remain visible in individual views', () => {
    const me = summarise(txns, DEFAULT_CATEGORIES, accounts, 'me', { month: '2026-09' });
    const partner = summarise(txns, DEFAULT_CATEGORIES, accounts, 'partner', { month: '2026-09' });
    expect(me.partnerTransfersOutCents).toBe(80000);
    expect(partner.partnerTransfersInCents).toBe(80000);
    expect(me.incomeCents).toBe(500000);
  });

  it('investment purchases and debt principal are outflows but not consumption', () => {
    const s = summarise(txns, DEFAULT_CATEGORIES, accounts, 'household', { month: '2026-09' });
    expect(s.investmentCents).toBe(150000);
    expect(s.debtRepaymentCents).toBe(70000);
    expect(s.savingsRate).toBeCloseTo((900000 - 45000) / 900000, 6);
    // Net cash flow includes the investment and debt outflows.
    expect(s.netCashFlowCents).toBe(900000 - 45000 - 150000 - 70000);
  });

  it('individual and household cash flows reconcile', () => {
    const hh = summarise(txns, DEFAULT_CATEGORIES, accounts, 'household', { month: '2026-09' });
    const me = summarise(txns, DEFAULT_CATEGORIES, accounts, 'me', { month: '2026-09' });
    const pa = summarise(txns, DEFAULT_CATEGORIES, accounts, 'partner', { month: '2026-09' });
    expect(me.incomeCents + pa.incomeCents).toBe(hh.incomeCents);
    expect(me.consumptionCents + pa.consumptionCents).toBe(hh.consumptionCents);
    // Partner transfers cancel out between individuals.
    expect(me.netCashFlowCents + pa.netCashFlowCents).toBe(hh.netCashFlowCents);
  });

  it('reports the principal part of a loan repayment as a debt repayment, not consumption', () => {
    const loan = holding('mortgage-owner', 500000, OWN_JOINT, { id: 'loan' });
    const t = [
      txn('p1', '2026-09-01', -3000, 'acc-joint', { transfer: 'internal' }),
      txn('p2', '2026-09-01', 3000, 'loan', { transfer: 'internal' }),
      txn('p3', '2026-09-01', -2400, 'loan', { categoryId: 'exp-housing' }),
    ];
    const s = summarise(t, DEFAULT_CATEGORIES, [...accounts, loan], 'household', { month: '2026-09' });
    expect(s.essentialCents).toBe(240000); // interest is an expense
    expect(s.debtRepaymentCents).toBe(60000); // principal reduces the liability
    expect(s.netCashFlowCents).toBe(-300000); // the whole repayment left the household's cash
  });

  it('handles an empty month and negative cash flow', () => {
    const empty = summarise([], DEFAULT_CATEGORIES, accounts, 'household', { month: '2026-09' });
    expect(empty.savingsRate).toBeNull();
    const neg = summarise([txn('a', '2026-09-01', -500, 'acc-me', { categoryId: 'exp-travel' })], DEFAULT_CATEGORIES, accounts, 'household');
    expect(neg.netCashFlowCents).toBe(-50000);
  });
});

describe('duplicates and transfers', () => {
  it('skips re-imported transactions and flags near duplicates', () => {
    const existing = [txn('e1', '2026-09-01', -42.5, 'acc-me', { description: 'WOOLWORTHS 1234 SYDNEY' }), txn('e2', '2026-09-02', -10, 'acc-me', { externalId: 'x2' })];
    const incoming = [
      txn('i1', '2026-09-01', -42.5, 'acc-me', { description: 'WOOLWORTHS 1234 SYDNEY' }),
      txn('i2', '2026-09-02', -10, 'acc-me', { externalId: 'x2', description: 'different' }),
      txn('i3', '2026-09-03', -42.5, 'acc-me', { description: 'WOOLIES METRO' }),
      txn('i4', '2026-09-20', -99, 'acc-me'),
    ];
    const r = mergeTransactions(existing, incoming);
    expect(r.skipped.map((t) => t.id)).toEqual(['i1', 'i2']);
    expect(r.added.map((t) => t.id)).toEqual(['i3', 'i4']);
    expect(r.flagged.map((t) => t.id)).toEqual(['i3']);
  });

  it('keeps genuine repeated purchases within a batch', () => {
    const coffee = (id: string) => txn(id, '2026-09-01', -5, 'acc-me', { description: 'CAFE' });
    const r = mergeTransactions([coffee('e1')], [coffee('i1'), coffee('i2')]);
    expect(r.skipped).toHaveLength(1);
    expect(r.added).toHaveLength(1);
  });

  it('detects transfers and classifies partner transfers', () => {
    const t = [
      txn('a', '2026-09-03', -1000, 'acc-me', { description: 'TRANSFER TO SAVINGS' }),
      txn('b', '2026-09-03', 1000, 'acc-me-sav', { description: 'TRANSFER FROM' }),
      txn('c', '2026-09-05', -250, 'acc-me', { description: 'OSKO PAYMENT' }),
      txn('d', '2026-09-06', 250, 'acc-partner', { description: 'OSKO' }),
      txn('e', '2026-09-20', -77, 'acc-me'),
    ];
    const s = detectTransfers(t, accounts);
    expect(s).toHaveLength(2);
    expect(s.find((x) => x.outId === 'a')!.kind).toBe('internal');
    expect(s.find((x) => x.outId === 'c')!.kind).toBe('between-partners');
  });

  it('does not re-suggest pairs already marked as transfers on both sides', () => {
    const t = [
      txn('a', '2026-09-03', -1000, 'acc-me', { description: 'TRANSFER TO SAVINGS', transfer: 'internal' }),
      txn('b', '2026-09-03', 1000, 'acc-me-sav', { description: 'TRANSFER FROM', transfer: 'internal' }),
      txn('c', '2026-09-05', -400, 'acc-me', { description: 'TO SAVINGS', transfer: 'internal' }),
      txn('d', '2026-09-05', 400, 'acc-me-sav', { description: 'DEPOSIT' }),
    ];
    const s = detectTransfers(t, accounts);
    expect(s.map((x) => x.outId)).toEqual(['c']);
  });
});

describe('categorisation', () => {
  it('applies user rules before built-in rules and never overrides manual choices', () => {
    const rule: CategoryRule = { id: 'r1', name: 'x', field: 'description', op: 'contains', value: 'woolworths', setCategoryId: 'exp-shopping', priority: 1, enabled: true, createdAt: '' };
    const auto = txn('a', '2026-09-01', -50, 'acc-me', { description: 'WOOLWORTHS METRO', categorisation: { source: 'uncategorised', confidence: 0 } });
    expect(applyCategorisation(auto, [], BUILTIN_RULES).categoryId).toBe('exp-groceries');
    expect(applyCategorisation(auto, [rule], BUILTIN_RULES).categoryId).toBe('exp-shopping');
    const manual = { ...auto, categoryId: 'exp-health', categorisation: { source: 'manual' as const, confidence: 1 } };
    expect(applyCategorisation(manual, [rule], BUILTIN_RULES).categoryId).toBe('exp-health');
  });

  it('uses word boundaries for built-in keywords', () => {
    const t = txn('a', '2026-09-01', -50, 'acc-me', { description: 'CURRENT ACCOUNT', categorisation: { source: 'uncategorised', confidence: 0 } });
    expect(applyCategorisation(t, [], BUILTIN_RULES).categoryId).toBeNull();
  });

  it('detects monthly recurring payments', () => {
    const t = ['2026-06-03', '2026-07-03', '2026-08-04', '2026-09-03'].map((d, i) => txn(`n${i}`, d, -22.99, 'acc-me', { description: 'NETFLIX.COM' }));
    const r = detectRecurring(t);
    expect(r).toHaveLength(1);
    expect(r[0].frequency).toBe('monthly');
    expect(r[0].nextExpected >= '2026-10-01').toBe(true);
  });
});
