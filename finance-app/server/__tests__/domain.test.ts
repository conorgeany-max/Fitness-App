import { describe, expect, it } from 'vitest';
import { DomainClient, domainSearchBody, mapDomainResults } from '../providers/domain';

const RESULTS = [
  {
    type: 'PropertyListing',
    listing: {
      id: 2019001,
      listingSlug: '12-smith-st-coburg-vic-3058-2019001',
      headline: 'Family home',
      priceDetails: { displayPrice: '$850,000 - $900,000', priceFrom: 850000, priceTo: 900000 },
      propertyDetails: { displayableAddress: '12 Smith St, Coburg', suburb: 'COBURG', state: 'VIC', postcode: '3058', propertyType: 'House', bedrooms: 3, bathrooms: 1, carspaces: 1, landArea: 420 },
    },
  },
  { type: 'Project', listings: [{ id: 5, propertyDetails: { suburb: 'BRUNSWICK', bedrooms: 2 }, priceDetails: { displayPrice: 'Contact agent' } }] },
  { type: 'PropertyListing', listing: { propertyDetails: {} } },
];

describe('Domain listing search', () => {
  it('builds a search from the screener criteria', () => {
    expect(domainSearchBody({ state: 'VIC', suburbs: ['Coburg'], minBedrooms: 3, minBathrooms: null, minCarspaces: 1, maxPriceCents: 900_000_00, propertyTypes: ['House', 'Apartment'] })).toEqual({
      listingType: 'Sale',
      propertyTypes: ['House', 'ApartmentUnitFlat'],
      minBedrooms: 3,
      minCarspaces: 1,
      maxPrice: 900000,
      locations: [{ state: 'VIC', suburb: 'Coburg', includeSurroundingSuburbs: false }],
      pageSize: 50,
    });
  });

  it('maps listings and project children, leaving unknown fields empty', () => {
    const r = mapDomainResults(RESULTS);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: '2019001', url: 'https://www.domain.com.au/12-smith-st-coburg-vic-3058-2019001', bedrooms: 3, priceCents: 900_000_00, priceText: '$850,000 - $900,000', landSqm: 420 });
    expect(r[1]).toMatchObject({ id: '5', priceCents: null, bathrooms: null, url: null });
  });

  it('gets a token with client credentials, reuses it and searches', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (u: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(u), init });
      if (String(u).includes('auth.domain')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      return new Response(JSON.stringify(RESULTS));
    }) as typeof fetch;
    const c = new DomainClient('id', 'secret', impl);
    const s = { state: 'VIC', suburbs: ['Coburg'], minBedrooms: null, minBathrooms: null, minCarspaces: null, maxPriceCents: null, propertyTypes: [] };
    await c.search(s);
    await c.search(s);
    expect(calls.filter((x) => x.url.includes('auth.domain'))).toHaveLength(1);
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect((calls[1].init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    await expect(c.search({ ...s, suburbs: [] })).rejects.toThrow(/suburb/);
  });
});
