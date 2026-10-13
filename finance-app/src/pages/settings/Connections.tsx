import { useCallback, useEffect, useState } from 'react';
import { Landmark, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { addDays, formatDate, relativeTime, todayISO } from '@/domain/dates';
import { applySync, type ObInstitution, type ObProviderId, type ObProviderInfo } from '@/domain/openBanking';
import type { BankConnection, ConnectionStatus, Visibility } from '@/domain/types';
import { uid } from '@/lib/id';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Modal, Segmented, Select, cx, toast } from '@/components/ui';
import { ApiError, api } from './api';

const STATUS_TONE: Record<ConnectionStatus, 'good' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  active: 'good',
  pending: 'info',
  syncing: 'info',
  expired: 'warn',
  error: 'bad',
  revoked: 'neutral',
};
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  active: 'Active',
  pending: 'Waiting for consent',
  syncing: 'Syncing',
  expired: 'Consent expired',
  error: 'Error',
  revoked: 'Revoked',
};
const ENV_BADGE = {
  mock: <Badge tone="demo">Mock</Badge>,
  sandbox: <Badge tone="warn">Sandbox</Badge>,
  live: <Badge tone="info">Live CDR</Badge>,
};
const SCOPES = ['Account name, type and masked number', 'Balances', 'Transactions (up to 90 days on first sync)'];

/** Sync one connection and merge the result into the workspace. */
export function useSync() {
  const mutate = useApp((s) => s.mutate);
  const addTransactions = useApp((s) => s.addTransactions);
  const upsertConnection = useApp((s) => s.upsertConnection);
  return useCallback(
    async (conn: BankConnection) => {
      const now = new Date().toISOString();
      const fromDate = conn.lastSyncAt ? addDays(conn.lastSyncAt.slice(0, 10), -7) : addDays(todayISO(), -90);
      upsertConnection({ ...conn, status: 'syncing' });
      try {
        const payload = await api.sync(conn.id, fromDate);
        const d0 = useApp.getState().data;
        const r = applySync(d0.holdings, conn, payload, conn.newAccountVisibility ?? 'shared', uid, now);
        mutate(
          (d) => {
            for (const h of r.holdings) {
              const i = d.holdings.findIndex((x) => x.id === h.id);
              if (i >= 0) d.holdings[i] = h;
              else d.holdings.push(h);
            }
          },
          { action: 'sync', detail: `${payload.institutionName}: ${r.created} new account(s), ${r.updated} updated` },
        );
        const outcome = r.transactions.length ? addTransactions(r.transactions, `Sync from ${payload.institutionName}`) : null;
        const added = outcome?.added.length ?? 0;
        const duplicates = outcome?.skipped.length ?? 0;
        const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
        const parts = [r.created ? `${plural(r.created, 'account')} added` : `${plural(r.updated, 'account')} updated`, `${plural(added, 'new transaction')}`];
        if (duplicates) parts.push(`${plural(duplicates, 'duplicate')} skipped`);
        if (outcome?.flagged.length) parts.push(`${plural(outcome.flagged.length, 'possible duplicate')} to review in Transactions, Reconcile`);
        const message = [parts.join(', '), ...payload.warnings].join('. ');
        upsertConnection({ ...conn, status: 'active', institutionName: payload.institutionName, lastSyncAt: now, lastSyncResult: { ok: true, message, at: now, added, duplicates } });
        toast(`Synced ${payload.institutionName}`);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('Sync failed', 'error', 0);
        const status: ConnectionStatus = err.code === 'consent_expired' ? 'expired' : err.code === 'revoked' ? 'revoked' : conn.status === 'syncing' ? 'active' : conn.status === 'pending' && err.code === 'consent_pending' ? 'pending' : 'error';
        // Nothing is changed on failure apart from the connection's status line.
        upsertConnection({ ...conn, status, lastSyncResult: { ok: false, message: err.message, at: now } });
        toast(err.message, 'bad');
      }
    },
    [mutate, addTransactions, upsertConnection],
  );
}

