import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Upload } from 'lucide-react';
import { applyMapping, guessMapping, parseCsv, toCsv, type CsvMapping } from '@/domain/csv';
import { formatDate } from '@/domain/dates';
import type { ImportOutcome } from '@/domain/transactions';
import type { Transaction } from '@/domain/types';
import { uid } from '@/lib/id';
import { listableTransactions, useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, Select, TextArea, Toggle, cx, toast } from '@/components/ui';
import { Money } from '@/components/finance';
import { useCategoryMap } from './shared';

const MAX_BYTES = 5 * 1024 * 1024;

export function ImportTab() {
  const data = useApp((s) => s.data);
  const addTransactions = useApp((s) => s.addTransactions);
  const d = useDerived();
  const catMap = useCategoryMap();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const parsed = useMemo(() => (mapping && rows.length ? applyMapping(rows, mapping) : []), [rows, mapping]);
  const good = parsed.filter((p) => !p.error);
  const bad = parsed.filter((p) => p.error);
  const columns = (mapping?.hasHeader ? rows[0] : rows[0]?.map((_, i) => `Column ${i + 1}`)) ?? [];
  const colOptions = (allowNone: boolean) => [...(allowNone ? [{ value: '-1', label: 'Not used' }] : []), ...columns.map((c, i) => ({ value: String(i), label: c || `Column ${i + 1}` }))];

  const load = (t: string, name: string | null) => {
    setOutcome(null);
    setError(null);
    setText(t);
    setFileName(name);
    const r = parseCsv(t);
    setMapping(r.length ? guessMapping(r) : null);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError('That file is larger than 5 MB. Export a shorter date range and try again.');
      return;
    }
    load(await f.text(), f.name);
  };

  const doImport = () => {
    if (!good.length) return;
    const batch = uid('imp');
    const now = new Date().toISOString();
    const txns: Transaction[] = good.map((p) => ({
      id: uid('txn'),
      date: p.date!,
      description: p.description,
      amountCents: p.amountCents!,
      currency: 'AUD',
      accountId: accountId || null,
      categoryId: null,
      transfer: 'none',
      tags: [],
      categorisation: { source: 'uncategorised', confidence: 0 },
      source: 'csv',
      importBatchId: batch,
      createdAt: now,
    }));
    const out = addTransactions(txns, `CSV import${fileName ? ` (${fileName})` : ''}`);
    setOutcome(out);
    toast(`${out.added.length} imported · ${out.skipped.length} duplicates skipped`);
  };

  const exportCsv = () => {
    const list = listableTransactions(data);
    const accName = new Map(data.holdings.map((h) => [h.id, h.name]));
    const csv = toCsv([
      ['Date', 'Description', 'Amount', 'Currency', 'Account', 'Category', 'Transfer', 'Source', 'Notes'],
      ...list.map((t) => [t.date, t.description, (t.amountCents / 100).toFixed(2), t.currency, t.accountId ? accName.get(t.accountId) ?? '' : '', t.categoryId ? catMap.get(t.categoryId)?.name ?? '' : '', t.transfer, t.source, t.notes ?? '']),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${d.today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dateRange = good.length ? [good.reduce((a, p) => (p.date! < a ? p.date! : a), good[0].date!), good.reduce((a, p) => (p.date! > a ? p.date! : a), good[0].date!)] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Import a bank CSV" subtitle="Files are read in your browser and never uploaded. Duplicates already in the app are skipped." />
          <div className="space-y-4 p-5">
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <FileUp className="h-6 w-6 text-muted" />
              <div className="text-sm">{fileName ? <span className="font-medium">{fileName}</span> : 'Drop a CSV file here'}</div>
              <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>Choose file</Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <TextArea label="…or paste CSV text" rows={4} value={fileName ? '' : text} placeholder="Date,Description,Amount" onChange={(e) => load(e.target.value, null)} />
            {error && <Callout tone="bad">{error}</Callout>}
            <Select label="Which account is this statement for?" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={[{ value: '', label: 'Not linked to an account' }, ...d.accounts.map((a) => ({ value: a.id, label: a.name }))]} hint="Linking sets ownership (whose money it is) and makes transfer matching and duplicate checks work." />
          </div>
        </Card>

        {mapping && rows.length > 0 && (
          <Card>
            <CardHeader title="Check the columns" subtitle={`${parsed.length} row(s) read · ${good.length} ready · ${bad.length} with problems`} />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Select label="Date" value={String(mapping.date)} onChange={(e) => setMapping({ ...mapping, date: Number(e.target.value) })} options={colOptions(false)} />
              <Select label="Description" value={String(mapping.description)} onChange={(e) => setMapping({ ...mapping, description: Number(e.target.value) })} options={colOptions(false)} />
              <Select label="Amount (signed)" value={String(mapping.amount)} onChange={(e) => setMapping({ ...mapping, amount: Number(e.target.value) })} options={colOptions(true)} hint="Or use separate debit and credit columns." />
              {mapping.amount < 0 && (
                <>
                  <Select label="Debit (money out)" value={String(mapping.debit)} onChange={(e) => setMapping({ ...mapping, debit: Number(e.target.value) })} options={colOptions(true)} />
                  <Select label="Credit (money in)" value={String(mapping.credit)} onChange={(e) => setMapping({ ...mapping, credit: Number(e.target.value) })} options={colOptions(true)} />
                </>
              )}
              <div className="flex flex-col justify-end gap-3 sm:col-span-3 sm:flex-row sm:items-center sm:justify-start sm:gap-8">
                <Toggle checked={mapping.hasHeader} onChange={(v) => setMapping({ ...mapping, hasHeader: v })} label="First row is a header" />
                {mapping.amount >= 0 && <Toggle checked={mapping.invert} onChange={(v) => setMapping({ ...mapping, invert: v })} label="Spending shows as positive" hint="Flip signs so money out is negative." />}
              </div>
            </div>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Line</th>
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-5 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 12).map((p) => (
                    <tr key={p.line} className={cx('border-t border-line/60', p.error && 'bg-bad/5')}>
                      <td className="num px-5 py-2 text-muted">{p.line}</td>
                      <td className="num px-2 py-2">{p.date ? formatDate(p.date, 'short') : '—'}</td>
                      <td className="max-w-[18rem] truncate px-2 py-2">{p.description || '—'} {p.error && <Badge tone="bad">{p.error}</Badge>}</td>
                      <td className="px-5 py-2 text-right">{p.amountCents !== null ? <Money cents={p.amountCents} showCents signed /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.length > 12 && <div className="px-5 py-2 text-xs text-muted">…and {parsed.length - 12} more row(s)</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
              <div className="text-xs text-muted">
                {dateRange && `${formatDate(dateRange[0], 'medium')} – ${formatDate(dateRange[1], 'medium')}. `}
                {bad.length > 0 && `${bad.length} row(s) with problems will be skipped.`}
              </div>
              <Button variant="primary" disabled={!good.length} onClick={doImport}>Import {good.length} transaction(s)</Button>
            </div>
          </Card>
        )}

        {outcome && (
          <Callout tone={outcome.flagged.length ? 'warn' : 'good'} title="Import complete">
            {outcome.added.length} added, {outcome.skipped.length} exact duplicate(s) skipped
            {outcome.flagged.length > 0 && `, ${outcome.flagged.length} flagged as possible duplicates — review them under Reconcile`}. Rules categorised {outcome.added.filter((t) => t.categoryId).length} of the new transactions.
          </Callout>
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Tips</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-ink-2">
            <li>Export from internet banking as CSV. Most Australian banks work without changes.</li>
            <li>Dates are read day-first (31/10/2026), as Australian banks export them.</li>
            <li>Import each account separately and link it, so transfers between accounts can be matched.</li>
            <li>Re-importing an overlapping date range is safe: exact duplicates are skipped.</li>
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Export</h3>
          <p className="mt-1 text-sm text-ink-2">Download the transactions you can see as CSV. The full backup (everything, as JSON) is in Settings.</p>
          <Button className="mt-3" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export transactions CSV</Button>
        </Card>
      </div>
    </div>
  );
}
