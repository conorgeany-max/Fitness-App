import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { addMonths, formatDate } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import { PRESET_ASSUMPTIONS } from '@/domain/forecast';
import type { Assumptions, PersonId, Scenario, ScenarioEvent, ScenarioEventType } from '@/domain/types';
import { uid } from '@/lib/id';
import { useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Button, Callout, Card, CardHeader, Modal, MoneyInput, NumberInput, PercentInput, Select, Slider, TextInput, toast } from '@/components/ui';

const ASSUMPTION_FIELDS: { key: keyof Assumptions; label: string; hint?: string }[] = [
  { key: 'inflation', label: 'Inflation (CPI)' },
  { key: 'salaryGrowth', label: 'Salary growth', hint: 'Used when a person has no expected pay rise set' },
  { key: 'livingCostGrowth', label: 'Living cost growth' },
  { key: 'investmentReturn', label: 'Investment return', hint: 'Before fees and tax drag' },
  { key: 'investmentFees', label: 'Investment fees' },
  { key: 'investmentTaxDrag', label: 'Tax drag on investments' },
  { key: 'superReturn', label: 'Super return (after fees)' },
  { key: 'cashRate', label: 'Cash savings rate' },
  { key: 'propertyGrowth', label: 'Property growth' },
  { key: 'mortgageRateDelta', label: 'Change to loan rates', hint: 'Added to every loan rate from next month' },
  { key: 'vehicleDepreciation', label: 'Vehicle depreciation' },
  { key: 'surplusInvestShare', label: 'Share of surplus invested', hint: 'After the emergency fund is full; the rest stays in cash' },
];

export const EVENT_LABEL: Record<ScenarioEventType, string> = {
  'salary-change': 'Salary change or promotion',
  'bonus-change': 'Bonus change',
  'hours-change': 'Change of hours (part-time)',
  'parental-leave': 'Parental leave',
  'income-stop': 'Income stops (career break, redundancy)',
  'rental-income': 'Rental income',
  'living-cost-change': 'Living costs change',
  child: 'New child',
  'large-expense': 'Large one-off expense',
  'super-change': 'Salary sacrifice change',
  'property-purchase': 'Buy a property',
};