export function Connections() {
  const data = useApp((s) => s.data);
  const [providers, setProviders] = useState<ObProviderInfo[] | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [removing, setRemoving] = useState<BankConnection | null>(null);

  const load = useCallback(() => {
    setOffline(null);
    api
      .providers()
      .then(setProviders)
      .catch((e: unknown) => setOffline(e instanceof Error ? e.message : 'The local API server is not reachable.'));
  }, []);
  useEffect(load, [load]);

  const { people, settings } = data;
  const active = settings.activeUser;
  const available = (providers ?? []).filter((p) => p.configured);

  return (
    <div className="space-y-4">
      <Callout tone="info" title="How bank connections work here">
        Connections use Australia&rsquo;s Consumer Data Right through an accredited provider. You approve access on the provider&rsquo;s own consent screen, so this app never asks for or stores your internet banking password, and it can only read data: it cannot move money or make payments. This build is not an accredited data recipient. It ships a mock provider with fictional banks and a Basiq sandbox adapter; live connections need your own provider agreement (see docs/OPEN_BANKING.md).
      </Callout>

      {offline && (
        <Callout tone="warn" title="Connection service unavailable" action={<Button size="sm" onClick={load}>Try again</Button>}>
          {offline} Your existing data is unaffected; manual entry and CSV import still work.
        </Callout>
      )}

      <Card>
        <CardHeader
          title="Providers"
          subtitle="Configured on the local server. API keys stay on the server and never reach this page."
          action={
            <Button variant="primary" size="sm" disabled={!available.length} onClick={() => setConnectOpen(true)}>
              <Link2 className="h-4 w-4" /> Connect a bank
            </Button>
          }
        />
        <div className="divide-y divide-line px-5 pb-3">
          {providers === null && !offline && <p className="py-3 text-sm text-muted">Checking the local server…</p>}
          {(providers ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.name} {ENV_BADGE[p.environment]}
                </div>
                <p className="text-xs text-muted">{p.note}</p>
              </div>
              <Badge tone={p.configured ? 'good' : 'neutral'}>{p.configured ? 'Available' : 'Not configured'}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Connections" subtitle={`Each person connects their own accounts. ${people[active].name} is using the app now.`} />
        {data.connections.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={<Landmark className="h-6 w-6" />} title="No bank connections">
              Connect a mock or sandbox bank to see how synced accounts behave. Synced balances are labelled with where they came from.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.connections.map((c) => (
              <ConnectionRow key={c.id} conn={c} onRemove={() => setRemoving(c)} />
            ))}
          </ul>
        )}
      </Card>

      {connectOpen && <ConnectModal providers={available} onClose={() => setConnectOpen(false)} />}
      {removing && <RemoveModal conn={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function ConnectionRow({ conn, onRemove }: { conn: BankConnection; onRemove: () => void }) {
  const data = useApp((s) => s.data);
  const upsertConnection = useApp((s) => s.upsertConnection);
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const { settings, people } = data;
  const mine = conn.owner === settings.activeUser;
  const accounts = data.holdings.filter((h) => h.connectionId === conn.id);
  const hiddenFromViewer = !mine && !settings.shareTotalsOfPrivateItems[conn.owner] && accounts.length > 0 && accounts.every((h) => h.visibility === 'private');

  if (hiddenFromViewer) {
    return (
      <li className="flex items-center gap-3 px-5 py-3 text-sm text-muted">
        <ShieldCheck className="h-4 w-4" /> A private connection belonging to {people[conn.owner].name}. Its details are visible when they are using the app.
      </li>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const checkStatus = () =>
    run(async () => {
      try {
        const s = await api.status(conn.id);
        upsertConnection({ ...conn, status: s.status, consentExpiresAt: s.consentExpiresAt ?? conn.consentExpiresAt, lastSyncResult: conn.lastSyncResult });
        toast(s.message, s.status === 'active' ? 'good' : 'info');
        if (s.status === 'active' && !conn.lastSyncAt) await sync({ ...conn, status: 'active' });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Status check failed', 'bad');
      }
    });

  const expiringSoon = conn.consentExpiresAt && conn.status === 'active' && Date.parse(conn.consentExpiresAt) - Date.now() < 14 * 864e5;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{conn.institutionName}</span>
            {ENV_BADGE[conn.environment]}
            <Badge tone={STATUS_TONE[conn.status]}>{STATUS_LABEL[conn.status]}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {people[conn.owner].name}&rsquo;s consent · {accounts.length} account{accounts.length === 1 ? '' : 's'} · last synced {conn.lastSyncAt ? relativeTime(conn.lastSyncAt) : 'never'}
            {conn.consentExpiresAt && ` · consent ${Date.parse(conn.consentExpiresAt) < Date.now() ? 'expired' : 'expires'} ${formatDate(conn.consentExpiresAt.slice(0, 10))}`}
          </p>
          {conn.lastSyncResult && <p className={cx('mt-1 text-xs', conn.lastSyncResult.ok ? 'text-ink-2' : 'text-bad')}>{conn.lastSyncResult.message}</p>}
          {expiringSoon && <p className="mt-1 text-xs text-warn">Consent expires soon. Reconnect to keep syncing.</p>}
        </div>
        {mine ? (
          <div className="flex flex-wrap gap-2">
            {conn.status === 'expired' ? (
              <span className="self-center text-xs text-muted">Disconnect and connect again to renew consent.</span>
            ) : conn.status === 'pending' ? (
              <Button size="sm" disabled={busy} onClick={checkStatus}>
                Check consent
              </Button>
            ) : (
              <Button size="sm" disabled={busy || conn.status === 'syncing' || conn.status === 'revoked'} onClick={() => run(() => sync(conn))}>
                <RefreshCw className={cx('h-4 w-4', (busy || conn.status === 'syncing') && 'animate-spin')} /> Sync now
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onRemove}>
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted">Only {people[conn.owner].name} can sync or disconnect this.</span>
        )}
      </div>
    </li>
  );
}

function ConnectModal({ providers, onClose }: { providers: ObProviderInfo[]; onClose: () => void }) {
  const data = useApp((s) => s.data);
  const upsertConnection = useApp((s) => s.upsertConnection);
  const sync = useSync();
  const owner = data.settings.activeUser;
  const name = data.people[owner].name;
  const [providerId, setProviderId] = useState<ObProviderId>(providers[0]?.id ?? 'mock');
  const [institutions, setInstitutions] = useState<ObInstitution[] | null>(null);
  const [institutionId, setInstitutionId] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('shared');
  const [step, setStep] = useState<'choose' | 'mock-consent' | 'external'>('choose');
  const [conn, setConn] = useState<BankConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const provider = providers.find((p) => p.id === providerId);

  useEffect(() => {
    setInstitutions(null);
    setInstitutionId('');
    api
      .institutions(providerId)
      .then((list) => {
        setInstitutions(list);
        setInstitutionId(list[0]?.id ?? '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load institutions'));
  }, [providerId]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.startConsent(providerId, owner, institutionId);
      const c: BankConnection = {
        id: r.connectionId,
        provider: providerId,
        environment: r.environment,
        institutionId,
        institutionName: r.institutionName,
        owner,
        status: 'pending',
        scopes: SCOPES,
        newAccountVisibility: visibility,
        consentExpiresAt: r.consentExpiresAt,
        createdAt: new Date().toISOString(),
      };
      upsertConnection(c);
      setConn(c);
      if (r.consentUrl) {
        window.open(r.consentUrl, '_blank', 'noopener,noreferrer');
        setStep('external');
      } else setStep('mock-consent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start consent');
    } finally {
      setBusy(false);
    }
  };

  const approveMock = async () => {
    if (!conn) return;
    setBusy(true);
    const granted = { ...conn, status: 'active' as const, consentGrantedAt: new Date().toISOString() };
    upsertConnection(granted);
    await sync(granted);
    setBusy(false);
    onClose();
  };

  const finishExternal = async () => {
    if (!conn) return;
    setBusy(true);
    try {
      const s = await api.status(conn.id);
      if (s.status !== 'active') {
        setError(`${s.message} If you closed the consent page, you can check again later from the connection list.`);
        return;
      }
      const granted = { ...conn, status: 'active' as const, consentGrantedAt: new Date().toISOString(), consentExpiresAt: s.consentExpiresAt };
      upsertConnection(granted);
      await sync(granted);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status check failed');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'mock-consent' && conn) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Mock consent screen"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={approveMock}>
              {busy ? 'Syncing…' : 'Approve (mock)'}
            </Button>
          </>
        }
      >
        <Callout tone="demo" title="This is a simulation">
          A real connection would show this step on the accredited provider&rsquo;s website, where you sign in to your bank. Nothing here is a real bank and no password is requested.
        </Callout>
        <div className="mt-4 space-y-3 text-sm">
          <p>
            <strong>{conn.institutionName}</strong> will share the following with this app for <strong>90 days</strong>:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-ink-2">
            {SCOPES.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="text-muted">Access is read-only. You can withdraw consent at any time by disconnecting.</p>
        </div>
      </Modal>
    );
  }

  if (step === 'external' && conn) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Finish on the provider’s consent page"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              I&rsquo;ll finish later
            </Button>
            <Button variant="primary" disabled={busy} onClick={finishExternal}>
              {busy ? 'Checking…' : 'I’ve finished consenting'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          A new tab opened on {provider?.name ?? 'the provider'}&rsquo;s consent site. Choose your bank and approve access there. Your bank credentials go to the provider, never to this app.
        </p>
        {error && (
          <div className="mt-3">
            <Callout tone="warn">{error}</Callout>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Connect a bank"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !institutionId} onClick={begin}>
            {busy ? 'Starting…' : 'Continue to consent'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Connecting as <strong>{name}</strong>. Consent must come from the account holder, so your partner connects their own accounts while they are using the app.
        </p>
        <Select label="Provider" value={providerId} onChange={(e) => setProviderId(e.target.value as ObProviderId)} options={providers.map((p) => ({ value: p.id, label: p.name }))} />
        <Select
          label="Institution"
          value={institutionId}
          onChange={(e) => setInstitutionId(e.target.value)}
          disabled={!institutions}
          options={institutions ? institutions.map((i) => ({ value: i.id, label: i.name })) : [{ value: '', label: 'Loading…' }]}
          hint={providerId === 'basiq' ? 'You can also choose the bank on the provider’s consent screen.' : 'Fictional institutions that simulate healthy, expired, failing and duplicate-sending feeds.'}
        />
        <div>
          <div className="mb-1 text-sm font-medium">Who can see new accounts from this connection?</div>
          <Segmented
            ariaLabel="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'shared', label: 'Shared with partner' },
              { value: 'private', label: `Private to ${name}` },
            ]}
          />
          <p className="mt-1 text-xs text-muted">New accounts are owned 100% by {name}. Mark joint accounts as joint in Net Worth after the first sync.</p>
        </div>
        {error && <Callout tone="bad">{error}</Callout>}
      </div>
    </Modal>
  );
}

function RemoveModal({ conn, onClose }: { conn: BankConnection; onClose: () => void }) {
  const removeConnection = useApp((s) => s.removeConnection);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    let warning: string | undefined;
    try {
      warning = (await api.revoke(conn.id)).warning;
    } catch (e) {
      warning = `The server could not revoke consent (${e instanceof Error ? e.message : 'error'}). Withdraw consent from your bank's app or the provider as well.`;
    }
    removeConnection(conn.id, deleteData);
    toast(warning ?? `Disconnected ${conn.institutionName}`, warning ? 'info' : 'good');
    setBusy(false);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Disconnect ${conn.institutionName}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={confirm}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">This withdraws consent at the provider and stops syncing.</p>
      <div className="mt-4">
        <Segmented
          ariaLabel="What to do with synced data"
          value={deleteData ? 'delete' : 'keep'}
          onChange={(v) => setDeleteData(v === 'delete')}
          options={[
            { value: 'keep', label: 'Keep accounts and history' },
            { value: 'delete', label: 'Delete synced accounts and transactions' },
          ]}
        />
      </div>
    </Modal>
  );
}
