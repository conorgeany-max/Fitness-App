import { useMemo } from 'react';
import { analyseAffordability, DEFAULT_THRESHOLDS, maxPriceForLabel, type AffordabilityResult, type MarketAssumptions, type PropertyCosts } from '@/domain/property/affordability';
import { emptyListing, parseListingText, parseListingUrl } from '@/domain/property/listingParser';
import type { PropertyAnalysis, PropertyListing, WorkspaceData } from '@/domain/types';
import { uid } from '@/lib/id';
import { defaultPurchaseSettings } from '@/store/demo';
import { householdFinancials } from '@/store/builders';
import { derive } from '@/store/derived';
import { useApp } from '@/store/store';

export interface PreparedAnalysis {
  costs: PropertyCosts | null;
  /** Why the analysis can't run yet (e.g. no price). */
  blockers: string[];
  /** Cost inputs that are missing and treated as $0 — shown prominently. */
  missing: string[];
  /** Which price was used when the listing gave a range. */
  priceNote: string | null;
  result: AffordabilityResult | null;
  maxComfortableCents: number | null;
  household: ReturnType<typeof householdFinancials>;
  market: MarketAssumptions;
}

export function marketAssumptions(data: WorkspaceData): MarketAssumptions {
  const a = data.scenarios[0]?.assumptions ?? data.settings.defaultAssumptions;
  // Rents are assumed to grow with inflation; there is no market data behind this.
  return { investmentReturn: a.investmentReturn - a.investmentFees - a.investmentTaxDrag, propertyGrowth: a.propertyGrowth, inflation: a.inflation, rentGrowth: a.inflation };
}

export function prepare(data: WorkspaceData, p: PropertyAnalysis, withMax = true): PreparedAnalysis {
  const d = derive(data);
  const household = householdFinancials(data, d);
  const market = marketAssumptions(data);
  const l = p.listing;
  const blockers: string[] = [];
  const missing: string[] = [];
  let priceNote: string | null = null;
  let price = l.priceCents.value;
  if (price !== null && l.priceMaxCents.value !== null && l.priceMaxCents.value > price) {
    price = l.priceMaxCents.value;
    priceNote = 'The listing gives a range; the upper figure is used so the result is not optimistic.';
  }
  if (price === null || price <= 0) blockers.push('Enter a price (or your expected purchase price) to run the analysis.');
  if (!l.state.value) missing.push('state (needed for stamp duty)');
  if (l.councilRatesAnnualCents.value === null) missing.push('council rates');
  if (l.waterAnnualCents.value === null) missing.push('water charges');
  const isStrata = /unit|apartment|townhouse|villa|studio|penthouse/i.test(l.propertyType.value ?? '');
  if (isStrata && l.strataAnnualCents.value === null) missing.push('owners corporation fees');
  if (p.settings.intendedUse === 'investment' && l.rentWeeklyCents.value === null) missing.push('expected rent');
  if (p.settings.depositCents <= 0) blockers.push('Enter the deposit you plan to put down.');

  if (blockers.length || price === null) {
    return { costs: null, blockers, missing, priceNote, result: null, maxComfortableCents: null, household, market };
  }
  const costs: PropertyCosts = {
    priceCents: price,
    state: l.state.value,
    strataAnnualCents: l.strataAnnualCents.value ?? 0,
    councilRatesAnnualCents: l.councilRatesAnnualCents.value ?? 0,
    waterAnnualCents: l.waterAnnualCents.value ?? 0,
    rentWeeklyCents: l.rentWeeklyCents.value ?? 0,
  };
  const settings = p.settings;
  const hh = settings.currentRentWeeklyCents !== null ? { ...household, currentRentMonthlyCents: Math.round((settings.currentRentWeeklyCents * 52) / 12) } : household;
  const result = analyseAffordability(costs, settings, hh, market, DEFAULT_THRESHOLDS);
  const maxComfortableCents = withMax ? maxPriceForLabel(costs, settings, hh, market, DEFAULT_THRESHOLDS) : null;
  return { costs, blockers, missing, priceNote, result, maxComfortableCents, household, market };
}

export function usePrepared(p: PropertyAnalysis | undefined, withMax = true): PreparedAnalysis | null {
  const data = useApp((s) => s.data);
  return useMemo(() => (p ? prepare(data, p, withMax) : null), [data, p, withMax]);
}

export const LABEL_META = {
  comfortable: { text: 'Comfortable', tone: 'good' as const },
  manageable: { text: 'Manageable', tone: 'info' as const },
  stretched: { text: 'Stretched', tone: 'warn' as const },
  'not-supported': { text: 'Not supported by your numbers', tone: 'bad' as const },
};

/** A new analysis from pasted listing text and/or a link. Only what the text says is filled in. */
export function newAnalysis(opts: { text: string; url?: string; blank?: boolean; fetchStatus?: { ok: boolean; message: string } | null }): PropertyAnalysis {
  const url = opts.url?.trim() || undefined;
  const listing: PropertyListing = opts.blank ? emptyListing() : opts.text.trim() ? parseListingText(opts.text, url) : { ...emptyListing(), ...(url ? parseListingUrl(url) : {}) };
  if (!listing.state.value) listing.state = { value: null, status: 'unavailable' };
  const now = new Date().toISOString();
  const name = listing.address.value ?? (listing.suburb.value ? `${listing.propertyType.value ?? 'Property'} in ${listing.suburb.value}` : 'New property');
  return {
    id: uid('prop'),
    name,
    sourceUrl: url,
    rawText: opts.text,
    fetchStatus: opts.fetchStatus ? { ...opts.fetchStatus, at: now } : undefined,
    listing,
    settings: { ...defaultPurchaseSettings() },
    shortlisted: false,
    createdAt: now,
    updatedAt: now,
  };
}

export interface DomainListingRow {
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

const STATES = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

/** An analysis from a Domain search result. Fields Domain didn't give stay empty. */
export function analysisFromDomain(d: DomainListingRow): PropertyAnalysis {
  const text = [d.address, d.headline, d.priceText, d.summary].filter(Boolean).join('\n');
  const p = newAnalysis({ text: '', url: d.url ?? undefined, blank: true });
  const f = <T,>(value: T | null) => (value === null || value === undefined ? { value: null, status: 'unavailable' as const } : { value, status: 'extracted' as const, evidence: 'Domain listing data' });
  const titleCase = (s: string | null) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);
  const state = d.state && STATES.includes(d.state.toUpperCase()) ? (d.state.toUpperCase() as PropertyListing['state']['value']) : null;
  p.listing = {
    ...p.listing,
    address: f(d.address),
    suburb: f(titleCase(d.suburb)),
    state: f(state),
    postcode: f(d.postcode),
    propertyType: f(d.propertyType),
    priceCents: f(d.priceCents),
    priceText: f(d.priceText),
    bedrooms: f(d.bedrooms),
    bathrooms: f(d.bathrooms),
    parking: f(d.parking),
    landSizeSqm: f(d.landSqm),
  };
  p.rawText = text;
  p.name = d.address ?? (d.suburb ? `${d.propertyType ?? 'Property'} in ${titleCase(d.suburb)}` : 'Domain listing');
  return p;
}
