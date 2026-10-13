/**
 * Extract property details from pasted listing text (and the listing URL's slug).
 *
 * Deterministic pattern matching only — no external AI service sees the text. Every field
 * records whether it was extracted (with the matching snippet as evidence) or is
 * unavailable. Nothing is invented: if the text does not say it, the field stays empty.
 */
import { toCents } from '../money';
import type { AustralianState, ListingField, PropertyListing } from '../types';

const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const none = <T>(): ListingField<T | null> => ({ value: null, status: 'unavailable' });
const found = <T>(value: T, evidence: string): ListingField<T> => ({ value, status: 'extracted', evidence: evidence.trim().slice(0, 160) });

export function emptyListing(): PropertyListing {
  return {
    address: none(),
    suburb: none(),
    state: none(),
    postcode: none(),
    propertyType: none(),
    priceCents: none(),
    priceMaxCents: none(),
    priceText: none(),
    bedrooms: none(),
    bathrooms: none(),
    parking: none(),
    landSizeSqm: none(),
    strataAnnualCents: none(),
    councilRatesAnnualCents: none(),
    waterAnnualCents: none(),
    rentWeeklyCents: none(),
    leaseDetails: none(),
  };
}

/** Parse "$1.25m", "$850k", "$1,250,000" into dollars. */
export function parseAmount(raw: string): number | null {
  const m = raw.replace(/\s/g, '').match(/^\$?([\d,]*\.?\d+)(k|m|mil|million)?$/i);
  if (!m) return null;
  let v = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'k') v *= 1e3;
  else if (unit.startsWith('m')) v *= 1e6;
  return v;
}

const MONEY = String.raw`\$\s?[\d,]*\.?\d+\s?(?:k|m|mil|million)?\b`;

type Period = 'week' | 'month' | 'quarter' | 'year';
function periodOf(text: string): Period | null {
  const t = text.toLowerCase();
  if (/(per\s*week|p\/?w\b|pw\b|weekly|a week)/.test(t)) return 'week';
  if (/(per\s*month|p\/?m\b|pcm|monthly|a month)/.test(t)) return 'month';
  if (/(per\s*quarter|p\/?q\b|pq\b|quarterly|a quarter|\/qtr|per qtr)/.test(t)) return 'quarter';
  if (/(per\s*(annum|year)|p\.?\s?a\.?\b|yearly|annually|a year|\/yr|per yr)/.test(t)) return 'year';
  return null;
}
const ANNUAL_FACTOR: Record<Period, number> = { week: 52, month: 12, quarter: 4, year: 1 };

function recurringCost(text: string, keyword: RegExp, defaultPeriod: Period): ListingField<number | null> {
  const re = new RegExp(`(${keyword.source})[^$\\n]{0,40}(${MONEY})([^\\n.;]{0,30})`, 'i');
  const m = text.match(re);
  if (!m) return none();
  const amount = parseAmount(m[2]);
  if (amount === null) return none();
  const period = periodOf(m[3]) ?? periodOf(m[0]) ?? defaultPeriod;
  const field = found<number | null>(toCents(amount * ANNUAL_FACTOR[period]), m[0]);
  if (!periodOf(m[3]) && !periodOf(m[0])) {
    field.evidence = `${field.evidence} (period not stated — assumed ${defaultPeriod === 'quarter' ? 'quarterly' : 'annual'}, please check)`;
  }
  return field;
}

