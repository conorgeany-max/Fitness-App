/**
 * SnapTrade, read-only, with a Personal API key: each partner creates their own key in
 * SnapTrade's dashboard and connects their brokerages there (as read-only connections). The
 * app only calls account and holdings endpoints; it never calls SnapTrade's trading endpoints.
 *
 * Request signing follows SnapTrade's SDK: an HMAC-SHA256 (base64) of the sorted-key JSON
 * {content, path, query}, keyed with the consumer key, sent in the Signature header.
 */
import { createHmac } from 'node:crypto';
import type { ObAccount } from '../../src/domain/openBanking';
import { HttpError, type Position } from '../cloud/types';

export const SNAPTRADE_HOST = 'api.snaptrade.com';

export interface SnapTradeCredentials {
  clientId: string;
  consumerKey: string;
}

export interface SnapTradeAccount {
  id: string;
  name: string | null;
  number?: string;
  institution_name: string;
  balance?: { total?: { amount?: number; currency?: string } | null };
  status?: string;
}

export interface SnapTradeHoldings {
  balances?: { currency?: { code?: string }; cash?: number | null }[] | null;
  positions?: {
    symbol?: { symbol?: { symbol?: string; raw_symbol?: string; description?: string | null; currency?: { code?: string } }; description?: string };
    units?: number | null;
    fractional_units?: number | null;
    price?: number | null;
    currency?: { code?: string };
    cash_equivalent?: boolean | null;
  }[] | null;
  total_value?: { value?: number | null; currency?: string | null };
}

/** Keys sort the way SnapTrade's SDK sorts them, so the server computes the same signature. */
function sortedJson(obj: unknown): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  JSON.stringify(obj, (k, v) => {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
    return v;
  });
  keys.sort();
  return JSON.stringify(obj, keys);
}

export function signSnapTrade(consumerKey: string, path: string, query: string, content: unknown = null): string {
  return createHmac('sha256', encodeURI(consumerKey)).update(sortedJson({ content, path, query })).digest('base64');
}

export function parseSnapTradeCredentials(raw: unknown): SnapTradeCredentials {
  const r = (raw ?? {}) as Record<string, unknown>;
  const clientId = typeof r.clientId === 'string' ? r.clientId.trim() : '';
  const consumerKey = typeof r.consumerKey === 'string' ? r.consumerKey.trim() : '';
  if (!/^[\x21-\x7e]{4,200}$/.test(clientId) || !/^[\x21-\x7e]{16,400}$/.test(consumerKey)) {
    throw new HttpError(400, 'bad_key', 'Paste both the Client ID and the Consumer Key from your SnapTrade dashboard.');
  }
  return { clientId, consumerKey };
}

export class SnapTradeClient {
  constructor(
    private readonly creds: SnapTradeCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async get<T>(path: string): Promise<T> {
    const query = new URLSearchParams({ clientId: this.creds.clientId, timestamp: String(Math.round(this.now().getTime() / 1000)) }).toString();
    const url = new URL(`https://${SNAPTRADE_HOST}${path}?${query}`);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json', Signature: signSnapTrade(this.creds.consumerKey, path, query) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(502, 'snaptrade_unreachable', "Couldn't reach SnapTrade. Try again shortly.");
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'snaptrade_unauthorised', 'SnapTrade rejected the key. Check the Client ID and Consumer Key, or create a new key in SnapTrade.');
    if (res.status === 429) throw new HttpError(429, 'snaptrade_rate_limited', 'SnapTrade is limiting requests. Try again in a minute.');
    if (!res.ok) throw new HttpError(502, 'snaptrade_error', `SnapTrade returned an error (${res.status}).`);
    return (await res.json()) as T;
  }

  accounts(): Promise<SnapTradeAccount[]> {
    return this.get<SnapTradeAccount[]>('/accounts');
  }

  holdings(accountId: string): Promise<SnapTradeHoldings> {
    return this.get<SnapTradeHoldings>(`/accounts/${encodeURIComponent(accountId)}/holdings`);
  }
}

const cents = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : null);

/** An account's value as SnapTrade reports it: holdings total if given, otherwise the account balance. */
export function mapSnapTradeAccount(a: SnapTradeAccount, h: SnapTradeHoldings | null, asAt: string): ObAccount | null {
  const total = cents(h?.total_value?.value) ?? cents(a.balance?.total?.amount);
  if (total === null) return null;
  const currency = (h?.total_value?.currency || a.balance?.total?.currency || 'AUD').toUpperCase();
  const last4 = a.number ? a.number.replace(/\s/g, '').slice(-4) : '';
  return {
    externalId: a.id,
    name: a.name?.trim() || `${a.institution_name} account`,
    type: 'investment',
    maskedNumber: last4 ? `xxxx ${last4}` : undefined,
    currency,
    balanceCents: total,
    availableCents: null,
    asAt,
  };
}

export function mapSnapTradePositions(h: SnapTradeHoldings): Position[] {
  const out = new Map<string, Position>();
  for (const p of h.positions ?? []) {
    const sym = p.symbol?.symbol;
    const symbol = sym?.symbol || sym?.raw_symbol;
    if (!symbol) continue;
    // `units` already includes any fractional part; `fractional_units` is the older field.
    const units = p.units ?? p.fractional_units ?? 0;
    const priceCents = cents(p.price);
    const prev = out.get(symbol);
    out.set(symbol, {
      symbol,
      description: sym?.description ?? p.symbol?.description ?? null,
      units: (prev?.units ?? 0) + units,
      priceCents,
      valueCents: priceCents === null ? null : Math.round(priceCents * ((prev?.units ?? 0) + units)),
      currency: (p.currency?.code || sym?.currency?.code || 'AUD').toUpperCase(),
    });
  }
  return [...out.values()];
}
