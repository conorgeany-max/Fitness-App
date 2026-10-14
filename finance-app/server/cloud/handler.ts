/**
 * One entry point for the hosted API, shared by the Netlify function (netlify/functions/api.mts) and the
 * local server. Takes a Web Request, returns a Web Response.
 */
import { json } from './http';
import { cloudApi, errorResponse, type CloudEnv } from './routes';

/** If a host rewrites /api/<path> to /api?__path=<path>, restore the original path. */
export function originalUrl(req: Request): URL {
  const url = new URL(req.url);
  const rewritten = url.searchParams.get('__path');
  if (url.pathname === '/api' && rewritten !== null) {
    url.pathname = `/api/${rewritten.replace(/^\/+/, '')}`;
    url.searchParams.delete('__path');
  }
  return url;
}

export async function handleCloudRequest(req: Request, env: CloudEnv | null): Promise<Response> {
  const url = originalUrl(req);
  if (url.pathname === '/api/health') return json(200, { ok: true, mode: env ? 'cloud' : 'not-configured' });
  if (!env) return json(503, { error: 'not_configured', message: 'The server is missing its Supabase settings. See docs/DEPLOY.md.' });
  const normalised = url.toString() === req.url ? req : new Request(url, req);
  try {
    return (await cloudApi(normalised, env)) ?? json(404, { error: 'not_found' });
  } catch (e) {
    return errorResponse(e);
  }
}
