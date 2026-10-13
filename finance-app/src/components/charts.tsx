/**
 * Chart building blocks (Recharts) styled with the validated reference palette.
 * Thin marks, recessive axes, one y-axis, hover tooltips, and legends for ≥ 2 series.
 */
import type { ReactNode } from 'react';
import { formatMoney } from '@/domain/money';
import { cx } from './ui';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export const axisProps = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '0', vertical: false } as const;

export function moneyTick(v: number) {
  return formatMoney(v, { compact: true });
}

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** Tooltip body used by all charts. Values are in cents. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, footer }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; labelFormatter?: (l: string | number, p?: Record<string, unknown>) => ReactNode; valueFormatter?: (v: number) => string; footer?: (p?: Record<string, unknown>) => ReactNode }) {
  if (!active || !payload?.length) return null;
  const fmt = valueFormatter ?? ((v: number) => formatMoney(v));
  const row = payload[0]?.payload;
  return (
    <div className="min-w-[160px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(label, row) : label}</div>}
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="num font-medium text-ink">{typeof p.value === 'number' ? fmt(p.value) : '—'}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-muted">{footer(row)}</div>}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2', className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.dashed ? (
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={i.color} strokeWidth="2" strokeDasharray="4 3" />
            </svg>
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: i.color }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal stacked bar used for composition (e.g. asset mix). */
export function CompositionBar({ parts, total, label }: { parts: { label: string; cents: number; color: string }[]; total: number; label: string }) {
  const visible = parts.filter((p) => p.cents > 0);
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${label}: ${visible.map((p) => `${p.label} ${formatMoney(p.cents)}`).join(', ')}`}>
        {visible.map((p) => (
          <div key={p.label} title={`${p.label}: ${formatMoney(p.cents)}`} style={{ width: `${(p.cents / Math.max(1, total)) * 100}%`, background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
        {visible.length === 0 && <div className="h-full w-full bg-surface-3" />}
      </div>
    </div>
  );
}
