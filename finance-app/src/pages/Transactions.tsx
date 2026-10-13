import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { detectTransfers } from '@/domain/transactions';
import { PageHeader, Tabs } from '@/components/ui';
import { ScopeBadge } from '@/components/finance';
import { listableTransactions, useDerived, usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { TransactionList } from './transactions/TransactionList';
import { BudgetTab } from './transactions/BudgetTab';
import { BillsTab } from './transactions/BillsTab';
import { RulesTab } from './transactions/RulesTab';
import { ReconcileTab } from './transactions/ReconcileTab';
import { ImportTab } from './transactions/ImportTab';

type Tab = 'transactions' | 'budget' | 'bills' | 'rules' | 'reconcile' | 'import';
const TABS: Tab[] = ['transactions', 'budget', 'bills', 'rules', 'reconcile', 'import'];

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const data = useApp((s) => s.data);
  const d = useDerived();
  const perspective = usePerspective();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'transactions';
  const filter = params.get('filter');
  const setTab = (t: Tab, extra?: Record<string, string>) => setParams({ tab: t, ...extra }, { replace: true });
  const toReconcile = useMemo(() => {
    const txns = listableTransactions(data);
    return detectTransfers(txns, d.accounts).length + txns.filter((t) => t.possibleDuplicateOf && !t.excluded).length;
  }, [data, d.accounts]);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Transactions & budget" subtitle={<span className="inline-flex items-center gap-2">Spending, budgets, bills and categorisation <ScopeBadge perspective={perspective} names={d.names} /></span>} />
      <Tabs
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { value: 'transactions', label: 'Transactions', count: d.uncategorisedCount || undefined },
          { value: 'budget', label: 'Budget' },
          { value: 'bills', label: 'Bills' },
          { value: 'rules', label: 'Rules' },
          { value: 'reconcile', label: 'Reconcile', count: toReconcile || undefined },
          { value: 'import', label: 'Import CSV' },
        ]}
      />
      {tab === 'transactions' && <TransactionList key={filter ?? 'all'} initialFilter={filter === 'uncategorised' ? 'uncategorised' : filter === 'review' ? 'review' : undefined} />}
      {tab === 'budget' && <BudgetTab />}
      {tab === 'bills' && <BillsTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'reconcile' && <ReconcileTab onShowUncategorised={() => setTab('transactions', { filter: 'uncategorised' })} />}
      {tab === 'import' && <ImportTab />}
    </div>
  );
}
