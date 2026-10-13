/**
 * Net-worth history.
 *
 * - "Recorded" snapshots are taken from the balance sheet as it stood on the day they were
 *   recorded (automatically once a month, or on demand).
 * - "Reconstructed" points are estimated from each holding's valuation history for dates
 *   where no snapshot was recorded. They are labelled as estimates in the UI because a
 *   holding without a valuation on or before that date is simply absent.
 */
import { addMonthKey, monthEnd, monthKey, type ISODate, type MonthKey } from './dates';
import { categoryMeta } from './holdingCategories';
import type { Cents } from './money';
import { computeBalanceSheet, totalsOf, valueOnDate, type StalenessSettings } from './networth';
import { amountForPerspective } from './ownership';
import type { Holding, NetWorthSnapshot, NetWorthTotals, Perspective, Transaction, Category } from './types';

export function takeSnapshot(
  holdings: Holding[],
  settings: StalenessSettings,
  date: ISODate,
  id: string,
  kind: NetWorthSnapshot['kind'] = 'recorded',
): NetWorthSnapshot {
  const historical = kind === 'reconstructed';
  const hh = computeBalanceSheet(holdings, 'household', settings, date, { historical });
  const me = computeBalanceSheet(holdings, 'me', settings, date, { historical });
  const partner = computeBalanceSheet(holdings, 'partner', settings, date, { historical });
  const active = holdings.filter((h) => !h.archived);
  const covered = active.filter((h) => valueOnDate(h, date) !== null).length;
  return {
    id,
    date,
    recordedAt: new Date().toISOString(),
    kind,
    household: totalsOf(hh),
    me: totalsOf(me),
    partner: totalsOf(partner),
    coverage: active.length ? covered / active.length : 1,
  };
}

export interface HistoryPoint extends NetWorthTotals {
  month: MonthKey;
  date: ISODate;
  kind: 'recorded' | 'reconstructed';
  coverage: number;
}

/**
 * Build a monthly series for a perspective: one point per month from `from` to `to`.
 * Uses the latest recorded snapshot in each month where available, otherwise reconstructs.
 */
export function buildHistorySeries(
  snapshots: NetWorthSnapshot[],
  holdings: Holding[],
  settings: StalenessSettings,
  perspective: Perspective,
  from: MonthKey,
  to: MonthKey,
): HistoryPoint[] {
  const byMonth = new Map<MonthKey, NetWorthSnapshot>();
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (s.kind === 'recorded') byMonth.set(monthKey(s.date), s);
  }
  const out: HistoryPoint[] = [];
  let m = from;
  let guard = 0;
  while (m <= to && guard++ < 600) {
    const rec = byMonth.get(m);
    if (rec) {
      out.push({ ...rec[perspective], month: m, date: rec.date, kind: 'recorded', coverage: 1 });
    } else {
      const date = monthEnd(m);
      const active = holdings.filter((h) => !h.archived);
      const covered = active.filter((h) => valueOnDate(h, date) !== null).length;
      if (covered > 0) {
        const bs = computeBalanceSheet(holdings, perspective, settings, date, { historical: true });
        out.push({ ...totalsOf(bs), month: m, date, kind: 'reconstructed', coverage: active.length ? covered / active.length : 0 });
      }
    }
    m = addMonthKey(m, 1);
  }
  return out;
}

export interface ChangeComponent {
  key: string;
  label: string;
  cents: Cents;
  basis: string;
}

/**
 * Explain a change in net worth between two dates as far as the data allows.
 * Components always sum to the total change.
 */
export function explainChange(
  holdings: Holding[],
  transactions: Transaction[],
  categories: Category[],
  settings: StalenessSettings,
  perspective: Perspective,
  from: ISODate,
  to: ISODate,
): { totalCents: Cents; components: ChangeComponent[] } {
  let cash = 0;
  let investments = 0;
  let superDelta = 0;
  let propertyReval = 0;
  let debt = 0;
  let other = 0;
  let newItems = 0;

  for (const h of holdings) {
    if (h.archived) continue;
    const a = valueOnDate(h, from);
    const b = valueOnDate(h, to);
    if (!b) continue;
    const meta = categoryMeta(h.category);
    const fx = h.currency === 'AUD' ? 1 : settings.fx[h.currency]?.audPerUnit;
    if (!fx) continue;
    const toV = amountForPerspective(Math.round(b.valueCents * fx), h.ownership, perspective);
    const fromV = a ? amountForPerspective(Math.round(a.valueCents * fx), h.ownership, perspective) : 0;
    const delta = meta.kind === 'asset' ? toV - fromV : -(toV - fromV);
    if (!a) {
      newItems += delta;
      continue;
    }
    if (meta.kind === 'liability') debt += delta;
    else if (meta.group === 'cash') cash += delta;
    else if (meta.group === 'investments') investments += delta;
    else if (meta.group === 'super') superDelta += delta;
    else if (meta.group === 'property') propertyReval += delta;
    else other += delta;
  }

  // Split investment change into contributions (from categorised transactions) and market movement.
  const investCats = new Set(categories.filter((c) => c.treatment === 'investment').map((c) => c.id));
  let contributions = 0;
  for (const t of transactions) {
    if (t.excluded || t.date <= from || t.date > to || !t.categoryId || !investCats.has(t.categoryId)) continue;
    if (t.amountCents < 0) contributions += -t.amountCents;
  }
  contributions = Math.min(Math.max(contributions, 0), Math.max(investments, 0));
  const market = investments - contributions;

  const components: ChangeComponent[] = [
    { key: 'cash', label: 'Cash & deposits', cents: cash, basis: 'Change in recorded account balances' },
    { key: 'contributions', label: 'Investment contributions', cents: contributions, basis: 'Transactions categorised as investments' },
    { key: 'market', label: 'Investment performance (est.)', cents: market, basis: 'Investment value change not explained by contributions' },
    { key: 'super', label: 'Superannuation', cents: superDelta, basis: 'Contributions and returns combined' },
    { key: 'property', label: 'Property revaluations', cents: propertyReval, basis: 'Updated property valuations' },
    { key: 'debt', label: 'Debt repaid', cents: debt, basis: 'Reduction in loan and card balances (negative = more debt)' },
    { key: 'other', label: 'Vehicles & other', cents: other, basis: 'Revaluations of other assets' },
    { key: 'new', label: 'New items', cents: newItems, basis: 'Items with no value recorded at the start date' },
  ].filter((c) => c.cents !== 0);
  const totalCents = components.reduce((a, c) => a + c.cents, 0);
  return { totalCents, components };
}
