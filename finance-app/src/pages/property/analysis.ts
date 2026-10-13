import { useMemo } from 'react';
import { analyseAffordability, DEFAULT_THRESHOLDS, maxPriceForLabel, type AffordabilityResult, type MarketAssumptions, type PropertyCosts } from '@/domain/property/affordability';
import type { PropertyAnalysis, WorkspaceData } from '@/domain/types';
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
