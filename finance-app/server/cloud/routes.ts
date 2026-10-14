/**
 * API routes for the hosted version. Every route except Up's webhook and the daily cron
 * requires a Supabase session that passed two-factor sign-in (aal2) and belongs to a household.
 */
import { FetchRefused, fetchListing } from '../listing';
import { UpClient, verifyUpSignature, type UpWebhookEvent } from '../providers/up';
import { decrypt, encrypt } from '../vault';
import { bearer, json, RateLimiter, readJson, readText } from './http';
import { applyUpEvent, syncUpConnection, type SyncDeps } from './sync';
import { HttpError, type Member, type Repo } from './types';

export interface VerifiedToken {
  userId: string;
  aal: string;
}

export interface CloudEnv {
  repo: Repo;
  /** 32-byte AES key for provider tokens. */
  key: Buffer;
  /** Public https origin of the app, used for Up's webhook URL. */
  publicUrl: string;
  cronSecret?: string;
  verifyToken(token: string): Promise<VerifiedToken | null>;
  fetchImpl?: typeof fetch;
  /** Extra route groups (AI agent, SnapTrade, Domain), tried in order after the core routes. */
  extraRoutes?: ExtraRoutes[];
  /** Per-instance rate limits; created on first use. */
  limiter?: RateLimiter;
}

export type ExtraRoutes = (req: Request, url: URL, ctx: { env: CloudEnv; member: () => Promise<Member> }) => Promise<Response | null>;

export function limit(env: CloudEnv, key: string, max: number, message = 'Too many requests. Wait a minute and try again.'): void {
  env.limiter ??= new RateLimiter();
  if (!env.limiter.check(key, max)) throw new HttpError(429, 'rate_limited', message);
}

export async function authenticate(req: Request, env: CloudEnv): Promise<Member> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'signed_out', 'Sign in to continue.');
  const v = await env.verifyToken(token);
  if (!v) throw new HttpError(401, 'signed_out', 'Your session has ended. Sign in again.');
  if (v.aal !== 'aal2') throw new HttpError(403, 'mfa_required', 'Finish two-factor sign-in to continue.');
  const m = await env.repo.memberByUser(v.userId);
  if (!m) throw new HttpError(403, 'no_household', 'Create or join a household first.');
  limit(env, `user:${v.userId}`, 120);
  return m;
}

/** Up only accepts public https webhook URLs. */
export function webhookUrlFor(publicUrl: string, connectionId: string): string | null {
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return new URL(`/api/webhooks/up/${connectionId}`, u.origin).toString();
  } catch {
    return null;
  }
}

const deps = (env: CloudEnv): SyncDeps => ({ repo: env.repo, key: env.key, fetchImpl: env.fetchImpl });

async function connectUp(req: Request, env: CloudEnv, member: Member): Promise<Response> {
  limit(env, `connect:${member.userId}`, 5, 'Too many attempts. Wait a minute and try again.');
  const body = await readJson<{ token?: unknown; visibility?: unknown }>(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const visibility = body.visibility === 'shared' ? 'shared' : 'private';
  const client = new UpClient(token, env.fetchImpl);
  await client.ping();

  // Replacing an earlier token: retire its webhook first so Up stops calling the old one.
  const previous = await env.repo.findConnection(member.householdId, member.person, 'up');
  if (previous?.webhookId) {
    try {
      await new UpClient(decrypt(env.key, previous.secretCiphertext), env.fetchImpl).deleteWebhook(previous.webhookId);
    } catch {
      /* the old token may already be revoked */
    }
  }

  const conn = await env.repo.insertConnection({
    householdId: member.householdId,
    person: member.person,
    provider: 'up',
    secretCiphertext: encrypt(env.key, token),
    webhookId: null,
    webhookSecretCiphertext: null,
    newAccountVisibility: visibility,
    status: 'pending',
    statusMessage: null,
    lastSyncAt: null,
  });

  let live = false;
  const hook = webhookUrlFor(env.publicUrl, conn.id);
  if (hook) {
    const w = await client.createWebhook(hook, 'Ledgerline household finance');
    await env.repo.updateConnection(conn.id, { webhookId: w.id, webhookSecretCiphertext: encrypt(env.key, w.secretKey) });
    live = true;
  }
  const summary = await syncUpConnection({ ...conn, lastSyncAt: null }, deps(env));
  return json(200, {
    ok: true,
    connectionId: conn.id,
    live,
    ...summary,
    message: live
      ? `Connected. ${summary.accounts} accounts and ${summary.transactions} transactions loaded; new transactions arrive as they happen.`
      : `Connected. ${summary.accounts} accounts and ${summary.transactions} transactions loaded. Real-time updates need the app's public https address; until then it refreshes daily and when you press Refresh.`,
  });
}

async function syncMine(env: CloudEnv, member: Member): Promise<Response> {
  limit(env, `sync:${member.userId}`, 6, 'Too many refreshes. Wait a minute and try again.');
  const conn = await env.repo.findConnection(member.householdId, member.person, 'up');
  if (!conn) throw new HttpError(404, 'not_connected', 'Connect Up first.');
  const summary = await syncUpConnection(conn, deps(env));
  return json(200, { ok: true, ...summary });
}

async function disconnectUp(env: CloudEnv, member: Member): Promise<Response> {
  const conn = await env.repo.findConnection(member.householdId, member.person, 'up');
  if (!conn) return json(200, { ok: true });
  let warning: string | undefined;
  if (conn.webhookId) {
    try {
      await new UpClient(decrypt(env.key, conn.secretCiphertext), env.fetchImpl).deleteWebhook(conn.webhookId);
    } catch {
      warning = "Up didn't confirm the webhook was removed. Revoke the token in the Up app to be sure.";
    }
  }
  await env.repo.releaseAccounts(member.householdId, 'up', member.person);
  await env.repo.deleteConnection(conn.id);
  return json(200, { ok: true, warning });
}

async function deleteAccount(req: Request, env: CloudEnv, member: Member): Promise<Response> {
  const body = await readJson<{ confirm?: unknown }>(req);
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'confirm', 'Type DELETE to confirm.');
  const warnings: string[] = [];
  for (const provider of ['up', 'snaptrade'] as const) {
    const conn = await env.repo.findConnection(member.householdId, member.person, provider);
    if (!conn) continue;
    if (provider === 'up' && conn.webhookId) {
      try {
        await new UpClient(decrypt(env.key, conn.secretCiphertext), env.fetchImpl).deleteWebhook(conn.webhookId);
      } catch {
        warnings.push('Revoke your Up token in the Up app to be sure Up stops sending updates.');
      }
    }
    await env.repo.releaseAccounts(member.householdId, provider, member.person);
    await env.repo.deleteConnection(conn.id);
  }
  await env.repo.removeMember(member);
  return json(200, { ok: true, warnings });
}

