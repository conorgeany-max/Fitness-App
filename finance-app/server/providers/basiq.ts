/**
 * Basiq adapter (Basiq is an accredited CDR data recipient that offers an intermediary
 * service). Runs only on the server with BASIQ_API_KEY from the environment.
 *
 * Flow:
 *   1. Server token (scope SERVER_ACCESS) from POST /token using the API key.
 *   2. Create a Basiq user for this person (once) and remember its id, encrypted.
 *   3. Client token (scope CLIENT_ACCESS, bound to that user) → consent URL on
 *      consent.basiq.io. The person chooses their bank and consents there; this app never
 *      sees bank credentials.
 *   4. Sync reads /users/{id}/accounts and /users/{id}/transactions.
 *
 * Endpoint shapes follow Basiq's v3 API reference. Check them against the current docs
 * before production use; see docs/OPEN_BANKING.md for what a live deployment needs
 * (accreditation or a CDR representative arrangement, consent records, retention).
 */
import type { ObAccount, ObAccountType, ObInstitution, ObSyncPayload, ObTransaction } from '../../src/domain/openBanking';
import { ProviderError, type ProviderAdapter } from './types';

interface BasiqConfig {
  apiKey: string | undefined;
  baseUrl: string;
  environment: 'sandbox' | 'live';
  consentReturnUrl: string;
}

type Json = Record<string, unknown>;

