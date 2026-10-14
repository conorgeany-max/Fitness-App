import { useMemo } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { categoryMeta } from '@/domain/holdingCategories';
import { formatMoney, formatPercent } from '@/domain/money';
import { computePayPlan, yearlyBillsMonthly, type PayPlan, type PayPlanLine } from '@/domain/payPlan';
import type { PersonId } from '@/domain/types';
import { uid } from '@/lib/id';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Button, Callout, Card, CardHeader, EmptyState, MoneyInput, NumberInput, Select, TextInput } from '@/components/ui';
import { Money } from '@/components/finance';

const FREQ_LABEL = { weekly: 'week', fortnightly: 'fortnight', monthly: 'month' } as const;

/** Starting lines with no amounts: the person fills in their own. */
const STARTER: { name: string }[] = [{ name: 'Bills and regular costs' }, { name: 'Spending money' }, { name: 'Emergency fund' }, { name: 'Holidays and big purchases' }, { name: 'Investing' }];

export function PayPlanTab() {
  const perspective = usePerspective();
  const people: PersonId[] = perspective === 'household' ? ['me', 'partner'] : [perspective];
  return (
    <div className="space-y-4">
      <Callout tone="info">
        Plan where each pay goes, then set up matching automatic transfers in your bank (Up's Savers work well for this). The app shows the transfers; it never moves money.
      </Callout>
      <div className={people.length > 1 ? 'grid gap-4 xl:grid-cols-2' : ''}>
        {people.map((p) => (
          <PersonPlan key={p} person={p} />
        ))}
      </div>
    </div>
  );
}

function PersonPlan({ person }: { person: PersonId }) {
  const data = useApp((s) => s.data);
  const update = useApp((s) => s.updateSettings);
  const d = useDerived();
  const name = d.names[person];
  const frequency = data.people[person].income.payFrequency;
  const saved = data.settings.payPlans?.[person];
  const plan: PayPlan = useMemo(() => saved ?? { lines: [] }, [saved]);
  const result = useMemo(() => computePayPlan(d.takeHomeMonthly[person], frequency, plan), [d.takeHomeMonthly, person, frequency, plan]);
  const billsMonthly = useMemo(() => yearlyBillsMonthly(data.bills, person), [data.bills, person]);
  const accounts = useMemo(
    () => data.holdings.filter((h) => h.kind === 'asset' && !h.archived && !h.summaryOf && h.ownership[person] > 0 && categoryMeta(h.category).liquid),
    [data.holdings, person],
  );

  const save = (lines: PayPlanLine[]) => update({ payPlans: { ...data.settings.payPlans, [person]: { lines } } });
  const setLine = (id: string, patch: Partial<PayPlanLine>) => save(plan.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const newLine = (name: string, amountCents = 0): PayPlanLine => ({ id: uid('pay'), name, mode: 'fixed', amountCents, percent: 0, destinationHoldingId: null });
  const per = FREQ_LABEL[frequency];
  const hasBillsLine = plan.lines.some((l) => /yearly bills/i.test(l.name));

  return (
    <Card>
      <CardHeader
        title={`${name}'s pay`}
        subtitle={
          result.takeHomeMonthlyCents > 0 ? (
            <>
              About {formatMoney(result.takeHomePerPayCents)} a {per} take-home ({formatMoney(result.takeHomeMonthlyCents)} a month), estimated from the salary in Forecasts.
            </>
          ) : (
            <>Add {name}'s salary under Forecasts → Income & tax to see amounts per pay.</>
          )
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {plan.lines.length === 0 ? (
          <EmptyState
            title="No plan yet"
            action={
              <Button variant="primary" onClick={() => save(STARTER.map((s) => newLine(s.name)))}>
                Start with common pots
              </Button>
            }
          >
            Starts with five common pots and no amounts. Rename, remove or add your own.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {plan.lines.map((l) => {
              const row = result.rows.find((r) => r.line.id === l.id);
              return (
                <li key={l.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-end gap-2">
                    <TextInput label="Pot" className="flex-1" value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                    <Button variant="ghost" size="sm" aria-label={`Remove ${l.name}`} onClick={() => save(plan.lines.filter((x) => x.id !== l.id))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Select label="How much" value={l.mode} onChange={(e) => setLine(l.id, { mode: e.target.value as PayPlanLine['mode'] })} options={[{ value: 'fixed', label: 'Fixed amount' }, { value: 'percent', label: '% of pay' }]} />
                    {l.mode === 'fixed' ? (
                      <MoneyInput label="Per month" value={l.amountCents} onChange={(v) => setLine(l.id, { amountCents: v ?? 0 })} />
                    ) : (
                      <NumberInput label="Percent of pay" suffix="%" min={0} max={100} step={0.5} value={l.percent} onChange={(v) => setLine(l.id, { percent: v })} />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="num font-medium">{formatMoney(row?.perPayCents ?? 0)}</span>
                    <span className="text-muted">a {per}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted" />
                    <Select
                      aria-label="Goes to"
                      className="min-w-[12rem] flex-1"
                      value={l.destinationHoldingId ?? ''}
                      onChange={(e) => setLine(l.id, { destinationHoldingId: e.target.value || null })}
                      options={[{ value: '', label: 'Choose an account' }, ...accounts.map((h) => ({ value: h.id, label: h.institution ? `${h.name} (${h.institution})` : h.name }))]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => save([...plan.lines, newLine('New pot')])}>
            Add a pot
          </Button>
          {billsMonthly > 0 && !hasBillsLine && (
            <Button size="sm" onClick={() => save([...plan.lines, newLine('Yearly bills', billsMonthly)])}>
              Add yearly bills ({formatMoney(billsMonthly)} a month)
            </Button>
          )}
        </div>
        {billsMonthly > 0 && (
          <p className="text-xs text-muted">
            Yearly bills: {formatMoney(billsMonthly)} a month covers {name}'s quarterly and yearly bills from the Bills tab when they fall due (household bills count half each).
          </p>
        )}

        {plan.lines.length > 0 && result.takeHomeMonthlyCents > 0 && (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">Planned</div>
              <Money cents={result.allocatedMonthlyCents} className="block font-semibold" />
              <div className="text-xs text-muted">{formatPercent(result.allocatedShare, 0)} of pay, per month</div>
            </div>
            <div>
              <div className="text-xs text-muted">Left in the everyday account</div>
              <Money cents={result.leftoverMonthlyCents} className={result.leftoverMonthlyCents < 0 ? 'block font-semibold text-bad' : 'block font-semibold'} />
              <div className="text-xs text-muted">{formatMoney(result.leftoverPerPayCents)} a {per}</div>
            </div>
            {result.leftoverMonthlyCents < 0 && (
              <p className="text-sm text-bad sm:col-span-3">The plan adds up to more than {name}'s take-home pay by {formatMoney(-result.leftoverMonthlyCents)} a month.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
