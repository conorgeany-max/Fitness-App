import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Archive, Camera, History, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { useApp } from '@/store/store';
import { reportableTransactions, useDerived, usePerspective } from '@/store/derived';
import { buildHistorySeries, explainChange } from '@/domain/history';
import { computeBalanceSheet, type BalanceSheetItem } from '@/domain/networth';
import { ASSET_GROUP_LABELS, LIABILITY_GROUP_LABELS, categoryMeta } from '@/domain/holdingCategories';
import { addMonthKey, formatDate, formatMonthKey, monthEnd, type MonthKey } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import type { Holding, NetWorthTotals } from '@/domain/types';
import { Badge, Button, Card, CardBody, CardHeader, Disclosure, EmptyState, PageHeader, Segmented, Stat, cx, toast } from '@/components/ui';
import { Money, OwnerChip, ScopeBadge, SourceBadge, StatusBadge, UpdatedAt } from '@/components/finance';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';
import { HoldingForm, ValuationForm, newHolding } from '@/components/HoldingForm';

type Metric = keyof NetWorthTotals;
const METRICS: { key: Metric; label: string }[] = [
  { key: 'netWorthCents', label: 'Net worth' },
  { key: 'assetsCents', label: 'Assets' },
  { key: 'liabilitiesCents', label: 'Liabilities' },
  { key: 'liquidCents', label: 'Liquid' },
  { key: 'investableCents', label: 'Investable' },
  { key: 'propertyEquityCents', label: 'Property equity' },
  { key: 'superCents', label: 'Super' },
];

