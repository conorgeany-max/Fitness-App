import { useState } from 'react';
import { ClipboardPaste, Globe, Home as HomeIcon, Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { emptyListing, parseListingText, parseListingUrl } from '@/domain/property/listingParser';
import { formatMoney } from '@/domain/money';
import type { PropertyAnalysis, PropertyListing, PropertyPurchaseSettings } from '@/domain/types';
import { uid } from '@/lib/id';
import { defaultPurchaseSettings } from '@/store/demo';
import { useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, Disclosure, MoneyInput, NumberInput, PercentInput, Select, TextArea, TextInput, Toggle, cx, toast } from '@/components/ui';
import { ListingReview } from './ListingReview';
import { AffordabilityView } from './AffordabilityView';
import { LABEL_META, usePrepared } from './analysis';

export function Analyser({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const properties = useApp((s) => s.data.properties);
  const selected = properties.find((p) => p.id === selectedId) ?? null;
  const [creating, setCreating] = useState(!properties.length);

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        <Button variant="primary" className="w-full" icon={<Plus className="h-4 w-4" />} onClick={() => { setCreating(true); onSelect(null); }}>Analyse a property</Button>
        {properties.length === 0 ? (
          <p className="px-1 text-sm text-muted">Saved analyses appear here.</p>
        ) : (
          <ul className="space-y-2">
            {properties.map((p) => <PropertyListItem key={p.id} p={p} active={p.id === selected?.id && !creating} onClick={() => { setCreating(false); onSelect(p.id); }} />)}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        {creating || !selected ? (
          <NewAnalysis onCreated={(id) => { setCreating(false); onSelect(id); }} />
        ) : (
          <AnalysisEditor key={selected.id} p={selected} onDeleted={() => onSelect(null)} />
        )}
      </div>
    </div>
  );
}

function PropertyListItem({ p, active, onClick }: { p: PropertyAnalysis; active: boolean; onClick: () => void }) {
  const prep = usePrepared(p, false);
  const label = prep?.result?.label;
  return (
    <li>
      <button type="button" onClick={onClick} className={cx('w-full rounded-xl border px-3 py-2.5 text-left transition-colors', active ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface hover:bg-surface-2')}>
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
          {p.shortlisted && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-warn" aria-label="Shortlisted" />}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span className="num">{p.listing.priceCents.value !== null ? formatMoney(p.listing.priceCents.value) : 'No price'}</span>
          {label && <Badge tone={LABEL_META[label].tone}>{LABEL_META[label].text.split(' ')[0]}</Badge>}
        </div>
      </button>
    </li>
  );
}

function NewAnalysis({ onCreated }: { onCreated: (id: string) => void }) {
  const upsert = useApp((s) => s.upsertProperty);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const urlValid = (() => {
    if (!url.trim()) return true;
    try {
      const u = new URL(url.trim());
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  })();

  const tryFetch = async () => {
    setFetching(true);
    setFetchMsg(null);
    try {
      const res = await fetch(`/api/listing/fetch?url=${encodeURIComponent(url.trim())}`);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; message?: string } | null;
      if (res.ok && body?.ok && body.text) {
        setText(body.text);
        setFetchMsg({ ok: true, message: 'Page text retrieved. Check the extracted details below before relying on them.' });
      } else {
        setFetchMsg({ ok: false, message: body?.message ?? `The page could not be retrieved (HTTP ${res.status}). Copy the listing text from your browser and paste it below.` });
      }
    } catch {
      setFetchMsg({ ok: false, message: 'The local server is not running, so the page could not be fetched. Copy the listing text from your browser and paste it below.' });
    } finally {
      setFetching(false);
    }
  };

  const create = (blank = false) => {
    const listing: PropertyListing = blank ? emptyListing() : text.trim() ? parseListingText(text, url.trim() || undefined) : { ...emptyListing(), ...parseListingUrl(url.trim()) };
    if (!listing.state.value) listing.state = { value: null, status: 'unavailable' };
    const now = new Date().toISOString();
    const name = listing.address.value ?? (listing.suburb.value ? `${listing.propertyType.value ?? 'Property'} in ${listing.suburb.value}` : 'New property');
    const p: PropertyAnalysis = {
      id: uid('prop'),
      name,
      sourceUrl: url.trim() || undefined,
      rawText: text,
      fetchStatus: fetchMsg ? { ...fetchMsg, at: now } : undefined,
      listing,
      settings: { ...defaultPurchaseSettings() },
      shortlisted: false,
      createdAt: now,
      updatedAt: now,
    };
    upsert(p);
    const found = Object.values(listing).filter((f) => f.status === 'extracted').length;
    toast(blank ? 'Blank analysis created' : `${found} detail(s) extracted — please review them`, found || blank ? 'good' : 'info');
    onCreated(p.id);
  };

  return (
    <Card>
      <CardHeader title="Analyse a property" subtitle="Paste a listing link and/or the listing text. Details are extracted for you to review; nothing is guessed." />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-2">
          <TextInput label="Listing link (optional)" placeholder="https://www.realestate.com.au/property-…" value={url} onChange={(e) => setUrl(e.target.value)} error={urlValid ? null : 'Enter a full web address starting with https://'} className="min-w-[16rem] flex-1" />
          <Button icon={fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} disabled={!url.trim() || !urlValid || fetching} onClick={tryFetch}>Try to fetch page</Button>
        </div>
        {fetchMsg && <Callout tone={fetchMsg.ok ? 'good' : 'warn'}>{fetchMsg.message}</Callout>}
        <TextArea label="Listing text" rows={8} placeholder={'Paste everything from the listing page: address, price guide, beds/baths, rates, rent…'} value={text} onChange={(e) => setText(e.target.value)} hint="Tip: select all on the listing page, copy, and paste here. Only what's in the text is used." />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<ClipboardPaste className="h-4 w-4" />} disabled={!text.trim() && !url.trim()} onClick={() => create(false)}>Extract details</Button>
          <Button variant="ghost" onClick={() => create(true)}>Enter details manually</Button>
        </div>
        <p className="text-xs text-muted">Listing sites often block automated access. Fetching uses the app's own server, respects robots.txt, and reports failures rather than inventing data. Suburb growth, comparable sales and yields are never filled in for you.</p>
      </div>
    </Card>
  );
}

function AnalysisEditor({ p, onDeleted }: { p: PropertyAnalysis; onDeleted: () => void }) {
  const upsert = useApp((s) => s.upsertProperty);
  const del = useApp((s) => s.deleteProperty);
  const prep = usePrepared(p);
  const set = (patch: Partial<PropertyAnalysis>) => upsert({ ...p, ...patch, updatedAt: new Date().toISOString() });
  const setS = (patch: Partial<PropertyPurchaseSettings>) => set({ settings: { ...p.settings, ...patch } });
  const extracted = Object.values(p.listing).filter((f) => f.status === 'extracted').length;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <HomeIcon className="mt-1 h-5 w-5 text-muted" />
          <div className="min-w-0 flex-1">
            <TextInput aria-label="Analysis name" value={p.name} onChange={(e) => set({ name: e.target.value })} className="text-base font-semibold" />
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              {p.sourceUrl && <a href={p.sourceUrl} target="_blank" rel="noreferrer noopener" className="max-w-xs truncate text-accent hover:underline">{p.sourceUrl}</a>}
              <span>{extracted} field(s) from listing</span>
              {p.fetchStatus && !p.fetchStatus.ok && <Badge tone="warn" title={p.fetchStatus.message}>Page not fetched</Badge>}
            </div>
          </div>
          <Button icon={<Star className={cx('h-4 w-4', p.shortlisted && 'fill-current text-warn')} />} onClick={() => set({ shortlisted: !p.shortlisted })}>{p.shortlisted ? 'Shortlisted' : 'Shortlist'}</Button>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} aria-label="Delete analysis" onClick={() => { del(p.id); onDeleted(); toast('Analysis deleted'); }} />
        </div>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader title="Listing details" subtitle="Check every value. Badges show where each one came from." />
          <div className="p-5">
            <ListingReview listing={p.listing} onChange={(listing) => set({ listing })} />
            {p.rawText && (
              <div className="mt-5">
                <Disclosure summary="Original listing text">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-4 pb-4 text-xs text-ink-2">{p.rawText}</pre>
                </Disclosure>
              </div>
            )}
          </div>
        </Card>
        <PurchaseSettings p={p} setS={setS} />
      </div>

      {prep && <AffordabilityView prep={prep} />}
      <TextArea label="Notes" rows={3} value={p.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="Inspection notes, questions for the agent…" />
    </div>
  );
}

function PurchaseSettings({ p, setS }: { p: PropertyAnalysis; setS: (patch: Partial<PropertyPurchaseSettings>) => void }) {
  const d = useDerived();
  const s = p.settings;
  return (
    <Card>
      <CardHeader title="Your purchase" subtitle="Deposit, loan and costs. Defaults are typical figures — change them to yours." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Select
          label="Buying as"
          value={s.buyers}
          onChange={(e) => {
            const b = e.target.value as PropertyPurchaseSettings['buyers'];
            setS({ buyers: b, ownership: b === 'me' ? { me: 100, partner: 0 } : b === 'partner' ? { me: 0, partner: 100 } : b === 'joint' ? { me: 50, partner: 50 } : s.ownership });
          }}
          options={[{ value: 'joint', label: 'Both of us (50/50)' }, { value: 'me', label: `${d.names.me} only` }, { value: 'partner', label: `${d.names.partner} only` }, { value: 'custom', label: 'Custom split' }]}
        />
        {s.buyers === 'custom' ? (
          <PercentInput label={`${d.names.me}'s share`} value={s.ownership.me / 100} step={5} onChange={(v) => { const me = Math.round(Math.max(0, Math.min(1, v)) * 100); setS({ ownership: { me, partner: 100 - me } }); }} />
        ) : (
          <Select label="Use" value={s.intendedUse} onChange={(e) => setS({ intendedUse: e.target.value as PropertyPurchaseSettings['intendedUse'] })} options={[{ value: 'owner-occupier', label: 'Home to live in' }, { value: 'investment', label: 'Investment' }]} />
        )}
        {s.buyers === 'custom' && <Select label="Use" value={s.intendedUse} onChange={(e) => setS({ intendedUse: e.target.value as PropertyPurchaseSettings['intendedUse'] })} options={[{ value: 'owner-occupier', label: 'Home to live in' }, { value: 'investment', label: 'Investment' }]} />}
        <MoneyInput label="Deposit" value={s.depositCents} onChange={(v) => setS({ depositCents: v ?? 0 })} hint={`Savings available: ${formatMoney(d.balance.household.liquidCents)}`} />
        <PercentInput label="Interest rate" value={s.interestRate} step={0.05} onChange={(v) => setS({ interestRate: v })} hint="Use a real quote from a lender if you have one" />
        <NumberInput label="Loan term" value={s.termYears} onChange={(v) => setS({ termYears: Math.max(1, Math.min(40, v)) })} suffix="years" />
        <Select label="Repayments" value={s.repaymentType} onChange={(e) => setS({ repaymentType: e.target.value as 'PI' | 'IO' })} options={[{ value: 'PI', label: 'Principal & interest' }, { value: 'IO', label: 'Interest only' }]} />
        <PercentInput label="Stress test buffer" value={s.stressBuffer} step={0.25} onChange={(v) => setS({ stressBuffer: v })} hint="Lenders typically assess at +3%" />
        {s.intendedUse === 'owner-occupier' && <MoneyInput label="Rent you pay now (per week)" value={s.currentRentWeeklyCents} allowEmpty onChange={(v) => setS({ currentRentWeeklyCents: v })} hint={d.livingCosts.basis === 'transactions' ? 'Blank = use rent found in your transactions' : 'Stops when you move in'} />}
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={s.firstHomeBuyer} onChange={(v) => setS({ firstHomeBuyer: v })} label="First home buyer" hint="Applies state concessions where the rules support it. Check your eligibility with your state revenue office." />
          <Toggle checked={s.homeGuarantee} onChange={(v) => setS({ homeGuarantee: v })} label="Using the Home Guarantee Scheme" hint="No LMI with a 5% deposit (eligibility and price caps apply)." />
          <Toggle checked={s.capitaliseLmi} onChange={(v) => setS({ capitaliseLmi: v })} label="Add LMI to the loan" />
        </div>
        <Disclosure summary="Other costs and overrides">
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
            <MoneyInput label="Conveyancing" value={s.conveyancingCents} onChange={(v) => setS({ conveyancingCents: v ?? 0 })} />
            <MoneyInput label="Building & pest inspections" value={s.inspectionsCents} onChange={(v) => setS({ inspectionsCents: v ?? 0 })} />
            <MoneyInput label="Moving" value={s.movingCents} onChange={(v) => setS({ movingCents: v ?? 0 })} />
            <MoneyInput label="Furnishing" value={s.furnishingCents} onChange={(v) => setS({ furnishingCents: v ?? 0 })} />
            <MoneyInput label="Building insurance (per year)" value={s.buildingInsuranceAnnualCents} onChange={(v) => setS({ buildingInsuranceAnnualCents: v ?? 0 })} />
            <PercentInput label="Maintenance (of value, per year)" value={s.maintenanceRate} step={0.1} onChange={(v) => setS({ maintenanceRate: v })} />
            <MoneyInput label="Stamp duty override" value={s.stampDutyOverrideCents} allowEmpty onChange={(v) => setS({ stampDutyOverrideCents: v })} hint="Blank = calculate from state rules" />
            <MoneyInput label="LMI override" value={s.lmiOverrideCents} allowEmpty onChange={(v) => setS({ lmiOverrideCents: v })} hint="Blank = rough estimate; get a lender quote" />
            <MoneyInput label="Take-home pay override (monthly)" value={s.overrides.takeHomeMonthlyCents ?? null} allowEmpty onChange={(v) => setS({ overrides: { ...s.overrides, takeHomeMonthlyCents: v } })} hint={`Blank = ${formatMoney(d.takeHomeMonthly.me + d.takeHomeMonthly.partner)} from income profiles`} />
            <MoneyInput label="Living costs override (monthly)" value={s.overrides.livingCostsMonthlyCents ?? null} allowEmpty onChange={(v) => setS({ overrides: { ...s.overrides, livingCostsMonthlyCents: v } })} hint={`Blank = ${formatMoney(d.livingCosts.monthlyCents)} excluding housing`} />
            <MoneyInput label="Other debt repayments override (monthly)" value={s.overrides.otherDebtRepaymentsMonthlyCents ?? null} allowEmpty onChange={(v) => setS({ overrides: { ...s.overrides, otherDebtRepaymentsMonthlyCents: v } })} hint={`Blank = ${formatMoney(d.loanRepaymentsMonthlyCents + d.otherDebtRepaymentsMonthlyCents)} including existing home loans`} />
            <MoneyInput label="Savings override" value={s.overrides.savingsCents ?? null} allowEmpty onChange={(v) => setS({ overrides: { ...s.overrides, savingsCents: v } })} />
            <NumberInput label="Emergency buffer to keep" value={s.emergencyFundMonths} onChange={(v) => setS({ emergencyFundMonths: Math.max(0, v) })} suffix="months" />
          </div>
        </Disclosure>
      </div>
    </Card>
  );
}
