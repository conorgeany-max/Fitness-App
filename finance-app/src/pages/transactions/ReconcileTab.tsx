import { useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Copy } from 'lucide-react';
import { formatDate } from '@/domain/dates';
import { detectTransfers } from '@/domain/transactions';
import type { Transaction } from '@/domain/types';
import { listableTransactions, useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Card, CardHeader, EmptyState, toast } from '@/components/ui';
import { Money } from '@/components/finance';
import { useAccountMap } from './shared';

export function ReconcileTab({ onShowUncategorised }: { onShowUncategorised: () => void }) {
  const data = useApp((s) => s.data);
  const mutate = useApp((s) => s.mutate);
  const updateTransactions = useApp((s) => s.updateTransactions);
  const d = useDerived();
  const accounts = useAccountMap();
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const txns = useMemo(() => listableTransactions(data), [data]);
  const byId = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);
  const suggestions = useMemo(() => detectTransfers(txns, d.accounts).filter((s) => !ignored.has(`${s.outId}|${s.inId}`)), [txns, d.accounts, ignored]);
  const duplicates = txns.filter((t) => t.possibleDuplicateOf && !t.excluded);

  const confirm = (outId: string, inId: string, kind: Transaction['transfer']) => {
    mutate(
      (dd) => {
        for (const t of dd.transactions) {
          if (t.id === outId || t.id === inId) {
            t.transfer = kind;
            t.transferPairId = t.id === outId ? inId : outId;
            t.categorisation = { source: 'manual', confidence: 1 };
          }
        }
      },
      { action: 'reconcile', detail: `Matched transfer ${outId} ↔ ${inId} (${kind})` },
    );
  };

  const accName = (id: string | null) => (id ? accounts.get(id)?.name ?? 'Unknown account' : 'No account');

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-muted">Possible transfers to confirm</div>
          <div className="num mt-1 text-xl font-semibold">{suggestions.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Possible duplicates</div>
          <div className="num mt-1 text-xl font-semibold">{duplicates.length}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted">Need a category</div>
              <div className="num mt-1 text-xl font-semibold">{d.uncategorisedCount}</div>
            </div>
            {d.uncategorisedCount > 0 && <Button size="sm" variant="subtle" onClick={onShowUncategorised}>Review</Button>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Transfers between your accounts" subtitle="An outflow and an inflow of the same amount within 3 days. Confirmed transfers are left out of household income and spending, so nothing is counted twice." />
        {suggestions.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing to match">All likely transfers are already marked.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {suggestions.map((s) => {
              const out = byId.get(s.outId);
              const inn = byId.get(s.inId);
              if (!out || !inn) return null;
              return (
                <li key={`${s.outId}|${s.inId}`} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <ArrowLeftRight className="h-4 w-4 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        <Money cents={Math.abs(out.amountCents)} showCents /> from {accName(out.accountId)} to {accName(inn.accountId)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {formatDate(out.date, 'short')} “{out.description}” → {formatDate(inn.date, 'short')} “{inn.description}” · {s.reason}
                      </div>
                    </div>
                    <Badge tone={s.confidence === 'high' ? 'good' : 'warn'}>{s.confidence === 'high' ? 'Likely' : 'Possible'}</Badge>
                    {s.kind === 'between-partners' && <Badge tone="info">Between partners</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 pl-7">
                    <Button size="sm" variant="primary" onClick={() => { confirm(s.outId, s.inId, s.kind); toast('Marked as transfer'); }}>Confirm transfer</Button>
                    <Button size="sm" variant="ghost" onClick={() => setIgnored((x) => new Set(x).add(`${s.outId}|${s.inId}`))}>Not a transfer</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Possible duplicates" subtitle="Same account and amount within 3 days of another transaction, but a different description. Exact duplicates are skipped on import automatically." />
        {duplicates.length === 0 ? (
          <EmptyState icon={<Copy className="h-5 w-5" />} title="No possible duplicates" />
        ) : (
          <ul className="mt-2 divide-y divide-line/60">
            {duplicates.map((t) => {
              const other = t.possibleDuplicateOf ? data.transactions.find((x) => x.id === t.possibleDuplicateOf) : undefined;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{formatDate(t.date, 'short')} · {t.description}</div>
                    {other && <div className="text-xs text-muted">Looks like {formatDate(other.date, 'short')} · {other.description}</div>}
                  </div>
                  <Money cents={t.amountCents} showCents signed />
                  <Button size="sm" onClick={() => { updateTransactions([t.id], { possibleDuplicateOf: undefined }); toast('Kept as a separate transaction'); }}>Keep both</Button>
                  <Button size="sm" variant="danger" onClick={() => { updateTransactions([t.id], { excluded: true }); toast('Excluded from totals (kept for audit)'); }}>Exclude</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
