/**
 * Calendar helpers. All dates are stored as ISO calendar dates ("YYYY-MM-DD") with no
 * time zone, which avoids off-by-one-day bugs when a browser is not in AEST/AEDT.
 * Timestamps (e.g. "last synced") are stored as full ISO-8601 strings.
 */

export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export function isISODate(s: unknown): s is ISODate {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function parseISO(d: ISODate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, d: day };
}

export function makeISO(y: number, m: number, d: number): ISODate {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function todayISO(now: Date = new Date()): ISODate {
  // Local calendar date of the user, not UTC.
  return makeISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toUTCDate(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: ISODate, months: number): ISODate {
  const { y, m, d: day } = parseISO(d);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function addDays(d: ISODate, days: number): ISODate {
  const dt = toUTCDate(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTCDate(b).getTime() - toUTCDate(a).getTime()) / 86_400_000);
}

export function diffMonths(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

export function monthKey(d: ISODate): MonthKey {
  return d.slice(0, 7);
}

export function monthStart(key: MonthKey): ISODate {
  return `${key}-01`;
}

export function monthEnd(key: MonthKey): ISODate {
  const [y, m] = key.split('-').map(Number);
  return makeISO(y, m, daysInMonth(y, m));
}

export function addMonthKey(key: MonthKey, n: number): MonthKey {
  return monthKey(addMonths(monthStart(key), n));
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard++ < 1200) {
    out.push(k);
    k = addMonthKey(k, 1);
  }
  return out;
}

/** Australian financial year label for a date, e.g. 2026-10-13 -> "2026-27". */
export function financialYear(d: ISODate): string {
  const { y, m } = parseISO(d);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function financialYearStart(fy: string): ISODate {
  return `${fy.slice(0, 4)}-07-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(d: ISODate | null | undefined, style: 'short' | 'medium' | 'month' = 'medium'): string {
  if (!d || !isISODate(d)) return '—';
  const { y, m, d: day } = parseISO(d);
  if (style === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (style === 'short') return `${day} ${MONTHS[m - 1]}`;
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonthKey(k: MonthKey, withYear = true): string {
  const [y, m] = k.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : MONTHS[m - 1];
}

/** Human "3 days ago" style label for an ISO timestamp or date. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(t)) return 'unknown';
  const secs = Math.round((now.getTime() - t) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30.4);
  if (months < 18) return `${months} months ago`;
  return `${Math.round(months / 12)} years ago`;
}

/** Parse common Australian bank CSV date formats. */
export function parseLooseDate(input: string): ISODate | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[2], +m[1]); // Australian day-first convention
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mi >= 0) return valid(y, mi + 1, +m[1]);
  }
  return null;
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return makeISO(y, m, d);
}
