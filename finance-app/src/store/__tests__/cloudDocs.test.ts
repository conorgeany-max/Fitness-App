import { describe, expect, it } from 'vitest';
import { holding, txn } from '@/domain/__tests__/fixtures';
import { assembleWorkspace, EMPTY_PROVIDER, emptyPrivate, emptyShared, merge3, providerTxnId, splitWorkspace, type ProviderData } from '../cloudDocs';

const provider: ProviderData = {
  accounts: [
    { id: 'acc-joint', provider: 'up', external_id: 'up-joint', owners: ['me', 'partner'], joint: true, visibility: 'shared', name: '2Up Spending', account_type: 'transaction', institution: 'Up', currency: 'AUD', balance_cents: 123_45, available_cents: 123_45, as_at: '2026-10-14T01:00:00Z' },
    { id: 'acc-mine', provider: 'up', external_id: 'up-mine', owners: ['me'], joint: false, visibility: 'private', name: 'My saver', account_type: 'savings', institution: 'Up', currency: 'AUD', balance_cents: 5_000_00, available_cents: null, as_at: '2026-10-14T01:00:00Z' },
    { id: 'acc-loan', provider: 'up', external_id: 'up-loan', owners: ['me', 'partner'], joint: true, visibility: 'shared', name: 'Home loan', account_type: 'mortgage', institution: 'Up', currency: 'AUD', balance_cents: -400_000_00, available_cents: null, as_at: '2026-10-14T01:00:00Z' },
  ],
  transactions: [
    { account_id: 'acc-joint', external_id: 't1', date: '2026-10-13', description: 'WOOLWORTHS 1234', amount_cents: -84_20, pending: false, merchant: 'Woolworths', transfer_external_id: null },
    { account_id: 'acc-mine', external_id: 't2', date: '2026-10-12', description: 'Transfer from 2Up', amount_cents: 100_00, pending: false, merchant: null, transfer_external_id: 'up-joint' },
  ],
  balances: [{ account_id: 'acc-mine', date: '2026-10-01', balance_cents: 4_900_00 }],
};

function workspace() {
  const shared = emptyShared();
  const mine = emptyPrivate();
  shared.holdings.push(holding('cash', 1000, { me: 50, partner: 50 }, { id: 'manual-shared' }));
  mine.holdings.push(holding('shares-au', 2000, { me: 100, partner: 0 }, { id: 'manual-private', visibility: 'private' }));
  mine.transactions.push(txn('m1', '2026-10-10', -20, 'manual-private'));
  return assembleWorkspace({ person: 'me', shared, mine, partnerSummary: null, provider });
}

describe('assembleWorkspace', () => {
  it('shows synced balances, with loans as positive liabilities', () => {
    const w = workspace();
    const loan = w.holdings.find((h) => h.id === 'pa_acc-loan')!;
    expect(loan.kind).toBe('liability');
    expect(loan.valueCents).toBe(400_000_00);
    expect(w.holdings.find((h) => h.id === 'pa_acc-mine')!.history).toHaveLength(1);
    expect(w.holdings.find((h) => h.id === 'pa_acc-joint')!.ownership).toEqual({ me: 50, partner: 50 });
  });

  it('marks a transfer from a joint account as internal and categorises the rest', () => {
    const w = workspace();
    expect(w.transactions.find((t) => t.id === 'pt_t2')!.transfer).toBe('internal');
    expect(w.transactions.find((t) => t.id === 'pt_t1')!.categoryId).not.toBeNull();
  });

  it('shows a partner summary only as category totals', () => {
    const w = assembleWorkspace({ person: 'me', shared: null, mine: null, partnerSummary: { generatedAt: '2026-10-14T00:00:00Z', items: [{ category: 'super', valueCents: 90_000_00, count: 1 }] }, provider: EMPTY_PROVIDER });
    const s = w.holdings.find((h) => h.summaryOf === 'partner')!;
    expect(s.valueCents).toBe(90_000_00);
    expect(s.ownership).toEqual({ me: 0, partner: 100 });
    expect(w.settings.shareTotalsOfPrivateItems.partner).toBe(true);
  });
});