export function ScenarioEditor({ scenario, onSelect }: { scenario: Scenario; onSelect: (id: string) => void }) {
  const upsert = useApp((s) => s.upsertScenario);
  const del = useApp((s) => s.deleteScenario);
  const scenarios = useApp((s) => s.data.scenarios);
  const d = useDerived();
  const [adding, setAdding] = useState<ScenarioEvent | null>(null);
  const set = (patch: Partial<Scenario>) => upsert({ ...scenario, ...patch });
  const setA = (patch: Partial<Assumptions>) => set({ assumptions: { ...scenario.assumptions, ...patch }, preset: 'custom' });

  const duplicate = () => {
    const now = new Date().toISOString();
    const copy: Scenario = { ...structuredClone(scenario), id: uid('scn'), name: `${scenario.name} (copy)`, createdAt: now, updatedAt: now, color: `var(--series-${(scenarios.length % 8) + 1})` };
    upsert(copy);
    onSelect(copy.id);
    toast('Scenario duplicated');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Scenario"
          action={
            <div className="flex gap-2">
              <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={duplicate}>Duplicate</Button>
              {scenarios.length > 1 && (
                <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { del(scenario.id); onSelect(scenarios.find((s) => s.id !== scenario.id)!.id); toast('Scenario deleted'); }}>Delete</Button>
              )}
            </div>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="Name" value={scenario.name} onChange={(e) => set({ name: e.target.value })} />
          <Select
            label="Assumption preset"
            value={scenario.preset}
            onChange={(e) => {
              const p = e.target.value as Scenario['preset'];
              if (p !== 'custom') set({ preset: p, assumptions: { ...PRESET_ASSUMPTIONS[p] } });
            }}
            options={[{ value: 'base', label: 'Base case' }, { value: 'optimistic', label: 'Optimistic' }, { value: 'conservative', label: 'Conservative' }, { value: 'custom', label: 'Custom', disabled: true }]}
          />
          <Slider label="Horizon" value={scenario.horizonYears} min={1} max={30} step={1} onChange={(v) => set({ horizonYears: v })} format={(v) => `${v} year${v > 1 ? 's' : ''}`} />
          <MoneyInput
            label="Living costs per month"
            value={scenario.livingCostsMonthlyCents}
            allowEmpty
            placeholder={Math.round(d.livingCosts.monthlyCents / 100).toLocaleString('en-AU')}
            onChange={(v) => set({ livingCostsMonthlyCents: v })}
            hint={scenario.livingCostsMonthlyCents === null ? `From your ${d.livingCosts.basis === 'transactions' ? 'spending history' : d.livingCosts.basis === 'budget' ? 'budget' : 'data (none yet)'}; excludes housing` : 'Excludes rent and mortgage'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Life events" subtitle="Changes that happen during the forecast. Each one shows up in the projection from its date." action={<AddEventMenu onPick={(t) => setAdding(blankEvent(t, d.today))} />} />
        {scenario.events.length === 0 ? (
          <div className="px-5 pb-5 pt-2 text-sm text-muted">No events. This scenario continues today's situation.</div>
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {[...scenario.events].sort((a, b) => eventDate(a).localeCompare(eventDate(b))).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <span className="num w-24 shrink-0 text-xs text-muted">{formatDate(eventDate(e), 'medium')}</span>
                <button type="button" className="min-w-0 flex-1 text-left hover:text-accent" onClick={() => setAdding(e)}>
                  <div className="font-medium">{EVENT_LABEL[e.type]}</div>
                  <div className="text-xs text-muted">{describeEvent(e, d.names)}</div>
                </button>
                <Button size="sm" variant="ghost" aria-label="Remove event" onClick={() => set({ events: scenario.events.filter((x) => x.id !== e.id) })}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Assumptions" subtitle={`Annual rates · preset: ${scenario.preset}`} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {ASSUMPTION_FIELDS.map((f) => (
            <PercentInput key={f.key} label={f.label} value={scenario.assumptions[f.key]} onChange={(v) => setA({ [f.key]: v })} hint={f.hint} step={0.1} />
          ))}
          <NumberInput label="Emergency fund target" value={scenario.assumptions.emergencyFundMonths} onChange={(v) => setA({ emergencyFundMonths: Math.max(0, v) })} suffix="months" hint="Months of living costs and repayments" />
        </div>
      </Card>

      {adding && <EventModal key={adding.id} event={adding} onClose={() => setAdding(null)} onSave={(e) => { set({ events: [...scenario.events.filter((x) => x.id !== e.id), e] }); setAdding(null); }} />}
    </div>
  );
}

function AddEventMenu({ onPick }: { onPick: (t: ScenarioEventType) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Plus className="h-4 w-4 text-muted" />
      <Select aria-label="Add a life event" value="" onChange={(e) => e.target.value && onPick(e.target.value as ScenarioEventType)} options={[{ value: '', label: 'Add event…' }, ...Object.entries(EVENT_LABEL).map(([value, label]) => ({ value, label }))]} className="w-56" />
    </div>
  );
}

export function eventDate(e: ScenarioEvent): string {
  return 'date' in e ? e.date : e.start;
}

export function blankEvent(type: ScenarioEventType, today: string): ScenarioEvent {
  const id = uid('evt');
  const date = addMonths(today, 6);
  switch (type) {
    case 'salary-change': return { id, type, person: 'me', date, mode: 'percent', value: 0.1 };
    case 'bonus-change': return { id, type, person: 'me', date, bonusAnnualCents: 0 };
    case 'hours-change': return { id, type, person: 'me', start: date, fte: 0.8 };
    case 'parental-leave': return { id, type, person: 'partner', start: date, totalWeeks: 52, employerPaidWeeks: 14, govPaidWeeks: 24, govWeeklyCents: 948_10, returnFte: 0.6 };
    case 'income-stop': return { id, type, person: 'me', start: date, end: addMonths(date, 6) };
    case 'rental-income': return { id, type, start: date, monthlyCents: 2_000_00, ownership: { me: 50, partner: 50 } };
    case 'living-cost-change': return { id, type, start: date, monthlyDeltaCents: 500_00 };
    case 'child': return { id, type, date, monthlyCostCents: 1_200_00 };
    case 'large-expense': return { id, type, date, amountCents: 20_000_00, label: 'Car' };
    case 'super-change': return { id, type, person: 'me', date, salarySacrificeAnnualCents: 5_000_00 };
    case 'property-purchase': return { id, type, date: addMonths(today, 12), priceCents: 900_000_00, depositCents: 180_000_00, costsCents: 50_000_00, rate: 0.0599, termYears: 30 };
  }
}

export function describeEvent(e: ScenarioEvent, names: Record<PersonId, string>): string {
  switch (e.type) {
    case 'salary-change': return `${names[e.person]}: ${e.mode === 'percent' ? `${formatPercent(e.value, 0, true)} pay change` : `salary becomes ${formatMoney(e.value)}`}`;
    case 'bonus-change': return `${names[e.person]}: bonus ${formatMoney(e.bonusAnnualCents)} a year`;
    case 'hours-change': return `${names[e.person]}: ${formatPercent(e.fte, 0)} of full time${e.end ? ` until ${formatDate(e.end, 'medium')}` : ''}`;
    case 'parental-leave': return `${names[e.person]}: ${e.totalWeeks} weeks (${e.employerPaidWeeks} employer-paid, ${e.govPaidWeeks} government-paid), back at ${formatPercent(e.returnFte, 0)}`;
    case 'income-stop': return `${names[e.person]}: no income${e.end ? ` until ${formatDate(e.end, 'medium')}` : ''}`;
    case 'rental-income': return `${formatMoney(e.monthlyCents)} a month${e.end ? ` until ${formatDate(e.end, 'medium')}` : ''}`;
    case 'living-cost-change': return `${formatMoney(e.monthlyDeltaCents, { signed: true })} a month${e.label ? ` · ${e.label}` : ''}`;
    case 'child': return `${formatMoney(e.monthlyCostCents)} a month in extra costs`;
    case 'large-expense': return `${e.label}: ${formatMoney(e.amountCents)}`;
    case 'super-change': return `${names[e.person]}: salary sacrifice ${formatMoney(e.salarySacrificeAnnualCents)} a year`;
    case 'property-purchase': return `${formatMoney(e.priceCents)} with ${formatMoney(e.depositCents)} deposit, ${formatMoney(e.costsCents)} costs, ${formatPercent(e.rate, 2)} over ${e.termYears} years`;
  }
}

function EventModal({ event, onClose, onSave }: { event: ScenarioEvent; onClose: () => void; onSave: (e: ScenarioEvent) => void }) {
  const d = useDerived();
  const [e, setE] = useState<ScenarioEvent>(event);
  // A loosely-typed setter: each branch below only touches fields of its own event type.
  const set = (patch: Record<string, unknown>) => setE({ ...e, ...patch } as ScenarioEvent);
  const personSelect = 'person' in e && (
    <Select label="Who" value={e.person} onChange={(x) => set({ person: x.target.value })} options={[{ value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
  );
  const dateField = 'date' in e ? <TextInput label="Date" type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /> : <TextInput label="Starts" type="date" value={e.start} onChange={(x) => set({ start: x.target.value })} />;
  const endField = 'start' in e && e.type !== 'parental-leave' && <TextInput label="Ends (optional)" type="date" value={('end' in e && e.end) || ''} onChange={(x) => set({ end: x.target.value || undefined })} />;

  let fields: React.ReactNode = null;
  switch (e.type) {
    case 'salary-change':
      fields = (
        <>
          <Select label="Change" value={e.mode} onChange={(x) => set({ mode: x.target.value, value: x.target.value === 'percent' ? 0.1 : 0 })} options={[{ value: 'percent', label: 'By a percentage' }, { value: 'set', label: 'To a new salary' }]} />
          {e.mode === 'percent' ? <PercentInput label="Change" value={e.value} onChange={(v) => set({ value: v })} /> : <MoneyInput label="New salary (same basis as profile)" value={e.value} onChange={(v) => set({ value: v ?? 0 })} />}
          <TextInput label="Label (optional)" value={e.label ?? ''} onChange={(x) => set({ label: x.target.value || undefined })} placeholder="e.g. Promotion" />
        </>
      );
      break;
    case 'bonus-change':
      fields = <MoneyInput label="New annual bonus" value={e.bonusAnnualCents} onChange={(v) => set({ bonusAnnualCents: v ?? 0 })} />;
      break;
    case 'hours-change':
      fields = <PercentInput label="Hours (share of full time)" value={e.fte} onChange={(v) => set({ fte: Math.max(0, Math.min(1, v)) })} step={5} />;
      break;
    case 'parental-leave':
      fields = (
        <>
          <NumberInput label="Total weeks away" value={e.totalWeeks} onChange={(v) => set({ totalWeeks: Math.max(0, v) })} suffix="weeks" />
          <NumberInput label="Employer-paid weeks" value={e.employerPaidWeeks} onChange={(v) => set({ employerPaidWeeks: Math.max(0, v) })} suffix="weeks" hint="At full pay" />
          <NumberInput label="Government-paid weeks" value={e.govPaidWeeks} onChange={(v) => set({ govPaidWeeks: Math.max(0, v) })} suffix="weeks" hint="Paid Parental Leave" />
          <MoneyInput label="Government pay per week" value={e.govWeeklyCents} onChange={(v) => set({ govWeeklyCents: v ?? 0 })} hint="Check the current national minimum wage rate at servicesaustralia.gov.au" />
          <PercentInput label="Hours on return" value={e.returnFte} onChange={(v) => set({ returnFte: Math.max(0, Math.min(1, v)) })} step={5} />
        </>
      );
      break;
    case 'income-stop':
      fields = <TextInput label="Label (optional)" value={e.label ?? ''} onChange={(x) => set({ label: x.target.value || undefined })} placeholder="e.g. Study break" />;
      break;
    case 'rental-income':
      fields = (
        <>
          <MoneyInput label="Rent received per month" value={e.monthlyCents} onChange={(v) => set({ monthlyCents: v ?? 0 })} hint="After agent fees; taxed at each owner's marginal rate" />
          <PercentInput label={`${d.names.me}'s share`} value={e.ownership.me / 100} onChange={(v) => { const me = Math.round(Math.max(0, Math.min(1, v)) * 100); set({ ownership: { me, partner: 100 - me } }); }} step={5} />
        </>
      );
      break;
    case 'living-cost-change':
      fields = (
        <>
          <MoneyInput label="Change per month" value={e.monthlyDeltaCents} allowNegative onChange={(v) => set({ monthlyDeltaCents: v ?? 0 })} hint="Negative for a saving" />
          <TextInput label="Label (optional)" value={e.label ?? ''} onChange={(x) => set({ label: x.target.value || undefined })} />
        </>
      );
      break;
    case 'child':
      fields = <MoneyInput label="Extra costs per month" value={e.monthlyCostCents} onChange={(v) => set({ monthlyCostCents: v ?? 0 })} hint="Childcare, food, clothing. Your own estimate." />;
      break;
    case 'large-expense':
      fields = (
        <>
          <TextInput label="What" value={e.label} onChange={(x) => set({ label: x.target.value })} />
          <MoneyInput label="Amount" value={e.amountCents} onChange={(v) => set({ amountCents: v ?? 0 })} />
        </>
      );
      break;
    case 'super-change':
      fields = <MoneyInput label="Salary sacrifice per year" value={e.salarySacrificeAnnualCents} onChange={(v) => set({ salarySacrificeAnnualCents: v ?? 0 })} />;
      break;
    case 'property-purchase':
      fields = (
        <>
          <MoneyInput label="Price" value={e.priceCents} onChange={(v) => set({ priceCents: v ?? 0 })} />
          <MoneyInput label="Deposit" value={e.depositCents} onChange={(v) => set({ depositCents: v ?? 0 })} />
          <MoneyInput label="Purchase costs" value={e.costsCents} onChange={(v) => set({ costsCents: v ?? 0 })} hint="Stamp duty, fees, LMI. Use the property analyser to estimate." />
          <PercentInput label="Interest rate" value={e.rate} onChange={(v) => set({ rate: v })} step={0.05} />
          <NumberInput label="Loan term" value={e.termYears} onChange={(v) => set({ termYears: Math.max(1, Math.min(40, v)) })} suffix="years" />
          <MoneyInput label="Rent that stops (per month)" value={e.rentSavedMonthlyCents ?? null} allowEmpty onChange={(v) => set({ rentSavedMonthlyCents: v ?? undefined })} hint="If you move in and stop renting" />
        </>
      );
      break;
  }

  const invalid = e.type === 'property-purchase' && (e.priceCents <= 0 || e.depositCents > e.priceCents);
  return (
    <Modal open onClose={onClose} title={EVENT_LABEL[e.type]} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={invalid} onClick={() => onSave(e)}>Save event</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {personSelect}
        {dateField}
        {endField}
        {fields}
      </div>
      {e.type === 'property-purchase' && <div className="mt-4"><Callout tone="info">The deposit and costs come out of cash and investments on the purchase date. If there isn't enough, the forecast shows a shortfall.</Callout></div>}
    </Modal>
  );
}
