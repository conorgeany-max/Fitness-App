import { describe, expect, it } from 'vitest';
import { emptyListing } from '../property/listingParser';
import { DEFAULT_CRITERIA, screenListing, splitListings, type ScreenCriteria } from '../property/screener';
import type { PropertyAnalysis, PropertyListing } from '../types';

function prop(fields: Partial<Record<keyof PropertyListing, unknown>>, extra: Partial<PropertyAnalysis> = {}): PropertyAnalysis {
  const listing = emptyListing();
  for (const [k, v] of Object.entries(fields)) (listing as unknown as Record<string, { value: unknown; status: string }>)[k] = { value: v, status: 'extracted' };
  return { id: 'p', name: 'x', rawText: '', listing, settings: {} as PropertyAnalysis['settings'], shortlisted: false, createdAt: '', updatedAt: '', ...extra };
}

const C: ScreenCriteria = { ...DEFAULT_CRITERIA, maxPriceCents: 900_000_00, suburbs: ['Brunswick', 'Coburg'], minBedrooms: 3, maxCommuteMinutes: 40, useAffordability: true };

describe('house screener', () => {
  it('passes a listing that meets every criterion', () => {
    const r = screenListing(prop({ priceCents: 850_000_00, suburb: 'brunswick', bedrooms: 3 }, { commuteMinutes: 30 }), C, 'comfortable');
    expect(r.verdict).toBe('pass');
    expect(r.unknowns).toBe(0);
  });

  it('uses the top of a price range and calls a small overrun a stretch', () => {
    const r = screenListing(prop({ priceCents: 880_000_00, priceMaxCents: 930_000_00, suburb: 'Coburg', bedrooms: 3 }, { commuteMinutes: 30 }), C, 'comfortable');
    expect(r.verdict).toBe('stretch');
    expect(r.checks.find((c) => c.key === 'price')!.text).toMatch(/930,000.*3\.3% over/);
  });

  it('fails on the wrong suburb or unsupported finances', () => {
    expect(screenListing(prop({ priceCents: 800_000_00, suburb: 'Richmond', bedrooms: 3 }, { commuteMinutes: 20 }), C, 'comfortable').verdict).toBe('fail');
    expect(screenListing(prop({ priceCents: 800_000_00, suburb: 'Coburg', bedrooms: 3 }, { commuteMinutes: 20 }), C, 'not-supported').verdict).toBe('fail');
  });

  it('reports missing details as unknown instead of assuming them', () => {
    const r = screenListing(prop({ suburb: 'Coburg' }), C, null);
    expect(r.checks.filter((c) => c.verdict === 'unknown').map((c) => c.key).sort()).toEqual(['afford', 'beds', 'commute', 'price']);
    expect(r.verdict).toBe('pass');
    expect(screenListing(prop({}), { ...DEFAULT_CRITERIA, minBedrooms: 2, useAffordability: false }, null).verdict).toBe('unknown');
  });

  it('splits pasted listings on dashed lines', () => {
    expect(splitListings('12 Smith St Coburg 3 bed house $850,000\n---\n4/9 Jones Rd Brunswick 2 bed unit $600k\n-----\nshort')).toHaveLength(2);
  });
});
