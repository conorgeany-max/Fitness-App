import { useSearchParams } from 'react-router-dom';
import { Card, PageHeader, Tabs } from '@/components/ui';
import { Goals } from './tools/Goals';
import { Calculator, TOOLS, ToolPicker, type ToolId } from './tools/Calculators';

export default function Tools() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'calculators' ? 'calculators' : 'goals';
  const raw = params.get('tool') as ToolId | null;
  const tool: ToolId = raw && TOOLS.some((t) => t.id === raw && !t.link) ? raw : 'compound';

  return (
    <div className="animate-fade-in">
      <PageHeader title="Financial tools" subtitle="Goals and calculators. Calculators that can use your data are prefilled; nothing you type here changes your records." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={[{ value: 'goals', label: 'Goals' }, { value: 'calculators', label: 'Calculators' }]} />
      {tab === 'goals' ? (
        <Goals />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
          <Card className="h-fit p-2 lg:sticky lg:top-20">
            <ToolPicker value={tool} onChange={(t) => setParams({ tab: 'calculators', tool: t }, { replace: true })} />
          </Card>
          <div className="min-w-0">
            <Calculator key={tool} id={tool} />
          </div>
        </div>
      )}
    </div>
  );
}
