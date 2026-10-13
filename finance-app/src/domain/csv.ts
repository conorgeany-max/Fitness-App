/**
 * CSV import/export for bank statements. Parsing happens entirely in the browser.
 */
import { parseLooseDate, type ISODate } from './dates';
import { parseMoney, type Cents } from './money';

/** RFC 4180-style parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v);
          // Neutralise spreadsheet formula injection.
          const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(','),
    )
    .join('\r\n');
}

export interface CsvMapping {
  hasHeader: boolean;
  date: number;
  description: number;
  /** Single signed amount column, or -1 when using debit/credit columns. */
  amount: number;
  debit: number;
  credit: number;
  /** Flip the sign of the amount column (some banks export spending as positive). */
  invert: boolean;
}

const find = (header: string[], patterns: RegExp[]) => header.findIndex((h) => patterns.some((p) => p.test(h.trim())));

/** Guess column mapping from a header row or the data shape. */
export function guessMapping(rows: string[][]): CsvMapping {
  const first = rows[0] ?? [];
  const hasHeader = first.some((c) => /date|description|amount|debit|credit|narrative|details|balance/i.test(c)) && !first.some((c) => parseLooseDate(c));
  if (hasHeader) {
    const h = first.map((c) => c.toLowerCase());
    return {
      hasHeader: true,
      date: Math.max(0, find(h, [/^date$/, /transaction date/, /^date/, /posted/])),
      description: Math.max(0, find(h, [/description/, /narrative/, /details/, /memo/, /payee/, /merchant/])),
      amount: find(h, [/^amount/, /amount$/, /value/]),
      debit: find(h, [/debit/, /withdrawal/, /money out/]),
      credit: find(h, [/credit/, /deposit/, /money in/]),
      invert: false,
    };
  }
  // Headerless (e.g. CommBank "date,amount,description,balance").
  const sample = rows.slice(0, 5);
  const width = Math.max(...sample.map((r) => r.length));
  let date = 0;
  let amount = 1;
  let description = 2;
  for (let c = 0; c < width; c++) {
    if (sample.every((r) => r[c] && parseLooseDate(r[c]))) date = c;
  }
  const numeric = [...Array(width).keys()].filter((c) => c !== date && sample.every((r) => parseMoney(r[c] ?? '') !== null));
  if (numeric.length) amount = numeric[0];
  const texty = [...Array(width).keys()].filter((c) => c !== date && !numeric.includes(c));
  if (texty.length) description = texty.sort((a, b) => avgLen(sample, b) - avgLen(sample, a))[0];
  return { hasHeader: false, date, description, amount, debit: -1, credit: -1, invert: false };
}

function avgLen(rows: string[][], c: number) {
  return rows.reduce((a, r) => a + (r[c]?.length ?? 0), 0) / rows.length;
}

export interface ParsedRow {
  line: number;
  date: ISODate | null;
  description: string;
  amountCents: Cents | null;
  error?: string;
}

export function applyMapping(rows: string[][], m: CsvMapping): ParsedRow[] {
  const data = m.hasHeader ? rows.slice(1) : rows;
  return data.map((r, i) => {
    const line = i + (m.hasHeader ? 2 : 1);
    const date = parseLooseDate(r[m.date] ?? '');
    const description = (r[m.description] ?? '').trim();
    let amount: Cents | null = null;
    if (m.amount >= 0) {
      let raw = (r[m.amount] ?? '').trim();
      let sign = 1;
      if (/\bDR\b/i.test(raw)) {
        sign = -1;
        raw = raw.replace(/\bDR\b/i, '');
      } else if (/\bCR\b/i.test(raw)) raw = raw.replace(/\bCR\b/i, '');
      const v = parseMoney(raw);
      amount = v === null ? null : v * sign * (m.invert ? -1 : 1);
    } else {
      const d = parseMoney(r[m.debit] ?? '') ?? 0;
      const c = parseMoney(r[m.credit] ?? '') ?? 0;
      amount = r[m.debit]?.trim() || r[m.credit]?.trim() ? Math.abs(c) - Math.abs(d) : null;
    }
    const error = !date ? 'Unrecognised date' : amount === null ? 'Unrecognised amount' : !description ? 'Missing description' : undefined;
    return { line, date, description, amountCents: amount, error };
  });
}
