import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui';
import { useApp } from '@/store/store';
import { Analyser } from './property/Analyser';
import { Shortlist } from './property/Shortlist';
import { MortgageCalculator } from './property/MortgageCalculator';
import { DebtDashboard, StampDutyEstimator } from './property/DebtsAndDuty';

type Tab = 'analyse' | 'shortlist' | 'mortgage' | 'debts' | 'duty';
const TABS: Tab[] = ['analyse', 'shortlist', 'mortgage', 'debts', 'duty'];

export default function Property() {
  const [params, setParams] = useSearchParams();
  const properties = useApp((s) => s.data.properties);
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'analyse';
  const selectedId = params.get('p') ?? properties[0]?.id ?? null;
  const go = (t: Tab, p?: string | null) => setParams(p ? { tab: t, p } : { tab: t }, { replace: true });

  return (
    <div className="animate-fade-in">
      <PageHeader title="Property & mortgages" subtitle="Analyse a listing against your real finances, compare a shortlist, and plan your loans." />
      <Tabs
        value={tab}
        onChange={(t) => go(t, t === 'analyse' ? selectedId : undefined)}
        tabs={[
          { value: 'analyse', label: 'Property analyser' },
          { value: 'shortlist', label: 'Shortlist', count: properties.filter((p) => p.shortlisted).length || undefined },
          { value: 'mortgage', label: 'Mortgage calculator' },
          { value: 'debts', label: 'Debts' },
          { value: 'duty', label: 'Stamp duty' },
        ]}
      />
      {tab === 'analyse' && <Analyser selectedId={selectedId} onSelect={(id) => go('analyse', id)} />}
      {tab === 'shortlist' && <Shortlist onOpen={(id) => go('analyse', id)} />}
      {tab === 'mortgage' && <MortgageCalculator />}
      {tab === 'debts' && <DebtDashboard />}
      {tab === 'duty' && <StampDutyEstimator />}
    </div>
  );
}
