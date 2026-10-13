/**
 * Balance sheet and net worth.
 *
 *   Net worth = total assets − total liabilities
 *
 * Household methodology: each underlying asset and liability is counted exactly once at
 * its full value. Individual views use each person's ownership (assets) or responsibility
 * (liabilities) allocation. Because individual shares are split with the largest-remainder
 * method, me + partner always equals household for the same set of items.
 */
import { diffDays, type ISODate } from './dates';
import { categoryMeta, isMortgage, isProperty, type AssetGroup, type LiabilityGroup } from './holdingCategories';
import { roundCents, toBaseCurrency, type Cents } from './money';
import { amountForPerspective, soleOwner } from './ownership';
import type { Holding, NetWorthTotals, Perspective, PersonId, Settings } from './types';

export type ItemStatus = 'current' | 'stale' | 'missing' | 'no-fx';
export type VisibilityMode = 'full' | 'aggregate' | 'hidden';

export interface BalanceSheetItem {
  holding: Holding;
  /** Full value of the underlying item in AUD cents (null when missing / no FX rate). */
  fullValueCents: Cents | null;
  /** Value attributed to the selected perspective in AUD cents. */
  attributedCents: Cents;
  status: ItemStatus;
  ageDays: number | null;
  visibility: VisibilityMode;
}

export interface BalanceSheet extends NetWorthTotals {
  perspective: Perspective;
  asOf: ISODate;
  items: BalanceSheetItem[];
  assetGroups: Record<AssetGroup, Cents>;
  liabilityGroups: Record<LiabilityGroup, Cents>;
  /** Liquid assets minus credit cards and BNPL. */
  liquidNetWorthCents: Cents;
  mortgageCents: Cents;
  propertyValueCents: Cents;
  staleCount: number;
  missingCount: number;
  /** Private items whose values were included as an aggregate only. */
  aggregatedPrivateCount: number;
  /** Private items excluded entirely (owner has not consented to sharing totals). */
  hiddenPrivateCount: number;
  oldestSyncedAt: string | null;
}

export type StalenessSettings = Pick<Settings, 'staleDays' | 'fx' | 'activeUser' | 'shareTotalsOfPrivateItems'>;

export function isSyncedSource(source: Holding['source']): boolean {
  return source === 'live' || source === 'sandbox' || source === 'mock';
}

export function staleThresholdDays(h: Holding, settings: Pick<Settings, 'staleDays'>): number {
  if (isSyncedSource(h.source)) return settings.staleDays.synced;
  const rule = categoryMeta(h.category).staleness;
  return settings.staleDays[rule];
}

/** Value of a holding on a given date (own currency), using its valuation history. */
export function valueOnDate(h: Holding, date: ISODate): { valueCents: Cents; date: ISODate } | null {
  let best: { valueCents: Cents; date: ISODate } | null = null;
  for (const e of h.history) {
    if (e.date <= date && (!best || e.date >= best.date)) best = { valueCents: e.valueCents, date: e.date };
  }
  if (h.valueCents !== null && h.valuedAt && h.valuedAt <= date && (!best || h.valuedAt >= best.date)) {
    best = { valueCents: h.valueCents, date: h.valuedAt };
  }
  return best;
}

/** Decide how an item may be shown in a perspective given privacy settings. */
export function visibilityFor(h: Holding, perspective: Perspective, settings: StalenessSettings): VisibilityMode {
  if (h.archived) return 'hidden';
  if (perspective !== 'household' && h.ownership[perspective] <= 0) return 'hidden';
  if (h.visibility !== 'private') return 'full';
  const owner = soleOwner(h.ownership);
  // Private items must be solely owned; a mis-flagged joint item is treated as shared.
  if (!owner) return 'full';
  if (owner === settings.activeUser) return 'full';
  return settings.shareTotalsOfPrivateItems[owner] ? 'aggregate' : 'hidden';
}

