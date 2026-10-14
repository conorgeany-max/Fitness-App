import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepo } from '../cloud/memoryRepo';
import { cloudApi, errorResponse, webhookUrlFor, type CloudEnv } from '../cloud/routes';
import { UpClient, verifyUpSignature, type UpAccount, type UpTransaction } from '../providers/up';
import { decrypt } from '../vault';

const ALEX_TOKEN = 'up:yeah:alexalexalexalexalexalex';
const BLAKE_TOKEN = 'up:yeah:blakeblakeblakeblakeblake';

function account(id: string, name: string, type: UpAccount['attributes']['accountType'], cents: number, joint = false): UpAccount {
  return { id, attributes: { displayName: name, accountType: type, ownershipType: joint ? 'JOINT' : 'INDIVIDUAL', balance: { currencyCode: 'AUD', value: (cents / 100).toFixed(2), valueInBaseUnits: cents }, createdAt: '2024-01-01T10:00:00+11:00' } };
}
function txn(id: string, accountId: string, cents: number, description: string, createdAt = '2026-10-10T09:15:00+11:00', status: 'HELD' | 'SETTLED' = 'SETTLED'): UpTransaction {
  return {
    id,
    attributes: { status, description, rawText: null, message: null, amount: { currencyCode: 'AUD', value: (cents / 100).toFixed(2), valueInBaseUnits: cents }, createdAt, settledAt: status === 'SETTLED' ? createdAt : null },
    relationships: { account: { data: { id: accountId } }, transferAccount: { data: null } },
  };
}

/** A fake api.up.com.au that serves per-token data and records calls. */
function fakeUp() {
  const data: Record<string, { accounts: UpAccount[]; transactions: UpTransaction[] }> = {
    [ALEX_TOKEN]: {
      accounts: [account('acc-alex', 'Spending', 'TRANSACTIONAL', 123_45), account('acc-joint', '2Up Spending', 'TRANSACTIONAL', 500_00, true), account('acc-loan', 'Home Loan', 'HOME_LOAN', -450_000_00)],
      transactions: [txn('t1', 'acc-alex', -4_50, 'Coffee'), txn('t2', 'acc-joint', -88_10, 'Woolworths'), txn('t3', 'acc-loan', 2_000_00, 'Repayment')],
    },
    [BLAKE_TOKEN]: {
      accounts: [account('acc-blake', 'Blake Spending', 'TRANSACTIONAL', 50_00), account('acc-joint', '2Up Spending', 'TRANSACTIONAL', 500_00, true)],
      transactions: [txn('t2', 'acc-joint', -88_10, 'Woolworths'), txn('t4', 'acc-blake', -12_00, 'Lunch')],
    },
  };
  const calls: string[] = [];
  const webhooks = new Map<string, { url: string; secretKey: string }>();
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
    calls.push(`${method} ${url.pathname}${url.search}`);
    const ok = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const d = data[token];
    if (!d) return ok({ errors: [{ status: '401' }] }, 401);
    const p = url.pathname.replace('/api/v1', '');
    if (p === '/util/ping') return ok({ meta: { id: 'x', statusEmoji: '⚡️' } });
    if (p === '/accounts') {
      // Two pages, to exercise pagination.
      if (url.searchParams.get('page[after]')) return ok({ data: d.accounts.slice(1), links: { next: null } });
      return ok({ data: d.accounts.slice(0, 1), links: { next: 'https://api.up.com.au/api/v1/accounts?page[size]=100&page[after]=1' } });
    }
    const acc = p.match(/^\/accounts\/(.+)$/);
    if (acc) return ok({ data: d.accounts.find((a) => a.id === acc[1]) });
    if (p === '/transactions') return ok({ data: d.transactions, links: { next: null } });
    const t = p.match(/^\/transactions\/(.+)$/);
    if (t) return ok({ data: d.transactions.find((x) => x.id === t[1]) });
    if (p === '/webhooks' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      const id = `wh-${webhooks.size + 1}`;
      webhooks.set(id, { url: body.data.attributes.url, secretKey: `secret-${id}` });
      return ok({ data: { id, attributes: { url: body.data.attributes.url, secretKey: `secret-${id}` } } }, 201);
    }
    const wh = p.match(/^\/webhooks\/(.+)$/);
    if (wh && method === 'DELETE') {
      webhooks.delete(wh[1]);
      return ok(null, 204);
    }
    return ok({ errors: [] }, 404);
  }) as typeof fetch;
  return { data, calls, webhooks, impl };
}

const HID = 'house-1';
const USERS: Record<string, { userId: string; aal: string }> = {
  'tok-alex': { userId: 'u-alex', aal: 'aal2' },
  'tok-blake': { userId: 'u-blake', aal: 'aal2' },
  'tok-weak': { userId: 'u-alex', aal: 'aal1' },
  'tok-stranger': { userId: 'u-stranger', aal: 'aal2' },
};

