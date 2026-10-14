/**
 * Moves Up data into the database: a full sync (on connect, on demand and daily) and
 * single-transaction updates from Up's webhooks. Balances are stored exactly as Up reports
 * them; nothing is estimated.
 */
import { decrypt } from '../vault';
import { mapUpAccount, mapUpTransaction, UpClient, type UpWebhookEvent } from '../providers/up';
import { HttpError, type ConnectionRow, type Repo } from './types';

export const FIRST_SYNC_DAYS = 365;
/** Re-read a few days before the last sync, so transactions that settled late are refreshed. */
const OVERLAP_DAYS = 3;

/** Today's date in Australian eastern time, for daily balance history. */
export function auDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export interface SyncDeps {
  repo: Repo;
  key: Buffer;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface SyncSummary {
  accounts: number;
  transactions: number;
}

export function upClientFor(conn: ConnectionRow, deps: SyncDeps): UpClient {
  return new UpClient(decrypt(deps.key, conn.secretCiphertext), deps.fetchImpl);
}

async function storeAccount(conn: ConnectionRow, deps: SyncDeps, account: ReturnType<typeof mapUpAccount>, date: string): Promise<string> {
  const { joint, ...a } = account;
  const id = await deps.repo.upsertAccount(conn.householdId, { provider: 'up', owner: conn.person, joint, defaultVisibility: conn.newAccountVisibility, institution: 'Up', account: a });
  await deps.repo.recordBalance(id, date, a.balanceCents);
  return id;
}

export async function syncUpConnection(conn: ConnectionRow, deps: SyncDeps): Promise<SyncSummary> {
  const now = deps.now?.() ?? new Date();
  const client = upClientFor(conn, deps);
  try {
    const accounts = await client.accounts();
    const ids = new Map<string, string>();
    for (const a of accounts) ids.set(a.id, await storeAccount(conn, deps, mapUpAccount(a, now.toISOString()), auDate(now)));

    const since = conn.lastSyncAt ? new Date(new Date(conn.lastSyncAt).getTime() - OVERLAP_DAYS * 864e5) : new Date(now.getTime() - FIRST_SYNC_DAYS * 864e5);
    const txns = (await client.transactions(since.toISOString())).map(mapUpTransaction);
    const byAccount = new Map<string, typeof txns>();
    for (const t of txns) {
      const id = ids.get(t.accountExternalId);
      if (!id) continue;
      byAccount.set(id, [...(byAccount.get(id) ?? []), t]);
    }
    for (const [id, list] of byAccount) await deps.repo.upsertTransactions(id, list);

    await deps.repo.updateConnection(conn.id, { status: 'active', statusMessage: null, lastSyncAt: now.toISOString() });
    return { accounts: accounts.length, transactions: txns.length };
  } catch (e) {
    const message = e instanceof HttpError ? e.message : 'Sync failed unexpectedly.';
    await deps.repo.updateConnection(conn.id, { status: 'error', statusMessage: message });
    throw e;
  }
}

/** Handles one verified webhook event. Idempotent: Up may deliver the same event more than once. */
export async function applyUpEvent(conn: ConnectionRow, event: UpWebhookEvent, deps: SyncDeps): Promise<'ignored' | 'updated' | 'deleted'> {
  const type = event.data.attributes.eventType;
  const txnId = event.data.relationships.transaction?.data.id;
  if (type === 'PING' || !txnId) return 'ignored';
  if (type === 'TRANSACTION_DELETED') {
    await deps.repo.deleteTransaction(conn.householdId, 'up', txnId);
    return 'deleted';
  }
  const now = deps.now?.() ?? new Date();
  const client = upClientFor(conn, deps);
  const txn = await client.transaction(txnId);
  // Refresh the account too, so the balance moves the moment the transaction lands.
  const account = await client.account(txn.relationships.account.data.id);
  const accountId = await storeAccount(conn, deps, mapUpAccount(account, now.toISOString()), auDate(now));
  await deps.repo.upsertTransactions(accountId, [mapUpTransaction(txn)]);
  await deps.repo.updateConnection(conn.id, { status: 'active', statusMessage: null });
  return 'updated';
}
