/**
 * Settings for the hosted version: household and invites, privacy, Up connections, sign-in
 * security and account deletion. Each person changes only their own connection and privacy.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, LogOut, RefreshCw, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import { formatDate } from '@/domain/dates';
import type { PersonId } from '@/domain/types';
import { api, supabase } from '@/cloud/client';
import type { ConnectionStatus } from '@/cloud/session';
import { cloudSession, useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, Modal, Segmented, TextInput, Toggle, toast } from '@/components/ui';

const PEOPLE: PersonId[] = ['me', 'partner'];

function useSession() {
  const s = cloudSession();
  if (!s) throw new Error('Not signed in.');
  return s;
}

// ---------------------------------------------------------------- Household
export function CloudHousehold() {
  const session = useSession();
  const people = useApp((s) => s.data.people);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = session.member.person;

  const invite = async () => {
    setBusy(true);
    try {
      const { data, error } = await session.sb.rpc('create_invite');
      if (error) throw error;
      setCode(data as string);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create an invite', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Your household</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {PEOPLE.map((p) => (
          <li key={p}>
            {session.names[p] ?? people[p].name} {p === me && <Badge tone="neutral">you</Badge>} {!session.names[p] && <span className="text-muted">(not joined yet)</span>}
          </li>
        ))}
      </ul>
      {!session.partnerJoined && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">Invite your partner. They create their own account and two-factor sign-in, then enter this code. It works once and expires in 7 days; making a new one cancels the old one.</p>
          {code ? (
            <div className="flex items-center gap-2">
              <code className="rounded bg-surface-2 px-3 py-2 text-base tracking-wider">{code}</code>
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(code).then(() => toast('Copied'))}>
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
          ) : (
            <Button variant="primary" disabled={busy} onClick={invite}>
              Create invite code
            </Button>
          )}
          <p className="text-xs text-muted">Send the code by a different channel from the app's address, for example tell them in person or by text.</p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Privacy
export function CloudPrivacy() {
  const data = useApp((s) => s.data);
  const update = useApp((s) => s.updateSettings);
  const session = useSession();
  const me = session.member.person;
  const partner = me === 'me' ? 'partner' : 'me';
  const mine = useMemo(() => data.holdings.filter((h) => h.visibility === 'private' && !h.summaryOf && !h.archived), [data.holdings]);
  const partnerName = data.people[partner].name;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold">How privacy works</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Anything you mark private is stored where only your sign-in can read it. The database refuses {partnerName}'s requests for it, so it never reaches their browser.</li>
          <li>New accounts from your Up connection follow the default you chose when connecting. Joint 2Up accounts are always shared.</li>
          <li>Change an account's privacy from Net worth, by editing the account.</li>
        </ul>
      </Card>
      <Card className="p-5">
        <Toggle
          checked={data.settings.shareTotalsOfPrivateItems[me]}
          onChange={(v) => update({ shareTotalsOfPrivateItems: { ...data.settings.shareTotalsOfPrivateItems, [me]: v } })}
          label="Include my private items in household totals"
          hint={`${mine.length} private item${mine.length === 1 ? '' : 's'}. When on, ${partnerName} sees one total per category (for example "Shares: $12,400"), never names, institutions or transactions. When off, they see nothing.`}
        />
        <p className="mt-3 text-xs text-muted">{partnerName} {data.settings.shareTotalsOfPrivateItems[partner] ? 'shares totals of their private items with you.' : "doesn't share totals of their private items."} Only they can change that.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Connections
const STATUS_TONE: Record<ConnectionStatus['status'], 'good' | 'warn' | 'bad' | 'neutral'> = { active: 'good', pending: 'warn', error: 'bad', revoked: 'neutral' };

export function CloudConnections() {
  const session = useSession();
  const pullCloud = useApp((s) => s.pullCloud);
  const names = useApp((s) => s.data.people);
  const [conns, setConns] = useState<ConnectionStatus[]>(session.connections);
  const [token, setToken] = useState('');
  const [visibility, setVisibility] = useState<'shared' | 'private'>('shared');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const me = session.member.person;
  const myUp = conns.find((c) => c.person === me && c.provider === 'up');

  const reload = async () => setConns(await session.fetchConnections());
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (label: string, fn: () => Promise<string | undefined>) => {
    setBusy(label);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ tone: 'good', text });
      await pullCloud();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : 'Something went wrong.' });
    } finally {
      await reload().catch(() => undefined);
      setBusy(null);
    }
  };

  const connect = () =>
    act('connect', async () => {
      const r = await api<{ message: string }>('/api/up/connect', { body: { token: token.trim(), visibility } });
      setToken('');
      return r.message;
    });
  const refresh = () => act('refresh', async () => {
    const r = await api<{ accounts: number; transactions: number }>('/api/up/sync', { body: {} });
    return `Refreshed: ${r.accounts} accounts, ${r.transactions} new or changed transactions.`;
  });
  const disconnect = () =>
    act('disconnect', async () => {
      setConfirmDisconnect(false);
      const r = await api<{ warning?: string }>('/api/up/disconnect', { body: {} });
      return r.warning ?? 'Disconnected. Revoke the token in the Up app too, so it can never be used again.';
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Up Bank" subtitle="Balances and transactions from your Up accounts, including 2Up and home loans." />
        <div className="space-y-4 px-5 pb-5">
          {myUp ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={STATUS_TONE[myUp.status]}>{myUp.status === 'active' ? 'Connected' : myUp.status === 'error' ? 'Needs attention' : myUp.status}</Badge>
                {myUp.last_sync_at && <span className="text-muted">Last updated {formatDate(myUp.last_sync_at.slice(0, 10))} {new Date(myUp.last_sync_at).toLocaleTimeString()}</span>}
              </div>
              {myUp.status_message && <Callout tone={myUp.status === 'error' ? 'bad' : 'info'}>{myUp.status_message}</Callout>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={refresh} disabled={!!busy}>
                  <RefreshCw className="h-4 w-4" /> {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={!!busy}>
                  <Unplug className="h-4 w-4" /> Disconnect
                </Button>
              </div>
              <p className="text-xs text-muted">To replace your token, paste a new one below. The old one stops being used straight away.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Not connected yet.</p>
          )}

          <div className="space-y-3 rounded-lg border border-line p-4">
            <h3 className="text-sm font-semibold">{myUp ? 'Replace your token' : 'Connect your Up account'}</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>
                Open{' '}
                <a className="underline" href="https://api.up.com.au/getting_started" target="_blank" rel="noreferrer">
                  api.up.com.au <ExternalLink className="inline h-3 w-3" />
                </a>{' '}
                and follow the steps to create a Personal Access Token.
              </li>
              <li>Paste it here. It is sent once over HTTPS, encrypted on the server and never shown again.</li>
            </ol>
            <Callout tone="info">
              An Up token can read your accounts and transactions. It can also change a transaction's category and tags in Up, but it can't move money. This app only reads. You can revoke the token in the Up app at any time.
            </Callout>
            <TextInput label="Personal Access Token" type="password" autoComplete="off" spellCheck={false} placeholder="up:yeah:…" value={token} onChange={(e) => setToken(e.target.value)} />
            <div>
              <p className="mb-1 text-sm">New accounts from this connection are</p>
              <Segmented ariaLabel="Default privacy" value={visibility} onChange={setVisibility} options={[{ value: 'shared', label: 'Shared with my partner' }, { value: 'private', label: 'Private to me' }]} />
              <p className="mt-1 text-xs text-muted">You can change each account afterwards. Joint 2Up accounts are always shared.</p>
            </div>
            <Button variant="primary" onClick={connect} disabled={!!busy || token.trim().length < 20}>
              {busy === 'connect' ? 'Connecting…' : myUp ? 'Replace token' : 'Connect Up'}
            </Button>
          </div>

          {message && <Callout tone={message.tone}>{message.text}</Callout>}

          {conns
            .filter((c) => c.person !== me)
            .map((c) => (
              <p key={c.id} className="text-sm text-muted">
                {names[c.person].name}'s {c.provider === 'up' ? 'Up' : 'SnapTrade'} connection: <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </p>
            ))}
        </div>
      </Card>

      {confirmDisconnect && (
        <Modal
          open
          onClose={() => setConfirmDisconnect(false)}
          title="Disconnect Up?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={disconnect}>
                Disconnect
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-2">The encrypted token is deleted and balances stop updating. Accounts only you reported, and their transactions, are removed from the app. Joint 2Up accounts stay while your partner is connected.</p>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Security
export function CloudSecurity() {
  const signOut = useApp((s) => s.signOut);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    setBusy(true);
    try {
      const { error } = await supabase().auth.updateUser({ password: pw });
      if (error) throw error;
      setPw('');
      toast('Password changed');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the password', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Two-factor sign-in</h2>
          <Badge tone="good">On</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">Required every time either of you signs in. The database itself refuses any request that hasn't passed it. If you lose your authenticator app, the household owner resets it from the Supabase dashboard (see docs/DEPLOY.md).</p>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Change password</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextInput label="New password" type="password" autoComplete="new-password" minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 12 characters." />
          <Button disabled={busy || pw.length < 12} onClick={changePassword}>
            Save
          </Button>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold">How the hosted version protects your data</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Each of you signs in separately with a password and an authenticator code.</li>
          <li>Database rules decide what each sign-in can read. Private items never leave the database for the other person.</li>
          <li>Up tokens are encrypted (AES-256-GCM) with a key that exists only on the server, never in the browser or the database.</li>
          <li>The app never asks for your internet banking password and cannot move money, make payments or trade.</li>
        </ul>
      </Card>
      <Button onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- Delete my account
export function CloudDeleteAccount() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const alone = !session.partnerJoined;

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api<{ warnings?: string[] }>('/api/account/delete', { body: { confirm: text } });
      for (const w of r.warnings ?? []) toast(w, 'info');
      await supabase().auth.signOut();
      window.location.assign('/');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the account', 'bad');
      setBusy(false);
    }
  };

  return (
    <Card className="border-bad/40 p-5">
      <h2 className="text-sm font-semibold text-bad">Delete my account</h2>
      <p className="mb-3 mt-1 text-sm text-muted">
        Deletes your sign-in, your private items and your bank connections.{' '}
        {alone ? 'You are the only member, so the shared household data is deleted too.' : 'Shared household data stays for your partner.'} This cannot be undone; export a backup first if you might need it.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" /> Delete my account
      </Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Delete your account?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={text !== 'DELETE' || busy} onClick={remove}>
                {busy ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <TextInput label="Type DELETE to confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Modal>
      )}
    </Card>
  );
}
