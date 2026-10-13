import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight } from 'lucide-react';
import { compound, monthsToTarget, requiredMonthlyContribution, toRealCents, type Compounding, type ContributionFrequency } from '@/domain/compound';
import { addMonths, formatDate } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { estimateStampDuty } from '@/domain/property/stampDuty';
import { calculateTakeHome, EMPTY_INCOME } from '@/domain/tax/salary';
import { leaveGap, monthsCovered, rentVsBuy } from '@/domain/tools';
import type { AustralianState, IncomeProfile, PersonId } from '@/domain/types';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Callout, Card, CardHeader, MoneyInput, NumberInput, PercentInput, Select, Toggle, cx } from '@/components/ui';
import { KindBadge } from '@/components/finance';
import { ChartTooltip, Legend, SERIES, axisProps, gridProps, moneyTick } from '@/components/charts';

export type ToolId =
  | 'compound' | 'emergency' | 'take-home' | 'promotion' | 'savings-goal' | 'deposit' | 'rent-vs-buy'
  | 'inflation' | 'retirement' | 'cash-flow' | 'parental-leave' | 'offset' | 'debt-payoff' | 'refinance';

export const TOOLS: { id: ToolId; name: string; blurb: string; link?: string }[] = [
  { id: 'compound', name: 'Compound growth', blurb: 'Grow savings with contributions, fees, tax and inflation' },
  { id: 'emergency', name: 'Emergency fund', blurb: 'How many months your cash would last' },
  { id: 'take-home', name: 'Salary take-home', blurb: 'Pay after tax, Medicare and HELP' },
  { id: 'promotion', name: 'Pay rise modeller', blurb: 'What a raise or new job really adds' },
  { id: 'savings-goal', name: 'Savings goal', blurb: 'Monthly amount or time to reach a target' },
  { id: 'deposit', name: 'Deposit timeline', blurb: 'When you could buy, including stamp duty' },
  { id: 'rent-vs-buy', name: 'Rent vs buy', blurb: 'Wealth over time either way' },
  { id: 'inflation', name: 'Inflation', blurb: 'Future cost and today’s value of money' },
  { id: 'retirement', name: 'Retirement & super', blurb: 'Super balance at retirement' },
  { id: 'cash-flow', name: 'Cash-flow what-if', blurb: 'Change income or spending and see the surplus' },
  { id: 'parental-leave', name: 'Parental leave & one income', blurb: 'The savings needed to cover time off' },
  { id: 'offset', name: 'Offset & extra repayments', blurb: 'Interest and years saved', link: '/property?tab=mortgage' },
  { id: 'debt-payoff', name: 'Debt snowball / avalanche', blurb: 'Fastest way to clear other debts', link: '/property?tab=debts' },
  { id: 'refinance', name: 'Refinance check', blurb: 'Is switching lenders worth it?', link: '/property?tab=mortgage' },
];

