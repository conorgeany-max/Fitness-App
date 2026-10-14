/**
 * Open banking (Consumer Data Right) data shapes shared by the browser and the local API
 * server, and the pure mapping from a provider sync into workspace records.
 *
 * This file must stay free of '@/...' imports: the server imports it directly.
 * Bank credentials never pass through the app. Consent happens on the accredited
 * provider's own consent screen; the server only ever holds provider API tokens.
 */
import type { BankConnection, DataSource, Holding, HoldingCategory, PersonId, Transaction, Visibility } from './types';

export type ObEnvironment = 'mock' | 'sandbox' | 'live';
export type ObProviderId = 'mock' | 'basiq';

export interface ObProviderInfo {
  id: ObProviderId;
  name: string;
  environment: ObEnvironment;
  configured: boolean;
  /** Plain-English status shown in Settings, e.g. why a provider is unavailable. */
  note: string;
}

export interface ObInstitution {
  id: string;
  name: string;
  environment: ObEnvironment;
  /** For the mock provider: which test scenario this institution simulates. */
  scenario?: 'healthy' | 'expired-consent' | 'failure' | 'duplicates';
}

export type ObAccountType = 'transaction' | 'savings' | 'offset' | 'term-deposit' | 'credit-card' | 'mortgage' | 'personal-loan' | 'investment' | 'other';

export interface ObAccount {
  externalId: string;
  name: string;
  type: ObAccountType;
  /** Masked number as given by the provider (e.g. "xxxx 1234"). Never a full account number. */
  maskedNumber?: string;
  currency: string;
  /** Signed balance as reported: positive = money held, negative = money owed. */
  balanceCents: number;
  availableCents?: number | null;
  asAt: string;
}

export interface ObTransaction {
  externalId: string;
  accountExternalId: string;
  date: string;
  description: string;
  /** Signed: positive = money in. */
  amountCents: number;
  pending?: boolean;
  merchant?: string;
}

export interface ObConsentStart {
  connectionId: string;
  /** Provider-hosted consent page, or null when the mock provider completes consent in-app. */
  consentUrl: string | null;
  institutionName: string;
  environment: ObEnvironment;
  consentExpiresAt?: string;
}

export interface ObConnectionStatus {
  connectionId: string;
  status: 'pending' | 'active' | 'expired' | 'error' | 'revoked';
  message: string;
  consentExpiresAt?: string;
}

export interface ObSyncPayload {
  connectionId: string;
  environment: ObEnvironment;
  institutionName: string;
  accounts: ObAccount[];
  transactions: ObTransaction[];
  fetchedAt: string;
  warnings: string[];
}

export const TYPE_TO_CATEGORY: Record<ObAccountType, HoldingCategory> = {
  transaction: 'transaction',
  savings: 'savings',
  offset: 'offset',
  'term-deposit': 'term-deposit',
  'credit-card': 'credit-card',
  mortgage: 'mortgage-owner',
  'personal-loan': 'personal-loan',
  investment: 'shares-au',
  other: 'other-asset',
};
export const LIABILITY_TYPES: ObAccountType[] = ['credit-card', 'mortgage', 'personal-loan'];

export function sourceFor(env: ObEnvironment): DataSource {
  return env === 'live' ? 'live' : env === 'sandbox' ? 'sandbox' : 'mock';
}

export interface SyncResult {
  /** Holdings to insert or replace (matched by connection + external account id). */
  holdings: Holding[];
  /** New transactions to merge (the store skips ones already imported, by external id). */
  transactions: Transaction[];
  created: number;
  updated: number;
}

/**
 * Map a provider sync into holdings and transactions.
 * - Existing holdings keep the user's edits (name, ownership, visibility, category);
 *   only the balance, sync time and masked number are refreshed.
 * - New accounts belong solely to the person who granted consent, with the visibility
 *   they chose when connecting. Joint accounts can be re-split in Net Worth.
 * - Balances are stored as reported by the provider; nothing is estimated.
 */
export function applySync(
  existing: Holding[],
  conn: Pick<BankConnection, 'id' | 'owner'>,
  payload: ObSyncPayload,
  visibility: Visibility,
  makeId: (prefix: string) => string,
  now = new Date().toISOString(),
): SyncResult {
  const source = sourceFor(payload.environment);
  const today = now.slice(0, 10);
  const byExternal = new Map(existing.filter((h) => h.connectionId === conn.id && h.externalAccountId).map((h) => [h.externalAccountId!, h]));
  const holdings: Holding[] = [];
  const accountIds = new Map<string, string>();
  let created = 0;
  let updated = 0;
  for (const a of payload.accounts) {
    const liability = LIABILITY_TYPES.includes(a.type) || (a.balanceCents < 0 && a.type === 'other');
    const value = liability ? Math.abs(a.balanceCents) : a.balanceCents;
    const prev = byExternal.get(a.externalId);
    const entry = { id: makeId('val'), date: today, valueCents: value, source, reason: 'sync' as const, recordedAt: now, recordedBy: conn.owner as PersonId };
    if (prev) {
      holdings.push({
        ...prev,
        valueCents: value,
        valuedAt: today,
        availableCents: a.availableCents ?? null,
        maskedNumber: a.maskedNumber ?? prev.maskedNumber,
        lastSyncedAt: now,
        source,
        history: [...prev.history.filter((e) => !(e.date === today && e.source === source)), entry].sort((x, y) => x.date.localeCompare(y.date)),
        updatedAt: now,
      });
      accountIds.set(a.externalId, prev.id);
      updated++;
    } else {
      const id = makeId('hold');
      holdings.push({
        id,
        kind: liability ? 'liability' : 'asset',
        category: TYPE_TO_CATEGORY[a.type],
        name: a.name,
        institution: payload.institutionName,
        ownership: conn.owner === 'me' ? { me: 100, partner: 0 } : { me: 0, partner: 100 },
        visibility,
        currency: a.currency || 'AUD',
        valueCents: value,
        valuedAt: today,
        source,
        connectionId: conn.id,
        externalAccountId: a.externalId,
        maskedNumber: a.maskedNumber,
        availableCents: a.availableCents ?? null,
        lastSyncedAt: now,
        history: [entry],
        createdAt: now,
        updatedAt: now,
      });
      accountIds.set(a.externalId, id);
      created++;
    }
  }
  const transactions: Transaction[] = payload.transactions
    .filter((t) => accountIds.has(t.accountExternalId))
    .map((t) => ({
      id: makeId('txn'),
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      currency: 'AUD',
      accountId: accountIds.get(t.accountExternalId)!,
      categoryId: null,
      merchant: t.merchant,
      transfer: 'none',
      tags: [],
      categorisation: { source: 'uncategorised', confidence: 0 },
      source,
      externalId: t.externalId,
      pending: t.pending,
      createdAt: now,
    }));
  return { holdings, transactions, created, updated };
}
