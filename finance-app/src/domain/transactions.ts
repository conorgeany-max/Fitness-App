/**
 * Transaction processing: categorisation rules, duplicate detection, transfer matching
 * and monthly cash-flow summaries.
 *
 * Accounting treatment (see docs/CALCULATIONS.md):
 * - Income: categories with treatment "income".
 * - Consumption spending: categories with treatment "expense" (refunds reduce spending).
 * - Transfers between our own accounts are excluded from income and spending. Transfers
 *   between partners are excluded from household figures but shown in individual views
 *   as "transfers to/from partner".
 * - Investment purchases and debt principal repayments are cash outflows but NOT
 *   consumption: they move money into assets or reduce liabilities.
 * - Savings rate = (income − consumption spending) / income. Investment contributions and
 *   principal repayments therefore count as saving. Cash-flow rate = net cash flow / income.
 */
import { addDays, diffDays, monthKey, type ISODate, type MonthKey } from './dates';
import { amountForPerspective, soleOwner } from './ownership';
import type { Cents } from './money';
import type { Category, CategoryRule, Holding, Ownership, Perspective, Transaction, TransferKind } from './types';

export function normaliseDescription(s: string): string {
  return s
    .toUpperCase()
    .replace(/\b(CARD|VISA|EFTPOS|DEBIT|PURCHASE|POS|AUS|AU|PTY|LTD)\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^A-Z0-9&./ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short merchant key for grouping (first two meaningful words). */
export function merchantKey(t: Pick<Transaction, 'merchant' | 'description'>): string {
  if (t.merchant) return t.merchant.toUpperCase();
  return normaliseDescription(t.description).split(' ').filter((w) => w.length > 1 && !/^\d/.test(w)).slice(0, 2).join(' ');
}

const regexCache = new Map<string, RegExp | null>();
function safeRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  // Guard against pathological patterns: limit length and nested quantifiers.
  if (pattern.length <= 200 && !/(\+|\*|\})\)?(\+|\*|\{)/.test(pattern)) {
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = null;
    }
  }
  regexCache.set(pattern, re);
  return re;
}

