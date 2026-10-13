import { describe, expect, it } from 'vitest';
import { computeBalanceSheet } from '../networth';
import { OWN_JOINT, OWN_ME, OWN_PARTNER, validateOwnership, splitByOwnership } from '../ownership';
import { explainChange, takeSnapshot, buildHistorySeries } from '../history';
import { holding, SETTINGS } from './fixtures';

const TODAY = '2026-10-13';

describe('net worth', () => {
  it('net worth equals total assets minus total liabilities', () => {
    const hs = [holding('savings', 20000, OWN_ME), holding('etf', 15000, OWN_PARTNER), holding('credit-card', 3000, OWN_ME)];
    const bs = computeBalanceSheet(hs, 'household', SETTINGS, TODAY);
    expect(bs.assetsCents).toBe(3500000);
    expect(bs.liabilitiesCents).toBe(300000);
    expect(bs.netWorthCents).toBe(bs.assetsCents - bs.liabilitiesCents);
  });

  it('counts a joint property and joint mortgage once in the household view', () => {
    const home = holding('property-home', 800000, OWN_JOINT);
    const loan = holding('mortgage-owner', 500000, OWN_JOINT);
    const hh = computeBalanceSheet([home, loan], 'household', SETTINGS, TODAY);
    expect(hh.assetsCents).toBe(80000000);
    expect(hh.liabilitiesCents).toBe(50000000);
    expect(hh.netWorthCents).toBe(30000000);
    expect(hh.propertyEquityCents).toBe(30000000);
    const me = computeBalanceSheet([home, loan], 'me', SETTINGS, TODAY);
    expect(me.assetsCents).toBe(40000000);
    expect(me.liabilitiesCents).toBe(25000000);
  });

  it('individual views reconcile to the household view for any ownership split', () => {
    const hs = [
      holding('property-investment', 650000.01, { me: 70, partner: 30 }),
      holding('mortgage-investment', 480000.03, { me: 33.33, partner: 66.67 }),
      holding('savings', 12345.67, OWN_JOINT),
      holding('super', 98765.43, OWN_ME),
      holding('car-loan', 15000.99, OWN_PARTNER),
    ];
    const hh = computeBalanceSheet(hs, 'household', SETTINGS, TODAY);
    const me = computeBalanceSheet(hs, 'me', SETTINGS, TODAY);
    const pa = computeBalanceSheet(hs, 'partner', SETTINGS, TODAY);
    expect(me.assetsCents + pa.assetsCents).toBe(hh.assetsCents);
    expect(me.liabilitiesCents + pa.liabilitiesCents).toBe(hh.liabilitiesCents);
    expect(me.netWorthCents + pa.netWorthCents).toBe(hh.netWorthCents);
  });

  it('validates ownership allocations', () => {
    expect(validateOwnership({ me: 60, partner: 40 })).toBeNull();
    expect(validateOwnership({ me: 60, partner: 30 })).toMatch(/100%/);
    expect(validateOwnership({ me: -10, partner: 110 })).toMatch(/negative/);
    expect(splitByOwnership(1001, { me: 50, partner: 50 })).toEqual({ me: 501, partner: 500 });
  });

  it('does not mistake missing or stale data for a current balance', () => {
    const missing = holding('savings', null, OWN_ME);
    const stale = holding('transaction', 1000, OWN_ME, { source: 'live', valuedAt: '2026-10-01', lastSyncedAt: '2026-10-01T00:00:00Z' });
    const fresh = holding('savings', 500, OWN_ME);
    const bs = computeBalanceSheet([missing, stale, fresh], 'household', SETTINGS, TODAY);
    expect(bs.missingCount).toBe(1);
    expect(bs.staleCount).toBe(1);
    expect(bs.items.find((i) => i.holding.id === missing.id)!.status).toBe('missing');
    expect(bs.items.find((i) => i.holding.id === stale.id)!.status).toBe('stale');
    expect(bs.assetsCents).toBe(150000); // missing value is excluded, not counted as $0 "current"
  });

  it('converts foreign currency and excludes items without a rate', () => {
    const us = holding('shares-intl', 1000, OWN_ME, { currency: 'USD' });
    const eu = holding('shares-intl', 1000, OWN_ME, { currency: 'EUR' });
    const bs = computeBalanceSheet([us, eu], 'household', SETTINGS, TODAY);
    expect(bs.assetsCents).toBe(150000);
    expect(bs.items.find((i) => i.holding.id === eu.id)!.status).toBe('no-fx');
  });

  it('respects private items and sharing consent', () => {
    const minePrivate = holding('savings', 1000, OWN_ME, { visibility: 'private' });
    const partnerPrivate = holding('savings', 2000, OWN_PARTNER, { visibility: 'private' });
    const bs = computeBalanceSheet([minePrivate, partnerPrivate], 'household', SETTINGS, TODAY);
    // active user is "me": own private item is fully visible; partner has not consented to share totals.
    expect(bs.assetsCents).toBe(100000);
    expect(bs.hiddenPrivateCount).toBe(1);
    const consent = { ...SETTINGS, shareTotalsOfPrivateItems: { me: true, partner: true } };
    const bs2 = computeBalanceSheet([minePrivate, partnerPrivate], 'household', consent, TODAY);
    expect(bs2.assetsCents).toBe(300000);
    expect(bs2.aggregatedPrivateCount).toBe(1);
  });

  it('separates liquid, investable, super and property equity', () => {
    const hs = [
      holding('offset', 50000, OWN_JOINT),
      holding('etf', 30000, OWN_ME),
      holding('super', 100000, OWN_ME),
      holding('property-home', 900000, OWN_JOINT),
      holding('mortgage-owner', 600000, OWN_JOINT),
      holding('credit-card', 2000, OWN_ME),
      holding('vehicle', 20000, OWN_PARTNER),
    ];
    const bs = computeBalanceSheet(hs, 'household', SETTINGS, TODAY);
    expect(bs.liquidCents).toBe(5000000);
    expect(bs.liquidNetWorthCents).toBe(4800000);
    expect(bs.investableCents).toBe(8000000);
    expect(bs.superCents).toBe(10000000);
    expect(bs.propertyEquityCents).toBe(30000000);
  });
});