export function basiqProvider(cfg: BasiqConfig): ProviderAdapter {
  let serverToken: { token: string; expires: number } | null = null;

  async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Json> {
    const token = init.token ?? (await getServerToken());
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'basiq-version': '3.0', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Provider error bodies can echo request data; log the status only.
      console.warn(`[basiq] ${init.method ?? 'GET'} ${path} → ${res.status}`);
      throw new ProviderError(res.status === 401 || res.status === 403 ? 'The open-banking provider rejected the app’s credentials.' : `The open-banking provider returned an error (${res.status}).`, 502, body.includes('consent') ? 'consent_error' : 'provider_error');
    }
    return (await res.json()) as Json;
  }

  async function getServerToken(): Promise<string> {
    if (!cfg.apiKey) throw new ProviderError('Basiq is not configured on this server.', 503, 'not_configured');
    if (serverToken && serverToken.expires > Date.now() + 60_000) return serverToken.token;
    const res = await fetch(`${cfg.baseUrl}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${cfg.apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'basiq-version': '3.0' },
      body: 'scope=SERVER_ACCESS',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ProviderError(`Could not authenticate with the open-banking provider (${res.status}).`, 502, 'auth_failed');
    const body = (await res.json()) as { access_token: string; expires_in: number };
    serverToken = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return serverToken.token;
  }

  async function clientToken(userId: string): Promise<string> {
    const res = await fetch(`${cfg.baseUrl}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${cfg.apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'basiq-version': '3.0' },
      body: `scope=CLIENT_ACCESS&userId=${encodeURIComponent(userId)}`,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ProviderError(`Could not start consent with the provider (${res.status}).`, 502, 'auth_failed');
    return ((await res.json()) as { access_token: string }).access_token;
  }

  const mapType = (t: string, cls: string): ObAccountType => {
    const s = `${t} ${cls}`.toLowerCase();
    if (s.includes('credit')) return 'credit-card';
    if (s.includes('mortgage') || s.includes('home loan')) return 'mortgage';
    if (s.includes('loan')) return 'personal-loan';
    if (s.includes('offset')) return 'offset';
    if (s.includes('term')) return 'term-deposit';
    if (s.includes('saving')) return 'savings';
    if (s.includes('transaction') || s.includes('everyday')) return 'transaction';
    return 'other';
  };
  const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

  return {
    info: () => ({
      id: 'basiq',
      name: cfg.environment === 'live' ? 'Basiq (CDR)' : 'Basiq sandbox',
      environment: cfg.environment,
      configured: !!cfg.apiKey,
      note: cfg.apiKey
        ? cfg.environment === 'live'
          ? 'Live CDR data via Basiq. Requires your own Basiq production agreement.'
          : 'Basiq sandbox: test banks such as "Hooli" with test credentials from Basiq’s docs. No real accounts.'
        : 'Not configured. Set BASIQ_API_KEY on the server (see docs/OPEN_BANKING.md).',
    }),

    async institutions() {
      const body = await call('/institutions');
      const list = (body.data as Json[] | undefined) ?? [];
      return list.slice(0, 500).map((i): ObInstitution => ({ id: String(i.id), name: String(i.name ?? i.shortName ?? i.id), environment: cfg.environment }));
    },

    async startConsent({ connectionId, owner, institutionId, existingUserId }) {
      let userId = existingUserId;
      if (!userId) {
        // Basiq users are created without personal details; the person may add them on the consent screen.
        const user = await call('/users', { method: 'POST', body: JSON.stringify({}) });
        userId = String(user.id);
      }
      const token = await clientToken(userId);
      const url = new URL('https://consent.basiq.io/home');
      url.searchParams.set('token', token);
      if (institutionId) url.searchParams.set('institutionId', institutionId);
      url.searchParams.set('state', connectionId);
      return {
        record: { id: connectionId, provider: 'basiq', owner, institutionId, institutionName: 'Chosen on consent screen', createdAt: new Date().toISOString(), providerUserId: userId },
        consentUrl: url.toString(),
      };
    },

    async status(record) {
      if (!record.providerUserId) return { connectionId: record.id, status: 'pending', message: 'Consent not started' };
      const body = await call(`/users/${encodeURIComponent(record.providerUserId)}/connections`);
      const list = (body.data as Json[] | undefined) ?? [];
      if (!list.length) return { connectionId: record.id, status: 'pending', message: 'Waiting for consent to be completed on the provider’s screen.' };
      const c = list[0];
      const st = String(c.status ?? 'active');
      const expiry = (c.expiryDate as string | undefined) ?? undefined;
      if (st === 'invalid' || st === 'expired' || (expiry && Date.parse(expiry) < Date.now())) return { connectionId: record.id, status: 'expired', message: 'Consent expired or needs to be renewed.', consentExpiresAt: expiry };
      return { connectionId: record.id, status: 'active', message: 'Consent active', consentExpiresAt: expiry };
    },

    async sync(record, { fromDate }) {
      if (!record.providerUserId) throw new ProviderError('Consent has not been completed for this connection.', 409, 'consent_pending');
      const uid = encodeURIComponent(record.providerUserId);
      const acc = await call(`/users/${uid}/accounts`);
      const accounts: ObAccount[] = ((acc.data as Json[] | undefined) ?? []).map((a) => ({
        externalId: String(a.id),
        name: String(a.name ?? 'Account'),
        type: mapType(String((a.class as Json | undefined)?.type ?? ''), String((a.class as Json | undefined)?.product ?? a.name ?? '')),
        maskedNumber: a.accountNo ? `xxxx ${String(a.accountNo).slice(-4)}` : undefined,
        currency: String(a.currency ?? 'AUD'),
        balanceCents: cents(a.balance),
        availableCents: a.availableFunds !== undefined ? cents(a.availableFunds) : null,
        asAt: String(a.lastUpdated ?? new Date().toISOString()),
      }));
      const transactions: ObTransaction[] = [];
      let next: string | null = `/users/${uid}/transactions?limit=500&filter=${encodeURIComponent(`transaction.postDate.gteq('${fromDate}')`)}`;
      let pages = 0;
      while (next && pages++ < 20) {
        const page = await call(next);
        for (const t of (page.data as Json[] | undefined) ?? []) {
          const date = String(t.postDate ?? t.transactionDate ?? '').slice(0, 10);
          if (!date) continue;
          transactions.push({
            externalId: String(t.id),
            accountExternalId: String(t.account),
            date,
            description: String(t.description ?? ''),
            amountCents: cents(t.amount),
            pending: t.status === 'pending',
            merchant: ((t.enrich as Json | undefined)?.merchant as Json | undefined)?.businessName as string | undefined,
          });
        }
        const links = page.links as Json | undefined;
        const href = links?.next ? String(links.next) : null;
        next = href ? href.replace(cfg.baseUrl, '') : null;
      }
      return { connectionId: record.id, environment: cfg.environment, institutionName: record.institutionName, accounts, transactions, fetchedAt: new Date().toISOString(), warnings: pages > 20 ? ['Transaction history was truncated at 10,000 records.'] : [] } satisfies ObSyncPayload;
    },

    async revoke(record) {
      if (!record.providerUserId) return;
      // Deleting the Basiq user removes its connections and data at the provider.
      await call(`/users/${encodeURIComponent(record.providerUserId)}`, { method: 'DELETE' });
    },
  };
}