export function computeBalanceSheet(
  holdings: Holding[],
  perspective: Perspective,
  settings: StalenessSettings,
  asOf: ISODate,
  opts: { historical?: boolean } = {},
): BalanceSheet {
  const assetGroups: Record<AssetGroup, Cents> = { cash: 0, investments: 0, super: 0, property: 0, other: 0 };
  const liabilityGroups: Record<LiabilityGroup, Cents> = { mortgage: 0, consumer: 0, loans: 0, student: 0, other: 0 };
  const items: BalanceSheetItem[] = [];
  let assets = 0;
  let liabilities = 0;
  let liquid = 0;
  let liquidLiabilities = 0;
  let investable = 0;
  let superCents = 0;
  let property = 0;
  let mortgages = 0;
  let staleCount = 0;
  let missingCount = 0;
  let aggregatedPrivateCount = 0;
  let hiddenPrivateCount = 0;
  let oldestSyncedAt: string | null = null;

  for (const h of holdings) {
    const visibility = visibilityFor(h, perspective, settings);
    if (visibility === 'hidden') {
      if (h.visibility === 'private' && !h.archived && (perspective === 'household' || h.ownership[perspective] > 0)) {
        hiddenPrivateCount += 1;
      }
      continue;
    }
    if (visibility === 'aggregate') aggregatedPrivateCount += 1;
    const meta = categoryMeta(h.category);

    let own: { valueCents: Cents; date: ISODate } | null;
    if (opts.historical) own = valueOnDate(h, asOf);
    else own = h.valueCents === null || !h.valuedAt ? null : { valueCents: h.valueCents, date: h.valuedAt };

    let status: ItemStatus = 'current';
    let fullValue: Cents | null = null;
    let ageDays: number | null = null;
    if (!own) {
      status = 'missing';
    } else {
      fullValue = toBaseCurrency(own.valueCents, h.currency, settings.fx);
      ageDays = diffDays(own.date, asOf);
      if (fullValue === null) status = 'no-fx';
      else if (!opts.historical && ageDays > staleThresholdDays(h, settings)) status = 'stale';
    }
    if (status === 'missing' || status === 'no-fx') missingCount += 1;
    if (status === 'stale') staleCount += 1;
    if (isSyncedSource(h.source) && h.lastSyncedAt && (!oldestSyncedAt || h.lastSyncedAt < oldestSyncedAt)) {
      oldestSyncedAt = h.lastSyncedAt;
    }

    // Missing values are excluded from totals rather than treated as zero balances.
    const attributed = fullValue === null ? 0 : amountForPerspective(fullValue, h.ownership, perspective);
    items.push({ holding: h, fullValueCents: fullValue, attributedCents: attributed, status, ageDays, visibility });
    if (fullValue === null) continue;

    if (meta.kind === 'asset') {
      assets += attributed;
      assetGroups[meta.group as AssetGroup] += attributed;
      if (meta.liquid) liquid += attributed;
      if (meta.investable) investable += attributed;
      if (meta.group === 'super') superCents += attributed;
      if (isProperty(h.category)) property += attributed;
    } else {
      liabilities += attributed;
      liabilityGroups[meta.group as LiabilityGroup] += attributed;
      if (meta.liquid) liquidLiabilities += attributed;
      if (isMortgage(h.category)) mortgages += attributed;
    }
  }

  return {
    perspective,
    asOf,
    items,
    assetsCents: assets,
    liabilitiesCents: liabilities,
    netWorthCents: assets - liabilities,
    liquidCents: liquid,
    investableCents: investable,
    propertyEquityCents: property - mortgages,
    superCents,
    assetGroups,
    liabilityGroups,
    liquidNetWorthCents: liquid - liquidLiabilities,
    mortgageCents: mortgages,
    propertyValueCents: property,
    staleCount,
    missingCount,
    aggregatedPrivateCount,
    hiddenPrivateCount,
    oldestSyncedAt,
  };
}

export function totalsOf(bs: BalanceSheet): NetWorthTotals {
  return {
    assetsCents: bs.assetsCents,
    liabilitiesCents: bs.liabilitiesCents,
    netWorthCents: bs.netWorthCents,
    liquidCents: bs.liquidCents,
    investableCents: bs.investableCents,
    propertyEquityCents: bs.propertyEquityCents,
    superCents: bs.superCents,
  };
}

/** Loan-to-value ratio of a property given the loans secured against it. */
export function propertyLvr(property: Holding, holdings: Holding[]): number | null {
  if (!property.valueCents) return null;
  const loans = holdings.filter((h) => h.loan?.securedByHoldingId === property.id && !h.archived);
  const owed = loans.reduce((a, l) => a + (l.valueCents ?? 0), 0);
  return roundCents((owed / property.valueCents) * 10000) / 10000;
}

export const PERSPECTIVES: Perspective[] = ['household', 'me', 'partner'];

export function perspectiveLabel(p: Perspective, names: Record<PersonId, string>): string {
  if (p === 'household') return 'Household';
  return names[p];
}