function setup(publicUrl = 'https://ledger.example.com') {
  const repo = new MemoryRepo();
  repo.members.push({ userId: 'u-alex', householdId: HID, person: 'me', displayName: 'Alex', aiEnabled: false }, { userId: 'u-blake', householdId: HID, person: 'partner', displayName: 'Blake', aiEnabled: false });
  const up = fakeUp();
  const env: CloudEnv = { repo, key: randomBytes(32), publicUrl, cronSecret: 'cron-secret', verifyToken: async (t) => USERS[t] ?? null, fetchImpl: up.impl };
  const call = async (method: string, path: string, opts: { auth?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
    const req = new Request(`http://localhost${path}`, {
      method,
      headers: { ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}), ...(opts.headers ?? {}) },
      body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
    let res: Response | null;
    try {
      res = await cloudApi(req, env);
    } catch (e) {
      res = errorResponse(e);
    }
    return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
  };
  return { repo, up, env, call };
}

describe('Up client', () => {
  it('maps account types, joint ownership and signed amounts', async () => {
    const up = fakeUp();
    const c = new UpClient(ALEX_TOKEN, up.impl);
    const accounts = await c.accounts();
    expect(accounts.map((a) => a.id)).toEqual(['acc-alex', 'acc-joint', 'acc-loan']);
    expect(up.calls.filter((x) => x.startsWith('GET /api/v1/accounts')).length).toBe(2);
  });

  it('never follows a pagination link to another host', async () => {
    const impl = (async () => new Response(JSON.stringify({ data: [], links: { next: 'https://evil.example.com/steal' } }), { status: 200 })) as typeof fetch;
    await expect(new UpClient(ALEX_TOKEN, impl).accounts()).rejects.toThrow(/unexpected host/);
  });

  it('rejects text that is not a token before sending anything', () => {
    expect(() => new UpClient('my password', fakeUp().impl)).toThrow(/personal access token/);
  });

  it('verifies webhook signatures', () => {
    const body = '{"data":{}}';
    const sig = createHmac('sha256', 'k').update(body).digest('hex');
    expect(verifyUpSignature(body, sig, 'k')).toBe(true);
    expect(verifyUpSignature(body, sig, 'other')).toBe(false);
    expect(verifyUpSignature(`${body} `, sig, 'k')).toBe(false);
    expect(verifyUpSignature(body, null, 'k')).toBe(false);
    expect(verifyUpSignature(body, 'zz', 'k')).toBe(false);
  });

  it('builds webhook URLs only for public https origins', () => {
    expect(webhookUrlFor('https://ledger.example.com', 'abc')).toBe('https://ledger.example.com/api/webhooks/up/abc');
    expect(webhookUrlFor('http://localhost:5173', 'abc')).toBeNull();
    expect(webhookUrlFor('https://localhost', 'abc')).toBeNull();
  });
});

describe('cloud API: sign-in checks', () => {
  it('requires a session, two-factor sign-in and a household', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/up/sync')).status).toBe(401);
    expect((await call('POST', '/api/up/sync', { auth: 'tok-unknown' })).status).toBe(401);
    expect((await call('POST', '/api/up/sync', { auth: 'tok-weak' })).body.error).toBe('mfa_required');
    expect((await call('POST', '/api/up/sync', { auth: 'tok-stranger' })).body.error).toBe('no_household');
  });

  it('protects the daily job with its secret', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/cron/daily')).status).toBe(401);
    expect((await call('GET', '/api/cron/daily', { auth: 'wrong' })).status).toBe(401);
    expect((await call('GET', '/api/cron/daily', { auth: 'cron-secret' })).status).toBe(200);
  });
});

