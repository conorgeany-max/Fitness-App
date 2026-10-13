import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatMoney, formatPercent } from '@/domain/money';
import { calculateTakeHome, PAYS_PER_YEAR } from '@/domain/tax/salary';
import { TAX_RULESETS } from '@/domain/tax/rulesets';
import type { IncomeProfile, PayFrequency, PersonId, Residency } from '@/domain/types';
import { useDerived } from '@/store/derived';
import { useApp } from '@/store/store';
import { Badge, Callout, Card, CardHeader, Disclosure, MoneyInput, PercentInput, Select, TextInput, Toggle } from '@/components/ui';
import { KindBadge } from '@/components/finance';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function IncomeTax() {
  const d = useDerived();
  const taxYearOverride = useApp((s) => s.data.settings.taxYearOverride);
  const updateSettings = useApp((s) => s.updateSettings);
  const r = d.ruleset;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Tax year"
          value={taxYearOverride ?? ''}
          onChange={(e) => updateSettings({ taxYearOverride: e.target.value || undefined })}
          options={[{ value: '', label: `Current (${r.financialYear})` }, ...TAX_RULESETS.map((t) => ({ value: t.financialYear, label: `${t.financialYear}${t.status === 'provisional' ? ' (provisional)' : ''}` }))]}
          className="w-56"
        />
        <div className="flex flex-wrap gap-2 pb-1">
          <Badge tone={r.status === 'confirmed' ? 'good' : 'warn'} title={r.statusNote}>{r.status === 'confirmed' ? 'Confirmed rates' : 'Provisional rates'}</Badge>
          {!d.rulesetExact && <Badge tone="warn">No ruleset for this year — nearest used</Badge>}
          <KindBadge kind="estimate" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PersonIncome person="me" />
        <PersonIncome person="partner" />
      </div>
      <RulesetCard />
    </div>
  );
}

