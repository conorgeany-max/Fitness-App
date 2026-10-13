import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { amortise, compareRefinance, toMonthly, yearlySummary, type LoanInput, type RepaymentFrequency } from '@/domain/mortgage';
import { isMortgage } from '@/domain/holdingCategories';
import { useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Card, CardHeader, Disclosure, MoneyInput, NumberInput, PercentInput, Select, Toggle } from '@/components/ui';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';

export function MortgageCalculator() {
  const d = useDerived();
  const holdings = useApp((s) => s.data.holdings);
  const loans = holdings.filter((h) => !h.archived && isMortgage(h.category) && h.valueCents);
  const [principal, setPrincipal] = useState<number>(600_000_00);
  const [rate, setRate] = useState(0.0599);
  const [term, setTerm] = useState(30);
  const [frequency, setFrequency] = useState<RepaymentFrequency>('monthly');
  const [accelerated, setAccelerated] = useState(false);
  const [type, setType] = useState<'PI' | 'IO'>('PI');
  const [ioYears, setIoYears] = useState(5);
  const [introOn, setIntroOn] = useState(false);
  const [introRate, setIntroRate] = useState(0.0549);
  const [introYears, setIntroYears] = useState(2);
  const [offset, setOffset] = useState<number>(0);
  const [offsetGrowth, setOffsetGrowth] = useState<number>(0);
  const [extra, setExtra] = useState<number>(0);
  const [feeAnnual, setFeeAnnual] = useState<number>(0);

  const loadLoan = (id: string) => {
    const h = holdings.find((x) => x.id === id);
    if (!h?.loan) return;
    setPrincipal(h.valueCents ?? 0);
    if (h.loan.annualRate) setRate(h.loan.annualRate);
    if (h.loan.repaymentType) setType(h.loan.repaymentType);
    if (h.loan.repaymentFrequency) setFrequency(h.loan.repaymentFrequency);
    if (h.loan.maturityDate) setTerm(Math.max(1, Math.round((new Date(h.loan.maturityDate).getTime() - Date.now()) / (365.25 * 864e5))));
    const offsets = (h.loan.offsetAccountIds ?? []).map((oid) => holdings.find((x) => x.id === oid)?.valueCents ?? 0).reduce((a, b) => a + b, 0);
    setOffset(offsets);
  };

  const input: LoanInput = useMemo(
    () => ({
      principalCents: principal,
      annualRate: rate,
      termYears: term,
      frequency,
      accelerated: accelerated && frequency !== 'monthly',
      repaymentType: type,
      interestOnlyYears: type === 'IO' ? ioYears : undefined,
      intro: introOn ? { annualRate: introRate, years: introYears } : null,
      offsetCents: offset,
      offsetGrowthMonthlyCents: offsetGrowth,
      extraPerPeriodCents: extra,
      startDate: d.today,
      ongoingFeeAnnualCents: feeAnnual,
    }),
    [principal, rate, term, frequency, accelerated, type, ioYears, introOn, introRate, introYears, offset, offsetGrowth, extra, feeAnnual, d.today],
  );
  const result = useMemo(() => amortise(input), [input]);
  const baseline = useMemo(() => amortise({ ...input, offsetCents: 0, offsetGrowthMonthlyCents: 0, extraPerPeriodCents: 0, accelerated: false }), [input]);
  const years = yearlySummary(result);
  const baseYears = yearlySummary(baseline);
  const chart = baseYears.map((b, i) => ({ year: b.year, base: b.closingCents, plan: years[i]?.closingCents ?? 0 }));
  const saved = baseline.totalInterestCents - result.totalInterestCents;
  const savedTime = baseline.yearsToRepay - result.yearsToRepay;
  const hasExtras = offset > 0 || offsetGrowth > 0 || extra > 0 || (accelerated && frequency !== 'monthly');
  const per = frequency === 'monthly' ? 'month' : frequency === 'fortnightly' ? 'fortnight' : 'week';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader title="Loan" subtitle="Change any input; results update instantly." />
          <div className="grid gap-4 p-5">
            {loans.length > 0 && <Select label="Start from one of your loans" value="" onChange={(e) => e.target.value && loadLoan(e.target.value)} options={[{ value: '', label: 'Choose a loan…' }, ...loans.map((l) => ({ value: l.id, label: `${l.name} · ${formatMoney(l.valueCents)}` }))]} />}
            <MoneyInput label="Loan amount" value={principal} onChange={(v) => setPrincipal(v ?? 0)} />
            <div className="grid grid-cols-2 gap-3">
              <PercentInput label="Interest rate" value={rate} step={0.05} onChange={setRate} />
              <NumberInput label="Term" value={term} onChange={(v) => setTerm(Math.max(1, Math.min(40, v)))} suffix="years" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Repayments" value={type} onChange={(e) => setType(e.target.value as 'PI' | 'IO')} options={[{ value: 'PI', label: 'Principal & interest' }, { value: 'IO', label: 'Interest only' }]} />
              <Select label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as RepaymentFrequency)} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'weekly', label: 'Weekly' }]} />
            </div>
            {type === 'IO' && <NumberInput label="Interest-only period" value={ioYears} onChange={(v) => setIoYears(Math.max(1, Math.min(term - 1, v)))} suffix="years" />}
            {frequency !== 'monthly' && <Toggle checked={accelerated} onChange={setAccelerated} label={`Pay half the monthly amount ${frequency === 'weekly' ? '(a quarter, weekly)' : 'fortnightly'}`} hint="Adds roughly one extra monthly repayment a year" />}
            <Toggle checked={introOn} onChange={setIntroOn} label="Introductory or fixed rate period" />
            {introOn && (
              <div className="grid grid-cols-2 gap-3">
                <PercentInput label="Intro rate" value={introRate} step={0.05} onChange={setIntroRate} />
                <NumberInput label="For" value={introYears} onChange={(v) => setIntroYears(Math.max(1, Math.min(10, v)))} suffix="years" />
              </div>
            )}
            <MoneyInput label="Offset balance" value={offset} onChange={(v) => setOffset(v ?? 0)} />
            <MoneyInput label="Added to offset each month" value={offsetGrowth} onChange={(v) => setOffsetGrowth(v ?? 0)} />
            <MoneyInput label={`Extra repayment each ${per}`} value={extra} onChange={(v) => setExtra(v ?? 0)} />
            <MoneyInput label="Annual package / account fee" value={feeAnnual} onChange={(v) => setFeeAnnual(v ?? 0)} />
          </div>
        </Card>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-muted">Repayment per {per}</div>
              <div className="num mt-1 text-xl font-semibold">{formatMoney(result.initialRepaymentCents, { cents: true })}</div>
              <div className="mt-1 text-xs text-muted">{formatMoney(toMonthly(result.initialRepaymentCents, frequency))} a month{result.revertRepaymentCents ? ` · then ${formatMoney(result.revertRepaymentCents)}` : ''}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Total interest</div>
              <div className="num mt-1 text-xl font-semibold">{formatMoney(result.totalInterestCents)}</div>
              {hasExtras && <div className="mt-1 text-xs text-good">{formatMoney(saved)} less than no offset or extras</div>}
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Paid off</div>
              <div className="num mt-1 text-xl font-semibold">{formatDate(result.payoffDate, 'month')}</div>
              <div className="mt-1 text-xs text-muted">{result.yearsToRepay.toFixed(1)} years{hasExtras && savedTime > 0.05 ? ` · ${savedTime.toFixed(1)} years sooner` : ''}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Total repaid</div>
              <div className="num mt-1 text-xl font-semibold">{formatMoney(result.totalPaidCents)}</div>
              {result.totalFeesCents > 0 && <div className="mt-1 text-xs text-muted">Includes {formatMoney(result.totalFeesCents)} fees</div>}
            </Card>
          </div>

          <Card>
            <CardHeader title="Balance over time" subtitle={hasExtras ? 'With your offset and extra repayments, compared with the plain loan' : 'Remaining balance at the end of each year'} />
            <div className="px-3 pb-3 pt-3">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="year" {...axisProps} tickFormatter={(y) => `Yr ${y}`} minTickGap={24} />
                    <YAxis {...axisProps} tickFormatter={moneyTick} width={64} />
                    <Tooltip content={<ChartTooltip labelFormatter={(l) => `End of year ${l}`} />} />
                     {hasExtras && <Area dataKey="base" name="Plain loan" stroke={SERIES[1]} fill="none" strokeWidth={2} strokeDasharray="5 4" isAnimationActive={false} />}
                    <Area dataKey="plan" name="Your plan" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Legend className="px-2 pt-2" items={hasExtras ? [{ label: 'Your plan', color: SERIES[0] }, { label: 'Plain loan', color: SERIES[1], dashed: true }] : [{ label: 'Balance', color: SERIES[0] }]} />
            </div>
          </Card>

          <Disclosure summary="Year-by-year schedule">
            <div className="max-h-96 overflow-auto px-2 pb-3">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2">
                  <tr className="text-right text-xs text-muted">
                    <th className="px-3 py-2 text-left font-medium">Year</th>
                    <th className="px-3 py-2 font-medium">Interest</th>
                    <th className="px-3 py-2 font-medium">Principal</th>
                    <th className="px-3 py-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {years.map((y) => (
                    <tr key={y.year} className="border-t border-line/50 text-right">
                      <td className="px-3 py-1.5 text-left">{y.year}</td>
                      <td className="px-3 py-1.5">{formatMoney(y.interestCents)}</td>
                      <td className="px-3 py-1.5">{formatMoney(y.principalCents)}</td>
                      <td className="px-3 py-1.5">{formatMoney(y.closingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
          <p className="text-xs text-muted">Interest is calculated on the balance less the offset each {per}, at the annual rate ÷ {frequency === 'monthly' ? 12 : frequency === 'fortnightly' ? 26 : 52}. Lenders calculate daily and round differently, so real figures can differ by a few dollars. Rate: {formatPercent(rate, 2)}.</p>
        </div>
      </div>
      <Refinance />
    </div>
  );
}

