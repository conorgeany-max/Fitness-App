import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, FlaskConical, Landmark, PenLine, ShieldCheck } from 'lucide-react';
import { useApp } from '@/store/store';
import { buildDemoWorkspace } from '@/store/demo';
import { Button, Callout, Card, Select, TextInput, cx } from '@/components/ui';
import type { AustralianState, Residency } from '@/domain/types';

const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export default function Onboarding() {
  const data = useApp((s) => s.data);
  const mutate = useApp((s) => s.mutate);
  const switchWorkspace = useApp((s) => s.switchWorkspace);
  const nav = useNavigate();
  const [me, setMe] = useState(data.people.me.name === 'Me' ? '' : data.people.me.name);
  const [partner, setPartner] = useState(data.people.partner.name === 'Partner' ? '' : data.people.partner.name);
  const [state, setState] = useState<AustralianState>(data.settings.stateOfResidence);
  const [resMe, setResMe] = useState<Residency>(data.people.me.income.residency);
  const [resPartner, setResPartner] = useState<Residency>(data.people.partner.income.residency);

  const save = (to: string) => {
    mutate((d) => {
      d.people.me.name = me.trim() || 'Me';
      d.people.partner.name = partner.trim() || 'Partner';
      d.people.me.income.residency = resMe;
      d.people.partner.income.residency = resPartner;
      d.settings.stateOfResidence = state;
      d.settings.onboarded = true;
    });
    nav(to);
  };

  const startDemo = async () => {
    await switchWorkspace('demo', () => buildDemoWorkspace());
    nav('/');
  };

  const residencyOptions = [
    { value: 'unknown', label: 'Not sure yet' },
    { value: 'resident', label: 'Australian resident for tax' },
    { value: 'non-resident', label: 'Foreign resident for tax' },
  ];

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Set up your household</h1>
        <p className="mt-1 text-sm text-muted">A shared command centre for two partners. Everything stays on this device unless you export it.</p>
      </div>

      {data.kind === 'demo' && (
        <div className="mb-4">
          <Callout tone="demo" title="You are in demo mode">
            Changes here apply to the fictional demo workspace. Exit demo mode from the banner to set up your real finances.
          </Callout>
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold">1. Who is in the household?</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextInput label="Your name" placeholder="e.g. Sam" value={me} onChange={(e) => setMe(e.target.value)} />
          <TextInput label="Your partner's name" placeholder="e.g. Riley" value={partner} onChange={(e) => setPartner(e.target.value)} />
          <Select label="Your tax residency" value={resMe} onChange={(e) => setResMe(e.target.value as Residency)} options={residencyOptions} hint="Used for take-home pay estimates. If unsure, we'll flag estimates as assuming resident rates." />
          <Select label="Partner's tax residency" value={resPartner} onChange={(e) => setResPartner(e.target.value as Residency)} options={residencyOptions} />
          <Select label="State" value={state} onChange={(e) => setState(e.target.value as AustralianState)} options={STATES.map((s) => ({ value: s, label: s }))} hint="Used as the default for stamp duty estimates." />
        </div>
      </Card>

      <h2 className="mb-3 mt-8 text-sm font-semibold">2. How would you like to add your finances?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice icon={<PenLine className="h-5 w-5" />} title="Enter balances manually" body="Add accounts, property, super and debts with who owns them. The quickest way to see your net worth." onClick={() => save('/net-worth?add=1')} primary />
        <Choice icon={<FileSpreadsheet className="h-5 w-5" />} title="Import bank CSV files" body="Upload statements exported from internet banking. Parsed in your browser; duplicates are detected." onClick={() => save('/transactions?tab=import')} />
        <Choice icon={<Landmark className="h-5 w-5" />} title="Connect a bank (open banking)" body="Uses the Consumer Data Right via an accredited provider. In this build, sandbox and mock banks are available for testing — no real connections." onClick={() => save('/settings?tab=connections')} />
        <Choice icon={<FlaskConical className="h-5 w-5" />} title="Explore demo mode" body="A separate, clearly labelled workspace of fictional data. Your real workspace is untouched." onClick={startDemo} />
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-surface-2/50 p-4 text-sm text-ink-2">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-good" />
        <div>
          <p className="font-medium text-ink">Private by default</p>
          <p className="mt-1">
            Data is stored in this browser (IndexedDB). You can add passphrase encryption, export everything, or delete it all from Settings. This app never asks for internet banking passwords, and calculations are educational estimates rather than financial, tax or credit advice.
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={() => save('/')}>
          Continue to dashboard
        </Button>
      </div>
    </div>
  );
}

function Choice({ icon, title, body, onClick, primary }: { icon: React.ReactNode; title: string; body: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('group rounded-2xl border bg-surface p-4 text-left transition-colors hover:border-accent/60 hover:bg-surface-2', primary ? 'border-accent/40' : 'border-line')}>
      <div className="mb-3 inline-grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</div>
      <div className="font-medium text-ink">{title}</div>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </button>
  );
}
