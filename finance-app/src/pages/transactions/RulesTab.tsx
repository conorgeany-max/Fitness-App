import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Wand2 } from 'lucide-react';
import { BUILTIN_RULES } from '@/domain/categories';
import { ruleMatches } from '@/domain/transactions';
import type { CategoryRule, RuleOp, TransferKind } from '@/domain/types';
import { uid } from '@/lib/id';
import { listableTransactions } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, Disclosure, EmptyState, Modal, MoneyInput, NumberInput, Select, TextInput, Toggle, toast } from '@/components/ui';
import { CategoryDot, useCategoryMap, useCategoryOptions } from './shared';

const OP_LABEL: Record<RuleOp, string> = { contains: 'contains', startsWith: 'starts with', equals: 'equals', regex: 'matches pattern' };

export function RulesTab() {
  const rules = useApp((s) => s.data.rules);
  const upsertRule = useApp((s) => s.upsertRule);
  const reapplyRules = useApp((s) => s.reapplyRules);
  const catMap = useCategoryMap();
  const [draft, setDraft] = useState<CategoryRule | null>(null);
  const sorted = [...rules].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const blank = (): CategoryRule => ({ id: uid('rule'), name: '', field: 'description', op: 'contains', value: '', setCategoryId: '', priority: 100, enabled: true, createdAt: new Date().toISOString() });

  return (
    <div className="space-y-4">
      <Callout tone="info" title="How categorisation works">
        Your own rules run first (highest priority wins), then the built-in keyword rules. A category you set by hand is never overwritten. Uncategorised spending still counts as spending, so totals stay honest while you tidy up.
      </Callout>
      <Card>
        <CardHeader
          title="Your rules"
          subtitle={`${rules.length} rule(s)`}
          action={
            <div className="flex gap-2">
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => toast(`${reapplyRules()} transaction(s) recategorised`)}>Re-apply all</Button>
              <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDraft(blank())}>Add rule</Button>
            </div>
          }
        />
        {sorted.length === 0 ? (
          <EmptyState icon={<Wand2 className="h-5 w-5" />} title="No rules yet">Change a transaction's category and you'll be offered a rule, or add one here.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {sorted.map((r) => {
              const cat = catMap.get(r.setCategoryId);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDraft(r)}>
                    <div className="font-medium hover:text-accent">{r.name || `${r.field} ${OP_LABEL[r.op]} “${r.value}”`}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      If {r.field} {OP_LABEL[r.op]} “{r.value}”{r.direction ? ` and money ${r.direction}` : ''} → <CategoryDot color={cat?.color} /> {cat?.name ?? 'Unknown category'}
                      {r.setTransfer && r.setTransfer !== 'none' ? ` · mark as ${r.setTransfer === 'internal' ? 'transfer' : 'partner transfer'}` : ''}
                    </div>
                  </button>
                  <Badge tone="neutral">{r.matchCount ?? 0} match{(r.matchCount ?? 0) === 1 ? '' : 'es'}</Badge>
                  <span className="text-xs text-muted">Priority {r.priority}</span>
                  <Toggle checked={r.enabled} onChange={(v) => upsertRule({ ...r, enabled: v }, true)} label={<span className="sr-only">Enabled</span>} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Disclosure summary={`Built-in keyword rules (${BUILTIN_RULES.length})`}>
        <ul className="grid gap-x-6 gap-y-1 px-4 pb-4 text-xs text-ink-2 sm:grid-cols-2 lg:grid-cols-3">
          {BUILTIN_RULES.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <CategoryDot color={catMap.get(r.setCategoryId)?.color} />
              <span className="font-mono">{r.value}</span>
              <span className="text-muted">→ {catMap.get(r.setCategoryId)?.name}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
      {draft && <RuleModal key={draft.id} rule={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function RuleModal({ rule, onClose }: { rule: CategoryRule; onClose: () => void }) {
  const data = useApp((s) => s.data);
  const upsertRule = useApp((s) => s.upsertRule);
  const deleteRule = useApp((s) => s.deleteRule);
  const options = useCategoryOptions({ includeNone: false });
  const [r, setR] = useState(rule);
  const isNew = !data.rules.some((x) => x.id === rule.id);
  let regexError: string | null = null;
  if (r.op === 'regex' && r.value) {
    try {
      new RegExp(r.value, 'i');
    } catch {
      regexError = 'Not a valid pattern';
    }
  }
  const preview = useMemo(() => (r.value && !regexError ? listableTransactions(data).filter((t) => ruleMatches({ ...r, enabled: true }, t)) : []), [data, r, regexError]);
  const valid = r.value.trim() && r.setCategoryId && !regexError;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Add a rule' : 'Edit rule'}
      footer={
        <>
          {!isNew && <Button variant="danger" className="mr-auto" onClick={() => { deleteRule(rule.id); onClose(); toast('Rule deleted — existing categories are kept'); }}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={() => { const n = upsertRule({ ...r, value: r.value.trim(), name: r.name.trim() }, true); toast(`Rule saved · ${n} transaction(s) recategorised`); onClose(); }}>Save & apply</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Name (optional)" className="sm:col-span-2" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        <Select label="Look at" value={r.field} onChange={(e) => setR({ ...r, field: e.target.value as CategoryRule['field'] })} options={[{ value: 'description', label: 'Description' }, { value: 'merchant', label: 'Merchant' }]} />
        <Select label="Condition" value={r.op} onChange={(e) => setR({ ...r, op: e.target.value as RuleOp })} options={Object.entries(OP_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextInput label="Text" className="sm:col-span-2" value={r.value} onChange={(e) => setR({ ...r, value: e.target.value })} error={regexError} hint="Case doesn't matter. Words are matched whole for 'contains'." />
        <Select label="Direction" value={r.direction ?? ''} onChange={(e) => setR({ ...r, direction: (e.target.value || undefined) as CategoryRule['direction'] })} options={[{ value: '', label: 'Money in or out' }, { value: 'out', label: 'Money out only' }, { value: 'in', label: 'Money in only' }]} />
        <Select label="Account" value={r.accountId ?? ''} onChange={(e) => setR({ ...r, accountId: e.target.value || undefined })} options={[{ value: '', label: 'Any account' }, ...data.holdings.filter((h) => !h.archived).map((h) => ({ value: h.id, label: h.name }))]} />
        <MoneyInput label="Minimum amount" value={r.minAmountCents ?? null} allowEmpty onChange={(v) => setR({ ...r, minAmountCents: v ?? undefined })} />
        <MoneyInput label="Maximum amount" value={r.maxAmountCents ?? null} allowEmpty onChange={(v) => setR({ ...r, maxAmountCents: v ?? undefined })} />
        <Select label="Set category to" value={r.setCategoryId} onChange={(e) => setR({ ...r, setCategoryId: e.target.value })} options={[{ value: '', label: 'Choose…' }, ...options]} />
        <Select label="Transfer status" value={r.setTransfer ?? ''} onChange={(e) => setR({ ...r, setTransfer: (e.target.value || undefined) as TransferKind | undefined })} options={[{ value: '', label: 'Leave unchanged' }, { value: 'internal', label: 'Transfer between own accounts' }, { value: 'between-partners', label: 'Transfer between partners' }]} />
        <NumberInput label="Priority" value={r.priority} onChange={(v) => setR({ ...r, priority: v })} hint="Higher runs first." />
      </div>
      <div className="mt-5 rounded-xl border border-line bg-surface-2/40 p-3 text-sm">
        <div className="font-medium">Preview: {preview.length} matching transaction(s)</div>
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-ink-2">
          {preview.slice(0, 30).map((t) => (
            <li key={t.id} className="flex justify-between gap-3">
              <span className="truncate">{t.date} · {t.description}</span>
              <span className="num shrink-0">{(t.amountCents / 100).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        {preview.some((t) => t.categorisation.source === 'manual') && <p className="mt-2 text-xs text-muted">Transactions you categorised by hand keep their category.</p>}
      </div>
    </Modal>
  );
}
