import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, ExternalLink, Lightbulb, XCircle } from 'lucide-react';
import { formatMoney, formatPercent } from '@/domain/money';
import { useDerived } from '@/store/derived';
import { Badge, Callout, Card, CardHeader, Disclosure, cx } from '@/components/ui';
import { KindBadge } from '@/components/finance';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';
import { LABEL_META, type PreparedAnalysis } from './analysis';

const BASIS_LABEL = { entered: 'You entered', estimated: 'Estimate', calculated: 'Calculated', unavailable: 'Unavailable' } as const;

export function AffordabilityView({ prep }: { prep: PreparedAnalysis }) {
  const d = useDerived();
  const r = prep.result;
  if (!r) {
    return (
      <Card className="p-5">
        <h3 className="font-semibold">Affordability</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{prep.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      </Card>
    );
  }
  const meta = LABEL_META[r.label];
  const toneBg = { good: 'border-good/40 bg-good/5', info: 'border-info/40 bg-info/5', warn: 'border-warn/40 bg-warn/5', bad: 'border-bad/40 bg-bad/5' }[meta.tone];

  return (
    <div className="space-y-4">
      <Card className={cx('border p-5', toneBg)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} className="text-sm">{meta.text}</Badge>
          <KindBadge kind="estimate" />
          <span className="text-xs text-muted">Based on your recorded finances. Not a lending decision or credit advice.</span>
        </div>
        <p className="mt-3 text-lg font-semibold">{r.headline}</p>
        {r.reasons.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
        {prep.maxComfortableCents !== null && (
          <p className="mt-3 text-sm">
            Highest price that stays <strong>comfortable</strong> with this deposit: <strong className="num">{formatMoney(prep.maxComfortableCents)}</strong>
          </p>
        )}
      </Card>

      {(prep.missing.length > 0 || prep.priceNote) && (
        <Callout tone="warn" title="Some inputs are missing">
          {prep.missing.length > 0 && <>Not in the listing and treated as $0: {prep.missing.join(', ')}. Enter them above (from the agent or council) for a reliable result. </>}
          {prep.priceNote}
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Loan" value={formatMoney(r.loanCents)} sub={`LVR ${formatPercent(r.lvr, 1)}${r.lmiCents > 0 ? ` · LMI ${formatMoney(r.lmiCents)}${r.lmiCapitalised ? ' added to loan' : ''}` : ''}`} />
        <Kpi label="Repayments" value={`${formatMoney(r.repaymentMonthlyCents)}/mo`} sub={`At ${formatPercent(r.rate, 2)}. At ${formatPercent(r.stressRate, 2)} stress rate: ${formatMoney(r.stressRepaymentMonthlyCents)}/mo`} />
        <Kpi label="Cash needed upfront" value={formatMoney(r.upfrontTotalCents)} sub={`Leaves ${formatMoney(r.savingsAfterSettlementCents)} in savings`} tone={r.savingsAfterSettlementCents < 0 ? 'bad' : undefined} />
        <Kpi label="Left over each month" value={formatMoney(r.disposableMonthlyCents)} sub={`${formatMoney(r.disposableAtStressCents)} at the stress rate`} tone={r.disposableMonthlyCents < 0 ? 'bad' : undefined} />
      </div>

      <Card>
        <CardHeader title="Checks" subtitle="Each check uses a threshold you can see. The overall label is the weakest result." />
        <ul className="mt-2 divide-y divide-line/60">
          {r.checks.map((c) => (
            <li key={c.id} className="flex gap-3 px-5 py-3 text-sm">
              {c.result === 'pass' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : c.result === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className="num">{c.value} <span className="text-xs text-muted">({c.threshold})</span></span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{c.explanation}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upfront costs" subtitle="What you need at settlement" />
          <dl className="mt-2 divide-y divide-line/60 text-sm">
            {r.upfront.map((u) => (
              <div key={u.key} className="flex items-start justify-between gap-3 px-5 py-2">
                <dt>
                  {u.label}
                  <span className="ml-2 text-2xs text-muted">{BASIS_LABEL[u.basis]}</span>
                  {u.note && <div className="text-xs text-muted">{u.note}</div>}
                </dt>
                <dd className="num shrink-0">{u.basis === 'unavailable' ? '—' : formatMoney(u.cents)}</dd>
              </div>
            ))}
            <div className="flex justify-between px-5 py-2.5 font-semibold"><dt>Total</dt><dd className="num">{formatMoney(r.upfrontTotalCents)}</dd></div>
          </dl>
          {r.duty && (
            <div className="border-t border-line px-5 py-3 text-xs text-muted">
              <div>
                Stamp duty: {r.duty.supported ? `${r.duty.state} rules${r.duty.effectiveFrom ? ` from ${r.duty.effectiveFrom}` : ''} (${r.duty.status})` : `${r.duty.state} is not supported yet — enter the duty yourself`}
                {r.duty.concessionLabel && ` · ${r.duty.concessionLabel}`}
              </div>
              {r.duty.notes.map((n) => <div key={n}>{n}</div>)}
              {r.duty.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-accent hover:underline">{s.label} <ExternalLink className="h-3 w-3" /></a>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Monthly housing costs" subtitle={`${formatPercent(r.housingRatio, 0)} of take-home pay (${formatMoney(r.takeHomeMonthlyCents)}/mo)`} />
          <dl className="mt-2 divide-y divide-line/60 text-sm">
            {r.housingBreakdown.map((h) => (
              <div key={h.label} className="flex justify-between px-5 py-2"><dt>{h.label}</dt><dd className="num">{formatMoney(h.cents)}</dd></div>
            ))}
            {r.netRentMonthlyCents > 0 && <div className="flex justify-between px-5 py-2 text-good"><dt>Less net rent received</dt><dd className="num">−{formatMoney(r.netRentMonthlyCents)}</dd></div>}
            <div className="flex justify-between px-5 py-2.5 font-semibold"><dt>Total</dt><dd className="num">{formatMoney(r.housingCostsMonthlyCents)}</dd></div>
          </dl>
          <div className="border-t border-line px-5 py-3">
            <h4 className="text-xs font-semibold text-muted">If one income stopped</h4>
            <ul className="mt-1.5 space-y-1 text-sm">
              {r.singleIncome.map((s) => (
                <li key={s.person} className="flex justify-between gap-2">
                  <span>On {d.names[s.person]}'s income alone</span>
                  <span className={cx('num', s.disposableCents < 0 && 'text-bad')}>
                    {formatMoney(s.disposableCents, { signed: true })}/mo
                    {s.disposableCents < 0 && s.monthsBufferLasts !== null && <span className="text-xs text-muted"> · savings last {s.monthsBufferLasts.toFixed(0)} mo</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Equity over time" subtitle={`Property growth ${formatPercent(prep.market.propertyGrowth, 1)} a year (your forecast assumption, not a market prediction)`} />
          <div className="px-3 pb-3 pt-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.equity} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="year" {...axisProps} tickFormatter={(y) => `Yr ${y}`} />
                  <YAxis {...axisProps} tickFormatter={moneyTick} width={60} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Year ${l}`} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
                  <Bar dataKey="equityCents" name="Equity" fill={SERIES[2]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="loanCents" name="Loan" fill={SERIES[7]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend className="px-2 pt-2" items={[{ label: 'Equity', color: SERIES[2] }, { label: 'Loan', color: SERIES[7] }]} />
          </div>
        </Card>

        <div className="space-y-4">
          {r.rentVsBuy && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold">Rent vs buy after {r.rentVsBuy.years} years</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-muted">Buying</div><div className="num text-lg font-semibold">{formatMoney(r.rentVsBuy.buyerNetWealthCents)}</div></div>
                <div><div className="text-xs text-muted">Renting & investing the difference</div><div className="num text-lg font-semibold">{formatMoney(r.rentVsBuy.renterNetWealthCents)}</div></div>
              </div>
              <p className="mt-2 text-sm">{r.rentVsBuy.differenceCents >= 0 ? 'Buying' : 'Renting'} comes out ahead by <strong className="num">{formatMoney(Math.abs(r.rentVsBuy.differenceCents))}</strong> on these assumptions.</p>
              <p className="mt-1 text-xs text-muted">{r.rentVsBuy.assumptions}</p>
            </Card>
          )}
          {(r.drivers.length > 0 || r.toImprove.length > 0) && (
            <Card className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-accent" /> What would change the result</h3>
              {r.drivers.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {r.drivers.map((x) => <li key={x.label} className="flex justify-between gap-2"><span className="text-ink-2">{x.label}</span><span className="num">{formatMoney(x.impactMonthlyCents)}/mo</span></li>)}
                </ul>
              )}
              {r.toImprove.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">{r.toImprove.map((x) => <li key={x}>{x}</li>)}</ul>}
            </Card>
          )}
        </div>
      </div>

      <Disclosure summary="What this analysis uses">
        <ul className="list-disc space-y-1 px-4 pb-4 pl-8 text-sm text-ink-2">
          {prep.household.basis.map((b) => <li key={b}>{b}</li>)}
          <li>Savings available: {formatMoney(prep.household.liquidSavingsCents)} (cash accounts and offset balances in the household view).</li>
          <li>Stress test adds {formatPercent(r.stressRate - r.rate, 1)} to the rate, as lenders do when assessing serviceability.</li>
          <li>No suburb growth, comparable sales or rental yield data is used or invented. Rent and costs come only from the listing or your entries.</li>
        </ul>
      </Disclosure>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('num mt-1 text-xl font-semibold', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}
