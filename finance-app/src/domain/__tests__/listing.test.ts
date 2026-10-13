import { describe, expect, it } from 'vitest';
import { parseListingText, parseListingUrl } from '../property/listingParser';

const SAMPLE = `12/45 Smith Street, Richmond VIC 3121
Apartment
Price guide: $650,000 - $700,000
2 bed 1 bath 1 car
Owners corporation: $1,200 per quarter
Council rates: $1,450 p.a.
Water rates: $180 per quarter
Currently leased at $520 per week until March 2027.
Internal size 78 m2`;

describe('listing extraction', () => {
  it('extracts fields with evidence and statuses', () => {
    const l = parseListingText(SAMPLE);
    expect(l.suburb.value).toBe('Richmond');
    expect(l.state.value).toBe('VIC');
    expect(l.postcode.value).toBe('3121');
    expect(l.address.value).toBe('12/45 Smith Street, Richmond VIC 3121');
    expect(l.propertyType.value).toBe('Apartment');
    expect(l.priceCents.value).toBe(65000000);
    expect(l.priceMaxCents.value).toBe(70000000);
    expect(l.bedrooms.value).toBe(2);
    expect(l.bathrooms.value).toBe(1);
    expect(l.parking.value).toBe(1);
    expect(l.strataAnnualCents.value).toBe(480000);
    expect(l.councilRatesAnnualCents.value).toBe(145000);
    expect(l.waterAnnualCents.value).toBe(72000);
    expect(l.rentWeeklyCents.value).toBe(52000);
    expect(l.leaseDetails.status).toBe('extracted');
    expect(l.priceCents.status).toBe('extracted');
    expect(l.priceCents.evidence).toMatch(/650,000/);
  });

  it('never invents missing details', () => {
    const l = parseListingText('Lovely family home with a big backyard. Contact agent for details.');
    expect(l.priceCents.status).toBe('unavailable');
    expect(l.priceCents.value).toBeNull();
    expect(l.bedrooms.status).toBe('unavailable');
    expect(l.priceText.value).toMatch(/contact agent/i);
    expect(l.strataAnnualCents.value).toBeNull();
  });

  it('handles $k / $m notation and does not treat rent as a price', () => {
    expect(parseListingText('Offers over $1.25m').priceCents.value).toBe(125000000);
    expect(parseListingText('For sale $850k').priceCents.value).toBe(85000000);
    expect(parseListingText('Rent $650 per week').priceCents.value).toBeNull();
  });

  it('reads details from listing URL slugs', () => {
    const u = parseListingUrl('https://www.realestate.com.au/property-house-vic-north+melbourne-143456789'.replace('+', '-'));
    expect(u.state?.value).toBe('VIC');
    expect(u.propertyType?.value).toBe('House');
    expect(u.suburb?.value).toBe('North Melbourne');
    expect(parseListingUrl('not a url')).toEqual({});
  });
});
