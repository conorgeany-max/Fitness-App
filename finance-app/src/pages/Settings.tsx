import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui';
import { useApp } from '@/store/store';
import { Connections } from './settings/Connections';
import { Audit, DataTab, Preferences, Privacy, Profiles, RulesAndSources, Security } from './settings/Sections';

type Tab = 'profiles' | 'privacy' | 'connections' | 'data' | 'security' | 'preferences' | 'rules' | 'audit';
const TABS: Tab[] = ['profiles', 'privacy', 'connections', 'data', 'security', 'preferences', 'rules', 'audit'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const connections = useApp((s) => s.data.connections.length);
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'profiles';

  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" subtitle="People, privacy, bank connections, your data and the rules behind every calculation." />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { value: 'profiles', label: 'Household' },
          { value: 'privacy', label: 'Privacy & sharing' },
          { value: 'connections', label: 'Connections', count: connections || undefined },
          { value: 'data', label: 'Data' },
          { value: 'security', label: 'Security' },
          { value: 'preferences', label: 'Preferences' },
          { value: 'rules', label: 'Rules & sources' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      {tab === 'profiles' && <Profiles />}
      {tab === 'privacy' && <Privacy />}
      {tab === 'connections' && <Connections />}
      {tab === 'data' && <DataTab />}
      {tab === 'security' && <Security />}
      {tab === 'preferences' && <Preferences />}
      {tab === 'rules' && <RulesAndSources />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