function PersonIncome({ person }: { person: PersonId }) {
  const p = useApp((s) => s.data.people[person]);
  const mutate = useApp((s) => s.mutate);
  const d = useDerived();
  const inc = p.income;
  const set = (patch: Partial<IncomeProfile>) =>
    mutate((dd) => {
      Object.assign(dd.people[person].income, patch);
    }, { action: 'update-income', detail: `Updated ${p.name}'s income profile` });
  const th = useMemo(() => calculateTakeHome(inc, d.ruleset), [inc, d.ruleset]);
  const has = inc.salaryCents > 0 || inc.bonusAnnualCents > 0 || inc.otherTaxableIncomeAnnualCents > 0;
  const per = PAYS_PER_YEAR[inc.payFrequency];

  return (
    <Card>
      <CardHeader title={p.name} subtitle="Income profile · individual" />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <MoneyInput label={inc.packageIncludesSuper ? 'Total package (incl. super)' : 'Base salary (excl. super)'} value={inc.salaryCents} onChange={(v) => set({ salaryCents: v ?? 0 })} hint="Annual, full-time equivalent" />
        <Select label="Salary is quoted" value={inc.packageIncludesSuper ? 'pkg' : 'base'} onChange={(e) => set({ packageIncludesSuper: e.target.value === 'pkg' })} options={[{ value: 'base', label: 'Plus super' }, { value: 'pkg', label: 'Including super (package)' }]} />
        <PercentInput label="Employer super rate" value={inc.superRate ?? d.ruleset.super.guaranteeRate} onChange={(v) => set({ superRate: Math.abs(v - d.ruleset.super.guaranteeRate) < 1e-9 ? undefined : v })} hint={`Super guarantee is ${formatPercent(d.ruleset.super.guaranteeRate, 1)} in ${d.ruleset.financialYear}`} />
        <Select label="Paid" value={inc.payFrequency} onChange={(e) => set({ payFrequency: e.target.value as PayFrequency })} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} />
        <MoneyInput label="Bonus (annual)" value={inc.bonusAnnualCents} onChange={(v) => set({ bonusAnnualCents: v ?? 0 })} />
        <MoneyInput label="Other taxable income (annual)" value={inc.otherTaxableIncomeAnnualCents} onChange={(v) => set({ otherTaxableIncomeAnnualCents: v ?? 0 })} hint="Interest, dividends, side income" />
        <MoneyInput label="Salary sacrifice to super (annual)" value={inc.salarySacrificeAnnualCents} onChange={(v) => set({ salarySacrificeAnnualCents: v ?? 0 })} />
        <MoneyInput label="Tax deductions (annual)" value={inc.deductionsAnnualCents} onChange={(v) => set({ deductionsAnnualCents: v ?? 0 })} />
        <PercentInput label="Expected annual pay rise" value={inc.expectedAnnualIncrease} onChange={(v) => set({ expectedAnnualIncrease: v })} hint="Used by forecasts at the review month" />
        <Select label="Salary review month" value={String(inc.reviewMonth)} onChange={(e) => set({ reviewMonth: Number(e.target.value) })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
        <Select label="Tax residency" value={inc.residency} onChange={(e) => set({ residency: e.target.value as Residency })} options={[{ value: 'unknown', label: 'Not set (resident assumed)' }, { value: 'resident', label: 'Australian resident' }, { value: 'non-resident', label: 'Foreign resident' }]} />
        <TextInput label="Employer (optional)" value={inc.employer ?? ''} onChange={(e) => set({ employer: e.target.value || undefined })} />
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={inc.bonusAttractsSuper} onChange={(v) => set({ bonusAttractsSuper: v })} label="Employer pays super on the bonus" />
          <Toggle checked={inc.hasHelpDebt} onChange={(v) => set({ hasHelpDebt: v })} label="Has a HELP / student loan" />
          <Toggle checked={inc.privateHospitalCover} onChange={(v) => set({ privateHospitalCover: v })} label="Has private hospital cover" hint="Without it, the Medicare levy surcharge may apply above the family threshold." />
        </div>
      </div>

      {has ? (
        <div className="border-t border-line p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Take-home pay</h3>
            <span className="text-xs text-muted">{d.ruleset.financialYear} rules</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {inc.payFrequency === 'monthly' ? (
              <div><div className="text-xs text-muted">Per week</div><div className="num text-lg font-semibold">{formatMoney(Math.round(th.netAnnualCents / 52))}</div></div>
            ) : (
              <div><div className="text-xs text-muted">Per pay ({inc.payFrequency})</div><div className="num text-lg font-semibold">{formatMoney(th.netPerPayCents)}</div></div>
            )}
            <div><div className="text-xs text-muted">Per month</div><div className="num text-lg font-semibold">{formatMoney(th.netMonthlyCents)}</div></div>
            <div><div className="text-xs text-muted">Per year</div><div className="num text-lg font-semibold">{formatMoney(th.netAnnualCents)}</div></div>
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label="Base salary (excl. super)" cents={th.baseSalaryCents} />
            {th.bonusCents > 0 && <Row label="Bonus" cents={th.bonusCents} />}
            {th.otherIncomeCents > 0 && <Row label="Other income" cents={th.otherIncomeCents} />}
            {th.salarySacrificeCents > 0 && <Row label="Less salary sacrifice" cents={-th.salarySacrificeCents} />}
            <Row label="Taxable income" cents={th.taxableIncomeCents} strong />
            <Row label="Income tax" cents={-Math.round(th.tax.incomeTax * 100)} />
            {th.tax.lito > 0 && <Row label="Low income tax offset" cents={Math.round(th.tax.lito * 100)} />}
            <Row label="Medicare levy" cents={-Math.round(th.tax.medicareLevy * 100)} />
            {th.tax.medicareSurcharge > 0 && <Row label="Medicare levy surcharge" cents={-Math.round(th.tax.medicareSurcharge * 100)} />}
            {th.tax.helpRepayment > 0 && <Row label="HELP repayment" cents={-Math.round(th.tax.helpRepayment * 100)} />}
            <Row label="Take-home" cents={th.netAnnualCents} strong />
          </dl>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>Average rate {formatPercent(th.tax.averageRate, 1)}</span>
            <span>Marginal rate {formatPercent(th.tax.marginalRate, 1)}</span>
            <span>Employer super {formatMoney(th.employerSuperCents)} ({formatPercent(th.superRate, 1)})</span>
            <span>Concessional super {formatMoney(th.totalConcessionalCents)} of {formatMoney(th.concessionalCapCents)} cap</span>
            <span>{per} pays a year</span>
          </div>
          {th.warnings.length > 0 && (
            <div className="mt-3">
              <Callout tone="warn">
                <ul className="list-disc space-y-1 pl-4">{th.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Callout>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-line p-5 text-sm text-muted">Enter a salary to see take-home pay. Forecasts and affordability use this profile.</div>
      )}
    </Card>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-line/60 pt-1.5 font-medium' : 'flex justify-between text-ink-2'}>
      <dt>{label}</dt>
      <dd className="num">{formatMoney(cents, { cents: true })}</dd>
    </div>
  );
}

function RulesetCard() {
  const d = useDerived();
  const r = d.ruleset;
  return (
    <Disclosure summary={`Tax rules used: ${r.financialYear} (${r.status}) · verified ${r.verifiedOn}`}>
      <div className="grid gap-6 px-4 pb-4 text-sm md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Resident brackets</h4>
          <table className="mt-2 w-full text-sm">
            <tbody className="num">
              {r.residentBrackets.map((b, i) => (
                <tr key={b.above} className="border-b border-line/50">
                  <td className="py-1">{i + 1 < r.residentBrackets.length ? `$${b.above.toLocaleString()} – $${r.residentBrackets[i + 1].above.toLocaleString()}` : `Over $${b.above.toLocaleString()}`}</td>
                  <td className="py-1 text-right">{formatPercent(b.rate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 space-y-1 text-ink-2">
            <li>Medicare levy {formatPercent(r.medicare.rate, 0)} (low-income threshold ${r.medicare.lowerThreshold.toLocaleString()})</li>
            <li>Super guarantee {formatPercent(r.super.guaranteeRate, 1)}; concessional cap ${r.super.concessionalCap.toLocaleString()}</li>
            <li>HELP repayments from ${r.help.find((t) => t.rate > 0)?.above.toLocaleString() ?? '—'} (marginal system)</li>
          </ul>
          {r.statusNote && <p className="mt-3 text-xs text-warn">{r.statusNote}</p>}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</h4>
          <ul className="mt-2 space-y-2">
            {r.sources.map((s) => (
              <li key={s.url + s.label}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">{s.label} <ExternalLink className="h-3 w-3" /></a>
                {s.note && <div className="text-xs text-muted">{s.note}</div>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Estimates only. They ignore offsets and deductions not entered here, Division 293 tax, and PAYG withholding differences, so actual pay slips may differ slightly.</p>
        </div>
      </div>
    </Disclosure>
  );
}