export function ruleMatches(rule: CategoryRule, t: Transaction): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== t.accountId) return false;
  if (rule.direction === 'in' && t.amountCents <= 0) return false;
  if (rule.direction === 'out' && t.amountCents >= 0) return false;
  const abs = Math.abs(t.amountCents);
  if (rule.minAmountCents != null && abs < rule.minAmountCents) return false;
  if (rule.maxAmountCents != null && abs > rule.maxAmountCents) return false;
  const hay = (rule.field === 'merchant' ? t.merchant ?? '' : t.description).toUpperCase();
  const needle = rule.value.toUpperCase();
  if (!needle) return false;
  switch (rule.op) {
    case 'contains':
      if (rule.id.startsWith('builtin-')) {
        const esc = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^A-Z0-9])${esc}([^A-Z0-9]|$)`).test(hay);
      }
      return hay.includes(needle);
    case 'startsWith':
      return hay.startsWith(needle);
    case 'equals':
      return hay.trim() === needle.trim();
    case 'regex':
      return safeRegex(rule.value)?.test(hay) ?? false;
  }
}

export interface CategorisationResult {
  categoryId: string | null;
  transfer?: TransferKind;
  merchant?: string;
  ruleId?: string;
  source: Transaction['categorisation']['source'];
  confidence: number;
}

/** Apply user rules (by priority), then built-in rules. Manual categorisations are never overridden. */
export function categorise(t: Transaction, userRules: CategoryRule[], builtinRules: CategoryRule[]): CategorisationResult | null {
  if (t.categorisation.source === 'manual') return null;
  const ordered = [...userRules].sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (ruleMatches(r, t)) {
      return { categoryId: r.setCategoryId, transfer: r.setTransfer, merchant: r.setMerchant, ruleId: r.id, source: 'rule', confidence: 0.95 };
    }
  }
  for (const r of builtinRules) {
    if (ruleMatches(r, t)) {
      // Built-in rules only categorise; they never decide that something is a transfer.
      const cat = r.setCategoryId;
      if (cat.startsWith('inc-') && t.amountCents < 0) continue;
      return { categoryId: cat, ruleId: r.id, source: 'builtin-rule', confidence: 0.7 };
    }
  }
  return { categoryId: null, source: 'uncategorised', confidence: 0 };
}

export function applyCategorisation(t: Transaction, userRules: CategoryRule[], builtinRules: CategoryRule[]): Transaction {
  const r = categorise(t, userRules, builtinRules);
  if (!r) return t;
  // Keep provider-supplied categories when no rule matched.
  if (r.source === 'uncategorised' && t.categoryId && t.categorisation.source === 'provider') return t;
  return {
    ...t,
    categoryId: r.categoryId,
    transfer: r.transfer ?? t.transfer,
    merchant: r.merchant ?? t.merchant,
    categorisation: { source: r.source, ruleId: r.ruleId, confidence: r.confidence },
  };
}

/** Suggest a rule from a manual correction. */
export function suggestRule(t: Transaction, categoryId: string): Pick<CategoryRule, 'field' | 'op' | 'value' | 'setCategoryId' | 'name'> {
  const key = t.merchant ? t.merchant : merchantKey(t);
  return { field: t.merchant ? 'merchant' : 'description', op: 'contains', value: key, setCategoryId: categoryId, name: `Contains "${key}"` };
}

// ------------------------------------------------------------------ Duplicates

export function fingerprint(t: Pick<Transaction, 'date' | 'amountCents' | 'description' | 'accountId'>): string {
  return `${t.accountId ?? '-'}|${t.date}|${t.amountCents}|${normaliseDescription(t.description)}`;
}

export interface ImportOutcome {
  added: Transaction[];
  /** Exact duplicates skipped (same external id, or same fingerprint as an existing transaction). */
  skipped: Transaction[];
  /** Added but flagged for review: same account/amount within 3 days with a different description. */
  flagged: Transaction[];
}

/**
 * Merge incoming transactions with existing ones without double-counting.
 * - Same provider external id → skipped (re-sync of the same transaction).
 * - Same account, date, amount and normalised description → skipped as exact duplicate,
 *   unless the incoming batch itself contains the same fingerprint several times (genuine
 *   repeated purchases) — those are kept up to the count present in the batch, and the
 *   repeats are flagged for review.
 * - Same account and amount within ±3 days → added but flagged as a possible duplicate.
 */
export function mergeTransactions(existing: Transaction[], incoming: Transaction[]): ImportOutcome {
  const byExternal = new Set(existing.filter((t) => t.externalId).map((t) => `${t.accountId}|${t.externalId}`));
  const existingFp = new Map<string, number>();
  for (const t of existing) existingFp.set(fingerprint(t), (existingFp.get(fingerprint(t)) ?? 0) + 1);
  const seenInBatch = new Map<string, number>();
  const batchFirst = new Map<string, Transaction>();
  const added: Transaction[] = [];
  const skipped: Transaction[] = [];
  const flagged: Transaction[] = [];
  const byAccountAmount = new Map<string, Transaction[]>();
  for (const t of existing) {
    const k = `${t.accountId}|${t.amountCents}`;
    (byAccountAmount.get(k) ?? byAccountAmount.set(k, []).get(k)!).push(t);
  }

  for (const t of incoming) {
    if (t.externalId && byExternal.has(`${t.accountId}|${t.externalId}`)) {
      skipped.push(t);
      continue;
    }
    const fp = fingerprint(t);
    const n = (seenInBatch.get(fp) ?? 0) + 1;
    seenInBatch.set(fp, n);
    if (n <= (existingFp.get(fp) ?? 0)) {
      skipped.push(t);
      continue;
    }
    // A repeat of a fingerprint already added from this batch is kept (it may be a genuine
    // second purchase) but flagged, so a feed that resends items doesn't double-count silently.
    const near =
      (n > 1 ? batchFirst.get(fp) : undefined) ??
      (byAccountAmount.get(`${t.accountId}|${t.amountCents}`) ?? []).find((e) => !e.excluded && Math.abs(diffDays(e.date, t.date)) <= 3 && fingerprint(e) !== fp);
    const out = near ? { ...t, possibleDuplicateOf: near.id } : t;
    if (near) flagged.push(out);
    added.push(out);
    if (!batchFirst.has(fp)) batchFirst.set(fp, out);
    if (t.externalId) byExternal.add(`${t.accountId}|${t.externalId}`);
  }
  return { added, skipped, flagged };
}

// ------------------------------------------------------------------ Transfers

export interface TransferSuggestion {
  outId: string;
  inId: string;
  kind: TransferKind;
  confidence: 'high' | 'medium';
  reason: string;
}

const TRANSFER_WORDS = /\b(TRANSFER|TFR|XFER|INTERNET BANKING|OSKO|PAYID|TO SAVINGS|FROM SAVINGS|PAYMENT RECEIVED|THANK YOU|BPAY)\b/i;

export function transferKindBetween(a: Ownership, b: Ownership): TransferKind {
  const oa = soleOwner(a);
  const ob = soleOwner(b);
  if (oa && ob && oa !== ob) return 'between-partners';
  return 'internal';
}

/**
 * Find likely transfers: an outflow and an inflow of the same absolute amount, in two
 * different accounts we own, within 3 days. Only unmatched, non-excluded transactions are
 * considered. Each transaction is used at most once.
 */
export function detectTransfers(transactions: Transaction[], accounts: Holding[]): TransferSuggestion[] {
  const owned = new Map(accounts.map((a) => [a.id, a]));
  const candidates = transactions.filter((t) => !t.excluded && !t.transferPairId && t.accountId && owned.has(t.accountId));
  const inflows = candidates.filter((t) => t.amountCents > 0);
  const used = new Set<string>();
  const out: TransferSuggestion[] = [];
  const outflows = candidates.filter((t) => t.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date));
  for (const o of outflows) {
    const matches = inflows.filter(
      (i) => !used.has(i.id) && i.accountId !== o.accountId && i.amountCents === -o.amountCents && Math.abs(diffDays(o.date, i.date)) <= 3,
    );
    if (matches.length === 0) continue;
    matches.sort((a, b) => Math.abs(diffDays(o.date, a.date)) - Math.abs(diffDays(o.date, b.date)));
    const m = matches[0];
    // Both sides already marked as transfers (by hand or by a rule): nothing left to decide.
    if (o.transfer !== 'none' && m.transfer !== 'none') {
      used.add(m.id);
      continue;
    }
    used.add(m.id);
    const kind = transferKindBetween(owned.get(o.accountId!)!.ownership, owned.get(m.accountId!)!.ownership);
    const worded = TRANSFER_WORDS.test(o.description) || TRANSFER_WORDS.test(m.description);
    out.push({
      outId: o.id,
      inId: m.id,
      kind,
      confidence: worded && matches.length === 1 ? 'high' : 'medium',
      reason: `${worded ? 'Transfer wording, ' : ''}same amount, ${Math.abs(diffDays(o.date, m.date))} day(s) apart${matches.length > 1 ? `, ${matches.length} candidates` : ''}`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ Summaries

export interface CashFlowSummary {
  month: MonthKey | 'range';
  incomeCents: Cents;
  essentialCents: Cents;
  discretionaryCents: Cents;
  consumptionCents: Cents;
  debtRepaymentCents: Cents;
  investmentCents: Cents;
  savingsTransfersCents: Cents;
  partnerTransfersInCents: Cents;
  partnerTransfersOutCents: Cents;
  uncategorisedOutCents: Cents;
  uncategorisedInCents: Cents;
  netCashFlowCents: Cents;
  /** (income − consumption) / income; null when there is no income. */
  savingsRate: number | null;
  /** net cash flow / income */
  cashFlowRate: number | null;
  byCategory: Map<string, Cents>;
  transactionCount: number;
}

export function ownershipOf(t: Transaction, accounts: Map<string, Holding>): Ownership {
  if (t.ownershipOverride) return t.ownershipOverride;
  const acc = t.accountId ? accounts.get(t.accountId) : undefined;
  return acc ? acc.ownership : { me: 50, partner: 50 };
}

/** Amount of a transaction attributed to a perspective (signed). */
export function perspectiveAmount(t: Transaction, perspective: Perspective, accounts: Map<string, Holding>): Cents {
  return amountForPerspective(t.amountCents, ownershipOf(t, accounts), perspective);
}

export function summarise(
  transactions: Transaction[],
  categories: Category[],
  accounts: Holding[],
  perspective: Perspective,
  filter: { month?: MonthKey; from?: ISODate; to?: ISODate } = {},
): CashFlowSummary {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const s: CashFlowSummary = {
    month: filter.month ?? 'range',
    incomeCents: 0,
    essentialCents: 0,
    discretionaryCents: 0,
    consumptionCents: 0,
    debtRepaymentCents: 0,
    investmentCents: 0,
    savingsTransfersCents: 0,
    partnerTransfersInCents: 0,
    partnerTransfersOutCents: 0,
    uncategorisedOutCents: 0,
    uncategorisedInCents: 0,
    netCashFlowCents: 0,
    savingsRate: null,
    cashFlowRate: null,
    byCategory: new Map(),
    transactionCount: 0,
  };
  // Repayments into loan accounts are transfers; their principal portion (payment minus the
  // interest charged on that loan in the period) is reported as a debt repayment outflow.
  const loanPayments = new Map<string, Cents>();
  const loanInterest = new Map<string, Cents>();
  const isLoan = (id: string | null) => {
    const acc = id ? accMap.get(id) : undefined;
    return !!acc && acc.kind === 'liability' && acc.category !== 'credit-card' && acc.category !== 'bnpl';
  };
  for (const t of transactions) {
    if (t.excluded) continue;
    if (filter.month && monthKey(t.date) !== filter.month) continue;
    if (filter.from && t.date < filter.from) continue;
    if (filter.to && t.date > filter.to) continue;
    const own = ownershipOf(t, accMap);
    if (perspective !== 'household' && own[perspective] <= 0) continue;
    const amt = amountForPerspective(t.amountCents, own, perspective);
    if (amt === 0) continue;
    s.transactionCount += 1;

    if (t.transfer === 'between-partners') {
      if (perspective === 'household') continue; // money stays in the household
      if (amt > 0) s.partnerTransfersInCents += amt;
      else s.partnerTransfersOutCents += -amt;
      s.netCashFlowCents += amt;
      continue;
    }
    if (t.transfer === 'internal') {
      if (amt > 0 && isLoan(t.accountId)) loanPayments.set(t.accountId!, (loanPayments.get(t.accountId!) ?? 0) + amt);
      continue; // between our own accounts: no effect on income, spending or net cash flow
    }
    const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
    if (cat?.treatment === 'expense' && amt < 0 && isLoan(t.accountId)) loanInterest.set(t.accountId!, (loanInterest.get(t.accountId!) ?? 0) - amt);
    s.netCashFlowCents += amt;
    if (!cat) {
      if (amt < 0) s.uncategorisedOutCents += -amt;
      else s.uncategorisedInCents += amt;
      continue;
    }
    s.byCategory.set(cat.id, (s.byCategory.get(cat.id) ?? 0) + amt);
    switch (cat.treatment) {
      case 'income':
        s.incomeCents += amt;
        break;
      case 'expense':
        // Refunds (positive amounts) reduce spending.
        if (cat.essential) s.essentialCents += -amt;
        else s.discretionaryCents += -amt;
        break;
      case 'investment':
        s.investmentCents += -amt;
        break;
      case 'debt-repayment':
        s.debtRepaymentCents += -amt;
        break;
      case 'transfer':
        // Categorised as a transfer but not paired with the other side: track as savings movement.
        s.savingsTransfersCents += -amt;
        s.netCashFlowCents -= amt; // a movement between own accounts is not a net cash flow
        break;
    }
  }
  for (const [acc, paid] of loanPayments) {
    const principal = Math.max(0, paid - (loanInterest.get(acc) ?? 0));
    s.debtRepaymentCents += principal;
    s.netCashFlowCents -= principal;
  }
  // Uncategorised outflows are treated as discretionary consumption until reviewed (conservative).
  s.consumptionCents = s.essentialCents + s.discretionaryCents + s.uncategorisedOutCents;
  s.savingsRate = s.incomeCents > 0 ? (s.incomeCents - s.consumptionCents) / s.incomeCents : null;
  s.cashFlowRate = s.incomeCents > 0 ? s.netCashFlowCents / s.incomeCents : null;
  return s;
}

/** Average monthly consumption over the last `months` complete months before `today`. */
export function averageMonthlySpending(
  transactions: Transaction[],
  categories: Category[],
  accounts: Holding[],
  perspective: Perspective,
  months: MonthKey[],
): { consumption: Cents; essential: Cents; income: Cents; housing: Cents; monthsWithData: number } {
  let consumption = 0;
  let essential = 0;
  let income = 0;
  let housing = 0;
  let monthsWithData = 0;
  const housingIds = new Set(['exp-housing', 'exp-rent']);
  for (const m of months) {
    const s = summarise(transactions, categories, accounts, perspective, { month: m });
    if (s.transactionCount === 0) continue;
    monthsWithData += 1;
    consumption += s.consumptionCents;
    essential += s.essentialCents;
    income += s.incomeCents;
    for (const id of housingIds) housing += -(s.byCategory.get(id) ?? 0);
  }
  const d = Math.max(1, monthsWithData);
  return {
    consumption: Math.round(consumption / d),
    essential: Math.round(essential / d),
    income: Math.round(income / d),
    housing: Math.round(housing / d),
    monthsWithData,
  };
}

// ------------------------------------------------------------------ Recurring detection

export interface RecurringCandidate {
  key: string;
  label: string;
  averageCents: Cents;
  cadenceDays: number;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';
  occurrences: number;
  lastDate: ISODate;
  nextExpected: ISODate;
  categoryId: string | null;
  accountId: string | null;
  transactionIds: string[];
}

const CADENCES: { f: RecurringCandidate['frequency']; days: number; tol: number }[] = [
  { f: 'weekly', days: 7, tol: 2 },
  { f: 'fortnightly', days: 14, tol: 3 },
  { f: 'monthly', days: 30.4, tol: 5 },
  { f: 'quarterly', days: 91, tol: 10 },
  { f: 'annually', days: 365, tol: 20 },
];

/** 'NETFLIX.COM' → 'Netflix.com': bank feeds shout; labels shouldn't. */
export function tidyLabel(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

export function detectRecurring(transactions: Transaction[], minOccurrences = 3): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.excluded || t.amountCents >= 0 || t.transfer !== 'none') continue;
    const k = merchantKey(t);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  const out: RecurringCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < minOccurrences) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push(diffDays(list[i - 1].date, list[i].date));
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const cadence = CADENCES.find((c) => Math.abs(median - c.days) <= c.tol);
    if (!cadence) continue;
    const regular = gaps.filter((g) => Math.abs(g - cadence.days) <= cadence.tol).length / gaps.length;
    if (regular < 0.7) continue;
    const amounts = list.map((t) => -t.amountCents);
    const avg = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    const consistent = amounts.every((a) => Math.abs(a - avg) <= Math.max(200, avg * 0.15));
    if (!consistent) continue;
    const last = list[list.length - 1];
    out.push({
      key,
      label: last.merchant ?? tidyLabel(key),
      averageCents: avg,
      cadenceDays: cadence.days,
      frequency: cadence.f,
      occurrences: list.length,
      lastDate: last.date,
      nextExpected: addDays(last.date, Math.round(cadence.days)),
      categoryId: last.categoryId,
      accountId: last.accountId,
      transactionIds: list.map((t) => t.id),
    });
  }
  return out.sort((a, b) => b.averageCents - a.averageCents);
}

/** Expenses that are unusually large for their category (> 3x the category median, > $100). */
export function unusualTransactions(transactions: Transaction[], categories: Category[], since: ISODate): Transaction[] {
  const expenseCats = new Set(categories.filter((c) => c.treatment === 'expense').map((c) => c.id));
  const byCat = new Map<string, number[]>();
  for (const t of transactions) {
    if (t.excluded || t.amountCents >= 0 || !t.categoryId || !expenseCats.has(t.categoryId) || t.transfer !== 'none') continue;
    (byCat.get(t.categoryId) ?? byCat.set(t.categoryId, []).get(t.categoryId)!).push(-t.amountCents);
  }
  const medians = new Map<string, number>();
  for (const [k, v] of byCat) {
    if (v.length < 5) continue;
    const s = [...v].sort((a, b) => a - b);
    medians.set(k, s[Math.floor(s.length / 2)]);
  }
  return transactions.filter((t) => {
    if (t.excluded || t.date < since || t.amountCents >= 0 || !t.categoryId || t.transfer !== 'none') return false;
    const med = medians.get(t.categoryId);
    return med !== undefined && -t.amountCents > 3 * med && -t.amountCents > 10000;
  });
}