describe('net worth history', () => {
  const entry = (date: string, dollars: number) => ({ id: date, date, valueCents: dollars * 100, source: 'manual' as const, reason: 'manual-update' as const, recordedAt: `${date}T00:00:00Z` });

  it('reconstructs history from valuations and labels it', () => {
    const acc = holding('savings', 3000, OWN_ME, { history: [entry('2026-07-15', 1000), entry('2026-08-15', 2000)], valuedAt: '2026-09-15' });
    const series = buildHistorySeries([], [acc], SETTINGS, 'household', '2026-06', '2026-09');
    expect(series.map((p) => p.netWorthCents)).toEqual([100000, 200000, 300000]);
    expect(series.every((p) => p.kind === 'reconstructed')).toBe(true);
    const snap = takeSnapshot([acc], SETTINGS, '2026-09-30', 's1');
    const series2 = buildHistorySeries([snap], [acc], SETTINGS, 'household', '2026-07', '2026-09');
    expect(series2[2].kind).toBe('recorded');
  });

  it('explains a change as components that sum to the total', () => {
    const cash = holding('savings', 12000, OWN_ME, { history: [entry('2026-01-01', 10000)], valuedAt: '2026-06-30' });
    const loan = holding('mortgage-owner', 495000, OWN_ME, { history: [entry('2026-01-01', 500000)], valuedAt: '2026-06-30' });
    const home = holding('property-home', 820000, OWN_ME, { history: [entry('2026-01-01', 800000)], valuedAt: '2026-06-30' });
    const r = explainChange([cash, loan, home], [], [], SETTINGS, 'household', '2026-01-01', '2026-06-30');
    expect(r.totalCents).toBe(200000 + 500000 + 2000000);
    expect(r.components.find((c) => c.key === 'debt')!.cents).toBe(500000);
    expect(r.components.find((c) => c.key === 'property')!.cents).toBe(2000000);
  });
});
