import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { formatMoney, formatPercent } from '@/domain/money';
import { useApp } from '@/store/store';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { LABEL_META, prepare } from './analysis';

export function Shortlist({ onOpen }: { onOpen: (id: string) => void }) {
  const data = useApp((s) => s.data);
  const list = data.properties.filter((p) => p.shortlisted);
  const rows = useMemo(() => list.map((p) => ({ p, prep: prepare(data, p, false) })), [data, list]);

  if (!list.length) {
    return (
      <Card>
        <EmptyState icon={<Star className="h-5 w-5" />} title="Nothing shortlisted yet">Open an analysis and press Shortlist to compare properties side by side.</EmptyState>
      </Card>
    );
  }

  const line = (label: string, get: (r: (typeof rows)[number]) => React.ReactNode) => (
    <tr className="border-t border-line/60">
      <th className="sticky left-0 bg-surface px-5 py-2 text-left text-xs font-medium text-muted">{label}</th>
      {rows.map((r) => <td key={r.p.id} className="num px-4 py-2 text-right">{get(r)}</td>)}
    </tr>
  );

  return (
    <Card>
      <CardHeader title="Shortlist" subtitle="Same household numbers applied to each property. Missing listing costs are treated as $0 and flagged." />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface px-5 py-2" />
              {rows.map(({ p }) => (
                <th key={p.id} className="px-4 py-2 text-right align-bottom">
                  <button type="button" className="font-semibold hover:text-accent" onClick={() => onOpen(p.id)}>{p.name}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line('Result', ({ prep }) => (prep.result ? <Badge tone={LABEL_META[prep.result.label].tone}>{LABEL_META[prep.result.label].text}</Badge> : <span className="text-muted">Needs inputs</span>))}
            {line('Price used', ({ prep }) => formatMoney(prep.costs?.priceCents))}
            {line('Beds / baths / cars', ({ p }) => `${p.listing.bedrooms.value ?? '—'} / ${p.listing.bathrooms.value ?? '—'} / ${p.listing.parking.value ?? '—'}`)}
            {line('Land', ({ p }) => (p.listing.landSizeSqm.value ? `${p.listing.landSizeSqm.value} m²` : '—'))}
            {line('Deposit', ({ p }) => formatMoney(p.settings.depositCents))}
            {line('Upfront cash', ({ prep }) => formatMoney(prep.result?.upfrontTotalCents))}
            {line('Stamp duty', ({ prep }) => { const u = prep.result?.upfront.find((x) => x.key === 'duty'); return u && u.basis !== 'unavailable' ? formatMoney(u.cents) : '—'; })}
            {line('Loan', ({ prep }) => formatMoney(prep.result?.loanCents))}
            {line('LVR', ({ prep }) => formatPercent(prep.result?.lvr, 1))}
            {line('Repayments / month', ({ prep }) => formatMoney(prep.result?.repaymentMonthlyCents))}
            {line('At stress rate', ({ prep }) => formatMoney(prep.result?.stressRepaymentMonthlyCents))}
            {line('Housing / take-home', ({ prep }) => formatPercent(prep.result?.housingRatio, 0))}
            {line('Left over / month', ({ prep }) => formatMoney(prep.result?.disposableMonthlyCents))}
            {line('Buffer after settlement', ({ prep }) => (prep.result ? `${prep.result.bufferMonths.toFixed(1)} months` : '—'))}
            {line('Missing inputs', ({ prep }) => (prep.missing.length ? <span className="text-warn">{prep.missing.length}</span> : <span className="text-muted">None</span>))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
