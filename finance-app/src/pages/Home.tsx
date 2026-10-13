import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, CalendarClock, CircleAlert, Lightbulb, Link2, Plus, Sparkles, Target, X } from 'lucide-react';
import { useApp } from '@/store/store';
import { reportableTransactions, useDerived, usePerspective } from '@/store/derived';
import { forecastFor, insightsFor, upcomingItems } from '@/store/builders';
import { buildHistorySeries } from '@/domain/history';
import { buildBudgetReport } from '@/domain/budget';
import { goalProgress } from '@/domain/goals';
import { addMonthKey, formatDate, formatMonthKey, relativeTime } from '@/domain/dates';
import { ASSET_GROUP_LABELS, LIABILITY_GROUP_LABELS, categoryMeta, isMortgage } from '@/domain/holdingCategories';
import { formatMoney, formatPercent } from '@/domain/money';
import { toMonthly } from '@/domain/mortgage';
import { Badge, Button, Card, CardBody, CardHeader, Disclosure, EmptyState, ProgressBar, Stat, cx } from '@/components/ui';
import { Delta, KindBadge, Money, ScopeBadge } from '@/components/finance';
import { ChartTooltip, CompositionBar, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';
import type { Insight } from '@/domain/insights';

const ASSET_COLORS = { cash: SERIES[0], investments: SERIES[2], super: SERIES[6], property: SERIES[1], other: SERIES[3] };
const LIAB_COLORS = { mortgage: SERIES[7], consumer: SERIES[4], loans: SERIES[3], student: SERIES[6], other: SERIES[5] };

export default function Home() {
  const data = useApp((s) => s.data);
  const perspective = usePerspective();
  const d = useDerived();
  const bs = d.balance[perspective];
  const hasData = data.holdings.length > 0 || data.transactions.length > 0;

  const history = useMemo(
    () => buildHistorySeries(data.snapshots, data.holdings, data.settings, perspective, addMonthKey(d.currentMonth, -12), d.currentMonth),
    [data, perspective, d.currentMonth],
  );
  const first = history[0];
  const monthAgo = history.length >= 2 ? history[history.length - 2] : null;

  const base = data.scenarios[0];
  const forecast = useMemo(() => (base && hasData ? forecastFor(data, base, perspective) : null), [data, base, perspective, hasData]);

  const months6 = d.monthly[perspective].slice(-7, -1);
  const lastFull = d.monthly[perspective][d.monthly[perspective].length - 2];
  const thisMonth = d.monthly[perspective][d.monthly[perspective].length - 1];
  const avg = d.average[perspective];
  const takeHome = perspective === 'household' ? d.takeHomeMonthly.me + d.takeHomeMonthly.partner : d.takeHomeMonthly[perspective];

  const budget = useMemo(
    () => (data.budgets.some((b) => b.scope === perspective) ? buildBudgetReport(data.budgets, reportableTransactions(data), data.categories, data.holdings, data.plannedExpenses, perspective, d.currentMonth, d.today) : null),
    [data, perspective, d.currentMonth, d.today],
  );
  const upcoming = useMemo(() => upcomingItems(data, perspective, d.today, 35), [data, perspective, d.today]);
  const insights = useMemo(() => insightsFor(data, perspective), [data, perspective]);
  const goals = data.goals.filter((g) => perspective === 'household' || g.scope === perspective).map((g) => goalProgress(g, data.holdings, d.today));
  const debts = bs.items.filter((i) => i.holding.kind === 'liability' && i.attributedCents > 0);
  const investItems = bs.items.filter((i) => ['investments', 'super'].includes(categoryMeta(i.holding.category).group) && i.attributedCents > 0);

  if (!hasData) return <FirstRun />;

  const savingsRate = lastFull?.savingsRate ?? null;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ---------------- Hero */}
      <Card className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Net worth <ScopeBadge perspective={perspective} names={d.names} />
              {bs.staleCount + bs.missingCount > 0 && (
                <Badge tone="warn" title="Some balances are stale or missing">
                  {bs.staleCount + bs.missingCount} need updating
                </Badge>
              )}
            </div>
            <div className="num mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{formatMoney(bs.netWorthCents)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {monthAgo && <Delta cents={bs.netWorthCents - monthAgo.netWorthCents} base={monthAgo.netWorthCents} label={`since ${formatMonthKey(monthAgo.month)}`} />}
              {first && first !== monthAgo && <Delta cents={bs.netWorthCents - first.netWorthCents} label={`since ${formatMonthKey(first.month)}`} />}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <Stat label="Assets" value={<Money cents={bs.assetsCents} />} />
              <Stat label="Liabilities" value={<Money cents={bs.liabilitiesCents} />} />
              <Stat label="Cash available" value={<Money cents={bs.liquidCents} />} sub={`Liquid net worth ${formatMoney(bs.liquidNetWorthCents)}`} />
              <Stat label="Property equity" value={<Money cents={bs.propertyEquityCents} />} />
            </dl>
            {(bs.hiddenPrivateCount > 0 || bs.aggregatedPrivateCount > 0) && (
              <p className="mt-4 text-xs text-muted">
                {bs.hiddenPrivateCount > 0 && `${bs.hiddenPrivateCount} private item(s) not shared are excluded. `}
                {bs.aggregatedPrivateCount > 0 && `${bs.aggregatedPrivateCount} private item(s) included as totals only.`}
              </p>
            )}
          </div>
          <div className="border-t border-line p-4 lg:border-l lg:border-t-0">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted">Net worth, last 12 months</span>
              <Legend items={[{ label: 'Recorded', color: 'var(--series-1)' }, { label: 'Reconstructed', color: 'var(--series-1)', dashed: true }]} />
            </div>
            {history.length >= 2 ? (
              <div className="h-48 sm:h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history.map((h) => ({ ...h, recorded: h.kind === 'recorded' ? h.netWorthCents : null }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" {...axisProps} tickFormatter={(m) => formatMonthKey(m)} minTickGap={24} />
                    <YAxis {...axisProps} tickFormatter={moneyTick} width={56} domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l, p) => `${formatMonthKey(String(l))} · ${p?.kind === 'recorded' ? 'recorded' : `reconstructed (${Math.round(Number(p?.coverage ?? 0) * 100)}% of items valued)`}`} />} />
                    <Area type="monotone" dataKey="netWorthCents" name="Net worth" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" fill="url(#nwFill)" />
                    <Area type="monotone" dataKey="recorded" name="Recorded" stroke="var(--series-1)" strokeWidth={2} fill="none" connectNulls={false} dot={{ r: 3, fill: 'var(--series-1)', strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="History builds up over time">A snapshot is recorded automatically each month. Add past valuations to an item to reconstruct earlier months.</EmptyState>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------- Cash-flow KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <Stat
            label="Monthly take-home"
            badge={<KindBadge kind="estimate" />}
            value={takeHome ? <Money cents={takeHome} /> : '—'}
            sub={takeHome ? `${d.ruleset.financialYear} tax rules${d.ruleset.status === 'provisional' ? ' (provisional)' : ''}` : <Link to="/forecasts?tab=income" className="text-accent">Add income</Link>}
          />
        </Card>
        <Card className="p-4">
          <Stat label={`Spending · ${lastFull ? formatMonthKey(lastFull.month as string) : ''}`} value={<Money cents={lastFull?.consumptionCents ?? 0} />} sub={avg.monthsWithData ? `3-month avg ${formatMoney(avg.consumption)}` : 'No transactions yet'} />
        </Card>
        <Card className="p-4">
          <Stat
            label="Savings rate"
            value={savingsRate === null ? '—' : formatPercent(savingsRate)}
            tone={savingsRate === null ? 'muted' : savingsRate >= 0 ? 'good' : 'bad'}
            sub={lastFull && lastFull.incomeCents > 0 ? `Saved ${formatMoney(lastFull.incomeCents - lastFull.consumptionCents)} of ${formatMoney(lastFull.incomeCents)}` : 'Needs income transactions'}
          />
        </Card>
        <Card className="p-4">
          <Stat label="This month so far" value={<Money cents={thisMonth.incomeCents - thisMonth.consumptionCents} />} tone={thisMonth.incomeCents - thisMonth.consumptionCents >= 0 ? 'good' : 'bad'} sub={`In ${formatMoney(thisMonth.incomeCents)} · Spent ${formatMoney(thisMonth.consumptionCents)}`} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* ---------------- Income vs spending */}
        <Card className="xl:col-span-2">
          <CardHeader title="Income vs spending" subtitle="Consumption spending only — transfers, investments and loan principal are excluded" action={<Legend items={[{ label: 'Income', color: SERIES[0] }, { label: 'Spending', color: SERIES[1] }]} />} />
          <CardBody>
            {months6.some((m) => m.transactionCount > 0) ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months6.map((m) => ({ month: m.month, income: m.incomeCents, spending: m.consumptionCents, rate: m.savingsRate }))} barGap={2} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" {...axisProps} tickFormatter={(m) => formatMonthKey(m)} />
                    <YAxis {...axisProps} tickFormatter={moneyTick} width={56} />
                    <Tooltip cursor={{ fill: 'rgb(var(--surface-3) / 0.5)' }} content={<ChartTooltip labelFormatter={(l) => formatMonthKey(String(l))} footer={(p) => `Savings rate ${formatPercent(p?.rate as number | null)}`} />} />
                    <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="spending" name="Spending" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="No transactions yet" action={<Link to="/transactions?tab=import"><Button size="sm" variant="subtle">Import a CSV</Button></Link>}>
                Import a bank statement or connect a sandbox bank to see income and spending.
              </EmptyState>
            )}
          </CardBody>
        </Card>

        {/* ---------------- Balance sheet */}
        <Card>
          <CardHeader title="Assets & liabilities" subtitle={perspective === 'household' ? 'Each item counted once' : `${d.names[perspective]}'s ownership share`} action={<Link to="/net-worth" className="text-xs text-accent">Details</Link>} />
          <CardBody className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Assets</span><Money cents={bs.assetsCents} className="font-medium" /></div>
              <CompositionBar label="Assets" total={bs.assetsCents} parts={Object.entries(bs.assetGroups).map(([k, v]) => ({ label: ASSET_GROUP_LABELS[k as keyof typeof ASSET_GROUP_LABELS], cents: v, color: ASSET_COLORS[k as keyof typeof ASSET_COLORS] }))} />
              <ul className="mt-2 space-y-1">
                {Object.entries(bs.assetGroups).filter(([, v]) => v > 0).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: ASSET_COLORS[k as keyof typeof ASSET_COLORS] }} />{ASSET_GROUP_LABELS[k as keyof typeof ASSET_GROUP_LABELS]}</span>
                    <Money cents={v} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Liabilities</span><Money cents={bs.liabilitiesCents} className="font-medium" /></div>
              <CompositionBar label="Liabilities" total={bs.liabilitiesCents} parts={Object.entries(bs.liabilityGroups).map(([k, v]) => ({ label: LIABILITY_GROUP_LABELS[k as keyof typeof LIABILITY_GROUP_LABELS], cents: v, color: LIAB_COLORS[k as keyof typeof LIAB_COLORS] }))} />
              <ul className="mt-2 space-y-1">
                {Object.entries(bs.liabilityGroups).filter(([, v]) => v > 0).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: LIAB_COLORS[k as keyof typeof LIAB_COLORS] }} />{LIABILITY_GROUP_LABELS[k as keyof typeof LIABILITY_GROUP_LABELS]}</span>
                    <Money cents={v} />
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {/* ---------------- Projection */}
        <Card>
          <CardHeader title="Projected net worth" subtitle={base ? `${base.name} · assumptions, not guarantees` : undefined} action={<KindBadge kind="forecast" />} />
          <CardBody>
            {forecast ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[1, 5, 10].map((y) => {
                    const h = forecast.horizons.find((x) => x.years === y);
                    return <Stat key={y} label={`${y} year${y > 1 ? 's' : ''}`} value={h ? <Money cents={h.netWorthCents} compact /> : '—'} sub={h ? `${formatMoney(h.realNetWorthCents, { compact: true })} today's $` : undefined} />;
                  })}
                </div>
                {forecast.warnings.length > 0 && <p className="mt-3 text-xs text-warn">{forecast.warnings[0]}</p>}
                <Link to="/forecasts" className="mt-4 inline-flex items-center gap-1 text-xs text-accent">
                  Explore scenarios <ArrowRight className="h-3 w-3" />
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted">Add income and balances to see projections.</p>
            )}
          </CardBody>
        </Card>

        {/* ---------------- Budget */}
        <Card>
          <CardHeader title="Budget this month" subtitle={budget ? `${Math.round(budget.progressOfMonth * 100)}% of month elapsed` : undefined} action={<Link to="/transactions?tab=budget" className="text-xs text-accent">Budget</Link>} />
          <CardBody>
            {budget && budget.rows.length ? (
              <ul className="space-y-3">
                {budget.rows.slice(0, 5).map((r) => (
                  <li key={r.line.id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-ink-2">{r.category.name}</span>
                      <span className="num">
                        <span className={cx(r.status === 'over' && 'text-bad', r.status === 'at-risk' && 'text-warn')}>{formatMoney(r.actualCents)}</span>
                        <span className="text-muted"> / {formatMoney(r.availableCents)}</span>
                      </span>
                    </div>
                    <ProgressBar value={r.availableCents > 0 ? r.actualCents / r.availableCents : 1} tone={r.status === 'over' ? 'bad' : r.status === 'at-risk' ? 'warn' : 'accent'} label={r.category.name} />
                  </li>
                ))}
                <li className="flex justify-between border-t border-line pt-2 text-xs">
                  <span className="text-muted">Total budgeted</span>
                  <span className="num">{formatMoney(budget.totalActualCents)} / {formatMoney(budget.totalBudgetCents)}</span>
                </li>
              </ul>
            ) : (
              <EmptyState title="No budget yet" action={<Link to="/transactions?tab=budget"><Button size="sm" variant="subtle" icon={<Plus className="h-3.5 w-3.5" />}>Create a budget</Button></Link>} />
            )}
          </CardBody>
        </Card>

        {/* ---------------- Upcoming */}
        <Card>
          <CardHeader title="Coming up" subtitle="Next 5 weeks" action={<CalendarClock className="h-4 w-4 text-muted" />} />
          <CardBody>
            {upcoming.length ? (
              <ul className="divide-y divide-line">
                {upcoming.slice(0, 6).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-ink">{u.name}</div>
                      <div className="text-xs text-muted">
                        {formatDate(u.date, 'short')} · {u.kind === 'detected' ? 'detected pattern' : u.kind}
                      </div>
                    </div>
                    <Money cents={u.kind === 'income' ? u.amountCents : -u.amountCents} className={u.kind === 'income' ? 'text-good' : ''} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing scheduled" action={<Link to="/transactions?tab=bills"><Button size="sm" variant="subtle">Add bills</Button></Link>} />
            )}
          </CardBody>
        </Card>

        {/* ---------------- Debts */}
        <Card>
          <CardHeader title="Mortgage & debts" action={<Link to="/property?tab=debts" className="text-xs text-accent">Debt dashboard</Link>} />
          <CardBody>
            {debts.length ? (
              <ul className="space-y-2.5">
                {debts.map((i) => (
                  <li key={i.holding.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{i.holding.name}</div>
                      <div className="text-xs text-muted">
                        {i.holding.loan?.annualRate !== undefined ? formatPercent(i.holding.loan.annualRate, 2) : 'rate not set'}
                        {i.holding.loan?.repaymentCents ? ` · ${formatMoney(toMonthly(i.holding.loan.repaymentCents, i.holding.loan.repaymentFrequency ?? 'monthly'))}/mo` : ''}
                        {isMortgage(i.holding.category) && i.holding.loan?.offsetAccountIds?.length ? ' · offset' : ''}
                      </div>
                    </div>
                    <Money cents={i.attributedCents} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No debts recorded.</p>
            )}
          </CardBody>
        </Card>

        {/* ---------------- Investments */}
        <Card>
          <CardHeader title="Investments & super" subtitle={formatMoney(investItems.reduce((a, i) => a + i.attributedCents, 0))} />
          <CardBody>
            {investItems.length ? (
              <InvestmentAllocation items={investItems.map((i) => ({ label: categoryMeta(i.holding.category).label, cents: i.attributedCents }))} />
            ) : (
              <p className="text-sm text-muted">No investments recorded.</p>
            )}
          </CardBody>
        </Card>

        {/* ---------------- Goals */}
        <Card>
          <CardHeader title="Goals" action={<Link to="/tools?tab=goals" className="text-xs text-accent">All goals</Link>} />
          <CardBody>
            {goals.length ? (
              <ul className="space-y-3">
                {goals.slice(0, 4).map((g) => (
                  <li key={g.goal.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-ink-2"><Target className="h-3 w-3" />{g.goal.name}</span>
                      <span className="num text-muted">{formatMoney(g.currentCents)} / {formatMoney(g.goal.targetCents)}</span>
                    </div>
                    <ProgressBar value={g.fraction} tone={g.complete ? 'good' : g.onTrack ? 'accent' : 'warn'} label={g.goal.name} />
                    <div className="mt-1 text-2xs text-muted">{g.complete ? 'Reached' : g.onTrack ? `On track · ${g.projectedDate ? formatDate(g.projectedDate, 'month') : ''}` : `Needs ${formatMoney(g.requiredMonthlyCents)}/mo to hit ${formatDate(g.goal.targetDate, 'month')}`}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No goals yet" action={<Link to="/tools?tab=goals"><Button size="sm" variant="subtle" icon={<Plus className="h-3.5 w-3.5" />}>Add a goal</Button></Link>} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <InsightsCard insights={insights} />
        <ConnectionHealth />
      </div>
    </div>
  );
}

function InvestmentAllocation({ items }: { items: { label: string; cents: number }[] }) {
  const grouped = new Map<string, number>();
  for (const i of items) grouped.set(i.label, (grouped.get(i.label) ?? 0) + i.cents);
  const rows = [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  return (
    <>
      <CompositionBar label="Investment allocation" total={total} parts={rows.map(([label, cents], i) => ({ label, cents, color: SERIES[i % SERIES.length] }))} />
      <ul className="mt-3 space-y-1.5">
        {rows.map(([label, cents], i) => (
          <li key={label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{label}</span>
            <span className="num">{formatMoney(cents)} <span className="text-muted">· {formatPercent(cents / Math.max(1, total), 0)}</span></span>
          </li>
        ))}
      </ul>
    </>
  );
}

function InsightsCard({ insights }: { insights: Insight[] }) {
  const dismiss = useApp((s) => s.dismissInsight);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? insights : insights.slice(0, 4);
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Insights" subtitle="Calculated from your own data — open any insight to see exactly why" action={<Lightbulb className="h-4 w-4 text-muted" />} />
      <CardBody>
        {insights.length ? (
          <ul className="space-y-2">
            {list.map((i) => (
              <li key={i.id}>
                <Disclosure
                  summary={
                    <span className="flex min-w-0 items-start gap-2 text-left">
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.severity === 'positive' && 'bg-good', i.severity === 'warning' && 'bg-warn', i.severity === 'info' && 'bg-info')} aria-hidden />
                      <span className="text-ink">{i.title}</span>
                    </span>
                  }
                >
                  <p>{i.detail}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    {i.evidence.map((e) => (
                      <div key={e.label} className="flex justify-between gap-3 text-xs">
                        <dt className="text-muted">{e.label}</dt>
                        <dd className="num text-ink">{e.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-muted">
                    <span className="font-medium text-ink-2">How this was calculated: </span>
                    {i.method}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {i.link && (
                      <Link to={i.link.to}>
                        <Button size="sm" variant="subtle">{i.link.label}</Button>
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => dismiss(i.id)}>
                      Dismiss
                    </Button>
                  </div>
                </Disclosure>
              </li>
            ))}
            {insights.length > 4 && (
              <li>
                <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show ${insights.length - 4} more`}
                </Button>
              </li>
            )}
          </ul>
        ) : (
          <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No insights right now">Insights appear as transactions, balances and goals build up.</EmptyState>
        )}
      </CardBody>
    </Card>
  );
}

function ConnectionHealth() {
  const data = useApp((s) => s.data);
  const d = useDerived();
  const bs = d.balance.household;
  const problems = bs.items.filter((i) => i.status !== 'current');
  const lastManual = data.holdings.reduce<string | null>((a, h) => (h.valuedAt && (!a || h.valuedAt > a) ? h.valuedAt : a), null);
  return (
    <Card>
      <CardHeader title="Data health" action={<Link to="/settings?tab=connections" className="text-xs text-accent">Connections</Link>} />
      <CardBody className="space-y-3 text-sm">
        {data.connections.length === 0 ? (
          <div className="flex items-start gap-2 text-muted">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No bank connections. Balances are manual or imported.</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{c.institutionName}</span>
                <span className="flex items-center gap-1.5">
                  <Badge tone={c.status === 'active' ? 'good' : c.status === 'expired' || c.status === 'error' ? 'bad' : 'warn'}>{c.status}</Badge>
                  <Badge tone={c.environment === 'live' ? 'good' : 'warn'}>{c.environment}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-muted">Latest balance update</span>
          <span>{lastManual ? relativeTime(lastManual) : 'never'}</span>
        </div>
        {problems.length > 0 ? (
          <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-warn">
              <CircleAlert className="h-3.5 w-3.5" /> {problems.length} item(s) need attention
            </div>
            <ul className="space-y-0.5 text-ink-2">
              {problems.slice(0, 4).map((p) => (
                <li key={p.holding.id}>
                  {p.holding.name} — {p.status === 'stale' ? `last valued ${p.ageDays} days ago` : p.status === 'no-fx' ? 'no exchange rate' : 'no value'}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-good">All balances are within their freshness thresholds.</p>
        )}
      </CardBody>
    </Card>
  );
}

function FirstRun() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <Card className="p-6 text-center">
        <h1 className="text-xl font-semibold">Your household finances start here</h1>
        <p className="mt-2 text-sm text-muted">Nothing has been added yet, so there is nothing to show. Nothing on this page is pre-filled — every figure comes from data you add.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/net-worth?add=1">
            <Button variant="primary" icon={<Plus className="h-4 w-4" />}>Add an account or asset</Button>
          </Link>
          <Link to="/transactions?tab=import">
            <Button>Import a CSV</Button>
          </Link>
          <Link to="/welcome">
            <Button variant="ghost">Setup & demo mode</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