export default function NetWorth() {
  const data = useApp((s) => s.data);
  const recordSnapshot = useApp((s) => s.recordSnapshot);
  const perspective = usePerspective();
  const d = useDerived();
  const bs = d.balance[perspective];
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Holding | null>(null);
  const [valuing, setValuing] = useState<Holding | null>(null);
  const [range, setRange] = useState<'12' | '24' | '60'>('12');
  const [metric, setMetric] = useState<Metric>('netWorthCents');
  const [compare, setCompare] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (params.get('add')) {
      setEditing(newHolding(params.get('add') === 'liability' ? 'liability' : 'asset'));
      params.delete('add');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const from = addMonthKey(d.currentMonth, -Number(range));
  const series = useMemo(() => {
    const own = buildHistorySeries(data.snapshots, data.holdings, data.settings, perspective, from, d.currentMonth);
    if (!compare) return own.map((p) => ({ month: p.month, value: p[metric], kind: p.kind, coverage: p.coverage }));
    const me = buildHistorySeries(data.snapshots, data.holdings, data.settings, 'me', from, d.currentMonth);
    const pa = buildHistorySeries(data.snapshots, data.holdings, data.settings, 'partner', from, d.currentMonth);
    const hh = buildHistorySeries(data.snapshots, data.holdings, data.settings, 'household', from, d.currentMonth);
    return hh.map((p) => ({ month: p.month, household: p[metric], me: me.find((x) => x.month === p.month)?.[metric], partner: pa.find((x) => x.month === p.month)?.[metric], kind: p.kind, coverage: p.coverage }));
  }, [data, perspective, from, d.currentMonth, metric, compare]);

  const [changeFrom, setChangeFrom] = useState<MonthKey>(addMonthKey(d.currentMonth, -3));
  const change = useMemo(() => explainChange(data.holdings, reportableTransactions(data), data.categories, data.settings, perspective, monthEnd(changeFrom), d.today), [data, perspective, changeFrom, d.today]);

  const archivedBs = useMemo(() => (showArchived ? computeBalanceSheet(data.holdings.map((h) => ({ ...h, archived: false })).filter((h) => data.holdings.find((x) => x.id === h.id)?.archived), perspective, data.settings, d.today) : null), [showArchived, data, perspective, d.today]);

  const assets = bs.items.filter((i) => i.holding.kind === 'asset');
  const liabilities = bs.items.filter((i) => i.holding.kind === 'liability');
  const archivedCount = data.holdings.filter((h) => h.archived).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Net worth"
        subtitle={<span className="inline-flex items-center gap-2">Assets − liabilities <ScopeBadge perspective={perspective} names={d.names} /></span>}
        actions={
          <>
            <Button icon={<Camera className="h-4 w-4" />} onClick={() => { recordSnapshot(); toast('Snapshot recorded for this month'); }}>
              Record snapshot
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(newHolding('asset'))}>
              Add item
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Card className="col-span-2 p-4 md:col-span-1 xl:col-span-1"><Stat label="Net worth" value={<Money cents={bs.netWorthCents} />} /></Card>
        <Card className="p-4"><Stat label="Assets" value={<Money cents={bs.assetsCents} />} /></Card>
        <Card className="p-4"><Stat label="Liabilities" value={<Money cents={bs.liabilitiesCents} />} /></Card>
        <Card className="p-4"><Stat label="Liquid" value={<Money cents={bs.liquidCents} />} /></Card>
        <Card className="p-4"><Stat label="Investable" value={<Money cents={bs.investableCents} />} /></Card>
        <Card className="p-4"><Stat label="Property equity" value={<Money cents={bs.propertyEquityCents} />} /></Card>
        <Card className="p-4"><Stat label="Super & retirement" value={<Money cents={bs.superCents} />} /></Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="History"
            subtitle="Filled dots are recorded snapshots; hollow dots are reconstructed from valuation history"
            action={<Segmented size="sm" ariaLabel="Range" value={range} onChange={setRange} options={[{ value: '12', label: '1Y' }, { value: '24', label: '2Y' }, { value: '60', label: '5Y' }]} />}
          />
          <CardBody>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {METRICS.map((m) => (
                  <button key={m.key} type="button" onClick={() => setMetric(m.key)} className={cx('rounded-md px-2 py-1 text-xs', metric === m.key ? 'bg-surface-3 text-ink ring-1 ring-line' : 'text-muted hover:text-ink')}>
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare {d.names.me}, {d.names.partner} & household
              </label>
            </div>
            {series.length >= 1 ? (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="month" {...axisProps} tickFormatter={(m) => formatMonthKey(m)} minTickGap={20} />
                      <YAxis {...axisProps} tickFormatter={moneyTick} width={60} domain={['auto', 'auto']} />
                      <Tooltip content={<ChartTooltip labelFormatter={(l, p) => `${formatMonthKey(String(l))} · ${p?.kind === 'recorded' ? 'recorded snapshot' : `reconstructed, ${Math.round(Number(p?.coverage) * 100)}% of items valued`}`} />} />
                      {compare ? (
                        <>
                          <Line type="monotone" dataKey="household" name="Household" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="me" name={d.names.me} stroke={SERIES[2]} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="partner" name={d.names.partner} stroke={SERIES[6]} strokeWidth={2} dot={false} />
                        </>
                      ) : (
                        <Line type="monotone" dataKey="value" name={METRICS.find((m) => m.key === metric)!.label} stroke={SERIES[0]} strokeWidth={2} dot={(p: { cx?: number; cy?: number; payload?: { kind: string }; index?: number }) => (p.payload?.kind === 'recorded' ? <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill={SERIES[0]} /> : <circle key={p.index} cx={p.cx} cy={p.cy} r={3} fill="var(--chart-surface)" stroke={SERIES[0]} strokeWidth={1.5} />)} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {compare ? (
                  <Legend className="mt-2" items={[{ label: 'Household', color: SERIES[0] }, { label: d.names.me, color: SERIES[2] }, { label: d.names.partner, color: SERIES[6] }]} />
                ) : (
                  <p className="mt-2 text-xs text-muted">● recorded snapshot &nbsp; ○ reconstructed estimate</p>
                )}
              </>
            ) : (
              <EmptyState icon={<History className="h-5 w-5" />} title="No history yet">Snapshots are recorded monthly. Add earlier valuations to an item to reconstruct past months.</EmptyState>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What changed"
            subtitle={`Since ${formatDate(monthEnd(changeFrom))}`}
            action={<Segmented size="sm" ariaLabel="Change period" value={changeFrom} onChange={setChangeFrom} options={[{ value: addMonthKey(d.currentMonth, -1), label: '1M' }, { value: addMonthKey(d.currentMonth, -3), label: '3M' }, { value: addMonthKey(d.currentMonth, -12), label: '1Y' }]} />}
          />
          <CardBody>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xs text-muted">Total change</span>
              <Money cents={change.totalCents} signed tone="auto" className="text-lg font-semibold" />
            </div>
            {change.components.length ? (
              <ul className="space-y-2">
                {change.components.map((c) => (
                  <li key={c.key} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-2">{c.label}</span>
                      <Money cents={c.cents} signed tone="auto" />
                    </div>
                    <div className="text-2xs text-muted">{c.basis}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No valuation changes recorded in this period.</p>
            )}
            <p className="mt-3 text-2xs text-muted">Breakdown uses recorded valuations and categorised transactions. Where contributions aren't categorised, investment changes can't be split into contributions and performance.</p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <HoldingTable title="Assets" total={bs.assetsCents} items={assets} groupLabels={ASSET_GROUP_LABELS} onEdit={setEditing} onValue={setValuing} onAdd={() => setEditing(newHolding('asset'))} />
        <HoldingTable title="Liabilities" total={bs.liabilitiesCents} items={liabilities} groupLabels={LIABILITY_GROUP_LABELS} onEdit={setEditing} onValue={setValuing} onAdd={() => setEditing(newHolding('liability'))} />
      </div>

      {archivedCount > 0 && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} {archivedCount} archived item(s)
          </Button>
          {archivedBs && (
            <Card className="mt-2">
              <ul className="divide-y divide-line">
                {archivedBs.items.map((i) => (
                  <ArchivedRow key={i.holding.id} item={i} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="mt-5">
        <Disclosure summary="How household and individual figures are calculated">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Net worth = total assets − total liabilities.</li>
            <li>Household view: every asset and liability is counted once at its full value, whoever owns it. A joint $800,000 home with a $500,000 joint mortgage adds $800,000 of assets and $500,000 of liabilities.</li>
            <li>Individual views: each item is multiplied by that person's ownership (assets) or responsibility (liabilities) percentage. Shares are rounded so the two individual views always add up to the household view.</li>
            <li>Liquid = cash, savings, offset and term deposits. Liquid net worth also deducts credit cards and BNPL. Investable excludes super, property and vehicles.</li>
            <li>Items with no value, or in a currency without an exchange rate, are excluded and flagged — never counted as $0. Stale balances are counted but flagged.</li>
            <li>Private items are only shown to their owner. Their values reach household totals only when the owner consents in Settings → Privacy.</li>
          </ul>
        </Disclosure>
      </div>

      {editing && <HoldingForm key={editing.id} open initial={editing} onClose={() => setEditing(null)} />}
      {valuing && <ValuationForm key={valuing.id} open holding={valuing} onClose={() => setValuing(null)} />}
    </div>
  );
}

function HoldingTable({ title, total, items, groupLabels, onEdit, onValue, onAdd }: { title: string; total: number; items: BalanceSheetItem[]; groupLabels: Record<string, string>; onEdit: (h: Holding) => void; onValue: (h: Holding) => void; onAdd: () => void }) {
  const perspective = usePerspective();
  const { names } = useDerived();
  const groups = new Map<string, BalanceSheetItem[]>();
  for (const i of items) {
    const g = categoryMeta(i.holding.category).group;
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  return (
    <Card>
      <CardHeader title={title} subtitle={formatMoney(total)} action={<Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={onAdd}>Add</Button>} />
      <CardBody className="px-0 pb-2">
        {items.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title={`No ${title.toLowerCase()} yet`} action={<Button size="sm" variant="subtle" onClick={onAdd}>Add {title === 'Assets' ? 'an asset' : 'a liability'}</Button>} />
        ) : (
          [...groups.entries()].map(([g, list]) => (
            <div key={g} className="mb-2">
              <div className="flex justify-between bg-surface-2/60 px-5 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted">
                <span>{groupLabels[g]}</span>
                <span className="num">{formatMoney(list.reduce((a, i) => a + i.attributedCents, 0))}</span>
              </div>
              <ul className="divide-y divide-line">
                {list.map((i) => (
                  <HoldingRow key={i.holding.id} item={i} perspective={perspective} names={names} onEdit={onEdit} onValue={onValue} />
                ))}
              </ul>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function HoldingRow({ item, perspective, names, onEdit, onValue }: { item: BalanceSheetItem; perspective: string; names: { me: string; partner: string }; onEdit: (h: Holding) => void; onValue: (h: Holding) => void }) {
  const h = item.holding;
  const archive = useApp((s) => s.archiveHolding);
  const remove = useApp((s) => s.deleteHolding);
  const [menu, setMenu] = useState(false);
  const aggregate = item.visibility === 'aggregate';
  const partial = perspective !== 'household' && item.fullValueCents !== null && item.attributedCents !== item.fullValueCents;
  return (
    <li className="group flex items-center gap-3 px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{aggregate ? 'Private item' : h.name}</span>
          <SourceBadge source={h.source} />
          <StatusBadge status={item.status} ageDays={item.ageDays} />
          {h.visibility === 'private' && <Badge tone="info">Private</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <OwnerChip ownership={h.ownership} names={names} />
          {!aggregate && <span className="text-xs text-muted">{categoryMeta(h.category).label}{h.institution ? ` · ${h.institution}` : ''}</span>}
          <UpdatedAt iso={h.lastSyncedAt ?? h.valuedAt} prefix={h.lastSyncedAt ? 'Synced' : 'Valued'} />
        </div>
      </div>
      <div className="text-right">
        <Money cents={item.fullValueCents === null ? null : item.attributedCents} className="text-sm font-medium" />
        {partial && <div className="text-2xs text-muted">of {formatMoney(item.fullValueCents)}</div>}
        {h.currency !== 'AUD' && h.valueCents !== null && <div className="text-2xs text-muted">{formatMoney(h.valueCents, { currency: h.currency })}</div>}
      </div>
      {!aggregate && (
        <div className="relative">
          <button type="button" aria-label={`Actions for ${h.name}`} onClick={() => setMenu((m) => !m)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-10 w-44 rounded-lg border border-line bg-surface p-1 shadow-pop" onMouseLeave={() => setMenu(false)}>
              {!h.connectionId && <MenuItem icon={<History className="h-3.5 w-3.5" />} onClick={() => { setMenu(false); onValue(h); }}>Update value</MenuItem>}
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setMenu(false); onEdit(h); }}>Edit details</MenuItem>
              <MenuItem icon={<Archive className="h-3.5 w-3.5" />} onClick={() => { setMenu(false); archive(h.id, true); toast(`Archived ${h.name}`, 'info'); }}>Archive (sold/closed)</MenuItem>
              <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setMenu(false); if (confirm(`Delete ${h.name} and its history? Transactions keep their data but lose the account link.`)) remove(h.id); }}>Delete</MenuItem>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ArchivedRow({ item }: { item: BalanceSheetItem }) {
  const archive = useApp((s) => s.archiveHolding);
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
      <span className="text-muted">{item.holding.name}</span>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => archive(item.holding.id, false)}>Restore</Button>
    </li>
  );
}

function MenuItem({ children, onClick, icon, danger }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2', danger ? 'text-bad' : 'text-ink-2')}>
      {icon}
      {children}
    </button>
  );
}
