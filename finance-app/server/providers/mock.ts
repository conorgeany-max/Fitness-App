/**
 * Mock provider for development and demos. Every institution, account and transaction is
 * fictional and labelled "Mock" in the UI. It simulates the shapes a real CDR provider
 * returns, plus failure modes worth testing: expired consent, provider errors and duplicates.
 */
import type { ObAccount, ObConnectionStatus, ObInstitution, ObSyncPayload, ObTransaction } from '../../src/domain/openBanking';
import { ProviderError, type ConnectionRecord, type ProviderAdapter } from './types';

const INSTITUTIONS: ObInstitution[] = [
  { id: 'mock-everyday', name: 'Mock Bank (healthy)', environment: 'mock', scenario: 'healthy' },
  { id: 'mock-expired', name: 'Mock Credit Union (consent expired)', environment: 'mock', scenario: 'expired-consent' },
  { id: 'mock-failing', name: 'Mock Building Society (provider error)', environment: 'mock', scenario: 'failure' },
  { id: 'mock-duplicates', name: 'Mock Bank (sends duplicates)', environment: 'mock', scenario: 'duplicates' },
];

/** Deterministic pseudo-random numbers so repeated syncs return the same history. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function buildData(record: ConnectionRecord, fromDate: string): { accounts: ObAccount[]; transactions: ObTransaction[] } {
  const rand = rng(record.id);
  const now = new Date();
  const asAt = now.toISOString();
  const prefix = record.id.slice(-4);
  const accounts: ObAccount[] = [
    { externalId: `${record.id}-txn`, name: 'Mock Everyday', type: 'transaction', maskedNumber: `xxxx ${prefix}`, currency: 'AUD', balanceCents: 0, availableCents: null, asAt },
    { externalId: `${record.id}-sav`, name: 'Mock Bonus Saver', type: 'savings', maskedNumber: `xxxx ${(Number.parseInt(prefix, 36) % 9000) + 1000}`, currency: 'AUD', balanceCents: Math.round(8_000_00 + rand() * 20_000_00), asAt },
    { externalId: `${record.id}-cc`, name: 'Mock Low Rate Card', type: 'credit-card', maskedNumber: 'xxxx 4242', currency: 'AUD', balanceCents: -Math.round(400_00 + rand() * 1_500_00), availableCents: 6_000_00, asAt },
  ];
  const tx: ObTransaction[] = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const merchants = [
    ['MOCK SUPERMARKET', -60, -180],
    ['MOCK CAFE', -5, -25],
    ['MOCK FUEL', -50, -95],
    ['MOCK STREAMING', -17.99, -17.99],
    ['MOCK PHARMACY', -12, -60],
  ] as const;
  let i = 0;
  let running = 3_200_00;
  for (let d = new Date(start); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = iso(d);
    if (d.getUTCDate() === 1 || d.getUTCDate() === 15) {
      tx.push({ externalId: `${record.id}-t${i++}`, accountExternalId: accounts[0].externalId, date: day, description: 'MOCK EMPLOYER PTY LTD PAY', amountCents: 3_100_00 });
      running += 3_100_00;
    }
    if (d.getUTCDate() === 3) {
      tx.push({ externalId: `${record.id}-t${i++}`, accountExternalId: accounts[0].externalId, date: day, description: 'TRANSFER TO MOCK BONUS SAVER', amountCents: -800_00 });
      tx.push({ externalId: `${record.id}-t${i++}`, accountExternalId: accounts[1].externalId, date: day, description: 'TRANSFER FROM MOCK EVERYDAY', amountCents: 800_00 });
      running -= 800_00;
    }
    if (rand() < 0.55) {
      const [name, lo, hi] = merchants[Math.floor(rand() * merchants.length)];
      const amt = Math.round((lo + (hi - lo) * rand()) * 100);
      const card = rand() < 0.4;
      tx.push({ externalId: `${record.id}-t${i++}`, accountExternalId: accounts[card ? 2 : 0].externalId, date: day, description: name, amountCents: amt, pending: day === iso(now) });
      if (!card) running += amt;
    }
  }
  accounts[0].balanceCents = running;
  accounts[0].availableCents = running;
  return { accounts, transactions: tx };
}

export function mockProvider(enabled: boolean): ProviderAdapter {
  return {
    info: () => ({
      id: 'mock',
      name: 'Mock bank (development)',
      environment: 'mock',
      configured: enabled,
      note: enabled ? 'Fictional banks for testing. No real accounts or money.' : 'Disabled in production (set ENABLE_MOCK_PROVIDER=true to allow).',
    }),
    async institutions() {
      return INSTITUTIONS;
    },
    async startConsent({ connectionId, owner, institutionId }) {
      const inst = INSTITUTIONS.find((x) => x.id === institutionId);
      if (!inst) throw new ProviderError('Unknown mock institution', 400, 'bad_request');
      const expires = new Date(Date.now() + 90 * 864e5).toISOString();
      return {
        record: { id: connectionId, provider: 'mock', owner, institutionId, institutionName: inst.name, createdAt: new Date().toISOString(), consentExpiresAt: inst.scenario === 'expired-consent' ? new Date(Date.now() - 864e5).toISOString() : expires },
        consentUrl: null,
      };
    },
    async status(record) {
      const inst = INSTITUTIONS.find((x) => x.id === record.institutionId);
      const s: ObConnectionStatus = { connectionId: record.id, status: 'active', message: 'Mock consent active', consentExpiresAt: record.consentExpiresAt };
      if (record.revoked) return { ...s, status: 'revoked', message: 'Consent withdrawn' };
      if (inst?.scenario === 'expired-consent') return { ...s, status: 'expired', message: 'Consent has expired. Reconnect to keep syncing.' };
      if (inst?.scenario === 'failure') return { ...s, status: 'error', message: 'The (mock) institution is unavailable.' };
      return s;
    },
    async sync(record, { fromDate }) {
      const inst = INSTITUTIONS.find((x) => x.id === record.institutionId);
      if (record.revoked) throw new ProviderError('Consent was withdrawn for this connection.', 409, 'revoked');
      if (inst?.scenario === 'expired-consent') throw new ProviderError('Consent has expired. Reconnect to grant access again.', 409, 'consent_expired');
      if (inst?.scenario === 'failure') throw new ProviderError('The (mock) institution returned an error. Nothing was changed; try again later.', 502, 'provider_error');
      const data = buildData(record, fromDate);
      const warnings: string[] = [];
      if (inst?.scenario === 'duplicates') {
        // Resend some transactions with new ids but identical details, as some feeds do.
        const dupes = data.transactions.slice(0, 5).map((t, n) => ({ ...t, externalId: `${t.externalId}-dup${n}` }));
        data.transactions.push(...dupes);
        warnings.push('This mock institution deliberately resends 5 transactions to test duplicate handling.');
      }
      return { connectionId: record.id, environment: 'mock', institutionName: record.institutionName, accounts: data.accounts, transactions: data.transactions, fetchedAt: new Date().toISOString(), warnings } satisfies ObSyncPayload;
    },
    async revoke() {
      // Nothing held at a provider.
    },
  };
}
