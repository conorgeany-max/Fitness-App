/** Small helpers for Web-standard Request/Response handlers (Netlify functions and the local server). */
import { HttpError } from './types';

export const MAX_BODY = 64 * 1024;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

export async function readText(req: Request, limit = MAX_BODY): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit) throw new HttpError(413, 'too_large', 'Request too large.');
  const text = await req.text();
  if (Buffer.byteLength(text) > limit) throw new HttpError(413, 'too_large', 'Request too large.');
  return text;
}

export async function readJson<T = Record<string, unknown>>(req: Request, limit = MAX_BODY): Promise<T> {
  const text = await readText(req, limit);
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as T;
  } catch {
    throw new HttpError(400, 'bad_request', 'Invalid JSON.');
  }
}

/** Fixed-window limiter, per server instance. A backstop, not the only defence. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  check(key: string, limit: number, windowMs = 60_000): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + windowMs });
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
      return true;
    }
    return ++h.n <= limit;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
