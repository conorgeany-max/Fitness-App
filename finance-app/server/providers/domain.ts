/**
 * Domain listing search (Domain's "Agents & Listings" API), used by the house screener to find
 * listings that match the household's criteria. Only works once Domain approves the app and
 * DOMAIN_CLIENT_ID / DOMAIN_CLIENT_SECRET are set. Uses OAuth client credentials, read-only.
 *
 * Written from Domain's public documentation; it could not be run against Domain's live API
 * while it was built. The fields below are read defensively and anything missing stays empty.
 */
import { HttpError } from '../cloud/types';

const AUTH_URL = 'https://auth.domain.com.au/v1/connect/token';
const SEARCH_URL = 'https://api.domain.com.au/v1/listings/residential/_search';

export interface DomainSearch {
  state: string;
  suburbs: string[];
  minBedrooms: number | null;
  minBathrooms: number | null;
  minCarspaces: number | null;
  maxPriceCents: number | null;
  propertyTypes: string[];
}

export interface DomainListing {
  id: string;
  url: string | null;
  headline: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  landSqm: number | null;
  priceText: string | null;
  priceCents: number | null;
  summary: string | null;
}

const TYPE_MAP: Record<string, string[]> = {
  house: ['House'],
  townhouse: ['Townhouse'],
  apartment: ['ApartmentUnitFlat'],
  unit: ['ApartmentUnitFlat'],
  flat: ['ApartmentUnitFlat'],
  villa: ['Villa'],
  duplex: ['Duplex'],
  terrace: ['Terrace'],
  land: ['VacantLand'],
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function domainSearchBody(s: DomainSearch) {
  const types = [...new Set(s.propertyTypes.flatMap((t) => TYPE_MAP[t.trim().toLowerCase()] ?? []))];
  return {
    listingType: 'Sale',
    ...(types.length ? { propertyTypes: types } : {}),
    ...(s.minBedrooms ? { minBedrooms: s.minBedrooms } : {}),
    ...(s.minBathrooms ? { minBathrooms: s.minBathrooms } : {}),
    ...(s.minCarspaces ? { minCarspaces: s.minCarspaces } : {}),
    ...(s.maxPriceCents ? { maxPrice: Math.round(s.maxPriceCents / 100) } : {}),
    locations: s.suburbs.slice(0, 10).map((suburb) => ({ state: s.state, suburb, includeSurroundingSuburbs: false })),
    pageSize: 50,
  };
}

export function mapDomainResults(body: unknown): DomainListing[] {
  if (!Array.isArray(body)) return [];
  const out: DomainListing[] = [];
  for (const item of body as Record<string, unknown>[]) {
    // Results are single listings or projects with child listings.
    const listings = item.type === 'Project' && Array.isArray(item.listings) ? (item.listings as Record<string, unknown>[]) : [item.listing as Record<string, unknown> | undefined];
    for (const l of listings) {
      if (!l || (typeof l.id !== 'number' && typeof l.id !== 'string')) continue;
      const pd = (l.propertyDetails ?? {}) as Record<string, unknown>;
      const price = (l.priceDetails ?? {}) as Record<string, unknown>;
      const priceDollars = num(price.price) ?? num(price.priceTo) ?? null;
      out.push({
        id: String(l.id),
        url: str(l.listingSlug) ? `https://www.domain.com.au/${String(l.listingSlug)}` : null,
        headline: str(l.headline),
        address: str(pd.displayableAddress),
        suburb: str(pd.suburb),
        state: str(pd.state),
        postcode: str(pd.postcode),
        propertyType: str(pd.propertyType),
        bedrooms: num(pd.bedrooms),
        bathrooms: num(pd.bathrooms),
        parking: num(pd.carspaces),
        landSqm: num(pd.landArea),
        priceText: str(price.displayPrice),
        priceCents: priceDollars === null ? null : Math.round(priceDollars * 100),
        summary: str(l.summaryDescription),
      });
    }
  }
  return out;
}

export class DomainClient {
  private token: { value: string; expires: number } | null = null;
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    let res: Response;
    try {
      res = await this.fetchImpl(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'api_listings_read' }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(502, 'domain_unreachable', "Couldn't reach Domain. Try again shortly.");
    }
    if (!res.ok) throw new HttpError(502, 'domain_auth', `Domain refused the app's credentials (${res.status}). Check DOMAIN_CLIENT_ID and DOMAIN_CLIENT_SECRET, and that Domain approved access.`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new HttpError(502, 'domain_auth', 'Domain did not return an access token.');
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async search(s: DomainSearch): Promise<DomainListing[]> {
    if (!s.suburbs.length) throw new HttpError(400, 'no_suburbs', 'Add at least one suburb to your criteria to search Domain.');
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await this.fetchImpl(SEARCH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(domainSearchBody(s)),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(502, 'domain_unreachable', "Couldn't reach Domain. Try again shortly.");
    }
    if (res.status === 429) throw new HttpError(429, 'domain_rate_limited', "Domain's daily search limit has been reached. Try again tomorrow, or paste listings instead.");
    if (!res.ok) throw new HttpError(502, 'domain_error', `Domain returned an error (${res.status}).`);
    return mapDomainResults(await res.json());
  }
}
