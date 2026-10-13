import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { baseScenario } from '@/store/defaults';
import { useApp } from '@/store/store';
import { Button, PageHeader, Select, Tabs, toast } from '@/components/ui';
import { Projection } from './forecasts/Projection';
import { IncomeTax } from './forecasts/IncomeTax';
import { ScenarioEditor } from './forecasts/ScenarioEditor';
import { Compare, Sensitivity } from './forecasts/Compare';

type Tab = 'projection' | 'income' | 'scenario' | 'compare' | 'sensitivity';
const TABS: Tab[] = ['projection', 'income', 'scenario', 'compare', 'sensitivity'];

export default function Forecasts() {
  const [params, setParams] = useSearchParams();
  const scenarios = useApp((s) => s.data.scenarios);
  const upsertScenario = useApp((s) => s.upsertScenario);
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'projection';
  const scenario = scenarios.find((s) => s.id === params.get('s')) ?? scenarios[0];
  const go = (t: Tab, s = scenario?.id) => setParams(s ? { tab: t, s } : { tab: t }, { replace: true });

  const addScenario = () => {
    const s = { ...baseScenario(), name: `Scenario ${scenarios.length + 1}`, color: `var(--series-${(scenarios.length % 8) + 1})` };
    upsertScenario(s);
    go('scenario', s.id);
    toast('Scenario added');
  };

  const showsScenario = tab !== 'income' && tab !== 'compare';
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Forecasts"
        subtitle="Income, tax and where your finances could be in 1 to 30 years. Projections are estimates, not guarantees."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {showsScenario && scenario && <Select aria-label="Scenario" value={scenario.id} onChange={(e) => go(tab, e.target.value)} options={scenarios.map((s) => ({ value: s.id, label: s.name }))} className="w-48" />}
            <Button icon={<Plus className="h-4 w-4" />} onClick={addScenario}>New scenario</Button>
          </div>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => go(t)}
        tabs={[
          { value: 'projection', label: 'Projection' },
          { value: 'income', label: 'Income & tax' },
          { value: 'scenario', label: 'Edit scenario' },
          { value: 'compare', label: 'Compare', count: scenarios.length },
          { value: 'sensitivity', label: 'Sensitivity' },
        ]}
      />
      {!scenario && tab !== 'income' ? null : (
        <>
          {tab === 'projection' && <Projection key={scenario.id} scenario={scenario} />}
          {tab === 'income' && <IncomeTax />}
          {tab === 'scenario' && <ScenarioEditor scenario={scenario} onSelect={(id) => go('scenario', id)} />}
          {tab === 'compare' && <Compare />}
          {tab === 'sensitivity' && <Sensitivity key={scenario.id} scenario={scenario} />}
        </>
      )}
    </div>
  );
}
