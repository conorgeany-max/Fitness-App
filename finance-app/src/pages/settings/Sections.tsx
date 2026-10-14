import { useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Lock, Trash2, Upload } from 'lucide-react';
import { formatDate, todayISO } from '@/domain/dates';
import { SUPPORTED_DUTY_STATES, estimateStampDuty } from '@/domain/property/stampDuty';
import { TAX_RULESETS } from '@/domain/tax/rulesets';
import type { AustralianState, PersonId, Residency, Settings, WorkspaceData } from '@/domain/types';
import { buildDemoWorkspace } from '@/store/demo';
import * as db from '@/store/persistence';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, Modal, NumberInput, Segmented, Select, TextInput, Toggle, cx, toast } from '@/components/ui';
import { api } from './api';
import { CloudDeleteAccount } from './Cloud';

const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const PEOPLE: PersonId[] = ['me', 'partner'];
const RESIDENCY = [
  { value: 'unknown', label: 'Not sure yet' },
  { value: 'resident', label: 'Australian resident for tax' },
  { value: 'non-resident', label: 'Foreign resident for tax' },
];

// ---------------------------------------------------------------- Profiles
export function Profiles() {
  const data = useApp((s) => s.data);
  const mutate = useApp((s) => s.mutate);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {PEOPLE.map((id) => {
        const p = data.people[id];
        return (
          <Card key={id} className="p-5">
            <h2 className="mb-3 text-sm font-semibold">{id === 'me' ? 'Partner 1' : 'Partner 2'}</h2>
            <div className="space-y-3">
              <TextInput label="Name" value={p.name} maxLength={40} onChange={(e) => mutate((d) => void (d.people[id].name = e.target.value))} onBlur={(e) => !e.target.value.trim() && mutate((d) => void (d.people[id].name = id === 'me' ? 'Me' : 'Partner'))} />
              <Select label="Tax residency" value={p.income.residency} options={RESIDENCY} onChange={(e) => mutate((d) => void (d.people[id].income.residency = e.target.value as Residency))} />
              <TextInput label="Date of birth (optional)" type="date" value={p.dateOfBirth ?? ''} max={todayISO()} hint="Used for retirement projections only." onChange={(e) => mutate((d) => void (d.people[id].dateOfBirth = e.target.value || undefined))} />
            </div>
          </Card>
        );
      })}
      <Card className="p-5 lg:col-span-2">
        <Select
          label="State you live in"
          hint="Used for stamp duty and as the default for property analysis."
          value={data.settings.stateOfResidence}
          options={STATES.map((s) => ({ value: s, label: s }))}
          onChange={(e) => mutate((d) => void (d.settings.stateOfResidence = e.target.value as AustralianState))}
        />
        <p className="mt-3 text-xs text-muted">Salaries, super and HELP are edited per person under Forecasts, Income &amp; tax.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Privacy
export function Privacy() {
  const data = useApp((s) => s.data);
  const update = useApp((s) => s.updateSettings);
  const { settings, people } = data;
  const active = settings.activeUser;
  const counts = useMemo(() => {
    const c: Record<PersonId, number> = { me: 0, partner: 0 };
    for (const h of data.holdings) if (h.visibility === 'private' && !h.archived) for (const p of PEOPLE) if (h.ownership[p] === 100) c[p]++;
    return c;
  }, [data.holdings]);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Who is using the app?</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Private items are shown in full only to their owner. Switch when the other partner takes over this device.</p>
        <Segmented ariaLabel="Active user" value={active} onChange={(v) => update({ activeUser: v })} options={PEOPLE.map((p) => ({ value: p, label: people[p].name }))} />
        <div className="mt-4">
          <Callout tone="info" title="A display control, not a lock">
            On a shared device both partners can switch here, so this keeps private items out of view rather than securing them. For real separation, use separate browser profiles or deploy behind a sign-in provider (see docs/SECURITY.md).
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sharing totals of private items" subtitle="Each person decides for their own private accounts. Only the owner can change their setting." />
        <div className="divide-y divide-line px-5 pb-2">
          {PEOPLE.map((p) => (
            <div key={p} className="py-3">
              <Toggle
                checked={settings.shareTotalsOfPrivateItems[p]}
                disabled={p !== active}
                onChange={(v) => update({ shareTotalsOfPrivateItems: { ...settings.shareTotalsOfPrivateItems, [p]: v } })}
                label={`${people[p].name}: include private items in household totals`}
                hint={
                  p === active
                    ? `${counts[p]} private item${counts[p] === 1 ? '' : 's'}. When on, your partner sees them only inside totals, never itemised. When off, they are left out of totals your partner sees.`
                    : `Only ${people[p].name} can change this while they are using the app.`
                }
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Data
function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function looksLikeWorkspace(x: unknown): x is WorkspaceData {
  if (!x || typeof x !== 'object') return false;
  const w = x as Partial<WorkspaceData>;
  return typeof w.schemaVersion === 'number' && !!w.people && Array.isArray(w.holdings) && Array.isArray(w.transactions) && !!w.settings;
}

export function DataTab() {
  const data = useApp((s) => s.data);
  const replaceWorkspace = useApp((s) => s.replaceWorkspace);
  const switchWorkspace = useApp((s) => s.switchWorkspace);
  const deleteAllData = useApp((s) => s.deleteAllData);
  const cloud = useApp((s) => s.mode === 'cloud');
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ ws: WorkspaceData; name: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const exportJson = () => {
    download(`household-finance-${data.kind}-${todayISO()}.json`, JSON.stringify(data, null, 2));
    toast('Backup downloaded. It is not encrypted, so store it somewhere safe.', 'info');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!looksLikeWorkspace(parsed)) throw new Error('This file is not a backup from this app.');
      setPending({ ws: parsed, name: f.name });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the file', 'bad');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const deleteEverything = async () => {
    setBusy(true);
    // Withdraw consent for every connection first (best effort), then wipe local storage.
    await Promise.allSettled(data.connections.map((c) => api.revoke(c.id)));
    await deleteAllData();
    setBusy(false);
    setDeleteOpen(false);
    window.location.assign('/welcome');
  };

  const resetDemo = async () => {
    await switchWorkspace('real');
    await db.deleteWorkspace('demo');
    await switchWorkspace('demo', () => buildDemoWorkspace());
    toast('Demo data reset');
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Back up and restore</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          A backup holds everything in the {data.kind === 'demo' ? 'demo' : 'real'} workspace: accounts, history, transactions, budgets, forecasts and settings. Transactions can also be exported as CSV from Transactions, Import.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson}>
            <Download className="h-4 w-4" /> Export backup (JSON)
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Restore from backup
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </Card>

      {!cloud && (
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Demo workspace</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Fictional data kept apart from your real workspace. Nothing you do in one affects the other.</p>
        <div className="flex flex-wrap gap-2">
          {data.kind === 'demo' ? (
            <>
              <Button onClick={() => switchWorkspace('real')}>Exit demo</Button>
              <Button variant="ghost" onClick={resetDemo}>
                Reset demo data
              </Button>
            </>
          ) : (
            <Button onClick={() => switchWorkspace('demo', () => buildDemoWorkspace())}>Open demo workspace</Button>
          )}
        </div>
      </Card>
      )}

      {cloud ? (
        <CloudDeleteAccount />
      ) : (
      <Card className="border-bad/40 p-5">
        <h2 className="text-sm font-semibold text-bad">Delete everything</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Removes both workspaces and the encryption settings from this browser and withdraws consent for every bank connection. This cannot be undone; export a backup first if you might need it.</p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" /> Delete all data
        </Button>
      </Card>
      )}

      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title="Restore this backup?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  replaceWorkspace(pending.ws, `Restored from ${pending.name}`);
                  setPending(null);
                  toast('Backup restored');
                }}
              >
                Replace current data
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-2">
            {pending.name} has {pending.ws.holdings.length} accounts and assets and {pending.ws.transactions.length} transactions. It will replace everything in the current {data.kind} workspace.
          </p>
          {pending.ws.kind !== data.kind && (
            <div className="mt-3">
              <Callout tone="warn">This backup came from the {pending.ws.kind} workspace and will be loaded into the {data.kind} workspace.</Callout>
            </div>
          )}
        </Modal>
      )}

      {deleteOpen && (
        <Modal
          open
          onClose={() => setDeleteOpen(false)}
          title="Delete all data?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={confirmText !== 'DELETE' || busy} onClick={deleteEverything}>
                {busy ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <TextInput label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Security
export function Security() {
  const meta = useApp((s) => s.meta);
  const setPassphrase = useApp((s) => s.setPassphrase);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const error = a && a.length < 10 ? 'Use at least 10 characters. A few unrelated words works well.' : b && a !== b ? 'The passphrases do not match.' : null;

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await setPassphrase(value);
      toast(value ? 'Encryption is on' : 'Encryption removed');
      setA('');
      setB('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update encryption', 'bad');
    } finally {
      setBusy(false);
      setRemoveOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Encryption on this device</h2>
          <Badge tone={meta.encrypted ? 'good' : 'warn'}>{meta.encrypted ? 'On' : 'Off'}</Badge>
        </div>
        <p className="mb-4 mt-1 text-sm text-muted">
          With a passphrase, your workspaces are encrypted in this browser with AES-256-GCM using a key derived from it (PBKDF2, 600,000 rounds). The passphrase is never stored. If you forget it, the data cannot be recovered, so keep a backup.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label={meta.encrypted ? 'New passphrase' : 'Passphrase'} type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
          <TextInput label="Repeat passphrase" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} error={error} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !a || a !== b || !!error} onClick={() => save(a)}>
            {meta.encrypted ? 'Change passphrase' : 'Turn on encryption'}
          </Button>
          {meta.encrypted && (
            <Button variant="ghost" disabled={busy} onClick={() => setRemoveOpen(true)}>
              Remove encryption
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">How this app protects your data</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Financial data stays in this browser. The local server only holds provider API keys and encrypted connection identifiers.</li>
          <li>Bank consent happens on the accredited provider&rsquo;s site. This app never asks for your internet banking password.</li>
          <li>Access is read-only. The app cannot move money, make payments or trade.</li>
          <li>There are no app accounts. The server listens on this computer only; put it behind a proper sign-in provider before exposing it anywhere else.</li>
          <li>Every import, sync, edit to balances and setting change is written to the audit log.</li>
        </ul>
      </Card>

      {removeOpen && (
        <Modal
          open
          onClose={() => setRemoveOpen(false)}
          title="Remove encryption?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoveOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => save(null)}>
                Remove encryption
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-2">Your data will be stored unencrypted in this browser. Anyone with access to this browser profile could read it.</p>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Preferences
export function Preferences() {
  const settings = useApp((s) => s.data.settings);
  const update = useApp((s) => s.updateSettings);
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('');
  const stale = settings.staleDays;
  const setStale = (k: keyof Settings['staleDays'], v: number) => update({ staleDays: { ...stale, [k]: Math.max(1, Math.round(v)) } });

  const addRate = () => {
    const c = code.trim().toUpperCase();
    const r = Number(rate);
    if (!/^[A-Z]{3}$/.test(c) || c === 'AUD' || !(r > 0)) {
      toast('Enter a three-letter currency code and a positive rate', 'bad');
      return;
    }
    update({ fx: { ...settings.fx, [c]: { audPerUnit: r, asOf: todayISO(), source: 'manual' } } });
    setCode('');
    setRate('');
  };
  const removeRate = (c: string) => {
    const next = { ...settings.fx };
    delete next[c];
    update({ fx: next });
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Appearance and history</h2>
        <Segmented
          ariaLabel="Theme"
          value={settings.theme}
          onChange={(v) => update({ theme: v })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
        <div className="mt-4">
          <Toggle checked={settings.autoSnapshot} onChange={(v) => update({ autoSnapshot: v })} label="Record a net worth snapshot each month automatically" hint="Taken the first time the app is opened in a new month." />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">When balances count as stale</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Stale balances are flagged on Home and Net Worth so you know what to update.</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <NumberInput label="Synced accounts" suffix="days" value={stale.synced} min={1} onChange={(v) => setStale('synced', v)} />
          <NumberInput label="Manual cash" suffix="days" value={stale.manualCash} min={1} onChange={(v) => setStale('manualCash', v)} />
          <NumberInput label="Manual investments" suffix="days" value={stale.manualInvestment} min={1} onChange={(v) => setStale('manualInvestment', v)} />
          <NumberInput label="Property" suffix="days" value={stale.property} min={1} onChange={(v) => setStale('property', v)} />
          <NumberInput label="Everything else" suffix="days" value={stale.other} min={1} onChange={(v) => setStale('other', v)} />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">Exchange rates</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Totals are in AUD. Foreign-currency holdings without a rate are left out of totals and flagged. Rates are entered by you; the app does not fetch them.</p>
        {Object.keys(settings.fx).length > 0 && (
          <table className="mb-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Currency</th>
                <th className="py-1 font-medium">AUD per unit</th>
                <th className="py-1 font-medium">As of</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(settings.fx).map(([c, r]) => (
                <tr key={c} className="border-t border-line">
                  <td className="py-2 font-medium">{c}</td>
                  <td className="tabular-nums">{r.audPerUnit}</td>
                  <td className="text-muted">{formatDate(r.asOf)}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => removeRate(c)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <TextInput label="Currency" placeholder="USD" maxLength={3} value={code} onChange={(e) => setCode(e.target.value)} className="w-24" />
          <TextInput label="AUD per unit" inputMode="decimal" placeholder="1.52" value={rate} onChange={(e) => setRate(e.target.value)} className="w-32" />
          <Button onClick={addRate}>Save rate</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Rules & sources
export function RulesAndSources() {
  const settings = useApp((s) => s.data.settings);
  const update = useApp((s) => s.updateSettings);
  const duty = SUPPORTED_DUTY_STATES.map((state) => estimateStampDuty({ state, priceCents: 500_000_00, ownerOccupier: false, firstHomeBuyer: false }));
  return (
    <div className="space-y-4">
      <Callout tone="info">
        Tax and duty calculations use versioned rule sets with their official sources. Provisional rule sets are based on announced or indexed figures and are marked wherever they are used. Results are estimates, not tax or legal advice.
      </Callout>
      <Card>
        <CardHeader
          title="Income tax, Medicare, HELP and super"
          action={
            <Select
              aria-label="Tax year used"
              value={settings.taxYearOverride ?? ''}
              onChange={(e) => update({ taxYearOverride: e.target.value || undefined })}
              options={[{ value: '', label: 'Use the current financial year' }, ...TAX_RULESETS.map((r) => ({ value: r.financialYear, label: `Always use ${r.financialYear}` }))]}
            />
          }
        />
        <div className="divide-y divide-line px-5 pb-2">
          {TAX_RULESETS.map((r) => (
            <RulesetRow key={r.id} title={`${r.financialYear} financial year`} status={r.status} meta={`${formatDate(r.startDate)} to ${formatDate(r.endDate)} · checked ${formatDate(r.verifiedOn)}`} note={r.statusNote} sources={r.sources} />
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Stamp duty" subtitle="Other states are not configured; the app asks for your own estimate rather than borrowing another state's rates." />
        <div className="divide-y divide-line px-5 pb-2">
          {duty.map((d) => (
            <RulesetRow key={d.state} title={d.state} status={d.status === 'confirmed' ? 'confirmed' : 'provisional'} meta={`Rule set ${d.rulesetId} · effective ${formatDate(d.effectiveFrom)}`} sources={d.sources} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function RulesetRow({ title, status, meta, note, sources }: { title: string; status: 'confirmed' | 'provisional'; meta: string; note?: string; sources: { label: string; url: string }[] }) {
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge tone={status === 'confirmed' ? 'good' : 'warn'}>{status === 'confirmed' ? 'Confirmed' : 'Provisional'}</Badge>
      </div>
      <p className="text-xs text-muted">{meta}</p>
      {note && <p className="mt-1 text-xs text-ink-2">{note}</p>}
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              {s.label} <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Audit
export function Audit() {
  const data = useApp((s) => s.data);
  const restoreInsights = useApp((s) => s.restoreInsights);
  const [limit, setLimit] = useState(50);
  const dismissed = Object.keys(data.insights.dismissed).length;
  const entries = data.audit.slice(0, limit);
  return (
    <div className="space-y-4">
      {dismissed > 0 && (
        <Callout tone="info" action={<Button size="sm" onClick={restoreInsights}>Show them again</Button>}>
          {dismissed} dismissed insight{dismissed === 1 ? '' : 's'} hidden from Home.
        </Callout>
      )}
      <Card>
        <CardHeader title="Audit log" subtitle="A record of imports, syncs, balance changes and settings on this workspace." />
        {entries.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                <time className="w-36 shrink-0 text-xs tabular-nums text-muted" dateTime={e.at}>
                  {new Date(e.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
                <Badge>{e.action}</Badge>
                <span className={cx('min-w-0 flex-1 break-words text-ink-2')}>{e.detail}</span>
                {e.by && <span className="text-xs text-muted">{data.people[e.by].name}</span>}
              </li>
            ))}
          </ol>
        )}
        {data.audit.length > limit && (
          <div className="px-5 pb-4">
            <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 100)}>
              Show older entries
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