describe('splitWorkspace', () => {
  it('round-trips through the documents without losing edits', () => {
    const w = workspace();
    w.transactions = w.transactions.map((t) => (t.id === 'pt_t1' ? { ...t, notes: 'weekly shop' } : t));
    const { shared, mine } = splitWorkspace(w, 'me', provider);
    const again = assembleWorkspace({ person: 'me', shared, mine, partnerSummary: null, provider });
    expect(again.holdings.map((h) => h.id).sort()).toEqual(w.holdings.map((h) => h.id).sort());
    expect(again.transactions.find((t) => t.id === 'pt_t1')!.notes).toBe('weekly shop');
    expect(again.transactions.find((t) => t.id === 'm1')).toBeTruthy();
  });

  it('never writes synced balances or synced transactions into documents', () => {
    const { shared, mine } = splitWorkspace(workspace(), 'me', provider);
    for (const h of [...shared.holdings, ...mine.holdings].filter((h) => h.id.startsWith('pa_'))) {
      expect(h.valueCents).toBeNull();
      expect(h.history).toEqual([]);
    }
    expect([...shared.transactions, ...mine.transactions].some((t) => t.id.startsWith('pt_'))).toBe(false);
    // Untouched synced transactions store nothing at all.
    expect(shared.txnNotes).toEqual({});
  });

  it('keeps private items, their transactions and edits out of the shared document', () => {
    const w = workspace();
    w.transactions = w.transactions.map((t) => (t.id === providerTxnId({ external_id: 't2' }) ? { ...t, notes: 'secret' } : t));
    const { shared, mine } = splitWorkspace(w, 'me', provider);
    const sharedJson = JSON.stringify(shared);
    for (const leak of ['manual-private', 'pa_acc-mine', 'm1', 'secret']) expect(sharedJson).not.toContain(leak);
    expect(mine.holdings.map((h) => h.id).sort()).toEqual(['manual-private', 'pa_acc-mine']);
    expect(mine.txnNotes.pt_t2.notes).toBe('secret');
  });

  it('builds a summary only when the person consents', () => {
    const w = workspace();
    expect(splitWorkspace(w, 'me', provider).summary).toBeNull();
    w.settings.shareTotalsOfPrivateItems = { me: true, partner: false };
    const s = splitWorkspace(w, 'me', provider, '2026-10-14T00:00:00Z');
    expect(s.summary!.items.map((i) => i.count)).toEqual([1, 1]);
    expect(s.summary!.items.reduce((a, i) => a + i.valueCents, 0)).toBe(7_000_00);
    expect(JSON.stringify(s.summary)).not.toMatch(/name|My saver|manual-private/);
    expect(s.mine.prefs.shareTotalsOfPrivateItems).toBe(true);
  });

  it("drops the partner's summary rows instead of saving them", () => {
    const w = assembleWorkspace({ person: 'me', shared: null, mine: null, partnerSummary: { generatedAt: '2026-10-14T00:00:00Z', items: [{ category: 'super', valueCents: 1, count: 1 }] }, provider: EMPTY_PROVIDER });
    const { shared, mine } = splitWorkspace(w, 'me', EMPTY_PROVIDER);
    expect(JSON.stringify([shared, mine])).not.toContain('sum_');
  });
});

describe('merge3', () => {
  it('keeps both people’s additions and each side’s field edits', () => {
    const base = { goals: [{ id: 'a', name: 'Car', target: 1 }], note: 'x' };
    const local = { goals: [{ id: 'a', name: 'New car', target: 1 }, { id: 'b', name: 'Trip', target: 2 }], note: 'x' };
    const remote = { goals: [{ id: 'a', name: 'Car', target: 5 }, { id: 'c', name: 'Wedding', target: 3 }], note: 'y' };
    expect(merge3(base, local, remote)).toEqual({
      goals: [{ id: 'a', name: 'New car', target: 5 }, { id: 'c', name: 'Wedding', target: 3 }, { id: 'b', name: 'Trip', target: 2 }],
      note: 'y',
    });
  });

  it('honours deletions on either side', () => {
    const base = { list: [{ id: 'a' }, { id: 'b' }], k: 1 } as { list: { id: string }[]; k?: number };
    const local = { list: [{ id: 'a' }] };
    const remote = { list: [{ id: 'b' }], k: 1 };
    expect(merge3(base, local, remote)).toEqual({ list: [] });
  });
});

describe('synced positions', () => {
  it('attaches fund positions to their account and never saves them in documents', () => {
    const withPositions: ProviderData = {
      ...provider,
      accounts: [...provider.accounts, { id: 'acc-broker', provider: 'snaptrade', external_id: 'st-1', owners: ['me'], joint: false, visibility: 'shared', name: 'Brokerage', account_type: 'investment', institution: 'Stake', currency: 'AUD', balance_cents: 1_000_00, available_cents: null, as_at: '2026-10-14T01:00:00Z' }],
      positions: [{ account_id: 'acc-broker', symbol: 'VAS', description: 'Vanguard Australian Shares', units: '10', value_cents: '100000', currency: 'AUD' }],
    };
    const w = assembleWorkspace({ person: 'me', shared: null, mine: null, partnerSummary: null, provider: withPositions });
    expect(w.holdings.find((h) => h.id === 'pa_acc-broker')!.positions).toEqual([{ symbol: 'VAS', description: 'Vanguard Australian Shares', units: 10, valueCents: 1_000_00, currency: 'AUD' }]);
    const { shared } = splitWorkspace(w, 'me', withPositions);
    expect(JSON.stringify(shared)).not.toContain('VAS');
  });
});