export function parseListingUrl(url: string): Partial<PropertyListing> {
  const out: Partial<PropertyListing> = {};
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return out;
  }
  const slug = decodeURIComponent(u.pathname).toLowerCase();
  // realestate.com.au: /property-house-vic-richmond-143456789
  let m = slug.match(/property-(house|unit|apartment|townhouse|villa|land|acreage|unitblock)-(vic|nsw|qld|wa|sa|tas|act|nt)-([a-z-]+?)-\d+/);
  if (m) {
    out.propertyType = found(cap(m[1]), `URL: ${u.pathname}`);
    out.state = found(m[2].toUpperCase() as AustralianState, `URL: ${u.pathname}`);
    out.suburb = found(m[3].split('-').map(cap).join(' '), `URL: ${u.pathname}`);
    return out;
  }
  // domain.com.au: /12-smith-street-richmond-vic-3121-2019123456
  m = slug.match(/\/([a-z0-9-]+)-(vic|nsw|qld|wa|sa|tas|act|nt)-(\d{4})-\d+/);
  if (m) {
    out.state = found(m[2].toUpperCase() as AustralianState, `URL: ${u.pathname}`);
    out.postcode = found(m[3], `URL: ${u.pathname}`);
    const words = m[1].split('-');
    out.address = found(words.map(cap).join(' '), `URL: ${u.pathname} (street and suburb combined — please check)`);
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseListingText(text: string, url?: string): PropertyListing {
  const l = emptyListing();
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');

  // ---- Address / suburb / state / postcode
  const loc = t.match(new RegExp(`([A-Z][A-Za-z' ]{2,40}),?\\s+(${STATES.join('|')})\\s+(\\d{4})\\b`));
  if (loc) {
    const suburb = loc[1].trim().split(/\s{2,}|,/).pop()!.trim();
    l.suburb = found(suburb, loc[0]);
    l.state = found(loc[2] as AustralianState, loc[0]);
    l.postcode = found(loc[3], loc[0]);
  }
  const addr = t.match(
    /\b((?:\d+[A-Za-z]?\/)?\d+[A-Za-z]?(?:-\d+)?\s+[A-Z][A-Za-z' ]{1,40}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln|Crescent|Cres|Parade|Pde|Boulevard|Blvd|Way|Close|Cl|Terrace|Tce|Grove|Gr|Highway|Hwy|Circuit|Cct|Esplanade|Esp|Square|Sq|Rise|Walk)\b\.?(?:,?\s+[A-Z][A-Za-z' ]{2,40})?(?:,?\s+(?:VIC|NSW|QLD|WA|SA|TAS|ACT|NT)\s+\d{4})?)/,
  );
  if (addr) {
    let a = addr[1].trim();
    // The suburb pattern can swallow a trailing state code and stop before the postcode.
    const pc = l.postcode.value;
    if (pc && new RegExp(`\\b(${STATES.join('|')})$`).test(a) && t.includes(`${a} ${pc}`)) a = `${a} ${pc}`;
    l.address = found(a, addr[0]);
  }

  // ---- Property type
  const type = t.match(/\b(house|apartment|unit|townhouse|villa|duplex|terrace|semi-detached|land|acreage|studio|penthouse)\b/i);
  if (type) l.propertyType = found(cap(type[1].toLowerCase()), type[0]);

  // ---- Price
  const priceLine = t.match(
    new RegExp(`(price guide|price|guide|offers? (?:over|above|from)|for sale|asking|auction guide|selling range|range|buy)[^\\n$]{0,25}(${MONEY})(?:\\s*(?:-|–|to)\\s*(${MONEY}))?`, 'i'),
  );
  const range = t.match(new RegExp(`(${MONEY})\\s*(?:-|–|to)\\s*(${MONEY})`, 'i'));
  const bare = t.match(new RegExp(`^\\s*(${MONEY})(?:\\s*(?:-|–|to)\\s*(${MONEY}))?\\s*$`, 'im'));
  const pm = priceLine ? { lo: priceLine[2], hi: priceLine[3], ev: priceLine[0] } : range ? { lo: range[1], hi: range[2], ev: range[0] } : bare ? { lo: bare[1], hi: bare[2], ev: bare[0] } : null;
  if (pm) {
    const lo = parseAmount(pm.lo);
    const hi = pm.hi ? parseAmount(pm.hi) : null;
    // Ignore implausible "prices" (e.g. weekly rents) below $20,000.
    if (lo !== null && lo >= 20000) {
      l.priceCents = found(toCents(lo), pm.ev);
      l.priceText = found(pm.ev.trim(), pm.ev);
      if (hi !== null && hi > lo) l.priceMaxCents = found(toCents(hi), pm.ev);
    }
  } else {
    const contact = t.match(/\b(contact agent|price on application|expressions of interest|auction)\b/i);
    if (contact) l.priceText = found(contact[1], contact[0]);
  }

  // ---- Rooms
  const num = (re: RegExp): ListingField<number | null> => {
    const m = t.match(re);
    return m ? found(Number(m[1] ?? m[2]), m[0]) : none();
  };
  l.bedrooms = num(/\b(\d{1,2})\s*(?:bed(?:room)?s?|br)\b|bed(?:room)?s?\s*[:-]?\s*(\d{1,2})\b/i);
  l.bathrooms = num(/\b(\d{1,2})\s*(?:bath(?:room)?s?|ba)\b|bath(?:room)?s?\s*[:-]?\s*(\d{1,2})\b/i);
  l.parking = num(/\b(\d{1,2})\s*(?:car(?:\s?spaces?|s|\s?park(?:s|ing)?)?|garages?|parking(?: spaces?)?)\b|(?:car\s?spaces?|parking|garage)\s*[:-]?\s*(\d{1,2})\b/i);
  const land = t.match(/\b([\d,]{2,7}(?:\.\d+)?)\s*(?:m2|m²|sqm|sq\.? ?m|square met(?:re|er)s)\b/i);
  if (land) l.landSizeSqm = found(Number(land[1].replace(/,/g, '')), land[0]);

  // ---- Recurring costs
  l.strataAnnualCents = recurringCost(t, /owners?'? ?corp(?:oration)?|body corp(?:orate)?|strata(?: levies| fees)?|o\/c fees/, 'quarter');
  l.councilRatesAnnualCents = recurringCost(t, /council rates?|council/, 'year');
  l.waterAnnualCents = recurringCost(t, /water rates?|water charges?|water/, 'quarter');

  // ---- Rent and lease
  const rent = t.match(new RegExp(`(?:rent(?:al)?|leased|tenanted|returns?|currently let)[^$\\n]{0,40}(${MONEY})\\s*(per\\s*week|p\\/?w|pw|weekly|a week|per\\s*month|pcm|monthly)`, 'i'));
  if (rent) {
    const amount = parseAmount(rent[1]);
    if (amount !== null) {
      const weekly = /month|pcm/i.test(rent[2]) ? (amount * 12) / 52 : amount;
      l.rentWeeklyCents = found(toCents(weekly), rent[0]);
    }
  }
  const lease = t.match(/[^.\n]*(?:leased|tenanted|lease expires|lease until|lease ending|periodic lease)[^.\n]*/i);
  if (lease) l.leaseDetails = found(lease[0].trim(), lease[0]);

  if (url) {
    const fromUrl = parseListingUrl(url);
    for (const [k, v] of Object.entries(fromUrl) as [keyof PropertyListing, ListingField<never>][]) {
      if (l[k].status === 'unavailable' && v) (l as unknown as Record<string, ListingField<unknown>>)[k] = v;
    }
  }
  return l;
}

export const LISTING_FIELD_LABELS: Record<keyof PropertyListing, string> = {
  address: 'Address',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  propertyType: 'Property type',
  priceCents: 'Price (or lower guide)',
  priceMaxCents: 'Upper price guide',
  priceText: 'Price wording',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  parking: 'Parking',
  landSizeSqm: 'Land size (m²)',
  strataAnnualCents: 'Owners corporation (per year)',
  councilRatesAnnualCents: 'Council rates (per year)',
  waterAnnualCents: 'Water charges (per year)',
  rentWeeklyCents: 'Rent (per week)',
  leaseDetails: 'Lease details',
};