export function ToolPicker({ value, onChange }: { value: ToolId; onChange: (t: ToolId) => void }) {
  return (
    <nav className="grid gap-1.5" aria-label="Calculators">
      {TOOLS.map((t) =>
        t.link ? (
          <Link key={t.id} to={t.link} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
            <span>{t.name}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" />
          </Link>
        ) : (
          <button key={t.id} type="button" onClick={() => onChange(t.id)} className={cx('rounded-lg px-3 py-2 text-left text-sm', value === t.id ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
            {t.name}
          </button>
        ),
      )}
    </nav>
  );
}

export function Calculator({ id }: { id: ToolId }) {
  switch (id) {
    case 'compound': return <CompoundTool />;
    case 'emergency': return <EmergencyTool />;
    case 'take-home': return <TakeHomeTool />;
    case 'promotion': return <PromotionTool />;
    case 'savings-goal': return <SavingsGoalTool />;
    case 'deposit': return <DepositTool />;
    case 'rent-vs-buy': return <RentVsBuyTool />;
    case 'inflation': return <InflationTool />;
    case 'retirement': return <RetirementTool />;
    case 'cash-flow': return <CashFlowTool />;
    case 'parental-leave': return <LeaveTool />;
    default: return null;
  }
}

function Shell({ id, children, result, note }: { id: ToolId; children: ReactNode; result: ReactNode; note?: ReactNode }) {
  const t = TOOLS.find((x) => x.id === id)!;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t.name} subtitle={t.blurb} action={<KindBadge kind="estimate" />} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      </Card>
      {result}
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('num mt-1 text-xl font-semibold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ResultRow({ children }: { children: ReactNode }) {
  return <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">{children}</Card>;
}

// ------------------------------------------------------------------ Compound
function CompoundTool() {
  const [start, setStart] = useState<number>(10_000_00);
  const [contrib, setContrib] = useState<number>(500_00);
  const [freq, setFreq] = useState<ContributionFrequency>('monthly');
  const [growth, setGrowth] = useState(0.03);
  const [ret, setRet] = useState(0.065);
  const [comp, setComp] = useState<Compounding>('annually-effective');
  const [fee, setFee] = useState(0.002);
  const [tax, setTax] = useState(0);
  const [infl, setInfl] = useState(0.025);
  const [years, setYears] = useState(20);
  const [timing, setTiming] = useState<'start' | 'end'>('end');
  const r = useMemo(() => compound({ startingCents: start, contributionCents: contrib, contributionFrequency: freq, contributionTiming: timing, contributionGrowth: growth, annualReturn: ret, compounding: comp, annualFee: fee, earningsTaxRate: tax, inflation: infl, years }), [start, contrib, freq, timing, growth, ret, comp, fee, tax, infl, years]);
  const chart = r.years.map((y) => ({ year: y.year, principal: start + y.contributionsCents, growth: y.balanceCents - start - y.contributionsCents, real: y.realBalanceCents }));
  return (
    <Shell
      id="compound"
      note="Returns are assumptions, not predictions. 'Effective annual' means the stated return is achieved over a full year; 'nominal monthly' compounds rate ÷ 12 monthly, which gives a slightly higher effective return."
      result={
        <>
          <ResultRow>
            <Big label={`Balance after ${years} years`} value={formatMoney(r.finalCents)} sub={`${formatMoney(r.finalRealCents)} in today's dollars`} />
            <Big label="You put in" value={formatMoney(start + r.totalContributionsCents)} />
            <Big label="Growth after fees and tax" value={formatMoney(r.totalGrowthCents)} tone="good" />
            <Big label="Fees and tax paid" value={formatMoney(r.totalFeesCents + r.totalTaxCents)} sub={`Fees ${formatMoney(r.totalFeesCents)} · tax ${formatMoney(r.totalTaxCents)}`} />
          </ResultRow>
          <Card className="px-3 pb-3 pt-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="year" {...axisProps} tickFormatter={(y) => `Yr ${y}`} minTickGap={24} />
                  <YAxis {...axisProps} tickFormatter={moneyTick} width={64} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Year ${l}`} />} />
                  <Area dataKey="principal" name="Money put in" stackId="a" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.35} isAnimationActive={false} />
                  <Area dataKey="growth" name="Growth" stackId="a" stroke={SERIES[2]} fill={SERIES[2]} fillOpacity={0.35} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <Legend className="px-2 pt-2" items={[{ label: 'Money put in', color: SERIES[0] }, { label: 'Growth', color: SERIES[2] }]} />
          </Card>
        </>
      }
    >
      <MoneyInput label="Starting amount" value={start} onChange={(v) => setStart(v ?? 0)} />
      <MoneyInput label="Regular contribution" value={contrib} onChange={(v) => setContrib(v ?? 0)} />
      <Select label="How often" value={freq} onChange={(e) => setFreq(e.target.value as ContributionFrequency)} options={['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'].map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))} />
      <PercentInput label="Contribution increase each year" value={growth} onChange={setGrowth} />
      <PercentInput label="Annual return" value={ret} onChange={setRet} />
      <Select label="Return is" value={comp} onChange={(e) => setComp(e.target.value as Compounding)} options={[{ value: 'annually-effective', label: 'Effective annual (compounded monthly)' }, { value: 'monthly', label: 'Nominal, compounded monthly' }, { value: 'annually', label: 'Compounded once a year' }]} />
      <PercentInput label="Annual fee (% of balance)" value={fee} onChange={setFee} step={0.05} />
      <PercentInput label="Tax on earnings" value={tax} onChange={setTax} step={1} hint="15% for super; your marginal rate for taxable investments (simplified)" />
      <PercentInput label="Inflation" value={infl} onChange={setInfl} />
      <NumberInput label="Years" value={years} onChange={(v) => setYears(Math.max(1, Math.min(60, v)))} suffix="years" />
      <Select label="Contributions made" value={timing} onChange={(e) => setTiming(e.target.value as 'start' | 'end')} options={[{ value: 'end', label: 'At the end of each period' }, { value: 'start', label: 'At the start of each period' }]} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Emergency fund
function EmergencyTool() {
  const d = useDerived();
  const perspective = usePerspective();
  const avg = d.average[perspective];
  // Household: essential non-housing costs plus full loan repayments (mortgage interest is inside
  // the repayment, so the housing category is left out to avoid counting it twice).
  const essentialDefault = avg.monthsWithData > 0 ? Math.round((perspective === 'household' ? d.livingCosts.essentialCents + d.loanRepaymentsMonthlyCents : avg.essential) / 100) * 100 : 0;
  const [essential, setEssential] = useState<number>(essentialDefault);
  const [savings, setSavings] = useState<number>(d.balance[perspective].liquidCents);
  const [target, setTarget] = useState(6);
  const [saving, setSaving] = useState<number>(500_00);
  const covered = monthsCovered(savings, essential);
  const targetCents = essential * target;
  const gap = Math.max(0, targetCents - savings);
  const m = gap > 0 ? monthsToTarget(targetCents, savings, saving, 0.035) : 0;
  return (
    <Shell
      id="emergency"
      note={avg.monthsWithData > 0 ? `Essential spending is prefilled from your last ${avg.monthsWithData} complete month(s) of essential categories${perspective === 'household' ? ' (excluding housing) plus loan repayments' : ''}. Savings are prefilled from cash accounts and offsets.` : 'No transaction history yet: enter your essential monthly costs.'}
      result={
        <ResultRow>
          <Big label="Your cash would last" value={covered === null ? '—' : `${covered.toFixed(1)} months`} tone={covered !== null && covered >= target ? 'good' : covered !== null && covered < 3 ? 'bad' : undefined} />
          <Big label="Target" value={formatMoney(targetCents)} sub={`${target} months of essentials`} />
          <Big label="Gap" value={formatMoney(gap)} />
          <Big label="Time to close the gap" value={gap === 0 ? 'Done' : m === null ? 'Not reached' : `${m} months`} sub={gap > 0 && m !== null ? `By ${formatDate(addMonths(d.today, m), 'month')} at ${formatMoney(saving)}/mo` : undefined} />
        </ResultRow>
      }
    >
      <MoneyInput label="Essential costs per month" value={essential} onChange={(v) => setEssential(v ?? 0)} hint="Housing, groceries, utilities, insurance, transport, minimum repayments" />
      <MoneyInput label="Cash available now" value={savings} onChange={(v) => setSavings(v ?? 0)} />
      <NumberInput label="Target" value={target} onChange={(v) => setTarget(Math.max(1, Math.min(24, v)))} suffix="months" />
      <MoneyInput label="You can save per month" value={saving} onChange={(v) => setSaving(v ?? 0)} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Take-home
function useIncomeEditor(initial: Partial<IncomeProfile>) {
  const [p, setP] = useState<IncomeProfile>({ ...EMPTY_INCOME, residency: 'resident', ...initial });
  return [p, (patch: Partial<IncomeProfile>) => setP((x) => ({ ...x, ...patch }))] as const;
}

function TakeHomeTool() {
  const d = useDerived();
  const [p, set] = useIncomeEditor({ salaryCents: 100_000_00 });
  const r = calculateTakeHome(p, d.ruleset);
  return (
    <Shell
      id="take-home"
      note={`Uses the ${d.ruleset.financialYear} ruleset (${d.ruleset.status}). Your saved income profiles are on Forecasts → Income & tax.`}
      result={
        <ResultRow>
          <Big label="Take-home per year" value={formatMoney(r.netAnnualCents)} />
          <Big label="Per month" value={formatMoney(r.netMonthlyCents)} sub={`${formatMoney(Math.round(r.netAnnualCents / 26))} a fortnight`} />
          <Big label="Total tax" value={formatMoney(r.totalTaxCents)} sub={`Average ${formatPercent(r.tax.averageRate, 1)} · marginal ${formatPercent(r.tax.marginalRate, 1)}`} />
          <Big label="Employer super" value={formatMoney(r.employerSuperCents)} />
        </ResultRow>
      }
    >
      <MoneyInput label={p.packageIncludesSuper ? 'Package incl. super' : 'Salary excl. super'} value={p.salaryCents} onChange={(v) => set({ salaryCents: v ?? 0 })} />
      <Select label="Salary is quoted" value={p.packageIncludesSuper ? 'pkg' : 'base'} onChange={(e) => set({ packageIncludesSuper: e.target.value === 'pkg' })} options={[{ value: 'base', label: 'Plus super' }, { value: 'pkg', label: 'Including super' }]} />
      <MoneyInput label="Salary sacrifice (annual)" value={p.salarySacrificeAnnualCents} onChange={(v) => set({ salarySacrificeAnnualCents: v ?? 0 })} />
      <Select label="Residency" value={p.residency} onChange={(e) => set({ residency: e.target.value as IncomeProfile['residency'] })} options={[{ value: 'resident', label: 'Australian resident' }, { value: 'non-resident', label: 'Foreign resident' }]} />
      <Toggle checked={p.hasHelpDebt} onChange={(v) => set({ hasHelpDebt: v })} label="HELP debt" />
      <Toggle checked={p.privateHospitalCover} onChange={(v) => set({ privateHospitalCover: v })} label="Private hospital cover" />
    </Shell>
  );
}

// ------------------------------------------------------------------ Promotion
function PromotionTool() {
  const data = useApp((s) => s.data);
  const d = useDerived();
  const [who, setWho] = useState<PersonId>('me');
  const profile = data.people[who].income;
  const [newSalary, setNewSalary] = useState<number>(Math.round((profile.salaryCents || 100_000_00) * 1.1));
  const [newBonus, setNewBonus] = useState<number>(profile.bonusAnnualCents);
  const before = calculateTakeHome({ ...profile, residency: profile.residency === 'unknown' ? 'resident' : profile.residency }, d.ruleset);
  const after = calculateTakeHome({ ...profile, residency: profile.residency === 'unknown' ? 'resident' : profile.residency, salaryCents: newSalary, bonusAnnualCents: newBonus }, d.ruleset);
  const gross = after.grossIncomeCents - before.grossIncomeCents;
  const net = after.netAnnualCents - before.netAnnualCents;
  return (
    <Shell
      id="promotion"
      note="Starts from the saved income profile, so HELP, super and cover settings carry over."
      result={
        <ResultRow>
          <Big label="Extra take-home per year" value={formatMoney(net, { signed: true })} tone={net > 0 ? 'good' : undefined} />
          <Big label="Per month" value={formatMoney(Math.round(net / 12), { signed: true })} />
          <Big label="Share of the raise you keep" value={gross > 0 ? formatPercent(net / gross, 0) : '—'} sub={`Marginal rate ${formatPercent(after.tax.marginalRate, 1)}`} />
          <Big label="Extra employer super" value={formatMoney(after.employerSuperCents - before.employerSuperCents, { signed: true })} />
        </ResultRow>
      }
    >
      <Select label="Whose pay" value={who} onChange={(e) => setWho(e.target.value as PersonId)} options={[{ value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
      <MoneyInput label={`New ${profile.packageIncludesSuper ? 'package' : 'salary'}`} value={newSalary} onChange={(v) => setNewSalary(v ?? 0)} hint={`Now ${formatMoney(profile.salaryCents)}`} />
      <MoneyInput label="New bonus" value={newBonus} onChange={(v) => setNewBonus(v ?? 0)} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Savings goal
function SavingsGoalTool() {
  const d = useDerived();
  const [target, setTarget] = useState<number>(30_000_00);
  const [current, setCurrent] = useState<number>(5_000_00);
  const [months, setMonths] = useState(24);
  const [monthly, setMonthly] = useState<number>(1_000_00);
  const [ret, setRet] = useState(0.045);
  const need = requiredMonthlyContribution(target, current, months, ret);
  const m = monthsToTarget(target, current, monthly, ret);
  return (
    <Shell
      id="savings-goal"
      result={
        <ResultRow>
          <Big label={`To reach it in ${months} months`} value={`${formatMoney(need)}/mo`} />
          <Big label={`Saving ${formatMoney(monthly)}/mo`} value={m === null ? 'Not reached' : `${m} months`} sub={m !== null ? formatDate(addMonths(d.today, m), 'month') : undefined} />
          <Big label="Interest earned (at your monthly amount)" value={m ? formatMoney(Math.max(0, target - current - monthly * m)) : '—'} />
        </ResultRow>
      }
    >
      <MoneyInput label="Target" value={target} onChange={(v) => setTarget(v ?? 0)} />
      <MoneyInput label="Saved so far" value={current} onChange={(v) => setCurrent(v ?? 0)} />
      <NumberInput label="Time frame" value={months} onChange={(v) => setMonths(Math.max(1, v))} suffix="months" />
      <MoneyInput label="Or, you save per month" value={monthly} onChange={(v) => setMonthly(v ?? 0)} />
      <PercentInput label="Interest rate" value={ret} onChange={setRet} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Deposit timeline
const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
function DepositTool() {
  const home = useApp((s) => s.data.settings.stateOfResidence);
  const d = useDerived();
  const [price, setPrice] = useState<number>(750_000_00);
  const [pct, setPct] = useState(0.2);
  const [state, setState] = useState<AustralianState>(home);
  const [fhb, setFhb] = useState(true);
  const [savings, setSavings] = useState<number>(d.balance.household.liquidCents);
  const [monthly, setMonthly] = useState<number>(3_000_00);
  const [growth, setGrowth] = useState(0.03);
  const [ret, setRet] = useState(0.045);
  const duty = estimateStampDuty({ state, priceCents: price, ownerOccupier: true, firstHomeBuyer: fhb });
  const other = 5_000_00;
  const needed = (p: number) => Math.round(p * pct) + (duty.supported ? estimateStampDuty({ state, priceCents: p, ownerOccupier: true, firstHomeBuyer: fhb }).dutyCents : 0) + other;
  // Prices move while you save: step month by month until savings catch the moving target.
  let m: number | null = null;
  let bal = savings;
  for (let i = 0; i <= 600; i++) {
    const p = Math.round(price * Math.pow(1 + growth, i / 12));
    if (bal >= needed(p)) { m = i; break; }
    bal = bal * (1 + ret / 12) + monthly;
  }
  return (
    <Shell
      id="deposit"
      note={`Includes stamp duty (${duty.supported ? `${state} rules, ${duty.status}` : `${state} not supported, so excluded`}) and about ${formatMoney(other)} of other costs. Price growth is your assumption, not a market forecast.`}
      result={
        <ResultRow>
          <Big label="Cash needed today" value={formatMoney(needed(price))} sub={`Deposit ${formatMoney(Math.round(price * pct))} + duty ${duty.supported ? formatMoney(duty.dutyCents) : 'n/a'} + costs`} />
          <Big label="Ready in" value={m === null ? 'Not within 50 years' : m === 0 ? 'Now' : `${Math.floor(m / 12)}y ${m % 12}m`} sub={m ? formatDate(addMonths(d.today, m), 'month') : undefined} />
          <Big label="Price by then" value={m === null ? '—' : formatMoney(Math.round(price * Math.pow(1 + growth, m / 12)))} />
          {pct < 0.2 && <Big label="Note" value="LMI likely" sub="Deposits under 20% usually attract lenders mortgage insurance unless a scheme applies" />}
        </ResultRow>
      }
    >
      <MoneyInput label="Target price (today)" value={price} onChange={(v) => setPrice(v ?? 0)} />
      <PercentInput label="Deposit" value={pct} onChange={setPct} step={1} />
      <Select label="State" value={state} onChange={(e) => setState(e.target.value as AustralianState)} options={STATES.map((s) => ({ value: s, label: s }))} />
      <MoneyInput label="Saved so far" value={savings} onChange={(v) => setSavings(v ?? 0)} />
      <MoneyInput label="Saving per month" value={monthly} onChange={(v) => setMonthly(v ?? 0)} />
      <PercentInput label="Savings interest" value={ret} onChange={setRet} />
      <PercentInput label="Price growth per year" value={growth} onChange={setGrowth} />
      <Toggle checked={fhb} onChange={setFhb} label="First home buyer" />
    </Shell>
  );
}

// ------------------------------------------------------------------ Rent vs buy
function RentVsBuyTool() {
  const [price, setPrice] = useState<number>(800_000_00);
  const [deposit, setDeposit] = useState<number>(160_000_00);
  const [costs, setCosts] = useState<number>(45_000_00);
  const [rate, setRate] = useState(0.06);
  const [owner, setOwner] = useState<number>(8_000_00);
  const [rent, setRent] = useState<number>(600_00);
  const [rentGrowth, setRentGrowth] = useState(0.03);
  const [growth, setGrowth] = useState(0.04);
  const [ret, setRet] = useState(0.06);
  const [years, setYears] = useState(20);
  const r = useMemo(() => rentVsBuy({ priceCents: price, depositCents: deposit, buyingCostsCents: costs, rate, termYears: 30, ownerCostsAnnualCents: owner, rentWeeklyCents: rent, rentGrowth, propertyGrowth: growth, investmentReturn: ret, inflation: 0.025, sellingCostRate: 0.025, years }), [price, deposit, costs, rate, owner, rent, rentGrowth, growth, ret, years]);
  const last = r.years[r.years.length - 1];
  return (
    <Shell
      id="rent-vs-buy"
      note="Both paths spend the same on housing plus saving: whoever pays less for housing that month invests the difference. Buyer wealth is after 2.5% selling costs. Every growth rate here is an assumption you control; no market data is used."
      result={
        <>
          <ResultRow>
            <Big label={`Buying, after ${years} years`} value={formatMoney(last?.buyerWealthCents)} />
            <Big label="Renting and investing" value={formatMoney(last?.renterWealthCents)} />
            <Big label="Difference" value={formatMoney(last ? Math.abs(last.buyerWealthCents - last.renterWealthCents) : 0)} sub={last ? (last.buyerWealthCents >= last.renterWealthCents ? 'in favour of buying' : 'in favour of renting') : undefined} />
            <Big label="Buying pulls ahead in" value={r.breakEvenYear ? `Year ${r.breakEvenYear}` : 'Not within the period'} />
          </ResultRow>
          <Card className="px-3 pb-3 pt-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r.years} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="year" {...axisProps} tickFormatter={(y) => `Yr ${y}`} />
                  <YAxis {...axisProps} tickFormatter={moneyTick} width={64} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Year ${l}`} />} />
                  <Line dataKey="buyerWealthCents" name="Buy" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="renterWealthCents" name="Rent & invest" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend className="px-2 pt-2" items={[{ label: 'Buy', color: SERIES[0] }, { label: 'Rent & invest', color: SERIES[1] }]} />
          </Card>
        </>
      }
    >
      <MoneyInput label="Price" value={price} onChange={(v) => setPrice(v ?? 0)} />
      <MoneyInput label="Deposit" value={deposit} onChange={(v) => setDeposit(v ?? 0)} />
      <MoneyInput label="Buying costs (duty, fees)" value={costs} onChange={(v) => setCosts(v ?? 0)} />
      <PercentInput label="Mortgage rate" value={rate} onChange={setRate} step={0.05} />
      <MoneyInput label="Owner costs per year" value={owner} onChange={(v) => setOwner(v ?? 0)} hint="Rates, insurance, strata, maintenance" />
      <MoneyInput label="Rent per week" value={rent} onChange={(v) => setRent(v ?? 0)} />
      <PercentInput label="Rent increase per year" value={rentGrowth} onChange={setRentGrowth} />
      <PercentInput label="Property growth per year" value={growth} onChange={setGrowth} />
      <PercentInput label="Investment return (after fees)" value={ret} onChange={setRet} />
      <NumberInput label="Compare over" value={years} onChange={(v) => setYears(Math.max(1, Math.min(30, v)))} suffix="years" />
    </Shell>
  );
}

