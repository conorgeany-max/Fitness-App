/**
 * Money primitives.
 *
 * Conventions (see docs/CALCULATIONS.md):
 * - Every stored monetary amount is an integer number of minor units (cents) in the
 *   amount's own currency. Totals are summed as integers, so they are exact.
 * - Intermediate model maths (interest, growth, tax) may use floating point, but every
 *   value that is stored, summed or displayed is rounded back to whole cents with
 *   `roundCents`, which rounds half away from zero (e.g. 0.5c -> 1c, -0.5c -> -1c).
 * - When a total is split between people we use the largest-remainder method so the
 *   parts always add back to the total exactly.
 */

export type Cents = number;

/** Round a (possibly fractional) cent amount to an integer, half away from zero. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  // A tiny epsilon absorbs binary representation error (e.g. 1.005 * 100 = 100.49999...).
  const rounded = Math.floor(Math.abs(value) + 0.5 + 1e-9);
  return rounded === 0 ? 0 : sign * rounded;
}

export function toCents(dollars: number): Cents {
  return roundCents(dollars * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Multiply an amount by a rate/fraction and round to cents. */
export function mulCents(cents: Cents, factor: number): Cents {
  return roundCents(cents * factor);
}

/**
 * Split `total` according to `weights` using the largest-remainder method.
 * The returned parts are integers that always sum to `total`.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r + 1e-9));
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((f) => (f === 0 ? 0 : f * sign));
}

export const DEFAULT_CURRENCY = 'AUD';

const formatterCache = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, decimals: number, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${decimals}|${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      currencyDisplay: currency === 'AUD' ? 'narrowSymbol' : 'code',
      minimumFractionDigits: compact ? 0 : decimals,
      maximumFractionDigits: compact ? 1 : decimals,
      notation: compact ? 'compact' : 'standard',
    });
    formatterCache.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  currency?: string;
  /** Show cents. Defaults to false for whole-dollar display of large figures. */
  cents?: boolean;
  compact?: boolean;
  /** Prefix positive numbers with "+". */
  signed?: boolean;
}

/** Format cents using Australian conventions, e.g. $1,234,567 or -$12.50. */
export function formatMoney(cents: Cents | null | undefined, opts: FormatMoneyOptions = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const { currency = DEFAULT_CURRENCY, cents: showCents = false, compact = false, signed = false } = opts;
  const value = showCents ? cents / 100 : Math.round(cents / 100);
  const text = formatter(currency, showCents ? 2 : 0, compact).format(value === 0 ? 0 : value);
  if (signed && cents > 0) return `+${text}`;
  return text;
}

export function formatPercent(fraction: number | null | undefined, digits = 1, signed = false): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  const text = `${(fraction * 100).toFixed(digits)}%`;
  return signed && fraction > 0 ? `+${text}` : text;
}

/**
 * Parse user-entered money ("$1,234.50", "1234", "-12", "(45.00)", "12k") into cents.
 * Returns null for unparseable input.
 */
export function parseMoney(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? toCents(input) : null;
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\b(AUD|USD|NZD|EUR|GBP)\b/gi, '').replace(/[$\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  let multiplier = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === 'k') multiplier = 1e3;
  if (suffix === 'm') multiplier = 1e6;
  if (multiplier !== 1) s = s.slice(0, -1);
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const value = Number(s) * multiplier;
  if (!Number.isFinite(value)) return null;
  return toCents(negative ? -value : value);
}

export interface FxRate {
  /** AUD per one unit of the foreign currency. */
  audPerUnit: number;
  asOf: string;
  source: 'manual';
}

export type FxTable = Record<string, FxRate>;

/** Convert an amount to AUD cents. Returns null when no rate is configured. */
export function toBaseCurrency(cents: Cents, currency: string, fx: FxTable): Cents | null {
  if (currency === DEFAULT_CURRENCY) return cents;
  const rate = fx[currency];
  if (!rate || !(rate.audPerUnit > 0)) return null;
  return roundCents(cents * rate.audPerUnit);
}

export const SUPPORTED_CURRENCIES = ['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'CAD', 'HKD', 'CHF'];
