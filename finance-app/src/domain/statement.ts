/**
 * Finds the balance on a super (or other) statement from its text. Returns candidates with the
 * words around them, so the person confirms the right figure; nothing is recorded until they do.
 * If no labelled balance is found, it says so rather than guessing from unlabelled numbers.
 */
import type { ISODate } from './dates';

export interface BalanceCandidate {
  valueCents: number;
  /** The label that identified it, e.g. "Closing balance". */
  label: string;
  /** The statement date found with it, if any. */
  date: ISODate | null;
  /** The surrounding text, for the person to check. */
  context: string;
  /** Higher is more likely to be the account balance. */
  score: number;
}

const LABELS: { re: RegExp; label: string; score: number }[] = [
  { re: /closing\s+(account\s+)?balance/i, label: 'Closing balance', score: 100 },
  { re: /(your\s+)?(total\s+)?account\s+balance\s+(as\s+at|at)/i, label: 'Account balance as at', score: 95 },
  { re: /balance\s+(as\s+at|at)\s+\d/i, label: 'Balance as at', score: 90 },
  { re: /(total\s+)?withdrawal\s+benefit/i, label: 'Withdrawal benefit', score: 85 },
  { re: /ending\s+balance|end\s+of\s+period\s+balance/i, label: 'Ending balance', score: 80 },
  { re: /your\s+(super\s+)?balance/i, label: 'Your balance', score: 75 },
  { re: /total\s+(super\s+)?balance/i, label: 'Total balance', score: 70 },
  { re: /account\s+balance/i, label: 'Account balance', score: 60 },
];
const NEGATIVE = /opening\s+balance|previous\s+balance|start(ing)?\s+balance|balance\s+brought\s+forward|insurance|premium|fees?\b|contribution|tax\b/i;

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function findDate(text: string): ISODate | null {
  const long = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (long) {
    const m = MONTHS.indexOf(long[2].toLowerCase()) + 1;
    return valid(+long[3], m, +long[1]);
  }
  const short = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (short) return valid(+short[3], +short[2], +short[1]);
  return null;
}

function valid(y: number, m: number, d: number): ISODate | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || y < 1990 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

function toCents(whole: string, fraction?: string): number {
  return Number(whole.replace(/,/g, '')) * 100 + (fraction ? Number(fraction.slice(1)) : 0);
}

export function findBalanceCandidates(text: string): BalanceCandidate[] {
  const flat = text.replace(/\s+/g, ' ');
  const out: BalanceCandidate[] = [];
  for (const { re, label, score } of LABELS) {
    const g = new RegExp(re.source, 'gi');
    for (let m = g.exec(flat); m; m = g.exec(flat)) {
      const start = m.index;
      // The amount is usually just after the label (same line or the next cell).
      const after = flat.slice(start, start + m[0].length + 90);
      const before = flat.slice(Math.max(0, start - 40), start);
      // Skip "Opening balance", "Insurance account balance" and the like.
      if (NEGATIVE.test(`${before.split(/[.$\d]/).pop() ?? ''}${m[0]}`)) continue;
      MONEY.lastIndex = 0;
      const money = MONEY.exec(after);
      if (!money) continue;
      const valueCents = toCents(money[1], money[2]);
      if (valueCents <= 0) continue;
      const context = flat.slice(Math.max(0, start - 30), start + m[0].length + 60).trim();
      out.push({ valueCents, label, date: findDate(after) ?? findDate(before), context, score: score + (money[2] ? 2 : 0) });
    }
  }
  // One entry per amount, keeping its best label.
  const best = new Map<number, BalanceCandidate>();
  for (const c of out) if (!best.has(c.valueCents) || best.get(c.valueCents)!.score < c.score) best.set(c.valueCents, c);
  return [...best.values()].sort((a, b) => b.score - a.score || b.valueCents - a.valueCents).slice(0, 5);
}

/** The statement's "as at" or period-end date, when one is printed. */
export function findStatementDate(text: string): ISODate | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = flat.match(/(as\s+at|period\s+end(ing)?|to|statement\s+date)[:\s]+([^.;]{0,30})/i);
  return (m && findDate(m[3])) ?? findDate(flat);
}

const FUNDS = ['AustralianSuper', 'Australian Retirement Trust', 'Hostplus', 'Aware Super', 'UniSuper', 'Rest', 'HESTA', 'Cbus', 'CareSuper', 'Colonial First State', 'AMP', 'Spirit Super', 'Vision Super', 'Mercer', 'MLC', 'Telstra Super', 'Commonwealth Super', 'Hesta', 'Brighter Super', 'Active Super', 'Legal Super', 'NGS Super', 'Prime Super', 'Qantas Super', 'Equip', 'Insignia', 'Netwealth', 'HUB24', 'Macquarie', 'Vanguard Super', 'Australian Ethical', 'Future Super', 'Aussie Super', 'Virgin Money Super', 'ING'];

export function findFundName(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  for (const f of FUNDS) if (new RegExp(`\\b${f.replace(/\s+/g, '\\s+')}\\b`, f === 'Rest' || f === 'AMP' || f === 'ING' ? '' : 'i').test(flat)) return f;
  return null;
}
