import { useMemo, useState } from 'react';
import { HOLDING_CATEGORIES, categoryMeta, isMortgage, isProperty } from '@/domain/holdingCategories';
import { ownershipFromMe, ownershipPreset, presetOwnership, soleOwner, validateOwnership } from '@/domain/ownership';
import { SUPPORTED_CURRENCIES, formatMoney } from '@/domain/money';
import { isISODate, todayISO } from '@/domain/dates';
import type { Holding, HoldingCategory, HoldingKind, LoanDetails } from '@/domain/types';
import { uid } from '@/lib/id';
import { useApp } from '@/store/store';
import { useDerived } from '@/store/derived';
import { Button, Callout, Field, Modal, MoneyInput, PercentInput, Segmented, Select, TextArea, TextInput, Toggle, toast } from './ui';
import { SourceBadge } from './finance';

export function newHolding(kind: HoldingKind = 'asset'): Holding {
  const now = new Date().toISOString();
  return {
    id: uid('h'),
    kind,
    category: kind === 'asset' ? 'transaction' : 'credit-card',
    name: '',
    ownership: { me: 100, partner: 0 },
    visibility: 'shared',
    currency: 'AUD',
    valueCents: null,
    valuedAt: todayISO(),
    source: 'manual',
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function HoldingForm({ open, initial, onClose }: { open: boolean; initial: Holding; onClose: () => void }) {
  const upsert = useApp((s) => s.upsertHolding);
  const holdings = useApp((s) => s.data.holdings);
  const workspaceKind = useApp((s) => s.data.kind);
  const { names } = useDerived();
  const [h, setH] = useState<Holding>(initial);
  const [touched, setTouched] = useState(false);
  const isNew = !holdings.some((x) => x.id === initial.id);
  const synced = !!h.connectionId;
  const meta = categoryMeta(h.category);
  const preset = ownershipPreset(h.ownership);
  const ownErr = validateOwnership(h.ownership);
  const privateErr = h.visibility === 'private' && !soleOwner(h.ownership) ? 'Only items owned 100% by one person can be private.' : null;
  const nameErr = touched && !h.name.trim() ? 'Give this item a name.' : null;
  const dateErr = h.valueCents !== null && (!h.valuedAt || !isISODate(h.valuedAt)) ? 'Enter the date this value applies to.' : null;
  const loan = h.loan ?? {};
  const setLoan = (patch: Partial<LoanDetails>) => setH({ ...h, loan: { ...loan, ...patch } });

  const categoryOptions = useMemo(
    () => HOLDING_CATEGORIES.filter((c) => c.kind === h.kind).map((c) => ({ value: c.id, label: c.label })),
    [h.kind],
  );
  const offsetCandidates = holdings.filter((x) => x.category === 'offset' || x.category === 'transaction' || x.category === 'savings');
  const properties = holdings.filter((x) => isProperty(x.category));

  const save = () => {
    setTouched(true);
    if (!h.name.trim() || ownErr || privateErr || dateErr) return;
    upsert({ ...h, name: h.name.trim(), source: isNew && workspaceKind === 'demo' ? 'demo' : h.source });
    toast(isNew ? `Added ${h.name}` : `Saved ${h.name}`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Add to balance sheet' : `Edit ${initial.name}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {isNew ? 'Add' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {isNew && (
          <Segmented<HoldingKind>
            ariaLabel="Asset or liability"
            value={h.kind}
            onChange={(k) => setH({ ...h, kind: k, category: k === 'asset' ? 'transaction' : 'credit-card', loan: undefined })}
            options={[
              { value: 'asset', label: 'Asset' },
              { value: 'liability', label: 'Liability' },
            ]}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name" placeholder={h.kind === 'asset' ? 'e.g. Joint offset account' : 'e.g. Home loan'} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} error={nameErr} autoFocus />
          <Select label="Category" value={h.category} onChange={(e) => setH({ ...h, category: e.target.value as HoldingCategory })} options={categoryOptions} />
          <TextInput label="Institution (optional)" value={h.institution ?? ''} onChange={(e) => setH({ ...h, institution: e.target.value })} />
          <TextInput label="Last 4 digits (optional)" hint="For reconciliation only — never enter a full account number." maxLength={4} value={h.maskedNumber ?? ''} onChange={(e) => setH({ ...h, maskedNumber: e.target.value.replace(/\D/g, '') })} />
        </div>

        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-xs font-medium text-ink-2">{h.kind === 'asset' ? 'Ownership' : 'Responsibility for repayment'}</legend>
          <Segmented
            ariaLabel="Owner"
            value={preset}
            onChange={(p) => setH({ ...h, ownership: p === 'custom' ? ownershipFromMe(60) : presetOwnership(p) })}
            options={[
              { value: 'me', label: names.me },
              { value: 'partner', label: names.partner },
              { value: 'joint', label: 'Joint 50/50' },
              { value: 'custom', label: 'Custom split' },
            ]}
          />
          {preset === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <PercentInput label={`${names.me}'s share`} value={h.ownership.me / 100} onChange={(v) => setH({ ...h, ownership: ownershipFromMe(v * 100) })} step={1} />
              <PercentInput label={`${names.partner}'s share`} value={h.ownership.partner / 100} onChange={(v) => setH({ ...h, ownership: ownershipFromMe(100 - v * 100) })} step={1} />
            </div>
          )}
          {ownErr && <p className="mt-2 text-xs text-bad">{ownErr}</p>}
          {h.valueCents !== null && !ownErr && preset !== 'me' && preset !== 'partner' && (
            <p className="mt-3 text-xs text-muted">
              Full value {formatMoney(h.valueCents)} counts once in the household view. Attributed: {names.me} {formatMoney(Math.round((h.valueCents * h.ownership.me) / 100))}, {names.partner} {formatMoney(Math.round((h.valueCents * h.ownership.partner) / 100))}.
            </p>
          )}
          <div className="mt-4">
            <Toggle
              checked={h.visibility === 'private'}
              onChange={(v) => setH({ ...h, visibility: v ? 'private' : 'shared' })}
              label="Private to the owner"
              hint="Hidden from the other partner's views. Its value is only included in household totals if the owner consents in Settings."
            />
            {privateErr && <p className="mt-2 text-xs text-bad">{privateErr}</p>}
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-line p-4">
          <legend className="px-1 text-xs font-medium text-ink-2">{h.kind === 'asset' ? 'Current value' : 'Balance owed'}</legend>
          {synced ? (
            <Callout tone="info" title="Balance synchronised from a bank connection">
              <span className="inline-flex items-center gap-2">Value {formatMoney(h.valueCents, { cents: true })} <SourceBadge source={h.source} /></span>
            </Callout>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyInput label={h.kind === 'asset' ? 'Value' : 'Balance owed'} value={h.valueCents} allowEmpty onChange={(v) => setH({ ...h, valueCents: v })} hint="Leave blank if unknown — it will be flagged, not counted as $0." />
              <TextInput label="Valued on" type="date" value={h.valuedAt ?? ''} max={todayISO()} onChange={(e) => setH({ ...h, valuedAt: e.target.value || null })} error={dateErr} />
              <Select label="Currency" value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value })} options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))} hint={h.currency !== 'AUD' ? 'Converted using the rate in Settings → Currencies.' : undefined} />
            </div>
          )}
          {!isNew && !synced && initial.valueCents !== h.valueCents && <p className="mt-2 text-xs text-muted">The previous value stays in this item's history.</p>}
        </fieldset>

        {h.kind === 'liability' && (
          <fieldset className="rounded-xl border border-line p-4">
            <legend className="px-1 text-xs font-medium text-ink-2">Loan details (optional, used for forecasts and the debt planner)</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <PercentInput label="Interest rate (p.a.)" value={loan.annualRate ?? 0} onChange={(v) => setLoan({ annualRate: v })} step={0.01} />
              <MoneyInput label="Repayment" value={loan.repaymentCents ?? null} allowEmpty onChange={(v) => setLoan({ repaymentCents: v ?? undefined })} />
              <Select label="Repayment frequency" value={loan.repaymentFrequency ?? 'monthly'} onChange={(e) => setLoan({ repaymentFrequency: e.target.value as LoanDetails['repaymentFrequency'] })} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} />
              {meta.group !== 'consumer' && (
                <>
                  <Select label="Repayment type" value={loan.repaymentType ?? 'PI'} onChange={(e) => setLoan({ repaymentType: e.target.value as 'PI' | 'IO' })} options={[{ value: 'PI', label: 'Principal & interest' }, { value: 'IO', label: 'Interest only' }]} />
                  <Select label="Rate type" value={loan.rateType ?? 'variable'} onChange={(e) => setLoan({ rateType: e.target.value as 'variable' | 'fixed' })} options={[{ value: 'variable', label: 'Variable' }, { value: 'fixed', label: 'Fixed' }]} />
                  <TextInput label="Loan end date" type="date" value={loan.maturityDate ?? ''} onChange={(e) => setLoan({ maturityDate: e.target.value || undefined })} />
                </>
              )}
              {meta.group === 'consumer' && <MoneyInput label="Credit limit" value={loan.creditLimitCents ?? null} allowEmpty onChange={(v) => setLoan({ creditLimitCents: v ?? undefined })} />}
            </div>
            {isMortgage(h.category) && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Select label="Secured against" value={loan.securedByHoldingId ?? ''} onChange={(e) => setLoan({ securedByHoldingId: e.target.value || undefined })} options={[{ value: '', label: 'Not linked' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]} />
                <Field label="Offset accounts">
                  <div className="flex flex-wrap gap-2">
                    {offsetCandidates.length === 0 && <span className="text-xs text-muted">Add an offset or savings account first.</span>}
                    {offsetCandidates.map((a) => {
                      const on = loan.offsetAccountIds?.includes(a.id) ?? false;
                      return (
                        <button key={a.id} type="button" aria-pressed={on} onClick={() => setLoan({ offsetAccountIds: on ? loan.offsetAccountIds!.filter((x) => x !== a.id) : [...(loan.offsetAccountIds ?? []), a.id] })} className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-accent bg-accent/10 text-accent' : 'border-line text-ink-2'}`}>
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            )}
          </fieldset>
        )}

        {h.category === 'property-investment' && (
          <MoneyInput label="Rental income per month (optional)" value={h.rentalIncomeMonthlyCents ?? null} allowEmpty onChange={(v) => setH({ ...h, rentalIncomeMonthlyCents: v ?? undefined })} />
        )}

        <TextArea label="Notes" value={h.notes ?? ''} onChange={(e) => setH({ ...h, notes: e.target.value })} rows={2} />
      </div>
    </Modal>
  );
}

export function ValuationForm({ open, holding, onClose }: { open: boolean; holding: Holding; onClose: () => void }) {
  const record = useApp((s) => s.recordValuation);
  const kind = useApp((s) => s.data.kind);
  const [value, setValue] = useState<number | null>(holding.valueCents);
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState<'manual-update' | 'revaluation' | 'correction'>(isProperty(holding.category) ? 'revaluation' : 'manual-update');
  const [note, setNote] = useState('');
  const save = () => {
    if (value === null || !isISODate(date)) return;
    record(holding.id, { date, valueCents: value, source: kind === 'demo' ? 'demo' : 'manual', reason, note: note || undefined });
    toast(`Recorded ${formatMoney(value)} for ${holding.name}`);
    onClose();
  };
  const history = [...holding.history].reverse();
  return (
    <Modal open={open} onClose={onClose} title={`Update ${holding.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={value === null}>Record value</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyInput label={holding.kind === 'asset' ? 'New value' : 'Balance owed'} value={value} onChange={setValue} />
          <TextInput label="Value as at" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} options={[{ value: 'manual-update', label: 'Balance update' }, { value: 'revaluation', label: 'Revaluation (e.g. property, vehicle)' }, { value: 'correction', label: 'Correction of an earlier value' }]} />
          <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bank valuation" />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-2">History & audit trail</h3>
          {history.length ? (
            <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line text-xs">
              {history.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {e.date} <span className="text-muted">· {e.reason.replace('-', ' ')}{e.note ? ` · ${e.note}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <SourceBadge source={e.source} />
                    <span className="num">{formatMoney(e.valueCents, { cents: true })}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No history recorded yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
