/**
 * Investment targets: how the household wants its shares and ETFs split, how far each fund is
 * from its target, and where the next contribution would best go.
 *
 * Suggestions only. The app never places a trade; the person buys through their own broker.
 * Values come from synced holdings (SnapTrade positions) the viewer can already see.
 */
import { allocate, roundCents, toBaseCurrency, type Cents } from './money';
import { amountForPerspective } from './ownership';
import { visibilityFor, type StalenessSettings } from './networth';
import type { Holding, Perspective } from './types';

export interface InvestmentTarget {
  /** Ticker as the broker reports it, e.g. VGS or VAS. Matched without case or exchange prefix. */
  symbol: string;
  /** Percent of the invested total, 0–100. */
  percent: number;
}

export interface AllocationRow {
  symbol: string;
  label: string;
  valueCents: Cents;
  /** Fraction of the invested total. */
  currentShare: number;
  /** Fraction, or null when the fund has no target. */
  targetShare: number | null;
  /** Target value minus current value at today's total (positive = under target). */
  gapCents: Cents | null;
  /** Part of the planned contribution suggested for this fund. */
  suggestedCents: Cents;
}

export interface AllocationResult {
  rows: AllocationRow[];
  totalCents: Cents;
  /** Sum of the target percents as entered. */
  targetPercentTotal: number;
  /** The fund furthest below its target, or null when nothing is under target. */
  nextSymbol: string | null;
  /** Symbols whose currency has no exchange rate set, so they're left out. */
  unconverted: string[];
}

/** VGS, ASX:VGS, vgs.ax all match each other. */
export function normaliseSymbol(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/^[A-Z]+:/, '')
    .replace(/\.(AX|ASX)$/, '');
}

/** Each fund's value in the viewer's share, from synced positions they can fully see. */
export function collectPositions(holdings: Holding[], perspective: Perspective, settings: StalenessSettings): { funds: Map<string, { label: string; valueCents: Cents }>; unconverted: string[] } {
  const funds = new Map<string, { label: string; valueCents: Cents }>();
  const unconverted = new Set<string>();
  for (const h of holdings) {
    if (!h.positions?.length || visibilityFor(h, perspective, settings) !== 'full') continue;
    for (const p of h.positions) {
      if (p.valueCents === null) continue;
      const symbol = normaliseSymbol(p.symbol);
      const aud = toBaseCurrency(p.valueCents, p.currency, settings.fx);
      if (aud === null) {
        unconverted.add(symbol);
        continue;
      }
      const share = amountForPerspective(aud, h.ownership, perspective);
      const cur = funds.get(symbol);
      funds.set(symbol, { label: cur?.label || p.description || symbol, valueCents: (cur?.valueCents ?? 0) + share });
    }
  }
  return { funds, unconverted: [...unconverted] };
}

export function allocationPlan(funds: Map<string, { label: string; valueCents: Cents }>, targets: InvestmentTarget[], contributionCents: Cents, unconverted: string[] = []): AllocationResult {
  const targetPercentTotal = targets.reduce((a, t) => a + (t.percent > 0 ? t.percent : 0), 0);
  // Weights are normalised so targets that don't quite add to 100 still give sensible gaps.
  const weight = new Map(targets.filter((t) => t.percent > 0).map((t) => [normaliseSymbol(t.symbol), t.percent / (targetPercentTotal || 1)]));
  const symbols = new Set([...funds.keys(), ...targets.map((t) => normaliseSymbol(t.symbol))]);
  const totalCents = [...funds.values()].reduce((a, f) => a + f.valueCents, 0);
  const contribution = Math.max(0, contributionCents);
  const afterTotal = totalCents + contribution;

  const base = [...symbols].map((symbol) => {
    const f = funds.get(symbol);
    const valueCents = f?.valueCents ?? 0;
    const w = weight.get(symbol) ?? null;
    return {
      symbol,
      label: f?.label ?? symbol,
      valueCents,
      currentShare: totalCents > 0 ? valueCents / totalCents : 0,
      targetShare: w,
      gapCents: w === null ? null : roundCents(w * totalCents) - valueCents,
      shortfallAfter: w === null ? 0 : Math.max(0, roundCents(w * afterTotal) - valueCents),
    };
  });

  // Fill the largest shortfalls first (in proportion), and spread anything left by target weight.
  const shortfalls = base.map((r) => r.shortfallAfter);
  const shortSum = shortfalls.reduce((a, b) => a + b, 0);
  let suggested: Cents[];
  if (contribution === 0 || weight.size === 0) suggested = base.map(() => 0);
  else if (shortSum >= contribution) suggested = allocate(contribution, shortfalls);
  else {
    const rest = allocate(contribution - shortSum, base.map((r) => r.targetShare ?? 0));
    suggested = shortfalls.map((s, i) => s + rest[i]);
  }

  const rows: AllocationRow[] = base
    .map(({ shortfallAfter: _s, ...r }, i) => ({ ...r, suggestedCents: suggested[i] }))
    .sort((a, b) => (b.targetShare ?? -1) - (a.targetShare ?? -1) || b.valueCents - a.valueCents);
  const under = rows.filter((r) => (r.gapCents ?? 0) > 0).sort((a, b) => (b.gapCents ?? 0) - (a.gapCents ?? 0));
  return { rows, totalCents, targetPercentTotal, nextSymbol: under[0]?.symbol ?? null, unconverted };
}
