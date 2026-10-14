/**
 * Records a super balance from a statement PDF. The PDF is read in the browser and never
 * uploaded; the person confirms the balance and date before anything is saved.
 */
import { useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { findBalanceCandidates, findFundName, findStatementDate, type BalanceCandidate } from '@/domain/statement';
import type { Holding } from '@/domain/types';
import { pdfText } from '@/lib/pdfText';
import { useApp } from '@/store/store';
import { Button, Callout, Modal, MoneyInput, Segmented, Select, TextInput, toast } from './ui';
import { newHolding } from './HoldingForm';

const MAX_BYTES = 15 * 1024 * 1024;
const NEW = '__new__';

export function StatementUpload() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<FileText className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Super statement
      </Button>
      {open && <StatementDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function StatementDialog({ onClose }: { onClose: () => void }) {
  const holdings = useApp((s) => s.data.holdings);
  const active = useApp((s) => s.data.settings.activeUser);
  const upsertHolding = useApp((s) => s.upsertHolding);
  const recordValuation = useApp((s) => s.recordValuation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BalanceCandidate[] | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [fund, setFund] = useState('');
  const [target, setTarget] = useState<string>(NEW);
  const [visibility, setVisibility] = useState<'shared' | 'private'>('shared');

  const supers = useMemo(() => holdings.filter((h) => h.category === 'super' && !h.archived && !h.summaryOf && !h.connectionId), [holdings]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setCandidates(null);
    if (file.size > MAX_BYTES) return setError('That file is over 15 MB. Statements are usually much smaller; check it is the right file.');
    if (file.type && file.type !== 'application/pdf') return setError('Choose a PDF statement.');
    setReading(true);
    setFileName(file.name);
    try {
      const text = await pdfText(file);
      if (text.replace(/\s/g, '').length < 40) {
        setError("This PDF has no readable text (it may be a scan). Enter the balance yourself below.");
        setCandidates([]);
        return;
      }
      const found = findBalanceCandidates(text);
      setCandidates(found);
      setValue(found[0]?.valueCents ?? null);
      setDate(found[0]?.date ?? findStatementDate(text) ?? todayISO());
      const name = findFundName(text);
      if (name) setFund(name);
      const match = name ? supers.find((h) => h.name.toLowerCase().includes(name.toLowerCase())) : undefined;
      setTarget(match?.id ?? supers.find((h) => h.ownership[active] === 100)?.id ?? NEW);
      if (!found.length) setError("Couldn't find a labelled balance in this statement. Enter it yourself below.");
    } catch {
      setError("Couldn't read this PDF. If it is password protected, save an unprotected copy, or enter the balance yourself.");
      setCandidates([]);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = () => {
    if (value === null || value <= 0) return;
    const note = fileName ? `From statement ${fileName}` : 'From statement';
    if (target === NEW) {
      const h: Holding = {
        ...newHolding('asset'),
        category: 'super',
        name: fund.trim() || 'Super',
        institution: fund.trim() || undefined,
        ownership: active === 'me' ? { me: 100, partner: 0 } : { me: 0, partner: 100 },
        visibility,
        valueCents: value,
        valuedAt: date,
        source: 'statement',
      };
      upsertHolding(h, note);
    } else {
      recordValuation(target, { date, valueCents: value, source: 'statement', reason: 'revaluation', note });
    }
    toast(`Recorded ${formatMoney(value)} as at ${date}`);
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Record a super balance from a statement"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={value === null || value <= 0 || !date || candidates === null} onClick={save}>
            Save balance
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">Choose your latest statement PDF (or a balance screenshot saved as PDF from your fund's app). It is read on this device and not uploaded. Only the balance you confirm is saved.</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => fileRef.current?.click()} disabled={reading}>
            {reading ? 'Reading…' : fileName ? 'Choose another file' : 'Choose PDF'}
          </Button>
          {fileName && <span className="truncate text-muted">{fileName}</span>}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
        </div>
        {error && <Callout tone="warn">{error}</Callout>}

        {candidates !== null && (
          <>
            {candidates.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="mb-1 font-medium">Balances found. Pick the right one.</legend>
                {candidates.map((c) => (
                  <label key={c.valueCents} className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 hover:bg-surface-2">
                    <input type="radio" name="balance" checked={value === c.valueCents} onChange={() => {
                      setValue(c.valueCents);
                      if (c.date) setDate(c.date);
                    }} />
                    <span>
                      <span className="font-medium">{formatMoney(c.valueCents)}</span> <span className="text-muted">({c.label}{c.date ? `, ${c.date}` : ''})</span>
                      <span className="mt-1 block text-xs text-muted">"…{c.context}…"</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput label="Balance" value={value} onChange={setValue} hint="Change it if the statement says something different." />
              <TextInput label="Balance date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Select
              label="Super account"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              options={[...supers.map((h) => ({ value: h.id, label: h.name })), { value: NEW, label: 'Add as a new super account' }]}
            />
            {target === NEW && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Fund name" value={fund} onChange={(e) => setFund(e.target.value)} placeholder="e.g. AustralianSuper" />
                <div>
                  <p className="mb-1 font-medium">Who can see it</p>
                  <Segmented ariaLabel="Visibility" value={visibility} onChange={setVisibility} options={[{ value: 'shared', label: 'Shared' }, { value: 'private', label: 'Private to me' }]} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
