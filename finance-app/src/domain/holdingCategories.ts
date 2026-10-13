import type { AssetCategory, HoldingCategory, HoldingKind, LiabilityCategory } from './types';

export type AssetGroup = 'cash' | 'investments' | 'super' | 'property' | 'other';
export type LiabilityGroup = 'mortgage' | 'consumer' | 'loans' | 'student' | 'other';

export interface HoldingCategoryMeta {
  id: HoldingCategory;
  kind: HoldingKind;
  label: string;
  group: AssetGroup | LiabilityGroup;
  /** Assets: counts towards liquid assets. Liabilities: deducted from liquid net worth. */
  liquid: boolean;
  /** Counts towards investable assets (excludes super, property and personal-use assets). */
  investable: boolean;
  /** Typical account-like holding that can carry transactions. */
  account: boolean;
  /** Which staleness rule applies. */
  staleness: 'manualCash' | 'manualInvestment' | 'property' | 'other';
}

const A = (
  id: AssetCategory,
  label: string,
  group: AssetGroup,
  liquid: boolean,
  investable: boolean,
  account: boolean,
  staleness: HoldingCategoryMeta['staleness'],
): HoldingCategoryMeta => ({ id, kind: 'asset', label, group, liquid, investable, account, staleness });

const L = (
  id: LiabilityCategory,
  label: string,
  group: LiabilityGroup,
  liquid: boolean,
  account: boolean,
): HoldingCategoryMeta => ({ id, kind: 'liability', label, group, liquid, investable: false, account, staleness: 'manualCash' });

export const HOLDING_CATEGORIES: HoldingCategoryMeta[] = [
  A('transaction', 'Everyday account', 'cash', true, true, true, 'manualCash'),
  A('savings', 'Savings account', 'cash', true, true, true, 'manualCash'),
  A('offset', 'Offset account', 'cash', true, true, true, 'manualCash'),
  A('term-deposit', 'Term deposit', 'cash', true, true, true, 'manualCash'),
  A('cash', 'Cash holdings', 'cash', true, true, false, 'manualCash'),
  A('shares-au', 'Australian shares', 'investments', false, true, true, 'manualInvestment'),
  A('shares-intl', 'International shares', 'investments', false, true, true, 'manualInvestment'),
  A('etf', 'ETFs', 'investments', false, true, true, 'manualInvestment'),
  A('managed-fund', 'Managed funds', 'investments', false, true, true, 'manualInvestment'),
  A('crypto', 'Cryptocurrency', 'investments', false, true, false, 'manualInvestment'),
  A('private-investment', 'Private investment', 'investments', false, true, false, 'manualInvestment'),
  A('super', 'Superannuation', 'super', false, false, true, 'manualInvestment'),
  A('kiwisaver', 'KiwiSaver', 'super', false, false, true, 'manualInvestment'),
  A('property-home', 'Home (owner-occupied)', 'property', false, false, false, 'property'),
  A('property-investment', 'Investment property', 'property', false, false, false, 'property'),
  A('vehicle', 'Vehicle', 'other', false, false, false, 'property'),
  A('other-asset', 'Other asset', 'other', false, false, false, 'other'),
  L('mortgage-owner', 'Home loan (owner-occupied)', 'mortgage', false, true),
  L('mortgage-investment', 'Investment property loan', 'mortgage', false, true),
  L('credit-card', 'Credit card', 'consumer', true, true),
  L('bnpl', 'Buy now, pay later', 'consumer', true, true),
  L('personal-loan', 'Personal loan', 'loans', false, true),
  L('car-loan', 'Car loan', 'loans', false, true),
  L('help-debt', 'HECS-HELP / student debt', 'student', false, false),
  L('family-loan', 'Family loan', 'other', false, false),
  L('other-liability', 'Other liability', 'other', false, false),
];

const BY_ID = new Map(HOLDING_CATEGORIES.map((c) => [c.id, c]));

export function categoryMeta(id: HoldingCategory): HoldingCategoryMeta {
  const meta = BY_ID.get(id);
  if (!meta) throw new Error(`Unknown holding category ${id}`);
  return meta;
}

export const ASSET_GROUP_LABELS: Record<AssetGroup, string> = {
  cash: 'Cash & deposits',
  investments: 'Investments',
  super: 'Super & retirement',
  property: 'Property',
  other: 'Vehicles & other',
};

export const LIABILITY_GROUP_LABELS: Record<LiabilityGroup, string> = {
  mortgage: 'Mortgages',
  consumer: 'Cards & BNPL',
  loans: 'Personal & car loans',
  student: 'Student debt',
  other: 'Other debts',
};

export function isMortgage(c: HoldingCategory): boolean {
  return c === 'mortgage-owner' || c === 'mortgage-investment';
}

export function isProperty(c: HoldingCategory): boolean {
  return c === 'property-home' || c === 'property-investment';
}
