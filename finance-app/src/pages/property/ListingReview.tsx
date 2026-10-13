import type { ReactNode } from 'react';
import { LISTING_FIELD_LABELS } from '@/domain/property/listingParser';
import type { AustralianState, FieldStatus, ListingField, PropertyListing } from '@/domain/types';
import { Badge, MoneyInput, NumberInput, Select, TextInput } from '@/components/ui';

const STATUS_META: Record<FieldStatus, { label: string; tone: 'good' | 'info' | 'warn' | 'neutral' }> = {
  extracted: { label: 'From listing', tone: 'good' },
  user: { label: 'You entered', tone: 'info' },
  estimated: { label: 'Estimate', tone: 'warn' },
  unavailable: { label: 'Not found', tone: 'neutral' },
};

const STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];
type Key = keyof PropertyListing;
const MONEY: Key[] = ['priceCents', 'priceMaxCents', 'strataAnnualCents', 'councilRatesAnnualCents', 'waterAnnualCents', 'rentWeeklyCents'];
const NUMBER: Key[] = ['bedrooms', 'bathrooms', 'parking', 'landSizeSqm'];

export function FieldStatusBadge({ field }: { field: ListingField<unknown> }) {
  const m = STATUS_META[field.status];
  return (
    <Badge tone={m.tone} title={field.evidence ? `Found in: “${field.evidence}”` : field.status === 'unavailable' ? 'Not in the listing text. Enter it yourself if you know it.' : undefined}>
      {m.label}
    </Badge>
  );
}

/**
 * Every extracted value is shown with where it came from, and every field can be corrected.
 * Editing a field marks it "You entered"; clearing it marks it "Not found". Nothing is filled in by guesswork.
 */
export function ListingReview({ listing, onChange }: { listing: PropertyListing; onChange: (l: PropertyListing) => void }) {
  const set = <K extends Key>(k: K, value: PropertyListing[K]['value']) => {
    const empty = value === null || value === '';
    onChange({ ...listing, [k]: { value: empty ? null : value, status: empty ? 'unavailable' : 'user' } });
  };

  const field = (k: Key, input: ReactNode, wide = false) => (
    <div key={k} className={wide ? 'sm:col-span-2' : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{LISTING_FIELD_LABELS[k]}</span>
        <FieldStatusBadge field={listing[k]} />
      </div>
      {input}
      {listing[k].status === 'extracted' && listing[k].evidence && <div className="mt-1 truncate text-2xs text-muted" title={listing[k].evidence}>“{listing[k].evidence}”</div>}
    </div>
  );

  const render = (k: Key) => {
    const f = listing[k];
    if (k === 'state')
      return field(k, <Select aria-label="State" value={(f.value as string) ?? ''} onChange={(e) => set('state', (e.target.value || null) as AustralianState | null)} options={[{ value: '', label: 'Unknown' }, ...STATES.map((s) => ({ value: s, label: s }))]} />);
    if (MONEY.includes(k)) return field(k, <MoneyInput ariaLabel={LISTING_FIELD_LABELS[k]} value={f.value as number | null} allowEmpty onChange={(v) => set(k, v as never)} placeholder="Not provided" />);
    if (NUMBER.includes(k)) return field(k, <NumberInputNullable value={f.value as number | null} onChange={(v) => set(k, v as never)} label={LISTING_FIELD_LABELS[k]} />);
    return field(k, <TextInput aria-label={LISTING_FIELD_LABELS[k]} value={(f.value as string) ?? ''} placeholder="Not provided" onChange={(e) => set(k, e.target.value as never)} />, k === 'address' || k === 'leaseDetails' || k === 'priceText');
  };

  return (
    <div className="space-y-6">
      <Section title="Location">{(['address', 'suburb', 'state', 'postcode'] as Key[]).map(render)}</Section>
      <Section title="Price">{(['priceText', 'priceCents', 'priceMaxCents'] as Key[]).map(render)}</Section>
      <Section title="Property">{(['propertyType', 'bedrooms', 'bathrooms', 'parking', 'landSizeSqm'] as Key[]).map(render)}</Section>
      <Section title="Ongoing costs and rent">{(['councilRatesAnnualCents', 'waterAnnualCents', 'strataAnnualCents', 'rentWeeklyCents', 'leaseDetails'] as Key[]).map(render)}</Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function NumberInputNullable({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  if (value === null)
    return <TextInput aria-label={label} placeholder="Not provided" value="" inputMode="decimal" onChange={(e) => { const n = Number(e.target.value); if (e.target.value && Number.isFinite(n)) onChange(n); }} />;
  return <NumberInput value={value} onChange={(v) => onChange(Number.isFinite(v) ? v : null)} min={0} />;
}
