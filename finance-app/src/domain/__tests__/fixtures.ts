import type { Holding, HoldingCategory, Ownership, Settings, Transaction } from '../types';
import { categoryMeta } from '../holdingCategories';

export const SETTINGS: Pick<Settings, 'staleDays' | 'fx' | 'activeUser' | 'shareTotalsOfPrivateItems'> = {
  staleDays: { synced: 3, manualCash: 45, manualInvestment: 120, property: 365, other: 365 },
  fx: { USD: { audPerUnit: 1.5, asOf: '2026-10-01', source: 'manual' } },
  activeUser: 'me',
  shareTotalsOfPrivateItems: { me: true, partner: false },
};

let n = 0;
export function holding(
  category: HoldingCategory,
  valueDollars: number | null,
  ownership: Ownership,
  extra: Partial<Holding> = {},
): Holding {
  n += 1;
  return {
    id: extra.id ?? `h${n}`,
    kind: categoryMeta(category).kind,
    category,
    name: extra.name ?? `${category} ${n}`,
    ownership,
    visibility: 'shared',
    currency: 'AUD',
    valueCents: valueDollars === null ? null : Math.round(valueDollars * 100),
    valuedAt: valueDollars === null ? null : '2026-10-10',
    source: 'manual',
    history: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

export function txn(id: string, date: string, dollars: number, accountId: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date,
    description: extra.description ?? `TXN ${id}`,
    amountCents: Math.round(dollars * 100),
    currency: 'AUD',
    accountId,
    categoryId: null,
    transfer: 'none',
    tags: [],
    categorisation: { source: 'manual', confidence: 1 },
    source: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}
