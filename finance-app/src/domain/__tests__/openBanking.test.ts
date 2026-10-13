import { describe, expect, it } from 'vitest';
import { applySync, type ObSyncPayload } from '../openBanking';

const NOW = '2026-10-13T09:00:00.000Z';
let seq = 0;
const makeId = (p: string) => `${p}_${++seq}`;

const payload = (over: Partial<ObSyncPayload> = {}): ObSyncPayload => ({
  connectionId: 'conn_1',
  environment: 'mock',
  institutionName: 'Mock Bank',
  accounts: [
    { externalId: 'a1', name: 'Everyday', type: 'transaction', currency: 'AUD', balanceCents: 1_234_56, asAt: NOW, maskedNumber: 'xxxx 1111' },
    { externalId: 'a2', name: 'Card', type: 'credit-card', currency: 'AUD', balanceCents: -500_00, availableCents: 5_500_00, asAt: NOW },
  ],
  transactions: [
    { externalId: 't1', accountExternalId: 'a1', date: '2026-10-10', description: 'PAY', amountCents: 3_000_00 },
    { externalId: 't2', accountExternalId: 'a2', date: '2026-10-11', description: 'CAFE', amountCents: -12_50 },
    { externalId: 't3', accountExternalId: 'unknown', date: '2026-10-11', description: 'ORPHAN', amountCents: -1_00 },
  ],
  fetchedAt: NOW,
  warnings: [],
  ...over,
});

describe('applySync', () => {
  it('creates accounts owned solely by the consenting person with the chosen visibility', () => {
    const r = applySync([], { id: 'conn_1', owner: 'partner' }, payload(), 'private', makeId, NOW);
    expect(r.created).toBe(2);
    expect(r.updated).toBe(0);
    const [everyday, card] = r.holdings;
    expect(everyday.ownership).toEqual({ me: 0, partner: 100 });
    expect(everyday.visibility).toBe('private');
    expect(everyday.source).toBe('mock');
    expect(everyday.valueCents).toBe(1_234_56);
    expect(card.kind).toBe('liability');
    expect(card.category).toBe('credit-card');
    expect(card.valueCents).toBe(500_00); // owed amount stored positive on a liability
  });

  it('maps transactions to their holdings and drops ones for unknown accounts', () => {
    const r = applySync([], { id: 'conn_1', owner: 'me' }, payload(), 'shared', makeId, NOW);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions.map((t) => t.externalId)).toEqual(['t1', 't2']);
    expect(r.transactions[1].accountId).toBe(r.holdings[1].id);
    expect(r.transactions.every((t) => t.categoryId === null && t.source === 'mock')).toBe(true);
  });

  it('keeps user edits on re-sync and only refreshes balance and history', () => {
    const first = applySync([], { id: 'conn_1', owner: 'me' }, payload(), 'shared', makeId, NOW);
    const edited = first.holdings.map((h, i) => (i === 0 ? { ...h, name: 'Joint everyday', ownership: { me: 50, partner: 50 } } : h));
    const later = '2026-10-14T09:00:00.000Z';
    const p2 = payload();
    p2.accounts[0] = { ...p2.accounts[0], balanceCents: 2_000_00 };
    const r = applySync(edited, { id: 'conn_1', owner: 'me' }, p2, 'private', makeId, later);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(2);
    const h = r.holdings[0];
    expect(h.id).toBe(edited[0].id);
    expect(h.name).toBe('Joint everyday');
    expect(h.ownership).toEqual({ me: 50, partner: 50 });
    expect(h.visibility).toBe('shared'); // the new visibility only applies to new accounts
    expect(h.valueCents).toBe(2_000_00);
    expect(h.history.map((e) => e.date)).toEqual(['2026-10-13', '2026-10-14']);
  });

  it('labels sandbox and live data honestly', () => {
    expect(applySync([], { id: 'c', owner: 'me' }, payload({ environment: 'sandbox' }), 'shared', makeId, NOW).holdings[0].source).toBe('sandbox');
    expect(applySync([], { id: 'c', owner: 'me' }, payload({ environment: 'live' }), 'shared', makeId, NOW).holdings[0].source).toBe('live');
  });
});
