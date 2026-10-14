import { useMemo, useState } from 'react';
import { Plus, Target, Trash2 } from 'lucide-react';
import { allocationPlan, collectPositions, normaliseSymbol, type InvestmentTarget } from '@/domain/allocation';
import { formatMoney, formatPercent } from '@/domain/money';
import { usePerspective } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Button, Callout, Card, CardHeader, MoneyInput, NumberInput, TextInput } from '@/components/ui';

/** Target split for shares and ETFs, the gap for each fund, and where the next buy would go. Suggestions only. */
export function InvestmentTargets() {
  const data = useApp((s) => s.data);
  const update = useApp((s) => s.updateSettings);
  const cloud = useApp((s) => s.mode === 'cloud');
  const perspective = usePerspective();
  const saved = data.settings.investmentTargets;
  const targets = useMemo(() => saved ?? [], [saved]);
  const [contribution, setContribution] = useState<number | null>(null);
  const [newSymbol, setNewSymbol] = useState('');

  const { funds, unconverted } = useMemo(() => collectPositions(data.holdings, perspective, data.settings), [data.holdings, data.settings, perspective]);
  const plan = useMemo(() => allocationPlan(funds, targets, contribution ?? 0, unconverted), [funds, targets, contribution, unconverted]);

  const save = (next: InvestmentTarget[]) => update({ investmentTargets: next });
  const setPercent = (symbol: string, percent: number) => {
    const exists = targets.some((t) => normaliseSymbol(t.symbol) === symbol);
    save(exists ? targets.map((t) => (normaliseSymbol(t.symbol) === symbol ? { ...t, percent } : t)) : [...targets, { symbol, percent }]);
  };
  const addTarget = () => {
    const symbol = normaliseSymbol(newSymbol);
    if (!symbol || targets.some((t) => normaliseSymbol(t.symbol) === symbol)) return;
    save([...targets, { symbol, percent: 0 }]);
    setNewSymbol('');
  };
  const next = plan.rows.find((r) => r.symbol === plan.nextSymbol);
  const totalOff = plan.targetPercentTotal > 0 && Math.abs(plan.targetPercentTotal - 100) > 0.01;

  return (
    <Card>
      <CardHeader
        title="Investment targets"
        subtitle="How you want your shares and ETFs split, and where the next buy would bring you closest to it. Suggestions only; the app never places trades."
      />
      <div className="space-y-4 px-5 pb-5 text-sm">
        {funds.size === 0 && (
          <Callout tone="info">
            {cloud ? 'Connect SnapTrade in Settings → Connections to see each fund you hold. You can set targets now.' : 'Fund-by-fund values come from SnapTrade in the online version. You can set targets now.'}
          </Callout>
        )}
        {next && plan.totalCents > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <Target className="h-4 w-4 text-accent" />
            <span>
              Invest next in <strong>{next.symbol}</strong>: it's {formatMoney(next.gapCents ?? 0)} below its target.
            </span>
          </div>
        )}
        {totalOff && <p className="text-warn">Targets add up to {plan.targetPercentTotal.toFixed(1)}%. Gaps are worked out as if they added to 100%.</p>}

        {plan.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1.5 font-normal">Fund</th>
                  <th className="py-1.5 text-right font-normal">Value</th>
                  <th className="py-1.5 text-right font-normal">Now</th>
                  <th className="w-28 py-1.5 pl-3 font-normal">Target</th>
                  <th className="py-1.5 text-right font-normal">Gap</th>
                  {(contribution ?? 0) > 0 && <th className="py-1.5 text-right font-normal">Buy</th>}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.symbol}</div>
                      {r.label !== r.symbol && <div className="text-xs text-muted">{r.label}</div>}
                    </td>
                    <td className="num py-2 text-right">{formatMoney(r.valueCents)}</td>
                    <td className="num py-2 text-right">{plan.totalCents > 0 ? formatPercent(r.currentShare, 1) : '–'}</td>
                    <td className="py-2 pl-3">
                      <NumberInput suffix="%" min={0} max={100} step={1} value={targets.find((t) => normaliseSymbol(t.symbol) === r.symbol)?.percent ?? 0} onChange={(v) => setPercent(r.symbol, v)} />
                    </td>
                    <td className="num py-2 text-right">
                      {r.gapCents === null ? <Badge>No target</Badge> : <span className={r.gapCents > 0 ? 'text-warn' : 'text-ink-2'}>{r.gapCents > 0 ? `${formatMoney(r.gapCents)} under` : r.gapCents < 0 ? `${formatMoney(-r.gapCents)} over` : 'On target'}</span>}
                    </td>
                    {(contribution ?? 0) > 0 && <td className="num py-2 text-right font-medium">{r.suggestedCents > 0 ? formatMoney(r.suggestedCents) : '–'}</td>}
                    <td className="py-2 pl-2 text-right">
                      {targets.some((t) => normaliseSymbol(t.symbol) === r.symbol) && (
                        <Button variant="ghost" size="sm" aria-label={`Remove target for ${r.symbol}`} onClick={() => save(targets.filter((t) => normaliseSymbol(t.symbol) !== r.symbol))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <TextInput label="Add a fund you don't hold yet" placeholder="e.g. VAS" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTarget()} />
            <Button icon={<Plus className="h-4 w-4" />} onClick={addTarget} disabled={!newSymbol.trim()}>
              Add
            </Button>
          </div>
          <MoneyInput label="Planning to invest" value={contribution} allowEmpty onChange={setContribution} hint="Splits this amount to close the biggest gaps first." />
        </div>
        {plan.unconverted.length > 0 && <p className="text-xs text-muted">Left out because their currency has no exchange rate set: {plan.unconverted.join(', ')}.</p>}
      </div>
    </Card>
  );
}
