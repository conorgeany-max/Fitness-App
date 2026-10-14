import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '@/components/ui';
import { useApp } from '@/store/store';
import { Connections } from './settings/Connections';
import { CloudConnections, CloudHousehold, CloudPrivacy, CloudSecurity } from './settings/Cloud';
import { Audit, DataTab, Preferences, Privacy, Profiles, RulesAndSources, Security } from './settings/Sections';

type Tab = 'profiles' | 'privacy' | 'connections' | 'data' | 'security' | 'preferences' | 'rules' | 'audit';
const TABS: Tab[] = ['profiles', 'privacy', 'connections', 'data', 'security', 'preferences', 'rules', 'audit'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const connections = useApp((s) => s.data.connections.length);
  const cloud = useApp((s) => s.mode === 'cloud');
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
          { value: 'connections', label: 'Connections', count: cloud ? undefined : connections || undefined },
          { value: 'data', label: 'Data' },
          { value: 'security', label: 'Security' },
          { value: 'preferences', label: 'Preferences' },
          { value: 'rules', label: 'Rules & sources' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      {tab === 'profiles' && (
        <div className="space-y-4">
          {cloud && <CloudHousehold />}
          <Profiles />
        </div>
      )}
      {tab === 'privacy' && (cloud ? <CloudPrivacy /> : <Privacy />)}
      {tab === 'connections' && (cloud ? <CloudConnections /> : <Connections />)}
      {tab === 'data' && <DataTab />}
      {tab === 'security' && (cloud ? <CloudSecurity /> : <Security />)}
      {tab === 'preferences' && <Preferences />}
      {tab === 'rules' && <RulesAndSources />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
