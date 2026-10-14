/**
 * House screener: checks each listing against the household's own criteria and says pass,
 * stretch or fail, with a reason for every check. Uses only what the listing states or what
 * the household entered; a detail the listing doesn't give is reported as unknown, never
 * assumed. No suburb data, growth figures or comparable sales are involved.
 */
import type { Cents } from '../money';
import type { PropertyAnalysis } from '../types';
import type { AffordabilityLabel } from './affordability';

export interface ScreenCriteria {
  /** The most you want to pay. Listings up to `stretchPercent` above it are a stretch. */
  maxPriceCents: Cents | null;
  stretchPercent: number;
  /** Suburbs you'd live in (case-insensitive). Empty means any. */
  suburbs: string[];
  minBedrooms: number | null;
  minBathrooms: number | null;
  minParking: number | null;
  /** e.g. House, Townhouse, Apartment. Empty means any. */
  propertyTypes: string[];
  minLandSqm: number | null;
  maxStrataAnnualCents: Cents | null;
  /** Compared with the commute you enter for each listing. */
  maxCommuteMinutes: number | null;
  /** Fail listings your finances don't support, using the property analyser's result. */
  useAffordability: boolean;
}

export const DEFAULT_CRITERIA: ScreenCriteria = {
  maxPriceCents: null,
  stretchPercent: 5,
  suburbs: [],
  minBedrooms: null,
  minBathrooms: null,
  minParking: null,
  propertyTypes: [],
  minLandSqm: null,
  maxStrataAnnualCents: null,
  maxCommuteMinutes: null,
  useAffordability: true,
};

export type Verdict = 'pass' | 'stretch' | 'fail' | 'unknown';

export interface ScreenCheck {
  key: string;
  verdict: Verdict;
  text: string;
}

export interface ScreenResult {
  verdict: Verdict;
  checks: ScreenCheck[];
  /** Checks that couldn't run because the listing doesn't say. */
  unknowns: number;
}

const money = (c: number) => `$${Math.round(c / 100).toLocaleString('en-AU')}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function minCheck(key: string, label: string, have: number | null, want: number | null, unit = ''): ScreenCheck | null {
  if (want === null) return null;
  if (have === null) return { key, verdict: 'unknown', text: `${label} not stated in the listing` };
  if (have >= want) return { key, verdict: 'pass', text: `${have}${unit} ${label.toLowerCase()} (want ${want}+)` };
  // One short is a stretch for rooms; anything else fails.
  if (unit === '' && want - have === 1) return { key, verdict: 'stretch', text: `${have} ${label.toLowerCase()}, one fewer than the ${want} you want` };
  return { key, verdict: 'fail', text: `${have}${unit} ${label.toLowerCase()}, below the ${want}${unit} you want` };
}

export function screenListing(p: PropertyAnalysis, c: ScreenCriteria, affordability: AffordabilityLabel | null): ScreenResult {
  const l = p.listing;
  const checks: ScreenCheck[] = [];

  if (c.maxPriceCents !== null) {
    // Use the top of a price range: it's what you may have to pay.
    const price = l.priceMaxCents.value ?? l.priceCents.value;
    if (price === null) checks.push({ key: 'price', verdict: 'unknown', text: `No price in the listing${l.priceText.value ? ` ("${l.priceText.value}")` : ''}` });
    else if (price <= c.maxPriceCents) checks.push({ key: 'price', verdict: 'pass', text: `${money(price)} is within your ${money(c.maxPriceCents)} limit` });
    else if (price <= c.maxPriceCents * (1 + c.stretchPercent / 100)) checks.push({ key: 'price', verdict: 'stretch', text: `${money(price)} is ${(((price - c.maxPriceCents) / c.maxPriceCents) * 100).toFixed(1)}% over your ${money(c.maxPriceCents)} limit` });
    else checks.push({ key: 'price', verdict: 'fail', text: `${money(price)} is over your ${money(c.maxPriceCents)} limit` });
  }

  if (c.suburbs.length) {
    const s = l.suburb.value;
    if (!s) checks.push({ key: 'suburb', verdict: 'unknown', text: 'Suburb not found in the listing' });
    else if (c.suburbs.some((x) => norm(x) === norm(s))) checks.push({ key: 'suburb', verdict: 'pass', text: `${s} is on your list` });
    else checks.push({ key: 'suburb', verdict: 'fail', text: `${s} isn't one of your suburbs` });
  }

  if (c.propertyTypes.length) {
    const t = l.propertyType.value;
    if (!t) checks.push({ key: 'type', verdict: 'unknown', text: 'Property type not stated' });
    else if (c.propertyTypes.some((x) => norm(t).includes(norm(x)))) checks.push({ key: 'type', verdict: 'pass', text: `${t}` });
    else checks.push({ key: 'type', verdict: 'fail', text: `${t} isn't a type you're after` });
  }

  for (const ch of [
    minCheck('beds', 'Bedrooms', l.bedrooms.value, c.minBedrooms),
    minCheck('baths', 'Bathrooms', l.bathrooms.value, c.minBathrooms),
    minCheck('parking', 'Car spaces', l.parking.value, c.minParking),
    minCheck('land', 'Land', l.landSizeSqm.value, c.minLandSqm, ' m²'),
  ])
    if (ch) checks.push(ch);

  if (c.maxStrataAnnualCents !== null) {
    const s = l.strataAnnualCents.value;
    if (s === null) checks.push({ key: 'strata', verdict: 'unknown', text: 'Strata fees not stated (none for most houses)' });
    else if (s <= c.maxStrataAnnualCents) checks.push({ key: 'strata', verdict: 'pass', text: `Strata ${money(s)}/yr` });
    else checks.push({ key: 'strata', verdict: 'fail', text: `Strata ${money(s)}/yr is over your ${money(c.maxStrataAnnualCents)} limit` });
  }

  if (c.maxCommuteMinutes !== null) {
    const m = p.commuteMinutes ?? null;
    if (m === null) checks.push({ key: 'commute', verdict: 'unknown', text: 'Enter the commute for this listing' });
    else if (m <= c.maxCommuteMinutes) checks.push({ key: 'commute', verdict: 'pass', text: `${m} min commute` });
    else if (m <= c.maxCommuteMinutes + 10) checks.push({ key: 'commute', verdict: 'stretch', text: `${m} min commute, a little over your ${c.maxCommuteMinutes}` });
    else checks.push({ key: 'commute', verdict: 'fail', text: `${m} min commute, over your ${c.maxCommuteMinutes}` });
  }

  if (c.useAffordability) {
    if (!affordability) checks.push({ key: 'afford', verdict: 'unknown', text: 'Affordability needs a price and your household numbers' });
    else if (affordability === 'comfortable' || affordability === 'manageable') checks.push({ key: 'afford', verdict: 'pass', text: `Your finances: ${affordability}` });
    else if (affordability === 'stretched') checks.push({ key: 'afford', verdict: 'stretch', text: 'Your finances: stretched' });
    else checks.push({ key: 'afford', verdict: 'fail', text: 'Not supported by your finances' });
  }

  const has = (v: Verdict) => checks.some((x) => x.verdict === v);
  const unknowns = checks.filter((x) => x.verdict === 'unknown').length;
  // Unknowns don't fail a listing; they're shown so you can check them.
  const verdict: Verdict = has('fail') ? 'fail' : has('stretch') ? 'stretch' : has('pass') ? 'pass' : 'unknown';
  return { verdict, checks, unknowns };
}

/** Splits several pasted listings. Separate them with a line of three or more dashes. */
export function splitListings(text: string): string[] {
  return text
    .split(/^\s*-{3,}\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}
