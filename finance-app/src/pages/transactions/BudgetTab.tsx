import { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { buildBudgetReport, type BudgetRow } from '@/domain/budget';
import { addMonthKey, formatDate, formatMonthKey, monthKey, todayISO } from '@/domain/dates';
import { formatMoney, formatPercent } from '@/domain/money';
import type { BudgetLine, PlannedExpense } from '@/domain/types';
import { uid } from '@/lib/id';
import { reportableTransactions, useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, MoneyInput, ProgressBar, Select, TextInput, Toggle, cx, toast } from '@/components/ui';
import { Money, ScopeBadge } from '@/components/finance';
import { CategoryDot, useCategoryMap, useCategoryOptions } from './shared';

const STATUS: Record<BudgetRow['status'], { label: string; tone: 'good' | 'info' | 'warn' | 'bad' }> = {
  under: { label: 'Under budget', tone: 'good' },
  'on-track': { label: 'On track', tone: 'info' },
  'at-risk': { label: 'At risk', tone: 'warn' },
  over: { label: 'Over', tone: 'bad' },
};

export function BudgetTab() {
  const data = useApp((s) => s.data);
  const upsertBudget = useApp((s) => s.upsertBudget);
  const deleteBudget = useApp((s) => s.deleteBudget);
  const d = useDerived();
  const perspective = usePerspective();
  const catMap = useCategoryMap();
  const [month, setMonth] = useState(d.currentMonth);
  const [editing, setEditing] = useState<BudgetLine | null>(null);

  const report = useMemo(
    () => buildBudgetReport(data.budgets, reportableTransactions(data), data.categories, data.holdings, data.plannedExpenses, perspective, month, d.today),
    [data, perspective, month, d.today],
  );
  const summary = d.monthly[perspective][d.months.indexOf(month)];
  const isCurrent = month === d.currentMonth;
  const isFuture = month > d.currentMonth;

  const newLine = (categoryId = ''): BudgetLine => ({ id: uid('bud'), categoryId, scope: perspective, monthlyCents: 0, rollover: false, startMonth: d.currentMonth });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setMonth(addMonthKey(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[8rem] text-center font-medium">{formatMonthKey(month)}</div>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => setMonth(addMonthKey(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          {!isCurrent && <Button size="sm" variant="ghost" onClick={() => setMonth(d.currentMonth)}>This month</Button>}
          <ScopeBadge perspective={perspective} names={d.names} />
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(newLine())}>Add budget</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Budgeted</div>
          <Money cents={report.totalBudgetCents} className="mt-1 block text-xl font-semibold" />
          <div className="mt-1 text-xs text-muted">{formatMoney(report.totalBudgetCents * 12)} a year</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Spent in budgeted categories</div>
          <Money cents={report.totalActualCents} className="mt-1 block text-xl font-semibold" />
          {isCurrent && <div className="mt-1 text-xs text-muted">{formatPercent(report.progressOfMonth, 0)} of the month gone</div>}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">{isCurrent ? 'Projected by month end' : 'Unbudgeted spending'}</div>
          <Money cents={isCurrent ? report.totalProjectedCents : report.unbudgetedSpendCents} className="mt-1 block text-xl font-semibold" />
          {isCurrent && <div className="mt-1 text-xs text-muted">Straight-line from spending so far, plus planned items</div>}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Month cash flow</div>
          {summary ? (
            <>
              <Money cents={summary.incomeCents - summary.consumptionCents} signed tone="auto" className="mt-1 block text-xl font-semibold" />
              <div className="mt-1 text-xs text-muted">In {formatMoney(summary.incomeCents)} · spent {formatMoney(summary.consumptionCents)}</div>
            </>
          ) : (
            <div className="mt-1 text-sm text-muted">{isFuture ? 'Future month' : 'Outside the last 12 months'}</div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Budgets" subtitle={`${perspective === 'household' ? 'Household' : `${d.names[perspective]}'s`} budget lines. Spending in individual views follows account ownership.`} />
        {report.rows.length === 0 ? (
          <EmptyState title="No budgets for this view yet" action={<Button variant="primary" onClick={() => setEditing(newLine())}>Add a budget</Button>}>
            Budgets are set per category and per view, so household, {d.names.me} and {d.names.partner} can each have their own.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {report.rows.map((r) => {
              const pct = r.availableCents > 0 ? r.actualCents / r.availableCents : r.actualCents > 0 ? 1 : 0;
              const st = STATUS[r.status];
              return (
                <li key={r.line.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <CategoryDot color={r.category.color} />
                    <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:text-accent" onClick={() => setEditing(r.line)}>
                      {r.category.name}
                    </button>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <div className="num text-sm">
                      <span className={cx('font-medium', r.status === 'over' ? 'text-bad' : 'text-ink')}>{formatMoney(r.actualCents)}</span>
                      <span className="text-muted"> / {formatMoney(r.availableCents)}</span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={pct} tone={r.status === 'over' ? 'bad' : r.status === 'at-risk' ? 'warn' : 'accent'} label={`${r.category.name} spent`} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                    <span>Budget {formatMoney(r.budgetCents)}</span>
                    {r.line.rollover && <span>Rollover {formatMoney(r.rolloverCents, { signed: true })}</span>}
                    {r.plannedCents > 0 && <span>Planned {formatMoney(r.plannedCents)}</span>}
                    {isCurrent && <span>Projected {formatMoney(r.projectedCents)}</span>}
                    <span className={r.remainingCents < 0 ? 'text-bad' : ''}>{r.remainingCents < 0 ? `${formatMoney(-r.remainingCents)} over` : `${formatMoney(r.remainingCents)} left`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {report.unbudgetedByCategory.length > 0 && (
        <Card>
          <CardHeader title="Spending without a budget" subtitle={`${formatMonthKey(month)} · ${formatMoney(report.unbudgetedSpendCents)} in total`} />
          <ul className="divide-y divide-line/60">
            {report.unbudgetedByCategory.map(({ category, cents }) => (
              <li key={category.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <CategoryDot color={category.color} />
                <span className="flex-1">{category.name}</span>
                <Money cents={cents} />
                <Button size="sm" variant="subtle" onClick={() => setEditing({ ...newLine(category.id), monthlyCents: Math.ceil(cents / 5000) * 5000 })}>Budget</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PlannedExpenses />

      {editing && <BudgetModal key={editing.id} line={editing} onClose={() => setEditing(null)} onSave={(l) => { upsertBudget(l); setEditing(null); toast('Budget saved'); }} onDelete={(id) => { deleteBudget(id); setEditing(null); toast('Budget removed'); }} existing={new Set(data.budgets.filter((b) => b.scope === perspective && b.id !== editing?.id).map((b) => b.categoryId))} catName={(id) => catMap.get(id)?.name ?? ''} />}
    </div>
  );
}

function BudgetModal({ line, onClose, onSave, onDelete, existing, catName }: { line: BudgetLine; onClose: () => void; onSave: (l: BudgetLine) => void; onDelete: (id: string) => void; existing: Set<string>; catName: (id: string) => string }) {
  const data = useApp((s) => s.data);
  const options = useCategoryOptions({ includeNone: false, only: ['expense', 'investment', 'debt-repayment'] });
  const [draft, setDraft] = useState<BudgetLine>(line);
  const isNew = !data.budgets.some((b) => b.id === line.id);
  const dup = existing.has(draft.categoryId);
  const valid = draft.categoryId && !dup && draft.monthlyCents >= 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add budget' : `Edit budget · ${catName(line.categoryId)}`}
      footer={
        <>
          {!isNew && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(line.id)} className="mr-auto">Remove</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(draft)}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select label="Category" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })} options={[{ value: '', label: 'Choose a category' }, ...options.map((o) => ({ ...o, disabled: o.disabled || existing.has(o.value) }))]} hint={dup ? 'This view already has a budget for that category.' : undefined} />
        <MoneyInput label="Monthly amount" value={draft.monthlyCents} onChange={(v) => setDraft({ ...draft, monthlyCents: v ?? 0 })} hint={`${formatMoney(draft.monthlyCents * 12)} a year · ${formatMoney(Math.round((draft.monthlyCents * 12) / 26))} a fortnight`} />
        <Toggle checked={draft.rollover} onChange={(v) => setDraft({ ...draft, rollover: v, startMonth: v && !draft.rollover ? monthKey(todayISO()) : draft.startMonth })} label="Roll over unspent (or overspent) amounts" hint="Carries the difference into next month, starting from the month you turn this on." />
      </div>
    </Modal>
  );
}

function PlannedExpenses() {
  const data = useApp((s) => s.data);
  const upsertPlanned = useApp((s) => s.upsertPlanned);
  const deletePlanned = useApp((s) => s.deletePlanned);
  const perspective = usePerspective();
  const catMap = useCategoryMap();
  const options = useCategoryOptions({ only: ['expense'] });
  const [draft, setDraft] = useState<PlannedExpense | null>(null);
  const list = data.plannedExpenses.filter((p) => perspective === 'household' || p.scope === perspective || p.scope === 'household').sort((a, b) => a.date.localeCompare(b.date));
  const blank = (): PlannedExpense => ({ id: uid('plan'), name: '', date: todayISO(), amountCents: 0, categoryId: null, scope: perspective });

  return (
    <Card>
      <CardHeader title="Planned one-off expenses" subtitle="Known future costs. They count against the category's budget in their month and appear in forecasts." action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft(blank())}>Add</Button>} />
      {list.length === 0 ? (
        <div className="px-5 pb-5 pt-2 text-sm text-muted">Nothing planned. Add things like car registration, a wedding or school fees.</div>
      ) : (
        <ul className="mt-2 divide-y divide-line/60">
          {list.map((p) => (
            <li key={p.id} className={cx('flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm', p.done && 'opacity-60')}>
              <CalendarClock className="h-4 w-4 text-muted" />
              <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:text-accent" onClick={() => setDraft(p)}>{p.name}</button>
              <span className="text-xs text-muted">{formatDate(p.date, 'medium')} · {p.categoryId ? catMap.get(p.categoryId)?.name : 'No category'}</span>
              <Money cents={p.amountCents} className="font-medium" />
              <Button size="sm" variant="ghost" onClick={() => upsertPlanned({ ...p, done: !p.done })}>{p.done ? 'Undo' : 'Done'}</Button>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title={data.plannedExpenses.some((p) => p.id === draft.id) ? 'Edit planned expense' : 'Plan an expense'}
          footer={
            <>
              {data.plannedExpenses.some((p) => p.id === draft.id) && <Button variant="danger" className="mr-auto" onClick={() => { deletePlanned(draft.id); setDraft(null); }}>Delete</Button>}
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" disabled={!draft.name.trim() || draft.amountCents <= 0} onClick={() => { upsertPlanned({ ...draft, name: draft.name.trim() }); setDraft(null); toast('Planned expense saved'); }}>Save</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="What is it?" className="sm:col-span-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <TextInput label="Date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <MoneyInput label="Amount" value={draft.amountCents} onChange={(v) => setDraft({ ...draft, amountCents: v ?? 0 })} />
            <Select label="Category" value={draft.categoryId ?? ''} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || null })} options={options} />
            <Select label="Whose?" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as PlannedExpense['scope'] })} options={[{ value: 'household', label: 'Household' }, { value: 'me', label: data.people.me.name }, { value: 'partner', label: data.people.partner.name }]} />
          </div>
        </Modal>
      )}
    </Card>
  );
}
