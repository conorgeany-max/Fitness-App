import { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, ExternalLink, Search } from 'lucide-react';
import { DEFAULT_CRITERIA, screenListing, splitListings, type ScreenCriteria, type Verdict } from '@/domain/property/screener';
import { authFetch } from '@/cloud/authFetch';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, MoneyInput, NumberInput, TextArea, TextInput, Toggle, toast } from '@/components/ui';
import { analysisFromDomain, newAnalysis, prepare, type DomainListingRow } from './analysis';

const VERDICT: Record<Verdict, { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  pass: { text: 'Pass', tone: 'good' },
  stretch: { text: 'Stretch', tone: 'warn' },
  fail: { text: 'Fail', tone: 'bad' },
  unknown: { text: 'Not enough detail', tone: 'neutral' },
};
const ORDER: Verdict[] = ['pass', 'stretch', 'unknown', 'fail'];
const csv = (v: string[]) => v.join(', ');
const fromCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const optNum = (v: number) => (v > 0 ? v : null);

export function Screener({ onOpen }: { onOpen: (id: string) => void }) {
  const data = useApp((s) => s.data);
  const update = useApp((s) => s.updateSettings);
  const upsert = useApp((s) => s.upsertProperty);
  const criteria = data.settings.screener ?? DEFAULT_CRITERIA;
  const set = (patch: Partial<ScreenCriteria>) => update({ screener: { ...criteria, ...patch } });
  const [suburbs, setSuburbs] = useState(csv(criteria.suburbs));
  const [types, setTypes] = useState(csv(criteria.propertyTypes));
  const [paste, setPaste] = useState('');

  const rows = useMemo(
    () =>
      data.properties
        .map((p) => ({ p, r: screenListing(p, criteria, criteria.useAffordability ? prepare(data, p, false).result?.label ?? null : null) }))
        .sort((a, b) => ORDER.indexOf(a.r.verdict) - ORDER.indexOf(b.r.verdict)),
    [data, criteria],
  );

  const addPasted = () => {
    const parts = splitListings(paste);
    if (!parts.length) return toast('Paste at least one listing (separate several with a line of ---).', 'info');
    for (const text of parts) upsert(newAnalysis({ text }));
    setPaste('');
    toast(`${parts.length} listing${parts.length === 1 ? '' : 's'} added. Check the extracted details in the analyser.`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="What you're looking for" subtitle="Shared by both of you. Every listing below is checked against these." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyInput label="Most you'd pay" value={criteria.maxPriceCents} allowEmpty onChange={(v) => set({ maxPriceCents: v })} />
          <NumberInput label="Stretch allowance" suffix="%" min={0} max={20} value={criteria.stretchPercent} onChange={(v) => set({ stretchPercent: v })} hint="Listings this far over your limit show as a stretch." />
          <TextInput label="Suburbs" placeholder="Coburg, Brunswick, Thornbury" value={suburbs} onChange={(e) => setSuburbs(e.target.value)} onBlur={() => set({ suburbs: fromCsv(suburbs) })} hint="Comma-separated. Empty means any suburb." />
          <TextInput label="Property types" placeholder="House, Townhouse" value={types} onChange={(e) => setTypes(e.target.value)} onBlur={() => set({ propertyTypes: fromCsv(types) })} hint="Empty means any type." />
          <NumberInput label="Bedrooms (at least)" min={0} max={10} value={criteria.minBedrooms ?? 0} onChange={(v) => set({ minBedrooms: optNum(v) })} />
          <NumberInput label="Bathrooms (at least)" min={0} max={10} value={criteria.minBathrooms ?? 0} onChange={(v) => set({ minBathrooms: optNum(v) })} />
          <NumberInput label="Car spaces (at least)" min={0} max={10} value={criteria.minParking ?? 0} onChange={(v) => set({ minParking: optNum(v) })} />
          <NumberInput label="Land (at least)" suffix="m²" min={0} step={10} value={criteria.minLandSqm ?? 0} onChange={(v) => set({ minLandSqm: optNum(v) })} />
          <MoneyInput label="Strata fees (at most, per year)" value={criteria.maxStrataAnnualCents} allowEmpty onChange={(v) => set({ maxStrataAnnualCents: v })} />
          <NumberInput label="Commute (at most)" suffix="min" min={0} max={180} value={criteria.maxCommuteMinutes ?? 0} onChange={(v) => set({ maxCommuteMinutes: optNum(v) })} hint="You enter each listing's commute below." />
          <div className="sm:col-span-2">
            <Toggle checked={criteria.useAffordability} onChange={(v) => set({ useAffordability: v })} label="Check against our finances" hint="Uses the property analyser's result for each listing: deposit, stamp duty, repayments and your buffer." />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Paste listings" subtitle="Copy listing pages from realestate.com.au, Domain or an agent's site. Separate several with a line of three dashes (---)." />
          <div className="space-y-3 px-5 pb-5">
            <TextArea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'12 Smith St, Coburg VIC 3058\n$850,000 - $900,000\n3 bed 1 bath 1 car…\n---\n4/9 Jones Rd…'} />
            <Button variant="primary" icon={<ClipboardPaste className="h-4 w-4" />} disabled={!paste.trim()} onClick={addPasted}>
              Add to screener
            </Button>
          </div>
        </Card>
        <DomainSearch criteria={criteria} />
      </div>

      <Card>
        <CardHeader title="Results" subtitle="Best first. Details the listing doesn't give are shown as unknown, never assumed." />
        {rows.length === 0 ? (
          <EmptyState title="No listings yet">Paste some listings above, or analyse one in the Property analyser.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ p, r }) => (
              <li key={p.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-[14rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="font-medium hover:text-accent" onClick={() => onOpen(p.id)}>
                      {p.name}
                    </button>
                    <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].text}</Badge>
                    {r.unknowns > 0 && r.verdict !== 'unknown' && <span className="text-xs text-muted">{r.unknowns} unknown</span>}
                    {p.sourceUrl && (
                      <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-muted underline">
                        listing <ExternalLink className="inline h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {r.checks.map((c) => (
                      <li key={c.key} className={c.verdict === 'fail' ? 'text-bad' : c.verdict === 'stretch' ? 'text-warn' : c.verdict === 'unknown' ? 'text-muted' : 'text-ink-2'}>
                        {c.verdict === 'pass' ? '✓' : c.verdict === 'fail' ? '✗' : c.verdict === 'stretch' ? '~' : '?'} {c.text}
                      </li>
                    ))}
                    {r.checks.length === 0 && <li className="text-muted">Set some criteria above to screen this listing.</li>}
                  </ul>
                </div>
                {criteria.maxCommuteMinutes !== null && (
                  <div className="w-36">
                    <NumberInput label="Commute" suffix="min" min={0} max={300} value={p.commuteMinutes ?? 0} onChange={(v) => upsert({ ...p, commuteMinutes: v > 0 ? v : undefined })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DomainSearch({ criteria }: { criteria: ScreenCriteria }) {
  const state = useApp((s) => s.data.settings.stateOfResidence);
  const properties = useApp((s) => s.data.properties);
  const upsert = useApp((s) => s.upsertProperty);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<DomainListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch('/api/domain/status')
      .then(async (r) => setAvailable(r.ok && ((await r.json()) as { available?: boolean }).available === true))
      .catch(() => setAvailable(false));
  }, []);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch('/api/domain/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, suburbs: criteria.suburbs, minBedrooms: criteria.minBedrooms, minBathrooms: criteria.minBathrooms, minCarspaces: criteria.minParking, maxPriceCents: criteria.maxPriceCents ? Math.round(criteria.maxPriceCents * (1 + criteria.stretchPercent / 100)) : null, propertyTypes: criteria.propertyTypes }),
      });
      const body = (await res.json()) as { listings?: DomainListingRow[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Search failed.');
      setResults(body.listings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const known = new Set(properties.map((p) => p.sourceUrl).filter(Boolean));

  return (
    <Card>
      <CardHeader title="Search Domain" subtitle="Finds current listings matching your suburbs, price, rooms and types." />
      <div className="space-y-3 px-5 pb-5 text-sm">
        {available === false && <Callout tone="info">Domain search isn't switched on. It needs free API access approved by Domain; docs/DEPLOY.md explains how to apply. Pasting listings works in the meantime.</Callout>}
        {available && (
          <>
            <Button icon={<Search className="h-4 w-4" />} disabled={busy || !criteria.suburbs.length} onClick={search}>
              {busy ? 'Searching…' : `Search ${criteria.suburbs.length ? criteria.suburbs.slice(0, 3).join(', ') : 'your suburbs'}`}
            </Button>
            {!criteria.suburbs.length && <p className="text-muted">Add suburbs to your criteria first.</p>}
          </>
        )}
        {error && <Callout tone="bad">{error}</Callout>}
        {results && (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {results.length === 0 && <li className="p-3 text-muted">No listings matched.</li>}
            {results.map((d) => (
              <li key={d.id} className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <div className="font-medium">{d.address ?? d.suburb ?? 'Listing'}</div>
                  <div className="text-xs text-muted">
                    {[d.priceText, d.bedrooms !== null ? `${d.bedrooms} bed` : null, d.bathrooms !== null ? `${d.bathrooms} bath` : null, d.propertyType].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!!d.url && known.has(d.url)}
                  onClick={() => {
                    upsert(analysisFromDomain(d));
                    toast('Added to the screener');
                  }}
                >
                  {d.url && known.has(d.url) ? 'Added' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
