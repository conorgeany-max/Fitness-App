import { useMemo, useState } from 'react';
import { Plus, Repeat } from 'lucide-react';
import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { detectRecurring } from '@/domain/transactions';
import type { Frequency, RecurringBill } from '@/domain/types';
import { uid } from '@/lib/id';
import { listableTransactions, useDerived, usePerspective } from '@/store/derived';
import { upcomingItems } from '@/store/builders';
import { useApp } from '@/store/store';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, MoneyInput, Select, TextInput, Toggle, cx, toast } from '@/components/ui';
import { Money } from '@/components/finance';
import { FREQUENCY_LABEL, useCategoryMap, useCategoryOptions } from './shared';

const PER_YEAR: Record<Frequency, number> = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annually: 1 };

export function BillsTab() {
  const data = useApp((s) => s.data);
  const upsertBill = useApp((s) => s.upsertBill);
  const d = useDerived();
  const perspective = usePerspective();
  const catMap = useCategoryMap();
  const [draft, setDraft] = useState<RecurringBill | null>(null);

  const bills = data.bills.filter((b) => perspective === 'household' || b.scope === perspective || b.scope === 'household');
  const outgoing = bills.filter((b) => b.active && b.kind !== 'income');
  const annual = outgoing.reduce((a, b) => a + b.amountCents * PER_YEAR[b.frequency], 0);
  const subs = outgoing.filter((b) => b.kind === 'subscription').reduce((a, b) => a + b.amountCents * PER_YEAR[b.frequency], 0);
  const upcoming = useMemo(() => upcomingItems(data, perspective, d.today, 35), [data, perspective, d.today]);

  const tracked = data.bills.map((b) => (b.matchText ?? b.name).toUpperCase());
  const candidates = useMemo(
    () => detectRecurring(listableTransactions(data)).filter((r) => !tracked.some((t) => r.key.includes(t) || t.includes(r.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const blank = (): RecurringBill => ({ id: uid('bill'), name: '', amountCents: 0, frequency: 'monthly', nextDate: d.today, categoryId: null, accountId: null, scope: perspective, kind: 'bill', active: true });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted">Bills & subscriptions per year</div>
          <Money cents={annual} className="mt-1 block text-xl font-semibold" />
          <div className="mt-1 text-xs text-muted">{formatMoney(Math.round(annual / 12))} a month on average</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Subscriptions per year</div>
          <Money cents={subs} className="mt-1 block text-xl font-semibold" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Due in the next 35 days</div>
          <Money cents={upcoming.filter((u) => u.kind !== 'income').reduce((a, u) => a + u.amountCents, 0)} className="mt-1 block text-xl font-semibold" />
          <div className="mt-1 text-xs text-muted">{upcoming.length} item(s), including detected patterns</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recurring bills" subtitle="Tracked bills feed the calendar, insights and forecasts." action={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft(blank())}>Add bill</Button>} />
          {bills.length === 0 ? (
            <EmptyState icon={<Repeat className="h-5 w-5" />} title="No bills tracked">Add bills yourself, or track a pattern detected in your transactions.</EmptyState>
          ) : (
            <ul className="mt-2 divide-y divide-line/60">
              {bills.map((b) => (
                <li key={b.id} className={cx('flex flex-wrap items-center gap-3 px-5 py-3 text-sm', !b.active && 'opacity-50')}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(b)}>
                    <div className="truncate font-medium hover:text-accent">{b.name}</div>
                    <div className="text-xs text-muted">
                      {FREQUENCY_LABEL[b.frequency]} · next {formatDate(b.nextDate, 'medium')}
                      {b.categoryId && ` · ${catMap.get(b.categoryId)?.name ?? ''}`}
                      {b.scope !== 'household' && ` · ${d.names[b.scope]}`}
                    </div>
                  </button>
                  {b.kind === 'subscription' && <Badge tone="info">Subscription</Badge>}
                  {b.kind === 'income' && <Badge tone="good">Income</Badge>}
                  <div className="text-right">
                    <Money cents={b.amountCents} className="font-medium" showCents />
                    <div className="num text-2xs text-muted">{formatMoney(b.amountCents * PER_YEAR[b.frequency])}/yr</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Coming up" subtitle="Next 35 days" />
            <ul className="mt-2 divide-y divide-line/60">
              {upcoming.slice(0, 10).map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="num w-14 shrink-0 text-xs text-muted">{formatDate(u.date, 'short')}</span>
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  {u.kind === 'detected' && <Badge tone="neutral" title="Detected from your transaction history; not yet tracked">Detected</Badge>}
                  <Money cents={u.kind === 'income' ? u.amountCents : -u.amountCents} signed className="font-medium" />
                </li>
              ))}
              {upcoming.length === 0 && <li className="px-5 pb-4 text-sm text-muted">Nothing due.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Detected recurring payments" subtitle="Regular payments of a consistent amount found in your transactions." />
            <ul className="mt-2 divide-y divide-line/60">
              {candidates.slice(0, 12).map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.label}</div>
                    <div className="text-xs text-muted">{FREQUENCY_LABEL[r.frequency]} · seen {r.occurrences}× · last {formatDate(r.lastDate, 'short')}</div>
                  </div>
                  <Money cents={r.averageCents} className="font-medium" />
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => {
                      upsertBill({ ...blank(), name: r.label, amountCents: r.averageCents, frequency: r.frequency, nextDate: r.nextExpected, categoryId: r.categoryId, accountId: r.accountId, matchText: r.key, kind: r.categoryId === 'exp-subscriptions' ? 'subscription' : 'bill', scope: 'household' });
                      toast(`Now tracking ${r.label}`);
                    }}
                  >
                    Track
                  </Button>
                </li>
              ))}
              {candidates.length === 0 && <li className="px-5 pb-4 text-sm text-muted">No untracked patterns found. Patterns need at least three regular payments.</li>}
            </ul>
          </Card>
        </div>
      </div>

      {draft && <BillModal key={draft.id} bill={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function BillModal({ bill, onClose }: { bill: RecurringBill; onClose: () => void }) {
  const data = useApp((s) => s.data);
  const upsertBill = useApp((s) => s.upsertBill);
  const deleteBill = useApp((s) => s.deleteBill);
  const d = useDerived();
  const options = useCategoryOptions();
  const [b, setB] = useState(bill);
  const isNew = !data.bills.some((x) => x.id === bill.id);
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add a recurring bill' : `Edit ${bill.name}`}
      footer={
        <>
          {!isNew && <Button variant="danger" className="mr-auto" onClick={() => { deleteBill(bill.id); onClose(); }}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!b.name.trim() || b.amountCents <= 0} onClick={() => { upsertBill({ ...b, name: b.name.trim() }); onClose(); toast('Bill saved'); }}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Name" className="sm:col-span-2" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="e.g. Electricity" />
        <MoneyInput label="Amount each time" value={b.amountCents} onChange={(v) => setB({ ...b, amountCents: v ?? 0 })} />
        <Select label="How often" value={b.frequency} onChange={(e) => setB({ ...b, frequency: e.target.value as Frequency })} options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextInput label="Next due" type="date" value={b.nextDate} onChange={(e) => setB({ ...b, nextDate: e.target.value })} />
        <Select label="Type" value={b.kind} onChange={(e) => setB({ ...b, kind: e.target.value as RecurringBill['kind'] })} options={[{ value: 'bill', label: 'Bill' }, { value: 'subscription', label: 'Subscription' }, { value: 'income', label: 'Regular income' }]} />
        <Select label="Category" value={b.categoryId ?? ''} onChange={(e) => setB({ ...b, categoryId: e.target.value || null })} options={options} />
        <Select label="Paid from" value={b.accountId ?? ''} onChange={(e) => setB({ ...b, accountId: e.target.value || null })} options={[{ value: '', label: 'Not specified' }, ...d.accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        <Select label="Whose?" value={b.scope} onChange={(e) => setB({ ...b, scope: e.target.value as RecurringBill['scope'] })} options={[{ value: 'household', label: 'Household' }, { value: 'me', label: d.names.me }, { value: 'partner', label: d.names.partner }]} />
        <TextInput label="Match text (optional)" value={b.matchText ?? ''} onChange={(e) => setB({ ...b, matchText: e.target.value || undefined })} hint="Text that appears in the bank description, used to recognise payments." />
        <div className="sm:col-span-2">
          <Toggle checked={b.active} onChange={(v) => setB({ ...b, active: v })} label="Active" hint="Paused bills are kept but excluded from totals and reminders." />
        </div>
      </div>
    </Modal>
  );
}
