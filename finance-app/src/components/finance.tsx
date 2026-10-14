/**
 * Finance-specific display components: money figures, provenance labels, ownership chips.
 */
import type { ReactNode } from 'react';
import { formatMoney, type Cents } from '@/domain/money';
import { relativeTime, formatDate } from '@/domain/dates';
import { ownershipLabel, ownershipPreset } from '@/domain/ownership';
import type { DataSource, Ownership, Perspective, PersonId } from '@/domain/types';
import type { ItemStatus } from '@/domain/networth';
import { Badge, cx, type Tone } from './ui';

export function Money({ cents, className, signed, showCents, compact, tone }: { cents: Cents | null | undefined; className?: string; signed?: boolean; showCents?: boolean; compact?: boolean; tone?: 'auto' | 'none' }) {
  const color = tone === 'auto' && cents ? (cents > 0 ? 'text-good' : 'text-bad') : '';
  return <span className={cx('num', color, className)}>{formatMoney(cents, { signed, cents: showCents, compact })}</span>;
}

const SOURCE_META: Record<DataSource, { label: string; tone: Tone; title: string }> = {
  manual: { label: 'Manual', tone: 'neutral', title: 'Entered manually' },
  csv: { label: 'CSV import', tone: 'neutral', title: 'Imported from a CSV file you supplied' },
  mock: { label: 'Mock bank', tone: 'warn', title: 'Development mock provider — not real money' },
  sandbox: { label: 'Sandbox', tone: 'warn', title: 'Provider sandbox test data — not real money' },
  live: { label: 'Synced', tone: 'good', title: 'Updated automatically from your bank or broker' },
  statement: { label: 'Statement', tone: 'neutral', title: 'From a statement you uploaded and confirmed' },
  estimate: { label: 'Estimate', tone: 'info', title: 'Estimated by the app' },
  demo: { label: 'Demo', tone: 'demo', title: 'Fictional demo data' },
};

export function SourceBadge({ source }: { source: DataSource }) {
  const m = SOURCE_META[source];
  return (
    <Badge tone={m.tone} title={m.title}>
      {m.label}
    </Badge>
  );
}

export function StatusBadge({ status, ageDays }: { status: ItemStatus; ageDays: number | null }) {
  if (status === 'current') return null;
  if (status === 'stale') return <Badge tone="warn" title={`Last valued ${ageDays} days ago`}>Stale · {ageDays}d</Badge>;
  if (status === 'no-fx') return <Badge tone="bad" title="No exchange rate configured — excluded from totals">No FX rate</Badge>;
  return <Badge tone="bad" title="No value recorded — excluded from totals">No value</Badge>;
}

export function ScopeBadge({ perspective, names }: { perspective: Perspective; names: Record<PersonId, string> }) {
  if (perspective === 'household') return <Badge tone="accent" title="Combined household figure: each item counted once">Household</Badge>;
  return <Badge tone="info" title={`${names[perspective]}'s attributed share`}>{names[perspective]}</Badge>;
}

export function KindBadge({ kind }: { kind: 'forecast' | 'estimate' | 'actual' | 'reconstructed' }) {
  if (kind === 'forecast') return <Badge tone="info" title="Projection based on assumptions — not a guaranteed outcome">Forecast</Badge>;
  if (kind === 'estimate') return <Badge tone="info" title="Calculated estimate">Estimate</Badge>;
  if (kind === 'reconstructed') return <Badge tone="neutral" title="Reconstructed from valuation history">Reconstructed</Badge>;
  return <Badge tone="neutral" title="Recorded value">Actual</Badge>;
}

export function OwnerChip({ ownership, names }: { ownership: Ownership; names: Record<PersonId, string> }) {
  const p = ownershipPreset(ownership);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      <span className="flex -space-x-1" aria-hidden>
        {ownership.me > 0 && <span className="h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: 'var(--series-1)' }} />}
        {ownership.partner > 0 && <span className="h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: 'var(--series-7)' }} />}
      </span>
      {p === 'custom' || p === 'joint' ? ownershipLabel(ownership, names) : names[p]}
    </span>
  );
}

export function UpdatedAt({ iso, prefix = 'Updated' }: { iso: string | null | undefined; prefix?: string }) {
  if (!iso) return <span className="text-xs text-muted">{prefix} never</span>;
  return (
    <time dateTime={iso} title={iso.length === 10 ? formatDate(iso) : new Date(iso).toLocaleString('en-AU')} className="text-xs text-muted">
      {prefix} {relativeTime(iso)}
    </time>
  );
}

export function Delta({ cents, base, label }: { cents: Cents; base?: Cents; label?: ReactNode }) {
  const pct = base ? cents / Math.abs(base) : null;
  return (
    <span className={cx('num inline-flex items-center gap-1 text-xs font-medium', cents > 0 ? 'text-good' : cents < 0 ? 'text-bad' : 'text-muted')}>
      <span aria-hidden>{cents > 0 ? '▲' : cents < 0 ? '▼' : '•'}</span>
      {formatMoney(Math.abs(cents))}
      {pct !== null && Number.isFinite(pct) && <span className="text-muted">({(pct * 100).toFixed(1)}%)</span>}
      {label && <span className="font-normal text-muted">{label}</span>}
    </span>
  );
}
