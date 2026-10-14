/** House screener routes: Domain listing search, available once Domain approves the app. */
import { DomainClient, type DomainSearch } from '../providers/domain';
import { json, readJson } from './http';
import { limit, type ExtraRoutes } from './routes';

const STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), max) : null);
const list = (v: unknown, maxLen: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 60).slice(0, maxLen) : []);

export function domainRoutes(client: DomainClient | null): ExtraRoutes {
  return async (req, url, { env, member }) => {
    if (url.pathname === '/api/domain/status' && req.method === 'GET') {
      await member();
      return json(200, { available: !!client });
    }
    if (url.pathname === '/api/domain/search' && req.method === 'POST') {
      const m = await member();
      if (!client) return json(404, { error: 'not_configured', message: 'Domain search is not set up. Paste listings instead.' });
      limit(env, `domain:${m.householdId}`, 5, 'Too many searches. Wait a minute and try again.');
      const b = await readJson<Record<string, unknown>>(req);
      const search: DomainSearch = {
        state: typeof b.state === 'string' && STATES.includes(b.state) ? b.state : 'VIC',
        suburbs: list(b.suburbs, 10),
        minBedrooms: n(b.minBedrooms, 10),
        minBathrooms: n(b.minBathrooms, 10),
        minCarspaces: n(b.minCarspaces, 10),
        maxPriceCents: n(b.maxPriceCents, 100_000_000_00),
        propertyTypes: list(b.propertyTypes, 10),
      };
      return json(200, { ok: true, listings: await client.search(search) });
    }
    return null;
  };
}
