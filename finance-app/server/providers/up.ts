/**
 * Up Bank API client (https://developer.up.com.au), used only on the server.
 *
 * Each partner creates a personal access token in Up and pastes it into the app once. The
 * token can read balances and transactions. Up's API cannot move money; it can change a
 * transaction's category or tags, which this client never does (it only calls the GET,
 * webhook and ping endpoints below).
 *
 * The token is sent only to api.up.com.au. Pagination links are followed only when they
 * point back at that host, so a malformed response can't send the token elsewhere.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ObAccount, ObAccountType, ObTransaction } from '../../src/domain/openBanking';
import { HttpError } from '../cloud/types';

export const UP_BASE = 'https://api.up.com.au/api/v1';
const UP_HOST = 'api.up.com.au';

interface Money {
  currencyCode: string;
  value: string;
  valueInBaseUnits: number;
}

export interface UpAccount {
  id: string;
  attributes: {
    displayName: string;
    accountType: 'SAVER' | 'TRANSACTIONAL' | 'HOME_LOAN';
    ownershipType: 'INDIVIDUAL' | 'JOINT';
    balance: Money;
    createdAt: string;
  };
}

export interface UpTransaction {
  id: string;
  attributes: {
    status: 'HELD' | 'SETTLED';
    description: string;
    rawText: string | null;
    message: string | null;
    amount: Money;
    createdAt: string;
    settledAt: string | null;
  };
  relationships: {
    account: { data: { id: string } };
    transferAccount?: { data: { id: string } | null };
  };
}

export interface UpWebhookEvent {
  data: {
    id: string;
    attributes: { eventType: 'TRANSACTION_CREATED' | 'TRANSACTION_SETTLED' | 'TRANSACTION_DELETED' | 'PING'; createdAt: string };
    relationships: { webhook: { data: { id: string } }; transaction?: { data: { id: string } } };
  };
}

type FetchLike = typeof fetch;

export class UpClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    // Up tokens start with "up:yeah:". Only the shape is checked here; Up's ping confirms it.
    if (!/^[\x21-\x7e]{20,400}$/.test(token)) {
      throw new HttpError(400, 'bad_token', "That doesn't look like an Up personal access token. Copy the whole token, which starts with up:yeah:");
    }
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== UP_HOST) throw new HttpError(502, 'up_bad_link', 'Up returned a link to an unexpected host.');
    let res: Response;
    try {
      res = await this.fetchImpl(u, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(502, 'up_unreachable', "Couldn't reach Up. Try again shortly.");
    }
    if (res.status === 401) throw new HttpError(401, 'up_unauthorised', 'Up rejected the token. It may have been revoked; create a new one in the Up app.');
    if (res.status === 429) throw new HttpError(429, 'up_rate_limited', 'Up is limiting requests. Try again in a minute.');
    if (res.status === 204) return undefined as T;
    if (!res.ok) throw new HttpError(502, 'up_error', `Up returned an error (${res.status}).`);
    return (await res.json()) as T;
  }

  private async all<T>(first: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = first;
    for (let page = 0; next && page < 200; page++) {
      const body: { data: T[]; links?: { next?: string | null } } = await this.request(next);
      out.push(...body.data);
      next = body.links?.next ?? null;
    }
    return out;
  }

  async ping(): Promise<void> {
    await this.request(`${UP_BASE}/util/ping`);
  }

  accounts(): Promise<UpAccount[]> {
    return this.all<UpAccount>(`${UP_BASE}/accounts?page[size]=100`);
  }

  async account(id: string): Promise<UpAccount> {
    return (await this.request<{ data: UpAccount }>(`${UP_BASE}/accounts/${encodeURIComponent(id)}`)).data;
  }

  transactions(sinceIso: string): Promise<UpTransaction[]> {
    return this.all<UpTransaction>(`${UP_BASE}/transactions?page[size]=100&filter[since]=${encodeURIComponent(sinceIso)}`);
  }

  async transaction(id: string): Promise<UpTransaction> {
    return (await this.request<{ data: UpTransaction }>(`${UP_BASE}/transactions/${encodeURIComponent(id)}`)).data;
  }

  async createWebhook(url: string, description: string): Promise<{ id: string; secretKey: string }> {
    const body = await this.request<{ data: { id: string; attributes: { secretKey: string } } }>(`${UP_BASE}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ data: { attributes: { url, description: description.slice(0, 64) } } }),
    });
    return { id: body.data.id, secretKey: body.data.attributes.secretKey };
  }

  async deleteWebhook(id: string): Promise<void> {
    try {
      await this.request(`${UP_BASE}/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      // Already gone is fine.
      if (!(e instanceof HttpError && e.code === 'up_error')) throw e;
    }
  }
}

const TYPES: Record<UpAccount['attributes']['accountType'], ObAccountType> = {
  TRANSACTIONAL: 'transaction',
  SAVER: 'savings',
  HOME_LOAN: 'mortgage',
};

export function mapUpAccount(a: UpAccount, asAt: string): ObAccount & { joint: boolean } {
  return {
    externalId: a.id,
    name: a.attributes.displayName,
    type: TYPES[a.attributes.accountType] ?? 'other',
    currency: a.attributes.balance.currencyCode || 'AUD',
    balanceCents: a.attributes.balance.valueInBaseUnits,
    availableCents: a.attributes.balance.valueInBaseUnits,
    asAt,
    joint: a.attributes.ownershipType === 'JOINT',
  };
}

/** The calendar date of an Up timestamp, as Up wrote it (Up sends Australian local offsets). */
export function upDate(iso: string): string {
  return iso.slice(0, 10);
}

export function mapUpTransaction(t: UpTransaction): ObTransaction & { transferExternalId: string | null } {
  return {
    externalId: t.id,
    accountExternalId: t.relationships.account.data.id,
    date: upDate(t.attributes.createdAt),
    description: t.attributes.description,
    amountCents: t.attributes.amount.valueInBaseUnits,
    pending: t.attributes.status === 'HELD',
    transferExternalId: t.relationships.transferAccount?.data?.id ?? null,
  };
}

/** Checks Up's X-Up-Authenticity-Signature: the hex SHA-256 HMAC of the raw body. */
export function verifyUpSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