describe('cloud API: Up connection', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('refuses a token Up rejects and stores nothing', async () => {
    const r = await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: 'up:yeah:revokedrevokedrevoked' } });
    expect(r.status).toBe(401);
    expect(s.repo.connections).toHaveLength(0);
  });

  it('connects, encrypts the token, registers a webhook and loads data', async () => {
    const r = await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN, visibility: 'private' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, live: true, accounts: 3, transactions: 3 });
    const conn = s.repo.connections[0];
    expect(conn.secretCiphertext).not.toContain('alex');
    expect(decrypt(s.env.key, conn.secretCiphertext)).toBe(ALEX_TOKEN);
    expect(conn.webhookId).toBe('wh-1');
    expect(s.up.webhooks.get('wh-1')!.url).toBe(`https://ledger.example.com/api/webhooks/up/${conn.id}`);
    expect(conn.status).toBe('active');

    const byExt = Object.fromEntries(s.repo.accounts.map((a) => [a.externalId, a]));
    expect(byExt['acc-alex']).toMatchObject({ owners: ['me'], visibility: 'private', balanceCents: 12345, accountType: 'transaction' });
    expect(byExt['acc-joint']).toMatchObject({ joint: true, visibility: 'shared' });
    expect(byExt['acc-loan']).toMatchObject({ accountType: 'mortgage', balanceCents: -45_000_000 });
    expect(s.repo.transactions.size).toBe(3);
    expect([...s.repo.balances.keys()].length).toBe(3);
    // The response never echoes the token.
    expect(JSON.stringify(r.body)).not.toContain(ALEX_TOKEN);
  });

  it('merges a 2Up account reported by both partners', async () => {
    await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    await s.call('POST', '/api/up/connect', { auth: 'tok-blake', body: { token: BLAKE_TOKEN, visibility: 'shared' } });
    const joint = s.repo.accounts.filter((a) => a.externalId === 'acc-joint');
    expect(joint).toHaveLength(1);
    expect(joint[0].owners).toEqual(['me', 'partner']);
    expect(s.repo.accounts.find((a) => a.externalId === 'acc-blake')!.visibility).toBe('shared');
    expect([...s.repo.transactions.values()].filter((t) => t.externalId === 't2')).toHaveLength(1);
  });

  it('skips the webhook without a public https address and says so', async () => {
    s = setup('http://localhost:5173');
    const r = await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    expect(r.body.live).toBe(false);
    expect(String(r.body.message)).toMatch(/refreshes daily/);
    expect(s.up.webhooks.size).toBe(0);
  });

  it('applies signed webhook events and rejects unsigned ones', async () => {
    await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    const conn = s.repo.connections[0];
    // A new purchase lands at Up.
    s.up.data[ALEX_TOKEN].transactions.push(txn('t9', 'acc-alex', -20_00, 'Bakery', '2026-10-14T08:00:00+11:00', 'HELD'));
    s.up.data[ALEX_TOKEN].accounts[0].attributes.balance.valueInBaseUnits = 103_45;
    const event = (type: string, id = 't9') => JSON.stringify({ data: { id: 'ev', attributes: { eventType: type, createdAt: '2026-10-14T08:00:01+11:00' }, relationships: { webhook: { data: { id: 'wh-1' } }, transaction: { data: { id } } } } });
    const sign = (body: string) => createHmac('sha256', 'secret-wh-1').update(body).digest('hex');
    const path = `/api/webhooks/up/${conn.id}`;

    const body = event('TRANSACTION_CREATED');
    expect((await s.call('POST', path, { raw: body, headers: { 'X-Up-Authenticity-Signature': '0'.repeat(64) } })).status).toBe(401);
    expect((await s.call('POST', `/api/webhooks/up/00000000-0000-0000-0000-000000000000`, { raw: body, headers: { 'X-Up-Authenticity-Signature': sign(body) } })).status).toBe(401);
    expect(s.repo.transactions.size).toBe(3);

    const r = await s.call('POST', path, { raw: body, headers: { 'X-Up-Authenticity-Signature': sign(body) } });
    expect(r.body).toMatchObject({ ok: true, result: 'updated' });
    const added = [...s.repo.transactions.values()].find((t) => t.externalId === 't9')!;
    expect(added).toMatchObject({ amountCents: -2000, pending: true, date: '2026-10-14', description: 'Bakery' });
    expect(s.repo.accounts.find((a) => a.externalId === 'acc-alex')!.balanceCents).toBe(10345);

    const del = event('TRANSACTION_DELETED');
    await s.call('POST', path, { raw: del, headers: { 'X-Up-Authenticity-Signature': sign(del) } });
    expect([...s.repo.transactions.values()].some((t) => t.externalId === 't9')).toBe(false);

    const ping = JSON.stringify({ data: { id: 'p', attributes: { eventType: 'PING', createdAt: 'x' }, relationships: { webhook: { data: { id: 'wh-1' } } } } });
    expect((await s.call('POST', path, { raw: ping, headers: { 'X-Up-Authenticity-Signature': sign(ping) } })).body.result).toBe('ignored');
  });

  it('refreshes from just before the last sync', async () => {
    await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    s.repo.connections[0].lastSyncAt = '2026-10-10T00:00:00.000Z';
    const r = await s.call('POST', '/api/up/sync', { auth: 'tok-alex' });
    expect(r.status).toBe(200);
    expect(s.up.calls.at(-1)).toContain(encodeURIComponent('2026-10-07T00:00:00.000Z'));
  });

  it('disconnects: removes the webhook and data only this person reported', async () => {
    await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    await s.call('POST', '/api/up/connect', { auth: 'tok-blake', body: { token: BLAKE_TOKEN } });
    const r = await s.call('POST', '/api/up/disconnect', { auth: 'tok-alex' });
    expect(r.status).toBe(200);
    expect(s.up.webhooks.has('wh-1')).toBe(false);
    expect(s.repo.connections.map((c) => c.person)).toEqual(['partner']);
    expect(s.repo.accounts.map((a) => a.externalId).sort()).toEqual(['acc-blake', 'acc-joint']);
    expect(s.repo.accounts.find((a) => a.externalId === 'acc-joint')!.owners).toEqual(['partner']);
    expect([...s.repo.transactions.values()].some((t) => t.externalId === 't1')).toBe(false);
  });

  it('marks the connection as failing when Up rejects a revoked token', async () => {
    await s.call('POST', '/api/up/connect', { auth: 'tok-alex', body: { token: ALEX_TOKEN } });
    delete s.up.data[ALEX_TOKEN];
    const r = await s.call('POST', '/api/up/sync', { auth: 'tok-alex' });
    expect(r.status).toBe(401);
    expect(s.repo.connections[0]).toMatchObject({ status: 'error' });
    expect(s.repo.connections[0].statusMessage).toMatch(/revoked/);
  });
});
