/**
 * Local API server.
 *
 * Responsibilities: hold open-banking provider secrets, talk to providers, and fetch
 * public listing pages for the property analyser. It does not store financial data:
 * the browser keeps the workspace (IndexedDB) and the server returns sync results to it.
 *
 * Security model: binds to 127.0.0.1 by default and is meant for one household on one
 * machine. It has no user accounts. Before exposing it beyond localhost, put it behind a
 * real identity provider (see docs/SECURITY.md) — do not add home-made password auth.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ObProviderId } from '../src/domain/openBanking';
import { basiqProvider } from './providers/basiq';
import { mockProvider } from './providers/mock';
import { ProviderError, type ProviderAdapter } from './providers/types';
import { ConnectionVault, loadKey } from './vault';
import { FetchRefused, fetchListing } from './listing';
import { cloudEnvFromProcess } from './cloud/env';
import { extraRoutesFromProcess } from './cloud/extras';
import { handleCloudRequest } from './cloud/handler';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// Optional .env next to package.json; real environment variables take precedence.
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, 'server', '.data'));

// With Supabase configured, /api is the hosted API (same code as the Vercel function).
// Without it, the server keeps its original single-computer mode below.
const cloud = cloudEnvFromProcess(process.env, (repo) => extraRoutesFromProcess(repo));

const key = loadKey(DATA_DIR, PRODUCTION);
const vault = new ConnectionVault(join(DATA_DIR, 'connections.enc'), key);

const providers: Record<ObProviderId, ProviderAdapter> = {
  mock: mockProvider(!PRODUCTION || process.env.ENABLE_MOCK_PROVIDER === 'true'),
  basiq: basiqProvider({
    apiKey: process.env.BASIQ_API_KEY || undefined,
    baseUrl: process.env.BASIQ_BASE_URL ?? 'https://au-api.basiq.io',
    environment: process.env.BASIQ_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
    consentReturnUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.WEB_PORT ?? 5173}/settings?tab=connections`,
  }),
};

// ------------------------------------------------------------------ helpers
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(req: IncomingMessage, limit = 60): boolean {
  const k = `${req.socket.remoteAddress}|${req.url?.split('?')[0]}`;
  const now = Date.now();
  const h = hits.get(k);
  if (!h || h.reset < now) {
    hits.set(k, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++h.n > limit;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new ProviderError('Request too large', 413, 'too_large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ProviderError('Invalid JSON', 400, 'bad_request');
  }
}

/** Reject cross-site requests: the API only serves the app's own origin. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs and server-to-server tools omit Origin
  try {
    const o = new URL(origin);
    return o.hostname === 'localhost' || o.hostname === '127.0.0.1' || (process.env.PUBLIC_URL ? origin === new URL(process.env.PUBLIC_URL).origin : false);
  } catch {
    return false;
  }
}

const provider = (id: unknown): ProviderAdapter => {
  if (id !== 'mock' && id !== 'basiq') throw new ProviderError('Unknown provider', 400, 'bad_request');
  const p = providers[id];
  if (!p.info().configured) throw new ProviderError(p.info().note, 503, 'not_configured');
  return p;
};

// ------------------------------------------------------------------ routes
async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/health') return send(res, 200, { ok: true, production: PRODUCTION, providers: Object.values(providers).map((p) => p.info()) });

  if (path === '/api/ob/providers') return send(res, 200, { providers: Object.values(providers).map((p) => p.info()) });

  if (path === '/api/ob/institutions') return send(res, 200, { institutions: await provider(url.searchParams.get('provider')).institutions() });

  if (path === '/api/ob/consent' && method === 'POST') {
    const body = await readJson(req);
    const owner = body.owner === 'partner' ? 'partner' : 'me';
    const p = provider(body.provider);
    const connectionId = `conn_${randomUUID()}`;
    // Reuse the provider user for this person so all their banks sit under one consent profile.
    const existingUserId = vault.list().find((r) => r.provider === body.provider && r.owner === owner && r.providerUserId && !r.revoked)?.providerUserId;
    const { record, consentUrl } = await p.startConsent({ connectionId, owner, institutionId: String(body.institutionId ?? ''), existingUserId });
    vault.put(record);
    return send(res, 200, { connectionId, consentUrl, institutionName: record.institutionName, environment: p.info().environment, consentExpiresAt: record.consentExpiresAt });
  }

  const m = path.match(/^\/api\/ob\/connections\/(conn_[0-9a-f-]{36})(\/status|\/sync)?$/);
  if (m) {
    const record = vault.get(m[1]);
    if (!record) return send(res, 404, { error: 'not_found', message: 'This connection is not known to the server (it may have been removed, or the server data was reset). Reconnect to continue.' });
    const p = providers[record.provider];
    if (m[2] === '/status' && method === 'GET') return send(res, 200, await p.status(record));
    if (m[2] === '/sync' && method === 'POST') {
      if (rateLimited(req, 10)) return send(res, 429, { error: 'rate_limited', message: 'Too many syncs. Wait a minute and try again.' });
      const body = await readJson(req);
      const from = typeof body.fromDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDate) ? body.fromDate : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const payload = await p.sync(record, { fromDate: from });
      if (payload.institutionName && payload.institutionName !== record.institutionName) vault.put({ ...record, institutionName: payload.institutionName });
      return send(res, 200, payload);
    }
    if (!m[2] && method === 'DELETE') {
      let warning: string | undefined;
      try {
        await p.revoke(record);
      } catch (e) {
        warning = `The provider could not confirm revocation (${e instanceof Error ? e.message : 'error'}). Withdraw consent from your bank's app or the provider's dashboard as well.`;
      }
      vault.delete(record.id);
      return send(res, 200, { ok: true, warning });
    }
  }

  if (path === '/api/listing/fetch' && method === 'GET') {
    if (rateLimited(req, 20)) return send(res, 429, { ok: false, message: 'Too many requests. Wait a minute and try again.' });
    try {
      const r = await fetchListing(url.searchParams.get('url') ?? '');
      return send(res, 200, { ok: true, ...r });
    } catch (e) {
      const message = e instanceof FetchRefused ? e.message : 'The page could not be retrieved (network error or timeout). Copy the listing text from your browser and paste it instead.';
      return send(res, 200, { ok: false, message });
    }
  }

  return send(res, 404, { error: 'not_found' });
}

// ------------------------------------------------------------------ static (production)
const DIST = join(ROOT, 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function serveStatic(res: ServerResponse, url: URL) {
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) return send(res, 503, { error: 'not_built', message: 'Run `npm run build` first.' });
  const immutable = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------ cloud bridge
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 512 * 1024) throw new ProviderError('Request too large', 413, 'too_large');
    chunks.push(c as Buffer);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const method = req.method ?? 'GET';
  return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks) });
}

async function sendWeb(res: ServerResponse, r: Response) {
  res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
  res.end(Buffer.from(await r.arrayBuffer()));
}

// ------------------------------------------------------------------ server
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (cloud && url.pathname.startsWith('/api/')) return await sendWeb(res, await handleCloudRequest(await toWebRequest(req), cloud.env));
    if (url.pathname.startsWith('/api/')) {
      if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden_origin' });
      if (rateLimited(req)) return send(res, 429, { error: 'rate_limited' });
      return await api(req, res, url);
    }
    if (PRODUCTION) return serveStatic(res, url);
    return send(res, 404, { error: 'not_found', message: 'In development the web app is served by Vite on port 5173.' });
  } catch (e) {
    if (e instanceof ProviderError) return send(res, e.status, { error: e.code, message: e.message });
    console.error('[api] unexpected error', e instanceof Error ? e.message : e);
    return send(res, 500, { error: 'internal', message: 'Unexpected server error.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[api] listening on http://${HOST}:${PORT} (${PRODUCTION ? 'production' : 'development'}, ${cloud ? 'hosted mode with Supabase' : 'single-computer mode'})`);
  for (const p of Object.values(providers)) console.log(`[api] provider ${p.info().id}: ${p.info().configured ? 'ready' : 'off'} — ${p.info().note}`);
});
