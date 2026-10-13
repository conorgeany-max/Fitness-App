import { useMemo, useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import { addMonths, formatDate } from '@/domain/dates';
import { allocateSurplus, goalOptions, goalProgress } from '@/domain/goals';
import { formatMoney, formatPercent } from '@/domain/money';
import type { Goal, GoalType } from '@/domain/types';
import { uid } from '@/lib/id';
import { useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Modal, MoneyInput, PercentInput, ProgressBar, Select, TextInput, cx, toast } from '@/components/ui';

const TYPE_LABEL: Record<GoalType, string> = {
  'home-deposit': 'Home deposit',
  'emergency-fund': 'Emergency fund',
  'mortgage-reduction': 'Pay down the mortgage',
  investment: 'Investment portfolio',
  retirement: 'Retirement',
  holiday: 'Holiday',
  car: 'Car',
  'parental-leave': 'Parental leave fund',
  'debt-repayment': 'Pay off a debt',
  'net-worth': 'Net worth milestone',
  other: 'Other',
};

export function Goals() {
  const data = useApp((s) => s.data);
  const d = useDerived();
  const perspective = usePerspective();
  const [draft, setDraft] = useState<Goal | null>(null);
  const a = data.scenarios[0]?.assumptions;
  const investReturn = a ? a.investmentReturn - a.investmentFees - a.investmentTaxDrag : 0.06;
  const goals = data.goals.filter((g) => perspective === 'household' || g.scope === perspective || g.scope === 'household');
  const progress = useMemo(() => goals.map((g) => goalProgress(g, data.holdings, d.today)), [goals, data.holdings, d.today]);

  const months = d.completeMonths.map((m) => d.monthly[perspective][d.months.indexOf(m)]).filter((s) => s.transactionCount > 0);
  const avgSurplus = months.length ? Math.round(months.reduce((a, s) => a + s.incomeCents - s.consumptionCents - s.debtRepaymentCents, 0) / months.length) : null;
  const alloc = useMemo(() => allocateSurplus(progress.filter((p) => !p.complete), Math.max(0, avgSurplus ?? 0)), [progress, avgSurplus]);

  const blank = (): Goal => ({ id: uid('goal'), name: '', type: 'other', targetCents: 0, targetDate: addMonths(d.today, 24), currentCents: 0, linkedHoldingIds: [], monthlyContributionCents: 0, expectedReturn: 0.035, priority: 3, scope: perspective, createdAt: new Date().toISOString() });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft(blank())}>Add goal</Button>
      </div>
      {progress.length === 0 ? (
        <Card><EmptyState icon={<Flag className="h-5 w-5" />} title="No goals yet" action={<Button variant="primary" onClick={() => setDraft(blank())}>Add a goal</Button>}>Set targets like a home deposit or emergency fund. Link them to accounts and progress updates itself.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {progress.map((p) => {
            const opts = goalOptions(p, d.today, 200_00, investReturn).filter((o) => !(p.basis === 'linked-debt' && o.label.startsWith('Invest'))).filter((o, i, all) => all.findIndex((x) => x.monthsToGoal === o.monthsToGoal && x.monthlyCents === o.monthlyCents) === i);
            return (
              <Card key={p.goal.id} className="p-5">
                <div className="flex items-start gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(p.goal)}>
                    <div className="font-semibold hover:text-accent">{p.goal.name}</div>
                    <div className="text-xs text-muted">{TYPE_LABEL[p.goal.type]} · priority {p.goal.priority} · by {formatDate(p.goal.targetDate, 'month')}{p.goal.scope !== 'household' ? ` · ${d.names[p.goal.scope]}` : ''}</div>
                  </button>
                  {p.complete ? <Badge tone="good">Reached</Badge> : p.onTrack ? <Badge tone="good">On track</Badge> : <Badge tone="warn">Behind</Badge>}
                </div>
                <div className="mt-4 flex items-baseline justify-between text-sm">
                  <span className="num font-semibold">{formatMoney(p.currentCents)}</span>
                  <span className="num text-muted">of {formatMoney(p.goal.targetCents)} · {formatPercent(p.fraction, 0)}</span>
                </div>
                <div className="mt-1.5"><ProgressBar value={p.fraction} tone={p.complete ? 'good' : p.onTrack ? 'accent' : 'warn'} label={`${p.goal.name} progress`} /></div>
                <div className="mt-2 text-xs text-muted">
                  {p.basis === 'linked-assets' ? 'Tracks linked accounts' : p.basis === 'linked-debt' ? 'Tracks repayment of linked debt' : 'Updated manually'}
                  {!p.complete && ` · needs ${formatMoney(p.requiredMonthlyCents)}/mo · contributing ${formatMoney(p.goal.monthlyContributionCents)}/mo`}
                  {!p.complete && p.projectedDate && ` · on pace for ${formatDate(p.projectedDate, 'month')}`}
                </div>
                {!p.complete && opts.length > 0 && (
                  <div className="mt-3 rounded-lg bg-surface-2/60 p-3 text-xs">
                    <div className="mb-1 font-medium text-ink-2">Ways to get there</div>
                    <ul className="space-y-0.5">
                      {opts.map((o) => <li key={o.label} className="flex justify-between gap-2"><span className="text-ink-2">{o.label}</span><span className="num">{formatMoney(o.monthlyCents)}/mo · {o.date ? formatDate(o.date, 'month') : 'not reached'}</span></li>)}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {progress.some((p) => !p.complete) && (
        <Card>
          <CardHeader title="Funding your goals" subtitle={avgSurplus !== null ? `Average monthly surplus over the last ${months.length} complete month(s): ${formatMoney(avgSurplus)} (income minus spending and debt repayments)` : 'No complete months of transactions yet, so the surplus is unknown.'} />
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-right text-xs text-muted">
                  <th className="px-5 py-2 text-left font-medium">Goal (by priority)</th>
                  <th className="px-3 py-2 font-medium">Needed / mo</th>
                  <th className="px-3 py-2 font-medium">Funded</th>
                  <th className="px-5 py-2 font-medium">Short</th>
                </tr>
              </thead>
              <tbody className="num">
                {alloc.rows.map((r) => (
                  <tr key={r.goalId} className="border-t border-line/60 text-right">
                    <td className="px-5 py-2 text-left">{r.name}</td>
                    <td className="px-3 py-2">{formatMoney(r.requiredCents)}</td>
                    <td className="px-3 py-2">{formatMoney(r.fundedCents)}</td>
                    <td className={cx('px-5 py-2', r.shortfallCents > 0 ? 'text-warn' : 'text-muted')}>{r.shortfallCents > 0 ? formatMoney(r.shortfallCents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 p-5 text-sm">
            {alloc.overcommittedCents > 0 ? (
              <Callout tone="warn">Your goals need {formatMoney(alloc.overcommittedCents)} a month more than your average surplus. Lower-priority goals are shown as short; each dollar is only counted once.</Callout>
            ) : (
              <p className="text-ink-2">After funding every goal, about <strong className="num">{formatMoney(alloc.unallocatedCents)}</strong> a month is unallocated.</p>
            )}
            {alloc.sharedHoldingWarnings.map((w) => <Callout key={w} tone="info">{w}</Callout>)}
          </div>
        </Card>
      )}

      {draft && <GoalModal key={draft.id} goal={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function GoalModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const data = useApp((s) => s.data);
  const upsert = useApp((s) => s.upsertGoal);
  const del = useApp((s) => s.deleteGoal);
  const d = useDerived();
  const [g, setG] = useState(goal);
  const isNew = !data.goals.some((x) => x.id === goal.id);
  const holdings = data.holdings.filter((h) => !h.archived);
  const toggleLink = (id: string) => {
    const has = g.linkedHoldingIds.includes(id);
    const linked = has ? g.linkedHoldingIds.filter((x) => x !== id) : [...g.linkedHoldingIds, id];
    const h = holdings.find((x) => x.id === id);
    // Debt goals remember the starting balance so progress = amount paid off since.
    const baseline = h?.kind === 'liability' && !has && g.baselineCents === undefined ? h.valueCents ?? undefined : g.baselineCents;
    setG({ ...g, linkedHoldingIds: linked, baselineCents: baseline });
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Add a goal' : `Edit ${goal.name}`}
      footer={
        <>
          {!isNew && <Button variant="danger" className="mr-auto" onClick={() => { del(goal.id); onClose(); }}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!g.name.trim() || g.targetCents <= 0} onClick={() => { upsert({ ...g, name: g.name.trim() }); onClose(); toast('Goal saved'); }}>Save goal</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Name" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="e.g. House deposit" />
        <Select label="Type" value={g.type} onChange={(e) => setG({ ...g, type: e.target.value as GoalType })} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <MoneyInput label="Target amount" value={g.targetCents} onChange={(v) => setG({ ...g, targetCents: v ?? 0 })} />
        <TextInput label="Target date" type="date" value={g.targetDate} onChange={(e) => setG({ ...g, targetDate: e.target.value })} />
        <MoneyInput label="Monthly contribution" value={g.monthlyContributionCents} onChange={(v) => setG({ ...g, monthlyContributionCents: v ?? 0 })} />
        <PercentInput label="Expected return" value={g.expectedReturn} onChange={(v) => setG({ ...g, expectedReturn: v })} hint="Savings account rate for cash goals" />
        <Select label="Priority" value={String(g.priority)} onChange={(e) => setG({ ...g, priority: Number(e.target.value) as Goal['priority'] })} options={[1, 2, 3, 4, 5].map((p) => ({ value: String(p), label: p === 1 ? '1 (highest)' : p === 5 ? '5 (lowest)' : String(p) }))} />
        <Select label="Whose goal" value={g.scope} onChange={(e) => setG({ ...g, scope: e.target.value as Goal['scope'] })} options={[{ value: 'household', label: 'Household' }, { value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
        {g.linkedHoldingIds.length === 0 && <MoneyInput label="Saved so far" value={g.currentCents} onChange={(v) => setG({ ...g, currentCents: v ?? 0 })} hint="Or link accounts below to track automatically" />}
      </div>
      <div className="mt-5">
        <div className="mb-2 text-xs font-medium text-ink-2">Linked accounts and debts</div>
        <div className="flex flex-wrap gap-2">
          {holdings.map((h) => (
            <button key={h.id} type="button" onClick={() => toggleLink(h.id)} className={cx('rounded-full border px-3 py-1 text-xs', g.linkedHoldingIds.includes(h.id) ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink-2 hover:bg-surface-2')}>
              {h.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Assets count towards the goal by your share of ownership in the goal's view. A linked debt counts the amount repaid since you linked it.</p>
      </div>
    </Modal>
  );
}