async function upWebhook(req: Request, env: CloudEnv, connectionId: string): Promise<Response> {
  const raw = await readText(req, 256 * 1024);
  const conn = /^[0-9a-f-]{36}$/.test(connectionId) ? await env.repo.getConnection(connectionId) : null;
  // Same answer for unknown connections and bad signatures, so probing learns nothing.
  if (!conn || conn.provider !== 'up' || !conn.webhookSecretCiphertext) return json(401, { error: 'unauthorised' });
  if (!verifyUpSignature(raw, req.headers.get('x-up-authenticity-signature'), decrypt(env.key, conn.webhookSecretCiphertext))) return json(401, { error: 'unauthorised' });
  let event: UpWebhookEvent;
  try {
    event = JSON.parse(raw) as UpWebhookEvent;
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const result = await applyUpEvent(conn, event, deps(env));
  return json(200, { ok: true, result });
}

async function dailyCron(req: Request, env: CloudEnv): Promise<Response> {
  if (!env.cronSecret || bearer(req) !== env.cronSecret) return json(401, { error: 'unauthorised' });
  const conns = (await env.repo.listConnections()).filter((c) => c.provider === 'up' && c.status !== 'revoked');
  const results: { id: string; ok: boolean }[] = [];
  for (const c of conns) {
    try {
      await syncUpConnection(c, deps(env));
      results.push({ id: c.id, ok: true });
    } catch {
      results.push({ id: c.id, ok: false });
    }
  }
  return json(200, { ok: true, synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}

async function listingFetch(url: URL, env: CloudEnv, member: Member): Promise<Response> {
  limit(env, `listing:${member.userId}`, 20);
  try {
    const r = await fetchListing(url.searchParams.get('url') ?? '');
    return json(200, { ok: true, ...r });
  } catch (e) {
    const message = e instanceof FetchRefused ? e.message : 'The page could not be retrieved (network error or timeout). Copy the listing text from your browser and paste it instead.';
    return json(200, { ok: false, message });
  }
}

/** Returns null when no cloud route matches, so the caller can fall through. */
export async function cloudApi(req: Request, env: CloudEnv): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  let cached: Member | null = null;
  const member = async () => (cached ??= await authenticate(req, env));

  const hook = path.match(/^\/api\/webhooks\/up\/([^/]+)$/);
  if (hook && method === 'POST') return upWebhook(req, env, hook[1]);
  if (path === '/api/cron/daily' && method === 'GET') return dailyCron(req, env);

  if (path === '/api/up/connect' && method === 'POST') return connectUp(req, env, await member());
  if (path === '/api/up/sync' && method === 'POST') return syncMine(env, await member());
  if (path === '/api/up/disconnect' && method === 'POST') return disconnectUp(env, await member());
  if (path === '/api/account/delete' && method === 'POST') return deleteAccount(req, env, await member());
  if (path === '/api/listing/fetch' && method === 'GET') return listingFetch(url, env, await member());

  for (const routes of env.extraRoutes ?? []) {
    const r = await routes(req, url, { env, member });
    if (r) return r;
  }
  return null;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
  console.error('[api] unexpected error', e instanceof Error ? e.message : e);
  return json(500, { error: 'internal', message: 'Unexpected server error.' });
}
