import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { planDebts, type DebtInput } from '@/domain/debt';
import { categoryMeta, isMortgage } from '@/domain/holdingCategories';
import { formatMoney, formatPercent } from '@/domain/money';
import { toMonthly } from '@/domain/mortgage';
import { amountForPerspective, ownershipLabel } from '@/domain/ownership';
import { estimateStampDuty, estimateRegistrationFees, SUPPORTED_DUTY_STATES } from '@/domain/property/stampDuty';
import type { AustralianState } from '@/domain/types';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Callout, Card, CardHeader, EmptyState, MoneyInput, Segmented, Select, Toggle } from '@/components/ui';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';

export function DebtDashboard() {
  const holdings = useApp((s) => s.data.holdings);
  const perspective = usePerspective();
  const d = useDerived();
  const [extra, setExtra] = useState<number>(500_00);
  const debts = holdings.filter((h) => h.kind === 'liability' && !h.archived && (h.valueCents ?? 0) > 0 && (perspective === 'household' || h.ownership[perspective] > 0));
  const nonMortgage = debts.filter((h) => !isMortgage(h.category) && h.category !== 'help-debt');
  const hasHelp = debts.some((h) => h.category === 'help-debt');

  const inputs: DebtInput[] = nonMortgage.map((h) => ({
    id: h.id,
    name: h.name,
    balanceCents: amountForPerspective(h.valueCents ?? 0, h.ownership, perspective),
    annualRate: h.loan?.annualRate ?? 0,
    minimumCents: h.loan?.repaymentCents ? toMonthly(h.loan.repaymentCents, h.loan.repaymentFrequency ?? 'monthly') : Math.max(2_500, Math.round((h.valueCents ?? 0) * 0.02)),
  }));
  const missingRate = nonMortgage.filter((h) => !h.loan?.annualRate);
  const plans = useMemo(() => {
    if (!inputs.length) return null;
    return { avalanche: planDebts(inputs, extra, 'avalanche'), snowball: planDebts(inputs, extra, 'snowball'), minimum: planDebts(inputs, 0, 'minimum') };
  }, [JSON.stringify(inputs), extra]); // eslint-disable-line react-hooks/exhaustive-deps

  const chart = plans
    ? Array.from({ length: Math.min(600, Math.max(plans.avalanche.balances.length, plans.snowball.balances.length, Math.min(plans.minimum.balances.length, 360))) }, (_, i) => ({
        month: i,
        avalanche: plans.avalanche.balances[i]?.totalCents ?? 0,
        snowball: plans.snowball.balances[i]?.totalCents ?? 0,
        minimum: plans.minimum.balances[i]?.totalCents ?? (plans.minimum.months !== null ? 0 : undefined),
      })).filter((r) => r.month % 3 === 0)
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="All debts" subtitle={perspective === 'household' ? 'Household view: each debt counted once' : `${d.names[perspective]}'s share by ownership`} />
        {debts.length === 0 ? (
          <EmptyState title="No debts recorded">Add loans and cards in Net Worth.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {debts.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{h.name}</div>
                  <div className="text-xs text-muted">{categoryMeta(h.category).label} · {ownershipLabel(h.ownership, d.names)} · {h.loan?.annualRate ? formatPercent(h.loan.annualRate, 2) : 'rate not set'}{h.loan?.repaymentCents ? ` · ${formatMoney(h.loan.repaymentCents)} ${h.loan.repaymentFrequency ?? 'monthly'}` : ''}</div>
                </div>
                <span className="num font-medium">{formatMoney(amountForPerspective(h.valueCents ?? 0, h.ownership, perspective))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {hasHelp && (
        <Callout tone="info" title="HELP debts work differently">
          HELP balances are indexed each June rather than charged interest, and are repaid through your tax return once income passes the threshold. Compulsory repayments are included in take-home pay on the Forecasts page. Voluntary repayments are possible but rarely beat paying off high-interest debt first.
        </Callout>
      )}

      {plans && (
        <Card>
          <CardHeader title="Pay off other debts faster" subtitle="Mortgages and HELP debts are excluded. Avalanche pays the highest rate first; snowball pays the smallest balance first. Nothing is paid automatically." />
          <div className="flex flex-wrap items-end gap-4 px-5 pt-4">
            <MoneyInput label="Extra each month" value={extra} onChange={(v) => setExtra(v ?? 0)} className="w-48" />
            {missingRate.length > 0 && <Callout tone="warn">{missingRate.map((h) => h.name).join(', ')}: no interest rate recorded, so treated as 0%. Add the rate in Net Worth for a real comparison.</Callout>}
          </div>
          {plans.avalanche.payoffOrder.map((o) => o.id).join() === plans.snowball.payoffOrder.map((o) => o.id).join() && inputs.length > 1 && (
            <p className="px-5 pt-3 text-sm text-ink-2">Here the highest-rate debt is also the smallest, so both strategies pay debts off in the same order.</p>
          )}
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            {(['avalanche', 'snowball', 'minimum'] as const).map((k) => {
              const p = plans[k];
              return (
                <div key={k} className="rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between text-sm font-medium">
                    {k === 'avalanche' ? 'Avalanche' : k === 'snowball' ? 'Snowball' : 'Minimums only'}
                    {k === 'avalanche' && <Badge tone="good">Least interest</Badge>}
                  </div>
                  <div className="num mt-2 text-lg font-semibold">{p.months !== null ? `${Math.floor(p.months / 12)}y ${p.months % 12}m` : 'Not paid off'}</div>
                  <div className="text-xs text-muted">Interest {formatMoney(p.totalInterestCents)}</div>
                  {p.payoffOrder.length > 0 && <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-ink-2">{p.payoffOrder.map((o) => <li key={o.id}>{o.name} · month {o.month}</li>)}</ol>}
                </div>
              );
            })}
          </div>
          <div className="px-3 pb-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} ticks={chart.filter((r) => r.month % 12 === 0).map((r) => r.month)} tickFormatter={(m) => `${m / 12}y`} />
                  <YAxis {...axisProps} tickFormatter={moneyTick} width={60} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Month ${l}`} />} />
                  <Line dataKey="avalanche" name="Avalanche" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="snowball" name="Snowball" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="minimum" name="Minimums only" stroke={SERIES[7]} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend className="px-2 pt-2" items={[{ label: 'Avalanche', color: SERIES[0] }, { label: 'Snowball', color: SERIES[1] }, { label: 'Minimums only', color: SERIES[7], dashed: true }]} />
          </div>
        </Card>
      )}
    </div>
  );
}

const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export function StampDutyEstimator() {
  const home = useApp((s) => s.data.settings.stateOfResidence);
  const [state, setState] = useState<AustralianState>(home);
  const [price, setPrice] = useState<number>(800_000_00);
  const [use, setUse] = useState<'owner' | 'investor'>('owner');
  const [fhb, setFhb] = useState(false);
  const [newHome, setNewHome] = useState(false);
  const r = estimateStampDuty({ state, priceCents: price, ownerOccupier: use === 'owner', firstHomeBuyer: fhb, newHome });
  const reg = estimateRegistrationFees(state, price);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Stamp duty estimator" subtitle={`Rules are versioned with sources. Supported: ${SUPPORTED_DUTY_STATES.join(', ')}.`} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Select label="State" value={state} onChange={(e) => setState(e.target.value as AustralianState)} options={STATES.map((s) => ({ value: s, label: `${s}${SUPPORTED_DUTY_STATES.includes(s) ? '' : ' (not yet supported)'}` }))} />
          <MoneyInput label="Purchase price" value={price} onChange={(v) => setPrice(v ?? 0)} />
          <div className="sm:col-span-2"><Segmented ariaLabel="Use" value={use} onChange={setUse} options={[{ value: 'owner', label: 'Home to live in' }, { value: 'investor', label: 'Investment' }]} /></div>
          <div className="space-y-3 sm:col-span-2">
            <Toggle checked={fhb} onChange={setFhb} label="First home buyer" disabled={use !== 'owner'} />
            <Toggle checked={newHome} onChange={setNewHome} label="New home or off the plan" hint="Some states treat new homes differently. Only rules in the ruleset are applied." />
          </div>
        </div>
      </Card>
      <Card className="p-5">
        {r.supported ? (
          <>
            <div className="text-xs text-muted">Estimated transfer (stamp) duty</div>
            <div className="num mt-1 text-3xl font-semibold">{formatMoney(r.dutyCents)}</div>
            {r.dutyCents !== r.generalDutyCents && <div className="mt-1 text-sm text-good">Saves {formatMoney(r.generalDutyCents - r.dutyCents)} vs general rate{r.concessionLabel ? ` (${r.concessionLabel})` : ''}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={r.status === 'confirmed' ? 'good' : 'warn'}>{r.status === 'confirmed' ? 'Confirmed rules' : 'Provisional rules'}</Badge>
              {r.effectiveFrom && <Badge tone="neutral">From {r.effectiveFrom}</Badge>}
            </div>
            <div className="mt-4 text-sm"><span className="text-muted">Registration and transfer fees (estimate):</span> <span className="num">{formatMoney(reg.cents)}</span> <div className="text-xs text-muted">{reg.note}</div></div>
            {r.notes.length > 0 && <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-2">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            <div className="mt-4 space-y-1">
              {r.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-sm text-accent hover:underline">{s.label} <ExternalLink className="h-3 w-3" /></a>)}
            </div>
          </>
        ) : (
          <Callout tone="warn" title={`${state} stamp duty isn't supported yet`}>
            Rather than guess, the app leaves this blank. Use your state revenue office's calculator and enter the figure as a stamp duty override in the property analyser.
          </Callout>
        )}
        <p className="mt-4 text-xs text-muted">Estimates only. Eligibility for concessions depends on conditions (residency, price caps, moving in) checked by the revenue office, not this app.</p>
      </Card>
    </div>
  );
}
