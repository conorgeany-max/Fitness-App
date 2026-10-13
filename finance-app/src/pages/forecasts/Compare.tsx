import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonthKey } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { sensitivity } from '@/domain/forecast';
import type { Scenario } from '@/domain/types';
import { buildForecastInput, forecastFor } from '@/store/builders';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Card, CardHeader, Segmented } from '@/components/ui';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';

export function Compare() {
  const data = useApp((s) => s.data);
  const perspective = usePerspective();
  const [real, setReal] = useState<'nominal' | 'real'>('real');
  const years = Math.max(...data.scenarios.map((s) => s.horizonYears));
  // Colour follows the scenario (its position in the saved list), never its rank.
  const color = (i: number) => SERIES[i % SERIES.length];
  const runs = useMemo(() => data.scenarios.map((s) => ({ s, fc: forecastFor(data, s, perspective) })), [data, perspective]);
  const chart = useMemo(() => {
    const rows: Record<string, number | string>[] = [];
    for (let m = 0; m < years * 12; m += 3) {
      const row: Record<string, number | string> = { month: '' };
      for (const { s, fc } of runs) {
        const p = fc.points[m];
        if (!p) continue;
        row.month = p.month;
        row[s.id] = real === 'real' ? p.realNetWorthCents : p.netWorthCents;
      }
      if (row.month) rows.push(row);
    }
    return rows;
  }, [runs, years, real]);
  const horizons = [1, 5, 10, 20, 30].filter((y) => y <= years);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Scenarios side by side" subtitle="Projected net worth" action={<Segmented size="sm" ariaLabel="Value basis" value={real} onChange={setReal} options={[{ value: 'nominal', label: 'Future $' }, { value: 'real', label: "Today's $" }]} />} />
        <div className="px-3 pb-3 pt-3">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={(m: string) => m.slice(0, 4)} minTickGap={40} />
                <YAxis {...axisProps} tickFormatter={moneyTick} width={64} />
                <Tooltip content={<ChartTooltip labelFormatter={(l) => formatMonthKey(String(l))} />} />
                {runs.map(({ s }, i) => <Line key={s.id} dataKey={s.id} name={s.name} stroke={color(i)} strokeWidth={2} dot={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend className="px-2 pt-2" items={runs.map(({ s }, i) => ({ label: s.name, color: color(i) }))} />
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-right text-xs text-muted">
                <th className="px-5 py-2 text-left font-medium">Scenario</th>
                {horizons.map((y) => <th key={y} className="px-3 py-2 font-medium">{y} yr</th>)}
                <th className="px-5 py-2 font-medium">Shortfall months</th>
              </tr>
            </thead>
            <tbody className="num">
              {runs.map(({ s, fc }, i) => (
                <tr key={s.id} className="border-t border-line/60 text-right">
                  <td className="px-5 py-2 text-left">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: color(i) }} />
                    {s.name}
                  </td>
                  {horizons.map((y) => {
                    const p = fc.points[y * 12 - 1];
                    return <td key={y} className="px-3 py-2">{p ? formatMoney(real === 'real' ? p.realNetWorthCents : p.netWorthCents, { compact: true }) : '—'}</td>;
                  })}
                  <td className={fc.shortfallMonths ? 'px-5 py-2 text-bad' : 'px-5 py-2 text-muted'}>{fc.shortfallMonths || 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function Sensitivity({ scenario }: { scenario: Scenario }) {
  const data = useApp((s) => s.data);
  const perspective = usePerspective();
  const d = useDerived();
  const [years, setYears] = useState(Math.min(10, scenario.horizonYears));
  const result = useMemo(() => sensitivity(buildForecastInput(data, scenario, d, perspective), years), [data, scenario, d, perspective, years]);
  const maxSwing = Math.max(1, ...result.rows.map((r) => Math.max(Math.abs(r.lowCents - result.baseCents), Math.abs(r.highCents - result.baseCents))));

  return (
    <Card>
      <CardHeader
        title="What moves the result most"
        subtitle={`${scenario.name}: net worth in ${years} years is ${formatMoney(result.baseCents)} (future dollars). Each row changes one assumption, all else equal.`}
        action={<Segmented size="sm" ariaLabel="Horizon" value={String(years)} onChange={(v) => setYears(Number(v))} options={[5, 10, 20].filter((y) => y <= scenario.horizonYears).map((y) => ({ value: String(y), label: `${y}y` }))} />}
      />
      <ul className="space-y-4 p-5">
        {result.rows.map((r) => {
          const lo = r.lowCents - result.baseCents;
          const hi = r.highCents - result.baseCents;
          return (
            <li key={r.label}>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium">{r.label}</span>
              </div>
              <div className="relative h-5">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <Bar delta={lo} max={maxSwing} label={r.lowLabel} />
                <Bar delta={hi} max={maxSwing} label={r.highLabel} />
              </div>
              <div className="mt-1 grid grid-cols-2 text-2xs text-muted">
                <span className="pr-2 text-right">{r.lowLabel}: {formatMoney(lo, { compact: true, signed: true })}</span>
                <span className="pl-2">{r.highLabel}: {formatMoney(hi, { compact: true, signed: true })}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-5 pb-5 text-xs text-muted">Bars to the right increase projected net worth; to the left, decrease it. Use this to see which assumptions deserve the most care.</p>
    </Card>
  );
}

function Bar({ delta, max, label }: { delta: number; max: number; label: string }) {
  const w = (Math.abs(delta) / max) * 50;
  const right = delta >= 0;
  return (
    <div
      title={`${label}: ${formatMoney(delta, { signed: true })}`}
      className="absolute inset-y-0 rounded-[4px]"
      style={{ left: right ? 'calc(50% + 1px)' : `calc(${50 - w}% - 1px)`, width: `${Math.max(w, 0.5)}%`, background: delta >= 0 ? SERIES[0] : SERIES[1] }}
    />
  );
}