function Refinance() {
  const [balance, setBalance] = useState<number>(500_000_00);
  const [years, setYears] = useState(25);
  const [cur, setCur] = useState(0.0649);
  const [neu, setNeu] = useState(0.0589);
  const [costs, setCosts] = useState<number>(1_500_00);
  const [curFees, setCurFees] = useState<number>(395_00);
  const [newFees, setNewFees] = useState<number>(0);
  const r = useMemo(() => compareRefinance({ balanceCents: balance, remainingYears: years, currentRate: cur, newRate: neu, switchingCostsCents: costs, currentFeesAnnualCents: curFees, newFeesAnnualCents: newFees }), [balance, years, cur, neu, costs, curFees, newFees]);
  return (
    <Card>
      <CardHeader title="Refinance check" subtitle="Compares repayments and lifetime cost on the same remaining term. Switching costs include discharge, application and government fees." />
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyInput label="Loan balance" value={balance} onChange={(v) => setBalance(v ?? 0)} />
        <NumberInput label="Years remaining" value={years} onChange={(v) => setYears(Math.max(1, Math.min(40, v)))} suffix="years" />
        <PercentInput label="Current rate" value={cur} step={0.05} onChange={setCur} />
        <PercentInput label="New rate" value={neu} step={0.05} onChange={setNeu} />
        <MoneyInput label="Switching costs" value={costs} onChange={(v) => setCosts(v ?? 0)} />
        <MoneyInput label="Current annual fees" value={curFees} onChange={(v) => setCurFees(v ?? 0)} />
        <MoneyInput label="New annual fees" value={newFees} onChange={(v) => setNewFees(v ?? 0)} />
      </div>
      <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-3">
        <div><div className="text-xs text-muted">Monthly saving</div><div className={`num text-lg font-semibold ${r.monthlySavingCents < 0 ? 'text-bad' : ''}`}>{formatMoney(r.monthlySavingCents, { signed: true })}</div></div>
        <div><div className="text-xs text-muted">Saving over the loan</div><div className="num text-lg font-semibold">{formatMoney(r.lifetimeSavingCents, { signed: true })}</div></div>
        <div><div className="text-xs text-muted">Costs recovered after</div><div className="num text-lg font-semibold">{r.breakEvenMonths !== null ? `${r.breakEvenMonths} months` : 'Never'}</div></div>
      </div>
    </Card>
  );
}
