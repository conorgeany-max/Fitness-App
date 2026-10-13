import { useMemo } from 'react';
import type { Category, CategoryTreatment, Holding, Transaction } from '@/domain/types';
import { useApp } from '@/store/store';
import { Badge } from '@/components/ui';

const TREATMENT_LABEL: Record<CategoryTreatment, string> = {
  income: 'Income',
  expense: 'Spending',
  transfer: 'Transfers',
  investment: 'Investing',
  'debt-repayment': 'Debt repayment',
};

/** Category <select> options grouped by treatment, with a leading "Uncategorised" option. */
export function useCategoryOptions(opts: { includeNone?: boolean; only?: CategoryTreatment[] } = {}) {
  const categories = useApp((s) => s.data.categories);
  return useMemo(() => {
    const out: { value: string; label: string; disabled?: boolean }[] = [];
    if (opts.includeNone !== false) out.push({ value: '', label: 'Uncategorised' });
    for (const t of Object.keys(TREATMENT_LABEL) as CategoryTreatment[]) {
      if (opts.only && !opts.only.includes(t)) continue;
      const list = categories.filter((c) => c.treatment === t && !c.archived);
      if (!list.length) continue;
      out.push({ value: `__${t}`, label: `── ${TREATMENT_LABEL[t]}`, disabled: true });
      for (const c of list) out.push({ value: c.id, label: c.name });
    }
    return out;
  }, [categories, opts.includeNone, opts.only]);
}

export function useCategoryMap(): Map<string, Category> {
  const categories = useApp((s) => s.data.categories);
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

export function useAccountMap(): Map<string, Holding> {
  const holdings = useApp((s) => s.data.holdings);
  return useMemo(() => new Map(holdings.map((h) => [h.id, h])), [holdings]);
}

export function CategoryDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? 'rgb(var(--muted))' }} aria-hidden />;
}

export function TransferBadge({ t }: { t: Transaction }) {
  if (t.transfer === 'internal') return <Badge tone="neutral" title="Moves money between your own accounts. Excluded from household income and spending.">Transfer</Badge>;
  if (t.transfer === 'between-partners')
    return (
      <Badge tone="info" title="Money moving between partners. Excluded from household totals; shown as a transfer in each person's view.">
        Partner transfer
      </Badge>
    );
  return null;
}

export const FREQUENCY_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' } as const;
