import { useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { formatDate, formatMonthKey, monthKey, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { ownershipLabel } from '@/domain/ownership';
import { normaliseDescription, perspectiveAmount, suggestRule } from '@/domain/transactions';
import type { CategoryRule, Transaction, TransferKind } from '@/domain/types';
import { uid } from '@/lib/id';
import { listableTransactions, useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, EmptyState, Modal, MoneyInput, Select, TextInput, cx, toast } from '@/components/ui';
import { Money, SourceBadge } from '@/components/finance';
import { CategoryDot, TransferBadge, useAccountMap, useCategoryMap, useCategoryOptions } from './shared';

type Kind = 'all' | 'in' | 'out' | 'transfers' | 'uncategorised' | 'review';
const PAGE = 50;

export function TransactionList({ initialFilter }: { initialFilter?: Kind }) {
  const data = useApp((s) => s.data);
  const updateTransactions = useApp((s) => s.updateTransactions);
  const deleteTransactions = useApp((s) => s.deleteTransactions);
  const upsertRule = useApp((s) => s.upsertRule);
  const d = useDerived();
  const perspective = usePerspective();
  const accounts = useAccountMap();
  const catMap = useCategoryMap();
  const catOptions = useCategoryOptions();

  const [q, setQ] = useState('');
  const [month, setMonth] = useState<string>('all');
  const [category, setCategory] = useState('all');
  const [account, setAccount] = useState('all');
  const [kind, setKind] = useState<Kind>(initialFilter ?? 'all');
  const [sort, setSort] = useState<'date' | 'amount'>('date');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ruleOffer, setRuleOffer] = useState<{ t: Transaction; categoryId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const all = useMemo(() => listableTransactions(data), [data]);
  const hiddenCount = data.transactions.length - all.length;
  const months = useMemo(() => [...new Set(all.map((t) => monthKey(t.date)))].sort().reverse(), [all]);

  const rows = useMemo(() => {
    const needle = normaliseDescription(q);
    const list = all.filter((t) => {
      if (perspective !== 'household' && perspectiveAmount(t, perspective, accounts) === 0) return false;
      if (month !== 'all' && monthKey(t.date) !== month) return false;
      if (account !== 'all' && t.accountId !== account) return false;
      if (category === '__none' ? t.categoryId !== null : category !== 'all' && t.categoryId !== category) return false;
      if (kind === 'in' && (t.amountCents <= 0 || t.transfer !== 'none')) return false;
      if (kind === 'out' && (t.amountCents >= 0 || t.transfer !== 'none')) return false;
      if (kind === 'transfers' && t.transfer === 'none') return false;
      if (kind === 'uncategorised' && (t.categoryId || t.transfer !== 'none' || t.excluded)) return false;
      if (kind === 'review' && !t.possibleDuplicateOf) return false;
      if (needle && !normaliseDescription(`${t.description} ${t.merchant ?? ''} ${t.notes ?? ''}`).includes(needle)) return false;
      return true;
    });
    if (sort === 'amount') list.sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    else list.sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
    return list;
  }, [all, q, month, account, category, kind, sort, perspective, accounts]);

  const shown = rows.slice(0, limit);
  const totals = useMemo(() => {
    let inC = 0;
    let outC = 0;
    for (const t of rows) {
      if (t.excluded || t.transfer !== 'none') continue;
      const a = perspective === 'household' ? t.amountCents : perspectiveAmount(t, perspective, accounts);
      if (a > 0) inC += a;
      else outC += a;
    }
    return { inC, outC };
  }, [rows, perspective, accounts]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const allShownSelected = shown.length > 0 && shown.every((t) => selected.has(t.id));

  const setCategoryFor = (t: Transaction, categoryId: string) => {
    updateTransactions([t.id], { categoryId: categoryId || null, categorisation: { source: 'manual', confidence: 1 } });
    if (categoryId) {
      const similar = all.filter((x) => x.id !== t.id && x.categorisation.source !== 'manual' && x.categoryId !== categoryId && suggestRule(x, categoryId).value === suggestRule(t, categoryId).value);
      const covered = data.rules.some((r) => r.enabled && r.setCategoryId === categoryId && suggestRule(t, categoryId).value.includes(r.value.toUpperCase()));
      if (!covered) setRuleOffer({ t, categoryId });
      if (similar.length) toast(`${similar.length} similar transaction(s) could use this category — create a rule to apply it`, 'info');
    }
  };

  const createRule = () => {
    if (!ruleOffer) return;
    const s = suggestRule(ruleOffer.t, ruleOffer.categoryId);
    const rule: CategoryRule = { id: uid('rule'), ...s, priority: 100, enabled: true, createdAt: new Date().toISOString() };
    const changed = upsertRule(rule, true);
    toast(`Rule created · ${changed} transaction(s) recategorised`);
    setRuleOffer(null);
  };

  const bulk = (patch: Partial<Transaction>, label: string) => {
    updateTransactions([...selected], patch);
    toast(`${label} · ${selected.size} transaction(s)`);
    setSelected(new Set());
  };

  const accountOptions = [{ value: 'all', label: 'All accounts' }, ...d.accounts.filter((a) => all.some((t) => t.accountId === a.id)).map((a) => ({ value: a.id, label: a.name }))];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted">Money in (excl. transfers)</div>
          <Money cents={totals.inC} className="mt-1 block text-xl font-semibold text-good" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Money out (excl. transfers)</div>
          <Money cents={-totals.outC} className="mt-1 block text-xl font-semibold" />
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Net</div>
          <Money cents={totals.inC + totals.outC} signed tone="auto" className="mt-1 block text-xl font-semibold" />
        </Card>
      </div>

      {hiddenCount > 0 && (
        <Callout tone="info">
          {hiddenCount} transaction(s) in your partner's private accounts aren't listed. If your partner shares totals, those accounts still count towards household figures; otherwise they're left out entirely.
        </Callout>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput aria-label="Search transactions" placeholder="Search description, merchant or note" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} className="pl-8" />
          </div>
          <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} options={[{ value: 'all', label: 'All months' }, ...months.map((m) => ({ value: m, label: formatMonthKey(m) }))]} className="w-36" />
          <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} options={accountOptions} className="w-44" />
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: 'all', label: 'All categories' }, { value: '__none', label: 'Uncategorised' }, ...catOptions.slice(1)]} className="w-44" />
          <Select
            aria-label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'in', label: 'Money in' },
              { value: 'out', label: 'Money out' },
              { value: 'transfers', label: 'Transfers' },
              { value: 'uncategorised', label: 'Needs a category' },
              { value: 'review', label: 'Possible duplicates' },
            ]}
            className="w-40"
          />
          <Button variant="ghost" icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setSort(sort === 'date' ? 'amount' : 'date')} aria-label="Change sort">
            {sort === 'date' ? 'Newest' : 'Largest'}
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        </div>

        {ruleOffer && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent/5 px-4 py-2.5 text-sm">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="min-w-0 flex-1">
              Always categorise transactions containing <strong className="font-medium">“{suggestRule(ruleOffer.t, ruleOffer.categoryId).value}”</strong> as <strong className="font-medium">{catMap.get(ruleOffer.categoryId)?.name}</strong>?
            </span>
            <Button size="sm" variant="subtle" onClick={createRule}>Create rule</Button>
            <Button size="sm" variant="ghost" onClick={() => setRuleOffer(null)} aria-label="Dismiss"><X className="h-4 w-4" /></Button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <Select aria-label="Set category" value="" onChange={(e) => e.target.value && bulk({ categoryId: e.target.value, categorisation: { source: 'manual', confidence: 1 } }, 'Category set')} options={[{ value: '', label: 'Set category…' }, ...catOptions.slice(1)]} className="w-44" />
            <Select
              aria-label="Mark as transfer"
              value=""
              onChange={(e) => e.target.value && bulk({ transfer: e.target.value as TransferKind }, 'Transfer status updated')}
              options={[
                { value: '', label: 'Transfer status…' },
                { value: 'internal', label: 'Transfer between own accounts' },
                { value: 'between-partners', label: 'Transfer between partners' },
                { value: 'none', label: 'Not a transfer' },
              ]}
              className="w-48"
            />
            <Button size="sm" onClick={() => bulk({ excluded: true }, 'Excluded from reports')}>Exclude</Button>
            <Button size="sm" onClick={() => bulk({ excluded: false, possibleDuplicateOf: undefined }, 'Included in reports')}>Include</Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState title={all.length ? 'No transactions match' : 'No transactions yet'}>
            {all.length ? 'Try clearing a filter.' : 'Import a CSV from your bank, connect a sandbox bank, or add one manually.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="w-10 px-4 py-2">
                    <input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((t) => t.id)))} className="accent-[rgb(var(--accent))]" />
                  </th>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const acc = t.accountId ? accounts.get(t.accountId) : undefined;
                  const cat = t.categoryId ? catMap.get(t.categoryId) : undefined;
                  const amount = perspective === 'household' ? t.amountCents : perspectiveAmount(t, perspective, accounts);
                  return (
                    <tr key={t.id} className={cx('border-b border-line/60 align-top hover:bg-surface-2/40', t.excluded && 'opacity-50', selected.has(t.id) && 'bg-accent/5')}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" aria-label={`Select ${t.description}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-[rgb(var(--accent))]" />
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2.5 text-ink-2">{formatDate(t.date, 'short')}</td>
                      <td className="max-w-[22rem] px-2 py-2.5">
                        <div className="truncate font-medium text-ink" title={t.description}>{t.merchant ?? t.description}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {t.merchant && <span className="truncate">{t.description}</span>}
                          {acc && <span>{acc.name} · {ownershipLabel(acc.ownership, d.names)}</span>}
                          <TransferBadge t={t} />
                          {t.possibleDuplicateOf && <Badge tone="warn" title="Same account and amount within 3 days of another transaction">Possible duplicate</Badge>}
                          {t.excluded && <Badge tone="neutral">Excluded</Badge>}
                          {t.pending && <Badge tone="info">Pending</Badge>}
                          {t.source !== 'manual' && <SourceBadge source={t.source} />}
                          {t.categorisation.source === 'rule' || t.categorisation.source === 'builtin-rule' ? <span title="Categorised by a rule">· auto</span> : null}
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <CategoryDot color={cat?.color} />
                          <Select aria-label="Category" value={t.categoryId ?? ''} onChange={(e) => setCategoryFor(t, e.target.value)} options={t.transfer !== 'none' ? [{ value: '', label: 'Transfer · no category needed' }, ...catOptions.slice(1)] : catOptions} className={cx('w-44', !t.categoryId && t.transfer === 'none' && '[&_select]:text-warn')} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <Money cents={amount} showCents signed className={cx('font-medium', amount > 0 && t.transfer === 'none' ? 'text-good' : 'text-ink')} />
                        {perspective !== 'household' && amount !== t.amountCents && <div className="num text-2xs text-muted">of {formatMoney(t.amountCents, { cents: true })}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && (
          <div className="flex items-center justify-center gap-3 p-3 text-sm text-muted">
            Showing {limit} of {rows.length}
            <Button size="sm" onClick={() => setLimit(limit + PAGE * 2)}>Show more</Button>
          </div>
        )}
      </Card>

      <AddTransactionModal open={adding} onClose={() => setAdding(false)} />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selected.size} transaction(s)?`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { deleteTransactions([...selected]); toast(`Deleted ${selected.size} transaction(s)`); setSelected(new Set()); setConfirmDelete(false); }}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">This can't be undone. To keep a record but leave it out of totals, choose <strong>Exclude</strong> instead. Synced transactions may reappear on the next sync.</p>
      </Modal>
    </div>
  );
}

function AddTransactionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const d = useDerived();
  const addTransactions = useApp((s) => s.addTransactions);
  const activeUser = useApp((s) => s.data.settings.activeUser);
  const catOptions = useCategoryOptions();
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const valid = !!date && description.trim() && amount !== null && amount > 0;

  const save = () => {
    if (!valid || amount === null) return;
    const t: Transaction = {
      id: uid('txn'),
      date,
      description: description.trim(),
      amountCents: direction === 'out' ? -Math.abs(amount) : Math.abs(amount),
      currency: 'AUD',
      accountId: accountId || null,
      categoryId: categoryId || null,
      transfer: 'none',
      tags: [],
      notes: notes.trim() || undefined,
      categorisation: categoryId ? { source: 'manual', confidence: 1 } : { source: 'uncategorised', confidence: 0 },
      source: 'manual',
      createdAt: new Date().toISOString(),
    };
    const out = addTransactions([t], `Manual entry by ${activeUser}`);
    toast(out.flagged.length ? 'Added — flagged as a possible duplicate for review' : out.added.length ? 'Transaction added' : 'Skipped: identical transaction already exists', out.added.length ? 'good' : 'info');
    setDescription('');
    setAmount(null);
    setNotes('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a transaction"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>Add transaction</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} />
        <TextInput label="Description" className="sm:col-span-2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Farmers market" />
        <MoneyInput label="Amount" value={amount} onChange={setAmount} allowEmpty />
        <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={[{ value: '', label: 'No account (cash)' }, ...d.accounts.map((a) => ({ value: a.id, label: a.name }))]} hint="Ownership follows the account." />
        <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={catOptions} hint="Leave blank to let your rules decide." />
        <TextInput label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