// ------------------------------------------------------------------ Inflation
function InflationTool() {
  const [amount, setAmount] = useState<number>(100_000_00);
  const [rate, setRate] = useState(0.025);
  const [years, setYears] = useState(10);
  const future = Math.round(amount * Math.pow(1 + rate, years));
  const real = toRealCents(amount, rate, years);
  return (
    <Shell
      id="inflation"
      result={
        <ResultRow>
          <Big label={`Something costing ${formatMoney(amount)} today would cost`} value={formatMoney(future)} sub={`in ${years} years`} />
          <Big label={`${formatMoney(amount)} in ${years} years is worth`} value={formatMoney(real)} sub="in today's dollars" />
          <Big label="Purchasing power lost" value={formatPercent(1 - real / Math.max(1, amount), 0)} />
        </ResultRow>
      }
    >
      <MoneyInput label="Amount" value={amount} onChange={(v) => setAmount(v ?? 0)} />
      <PercentInput label="Inflation per year" value={rate} onChange={setRate} hint="RBA target band is 2–3%" />
      <NumberInput label="Years" value={years} onChange={(v) => setYears(Math.max(1, Math.min(60, v)))} suffix="years" />
    </Shell>
  );
}

// ------------------------------------------------------------------ Retirement
function RetirementTool() {
  const data = useApp((s) => s.data);
  const d = useDerived();
  const [who, setWho] = useState<PersonId>('me');
  const superNow = data.holdings.filter((h) => !h.archived && h.category === 'super').reduce((a, h) => a + Math.round(((h.valueCents ?? 0) * h.ownership[who]) / 100), 0);
  const th = d.takeHome[who];
  const [balance, setBalance] = useState<number>(superNow);
  const [age, setAge] = useState(35);
  const [retireAge, setRetireAge] = useState(67);
  const [contrib, setContrib] = useState<number>(th ? th.totalConcessionalCents : 15_000_00);
  const [ret, setRet] = useState(0.065);
  const [fee, setFee] = useState(0.006);
  const [infl, setInfl] = useState(0.025);
  const [wageGrowth, setWageGrowth] = useState(0.03);
  const years = Math.max(1, retireAge - age);
  // Concessional contributions are taxed 15% on entry; earnings are taxed at up to 15% in accumulation.
  const r = compound({ startingCents: balance, contributionCents: Math.round(contrib * 0.85), contributionFrequency: 'annually', contributionTiming: 'end', contributionGrowth: wageGrowth, annualReturn: ret, compounding: 'annually-effective', annualFee: fee, earningsTaxRate: 0.15, inflation: infl, years });
  return (
    <Shell
      id="retirement"
      note="Simplified: contributions taxed at 15% on entry, earnings taxed at 15% (the actual rate is usually lower thanks to franking and discounts), fees as a percentage of the balance. Preservation age, the Age Pension and transfer balance caps are not modelled."
      result={
        <ResultRow>
          <Big label={`Super at ${retireAge}`} value={formatMoney(r.finalCents)} sub={`${formatMoney(r.finalRealCents)} in today's dollars`} />
          <Big label="Contributions (after 15% tax)" value={formatMoney(r.totalContributionsCents)} />
          <Big label="Investment growth" value={formatMoney(r.totalGrowthCents)} tone="good" />
          <Big label="Fees" value={formatMoney(r.totalFeesCents)} />
        </ResultRow>
      }
    >
      <Select label="Whose super" value={who} onChange={(e) => { const w = e.target.value as PersonId; setWho(w); setBalance(data.holdings.filter((h) => !h.archived && h.category === 'super').reduce((a, h) => a + Math.round(((h.valueCents ?? 0) * h.ownership[w]) / 100), 0)); setContrib(d.takeHome[w]?.totalConcessionalCents ?? 15_000_00); }} options={[{ value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
      <MoneyInput label="Super balance now" value={balance} onChange={(v) => setBalance(v ?? 0)} />
      <NumberInput label="Age now" value={age} onChange={(v) => setAge(Math.max(16, Math.min(80, v)))} />
      <NumberInput label="Retire at" value={retireAge} onChange={(v) => setRetireAge(Math.max(age + 1, Math.min(80, v)))} />
      <MoneyInput label="Contributions per year (before tax)" value={contrib} onChange={(v) => setContrib(v ?? 0)} hint="Employer super plus salary sacrifice" />
      <PercentInput label="Wage growth" value={wageGrowth} onChange={setWageGrowth} />
      <PercentInput label="Return (before fees)" value={ret} onChange={setRet} />
      <PercentInput label="Fees (% of balance)" value={fee} onChange={setFee} step={0.05} />
      <PercentInput label="Inflation" value={infl} onChange={setInfl} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Cash flow
function CashFlowTool() {
  const d = useDerived();
  const perspective = usePerspective();
  const months = d.completeMonths.map((m) => d.monthly[perspective][d.months.indexOf(m)]).filter((s) => s.transactionCount > 0);
  const avg = (k: 'incomeCents' | 'consumptionCents' | 'debtRepaymentCents' | 'investmentCents') => (months.length ? Math.round(months.reduce((a, s) => a + s[k], 0) / months.length) : 0);
  const [income, setIncome] = useState<number>(avg('incomeCents') || d.takeHomeMonthly.me + d.takeHomeMonthly.partner);
  const [spend, setSpend] = useState<number>(avg('consumptionCents'));
  const [debt, setDebt] = useState<number>(avg('debtRepaymentCents'));
  const [incomeChange, setIncomeChange] = useState(0);
  const [spendChange, setSpendChange] = useState(0);
  const newIncome = Math.round(income * (1 + incomeChange));
  const newSpend = Math.round(spend * (1 + spendChange));
  const now = income - spend - debt;
  const after = newIncome - newSpend - debt;
  return (
    <Shell
      id="cash-flow"
      note={months.length ? `Prefilled from the average of your last ${months.length} complete month(s). Transfers between your own accounts are excluded.` : 'No complete months of transactions yet: enter your own figures.'}
      result={
        <ResultRow>
          <Big label="Surplus now" value={`${formatMoney(now, { signed: true })}/mo`} tone={now < 0 ? 'bad' : undefined} />
          <Big label="Surplus after changes" value={`${formatMoney(after, { signed: true })}/mo`} tone={after < 0 ? 'bad' : after > now ? 'good' : undefined} />
          <Big label="Difference per year" value={formatMoney((after - now) * 12, { signed: true })} />
          <Big label="Savings rate after" value={newIncome > 0 ? formatPercent((newIncome - newSpend) / newIncome, 0) : '—'} />
        </ResultRow>
      }
    >
      <MoneyInput label="Income per month (after tax)" value={income} onChange={(v) => setIncome(v ?? 0)} />
      <MoneyInput label="Spending per month" value={spend} onChange={(v) => setSpend(v ?? 0)} />
      <MoneyInput label="Debt repayments (principal) per month" value={debt} onChange={(v) => setDebt(v ?? 0)} />
      <PercentInput label="Change income by" value={incomeChange} onChange={setIncomeChange} step={1} min={-100} />
      <PercentInput label="Change spending by" value={spendChange} onChange={setSpendChange} step={1} min={-100} />
    </Shell>
  );
}

// ------------------------------------------------------------------ Parental leave
function LeaveTool() {
  const d = useDerived();
  const [who, setWho] = useState<PersonId>('partner');
  const [weeks, setWeeks] = useState(52);
  const [employerWeeks, setEmployerWeeks] = useState(12);
  const [employerFraction, setEmployerFraction] = useState(1);
  const [govWeeks, setGovWeeks] = useState(24);
  const [govWeekly, setGovWeekly] = useState<number>(850_00);
  const [spend, setSpend] = useState<number>(Math.round((d.livingCosts.monthlyCents + d.loanRepaymentsMonthlyCents) / 100) * 100);
  const normal = d.takeHomeMonthly.me + d.takeHomeMonthly.partner;
  const g = leaveGap({ normalTakeHomeMonthlyCents: normal, personTakeHomeMonthlyCents: d.takeHomeMonthly[who], totalWeeks: weeks, employerPaidWeeks: employerWeeks, employerPayFraction: employerFraction, govPaidWeeks: govWeeks, govWeeklyAfterTaxCents: govWeekly, monthlySpendingCents: spend });
  const liquid = d.balance.household.liquidCents;
  return (
    <Shell
      id="parental-leave"
      note="Government Parental Leave Pay is paid at the national minimum wage and is taxable; enter the after-tax weekly amount from Services Australia for the current year. Superannuation on government pay and Dad and Partner Pay rules are not modelled here. For a full projection add a parental leave event to a forecast scenario."
      result={
        <>
          {normal === 0 && <Callout tone="warn">Add salaries on Forecasts → Income & tax so this uses your real take-home pay.</Callout>}
          <ResultRow>
            <Big label="Household income during leave" value={formatMoney(g.incomeDuringCents)} sub={`vs ${formatMoney(Math.round((normal * 12 * weeks) / 52))} normally`} />
            <Big label="Spending over the same period" value={formatMoney(g.spendingCents)} />
            <Big label="Savings needed" value={formatMoney(g.savingsNeededCents)} tone={g.savingsNeededCents > liquid ? 'bad' : undefined} sub={`You have ${formatMoney(liquid)} in cash and offsets`} />
            <Big label="Unpaid stretch" value={`${g.unpaidWeeks} weeks`} sub={`Living on ${formatMoney(Math.round(g.unpaidWeekIncomeCents))}/week from ${d.names[who === 'me' ? 'partner' : 'me']}`} />
          </ResultRow>
        </>
      }
    >
      <Select label="Who takes leave" value={who} onChange={(e) => setWho(e.target.value as PersonId)} options={[{ value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
      <NumberInput label="Total leave" value={weeks} onChange={(v) => setWeeks(Math.max(1, Math.min(104, v)))} suffix="weeks" />
      <NumberInput label="Employer-paid weeks" value={employerWeeks} onChange={(v) => setEmployerWeeks(Math.max(0, v))} suffix="weeks" />
      <PercentInput label="Employer pay rate" value={employerFraction} onChange={(v) => setEmployerFraction(Math.max(0, Math.min(1, v)))} step={5} hint="100% = full pay; 50% = half pay" />
      <NumberInput label="Government-paid weeks" value={govWeeks} onChange={(v) => setGovWeeks(Math.max(0, v))} suffix="weeks" />
      <MoneyInput label="Government pay per week (after tax)" value={govWeekly} onChange={(v) => setGovWeekly(v ?? 0)} />
      <MoneyInput label="Household spending per month" value={spend} onChange={(v) => setSpend(v ?? 0)} hint="Living costs plus loan repayments" />
    </Shell>
  );
}
