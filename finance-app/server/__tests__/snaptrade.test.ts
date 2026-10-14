import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../cloud/memoryRepo';
import { cloudApi, errorResponse, type CloudEnv } from '../cloud/routes';
import { mapSnapTradePositions, signSnapTrade, type SnapTradeAccount, type SnapTradeHoldings } from '../providers/snaptrade';
import { decrypt } from '../vault';

const CREDS = { clientId: 'ALEX-PERSONAL', consumerKey: 'consumer-key-0123456789abcdef' };

function fakeSnapTrade() {
  const accounts: SnapTradeAccount[] = [
    { id: 'st-1', name: 'Stake AUS', number: '12345678', institution_name: 'Stake', balance: { total: { amount: 1000, currency: 'AUD' } } },
    { id: 'st-2', name: null, institution_name: 'Interactive Brokers', balance: { total: { amount: 2500.5, currency: 'USD' } } },
  ];
  const holdings: Record<string, SnapTradeHoldings> = {
    'st-1': { positions: [{ symbol: { symbol: { symbol: 'VAS', description: 'Vanguard Australian Shares', currency: { code: 'AUD' } } }, units: 10, price: 100.25 }], total_value: { value: 1002.5, currency: 'AUD' } },
    'st-2': { positions: [], total_value: { value: null, currency: 'USD' } },
  };
  const calls: string[] = [];
  const impl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const sig = (init?.headers as Record<string, string>).Signature;
    const query = url.search.slice(1);
    // The server's check: same algorithm as SnapTrade's SDK.
    const expected = createHmac('sha256', CREDS.consumerKey).update(JSON.stringify({ content: null, path: url.pathname, query })).digest('base64');
    if (url.searchParams.get('clientId') !== CREDS.clientId || sig !== expected) return new Response('{}', { status: 401 });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.pathname === '/accounts') return ok(accounts);
    const m = url.pathname.match(/^\/accounts\/(.+)\/holdings$/);
    if (m) return ok(holdings[m[1]]);
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

function setup() {
  const repo = new MemoryRepo();
  repo.members.push({ userId: 'u-alex', householdId: 'h', person: 'me', displayName: 'Alex', aiEnabled: false });
  const st = fakeSnapTrade();
  const env: CloudEnv = { repo, key: randomBytes(32), publicUrl: 'https://x.example', cronSecret: 'c', verifyToken: async (t) => (t === 'tok' ? { userId: 'u-alex', aal: 'aal2' } : null), fetchImpl: st.impl };
  const call = async (path: string, body?: unknown, auth = 'tok', method = 'POST') => {
    let res: Response | null;
    try {
      res = await cloudApi(new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${auth}` }, body: body ? JSON.stringify(body) : undefined }), env);
    } catch (e) {
      res = errorResponse(e);
    }
    return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
  };
  return { repo, env, st, call };
}

describe('SnapTrade', () => {
  it('signs requests the way the SDK does (sorted keys, consumer key as HMAC key)', () => {
    const sig = signSnapTrade('k', '/accounts', 'clientId=a&timestamp=1');
    expect(sig).toBe(createHmac('sha256', 'k').update('{"content":null,"path":"/accounts","query":"clientId=a&timestamp=1"}').digest('base64'));
  });

  it('rejects a malformed key before calling SnapTrade', async () => {
    const s = setup();
    const r = await s.call('/api/snaptrade/connect', { clientId: 'x', consumerKey: 'short' });
    expect(r.status).toBe(400);
    expect(s.st.calls).toEqual([]);
  });

  it('refuses a key SnapTrade rejects and stores nothing', async () => {
    const s = setup();
    const r = await s.call('/api/snaptrade/connect', { clientId: CREDS.clientId, consumerKey: 'wrong-key-0123456789abcdef' });
    expect(r.status).toBe(401);
    expect(s.repo.connections).toEqual([]);
  });

  it('connects, encrypts the key and loads accounts and holdings', async () => {
    const s = setup();
    const r = await s.call('/api/snaptrade/connect', { ...CREDS, visibility: 'private' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accounts: 2, positions: 1 });
    const conn = s.repo.connections[0];
    expect(conn.secretCiphertext).not.toContain(CREDS.consumerKey);
    expect(JSON.parse(decrypt(s.env.key, conn.secretCiphertext))).toEqual(CREDS);
    const stake = s.repo.accounts.find((a) => a.externalId === 'st-1')!;
    expect(stake).toMatchObject({ accountType: 'investment', balanceCents: 1002_50, currency: 'AUD', visibility: 'private' });
    // No holdings total: falls back to the account balance, in its own currency.
    expect(s.repo.accounts.find((a) => a.externalId === 'st-2')).toMatchObject({ balanceCents: 2500_50, currency: 'USD', name: 'Interactive Brokers account' });
    expect(s.repo.positions.get(stake.id)).toEqual([{ symbol: 'VAS', description: 'Vanguard Australian Shares', units: 10, priceCents: 100_25, valueCents: 1002_50, currency: 'AUD' }]);
    expect(s.st.calls.some((c) => c.includes('trading') || c.includes('trade'))).toBe(false);
  });

  it('is refreshed by the daily job and removed on disconnect', async () => {
    const s = setup();
    await s.call('/api/snaptrade/connect', CREDS);
    const before = s.st.calls.length;
    const cron = await cloudApi(new Request('http://localhost/api/cron/daily', { headers: { Authorization: 'Bearer c' } }), s.env);
    expect(((await cron!.json()) as { synced: number }).synced).toBe(1);
    expect(s.st.calls.length).toBeGreaterThan(before);
    await s.call('/api/snaptrade/disconnect');
    expect(s.repo.connections).toEqual([]);
    expect(s.repo.accounts).toEqual([]);
  });

  it('merges duplicate lots of the same symbol', () => {
    const p = mapSnapTradePositions({ positions: [{ symbol: { symbol: { symbol: 'IVV' } }, units: 1, price: 50 }, { symbol: { symbol: { symbol: 'IVV' } }, units: 2, price: 50 }] });
    expect(p).toEqual([{ symbol: 'IVV', description: null, units: 3, priceCents: 5000, valueCents: 15000, currency: 'AUD' }]);
  });
});
