import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatMonthKey } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import type { ForecastPoint } from '@/domain/forecast';
import type { Scenario } from '@/domain/types';
import { forecastFor } from '@/store/builders';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Callout, Card, CardHeader, Disclosure, Segmented, Stat } from '@/components/ui';
import { KindBadge, ScopeBadge } from '@/components/finance';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';

const LAYERS: { key: keyof ForecastPoint; label: string }[] = [
  { key: 'cashCents', label: 'Cash' },
  { key: 'investmentsCents', label: 'Investments' },
  { key: 'superCents', label: 'Super' },
  { key: 'propertyCents', label: 'Property' },
  { key: 'otherAssetsCents', label: 'Other assets' },
];

export function Projection({ scenario }: { scenario: Scenario }) {
  const data = useApp((s) => s.data);
  const perspective = usePerspective();
  const d = useDerived();
  const [years, setYears] = useState(Math.min(10, scenario.horizonYears));
  const [real, setReal] = useState<'nominal' | 'real'>('nominal');
  const fc = useMemo(() => forecastFor(data, scenario, perspective), [data, scenario, perspective]);
  const pts = fc.points.slice(0, years * 12);
  const deflate = (p: ForecastPoint, v: number) => (real === 'real' ? Math.round(v * p.deflator) : v);

  const chart = pts
    .filter((p) => p.index % (years > 10 ? 6 : years > 3 ? 3 : 1) === 0 || p.index === pts.length - 1)
    .map((p) => {
      const row: Record<string, number | string> = { month: p.month };
      for (const l of LAYERS) row[l.key] = deflate(p, p[l.key] as number);
      row.liabilities = -deflate(p, p.liabilitiesCents);
      row.net = deflate(p, p.netWorthCents);
      return row;
    });

  const last = pts[pts.length - 1];
  const firstYear = fc.points.slice(0, 12);
  const firstSurplus = firstYear.reduce((a, p) => a + p.surplusCents, 0);
  const firstIncome = firstYear.reduce((a, p) => a + p.netIncomeCents + p.rentalIncomeCents, 0);
  const yearRows = useMemo(() => {
    const out: { year: number; income: number; living: number; loans: number; oneOff: number; surplus: number; net: number; realNet: number }[] = [];
    for (let y = 0; y < Math.min(years, 30); y++) {
      const slice = fc.points.slice(y * 12, y * 12 + 12);
      if (!slice.length) break;
      const sum = (k: keyof ForecastPoint) => slice.reduce((a, p) => a + (p[k] as number), 0);
      const end = slice[slice.length - 1];
      out.push({ year: y + 1, income: sum('netIncomeCents') + sum('rentalIncomeCents'), living: sum('livingCostsCents'), loans: sum('loanRepaymentsCents'), oneOff: sum('oneOffCents'), surplus: sum('surplusCents'), net: end.netWorthCents, realNet: end.realNetWorthCents });
    }
    return out;
  }, [fc, years]);

  if (!last) return null;
  const valueLabel = real === 'real' ? "today's dollars" : 'future dollars';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Horizon" value={String(years)} onChange={(v) => setYears(Number(v))} options={[1, 5, 10, 20, 30].filter((y) => y <= scenario.horizonYears).map((y) => ({ value: String(y), label: `${y}y` }))} />
        <Segmented ariaLabel="Value basis" value={real} onChange={setReal} options={[{ value: 'nominal', label: 'Future $' }, { value: 'real', label: "Today's $" }]} />
        <ScopeBadge perspective={perspective} names={d.names} />
        <KindBadge kind="forecast" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><Stat label={`Net worth in ${years} year${years > 1 ? 's' : ''}`} value={formatMoney(deflate(last, last.netWorthCents))} sub={real === 'real' ? `${formatMoney(last.netWorthCents)} in future dollars` : `${formatMoney(last.realNetWorthCents)} in today's dollars`} /></Card>
        <Card className="p-4"><Stat label="Liquid (cash + investments)" value={formatMoney(deflate(last, last.cashCents + last.investmentsCents))} sub="Excludes super and property" /></Card>
        <Card className="p-4"><Stat label="Debt remaining" value={formatMoney(deflate(last, last.liabilitiesCents))} sub={`${formatMoney(d.balance[perspective].liabilitiesCents)} today`} /></Card>
        <Card className="p-4"><Stat label="Surplus, first year" value={`${formatMoney(Math.round(firstSurplus / Math.max(1, firstYear.length)))}/mo`} sub={firstIncome > 0 ? `${formatPercent(firstSurplus / firstIncome, 0)} of take-home, after living costs and all loan repayments` : 'No income in the first year'} /></Card>
      </div>

      <Card>
        <CardHeader title="Projected balance sheet" subtitle={`${scenario.name} · stacked assets above the line, debts below · ${valueLabel}`} />
        <div className="px-3 pb-2 pt-3">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} ticks={years > 3 ? chart.map((r) => String(r.month)).filter((m) => m.endsWith('-01')) : undefined} tickFormatter={(m: string) => (years > 3 ? m.slice(0, 4) : formatMonthKey(m))} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={moneyTick} width={64} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => formatMonthKey(String(l))} footer={(p) => <span>Net worth <strong className="num">{formatMoney(Number(p?.net))}</strong></span>} />} />
                {LAYERS.map((l, i) => (
                  <Area key={l.key} type="monotone" dataKey={l.key} name={l.label} stackId="a" stroke={SERIES[i]} fill={SERIES[i]} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
                ))}
                <Area type="monotone" dataKey="liabilities" name="Debts" stackId="a" stroke={SERIES[7]} fill={SERIES[7]} fillOpacity={0.3} strokeWidth={1.5} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <Legend className="px-2 pt-2" items={[...LAYERS.map((l, i) => ({ label: l.label, color: SERIES[i] })), { label: 'Debts', color: SERIES[7] }]} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Year by year" subtitle="Annual totals. Income is after tax; super contributions are not cash." />
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-line text-right text-xs text-muted">
                  <th className="px-5 py-2 text-left font-medium">Year</th>
                  <th className="px-2 py-2 font-medium">Take-home</th>
                  <th className="px-2 py-2 font-medium">Living costs</th>
                  <th className="px-2 py-2 font-medium">Loans</th>
                  <th className="px-2 py-2 font-medium">One-offs</th>
                  <th className="px-2 py-2 font-medium">Surplus</th>
                  <th className="px-5 py-2 font-medium">Net worth</th>
                </tr>
              </thead>
              <tbody className="num">
                {yearRows.map((r) => (
                  <tr key={r.year} className="border-b border-line/50 text-right">
                    <td className="px-5 py-1.5 text-left text-ink-2">{r.year}</td>
                    <td className="px-2 py-1.5">{formatMoney(r.income, { compact: true })}</td>
                    <td className="px-2 py-1.5">{formatMoney(r.living, { compact: true })}</td>
                    <td className="px-2 py-1.5">{formatMoney(r.loans, { compact: true })}</td>
                    <td className="px-2 py-1.5">{r.oneOff ? formatMoney(r.oneOff, { compact: true }) : '—'}</td>
                    <td className={r.surplus < 0 ? 'px-2 py-1.5 text-bad' : 'px-2 py-1.5'}>{formatMoney(r.surplus, { compact: true, signed: true })}</td>
                    <td className="px-5 py-1.5 font-medium">{formatMoney(real === 'real' ? r.realNet : r.net, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold">Milestones</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                {fc.emergencyFundReachedMonth ? <span>Emergency fund of {scenario.assumptions.emergencyFundMonths} months reached by {formatMonthKey(fc.emergencyFundReachedMonth)}</span> : <span>Emergency fund target not reached in this horizon</span>}
              </li>
              {fc.firstShortfall ? (
                <li className="flex gap-2 text-bad">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Cash runs short in {fc.shortfallMonths} month(s), first in {formatMonthKey(fc.firstShortfall)}</span>
                </li>
              ) : (
                <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /><span>No cash shortfalls projected</span></li>
              )}
            </ul>
          </Card>
          {(fc.warnings.length > 0 || fc.notes.length > 0) && (
            <Callout tone={fc.warnings.length ? 'warn' : 'info'} title="About this forecast">
              <ul className="list-disc space-y-1 pl-4">
                {[...fc.warnings, ...fc.notes].map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Callout>
          )}
          <Disclosure summary="How the forecast works">
            <div className="space-y-2 px-4 pb-4 text-sm text-ink-2">
              <p>The model runs month by month from next month. Each month it grows salaries at review time, taxes income using the financial year's rules, pays living costs and loan repayments, and puts any surplus first into cash until the emergency fund target is met, then splits it between investments ({formatPercent(scenario.assumptions.surplusInvestShare, 0)}) and cash.</p>
              <p>Super grows with employer and salary-sacrifice contributions (after 15% contributions tax) and is never counted as spendable cash. Property grows at the assumed rate; loans amortise at their own rate plus any rate change in the scenario.</p>
              <p>"Today's dollars" divides by cumulative inflation of {formatPercent(scenario.assumptions.inflation, 1)} a year. Future tax brackets are not known, so the latest ruleset is carried forward without indexation (bracket creep is not modelled).</p>
            </div>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
