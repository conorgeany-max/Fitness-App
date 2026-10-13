/**
 * Demo workspace. Every figure here is fictional and every record is tagged with the
 * "demo" source. The demo lives in its own workspace, so it can never mix with real data.
 */
import { addDays, addMonths, monthEnd, monthKey, todayISO, type ISODate } from '@/domain/dates';
import { BUILTIN_RULES } from '@/domain/categories';
import { PRESET_ASSUMPTIONS } from '@/domain/forecast';
import { categoryMeta } from '@/domain/holdingCategories';
import { takeSnapshot } from '@/domain/history';
import { parseListingText } from '@/domain/property/listingParser';
import { applyCategorisation } from '@/domain/transactions';
import { EMPTY_INCOME } from '@/domain/tax/salary';
import type { Holding, HoldingCategory, Ownership, Transaction, ValuationEntry, WorkspaceData } from '@/domain/types';
import { uid } from '@/lib/id';
import { emptyWorkspace } from './defaults';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function buildDemoWorkspace(today: ISODate = todayISO()): WorkspaceData {
  const rand = rng(20261013);
  const ws = emptyWorkspace('demo');
  const now = new Date().toISOString();
  ws.people.me = {
    id: 'me',
    name: 'Alex',
    income: { ...EMPTY_INCOME, residency: 'resident', salaryCents: 135_000_00, packageIncludesSuper: false, bonusAnnualCents: 8_000_00, payFrequency: 'fortnightly', reviewMonth: 9, expectedAnnualIncrease: 0.03, privateHospitalCover: true },
  };
  ws.people.partner = {
    id: 'partner',
    name: 'Jordan',
    income: { ...EMPTY_INCOME, residency: 'resident', salaryCents: 112_000_00, packageIncludesSuper: true, payFrequency: 'monthly', reviewMonth: 7, expectedAnnualIncrease: 0.03, hasHelpDebt: true, privateHospitalCover: true },
  };
  ws.settings.onboarded = true;
  ws.settings.stateOfResidence = 'VIC';
  ws.settings.fx = { USD: { audPerUnit: 1.52, asOf: today, source: 'manual' } };

  const J: Ownership = { me: 50, partner: 50 };
  const ME: Ownership = { me: 100, partner: 0 };
  const PA: Ownership = { me: 0, partner: 100 };

  const holding = (category: HoldingCategory, name: string, ownership: Ownership, current: number, start: number, extra: Partial<Holding> = {}): Holding => {
    const history: ValuationEntry[] = [];
    for (let i = 18; i >= 1; i--) {
      const date = monthEnd(monthKey(addMonths(today, -i)));
      const t = (18 - i) / 18;
      const noise = 1 + (rand() - 0.5) * (categoryMeta(category).group === 'investments' ? 0.06 : 0.01);
      history.push({ id: uid('val'), date, valueCents: Math.round((start + (current - start) * t) * noise * 100), source: 'demo', reason: 'manual-update', recordedAt: now });
    }
    return {
      id: uid('h'),
      kind: categoryMeta(category).kind,
      category,
      name,
      ownership,
      visibility: 'shared',
      currency: 'AUD',
      valueCents: Math.round(current * 100),
      valuedAt: addDays(today, -1),
      source: 'demo',
      history,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
  };

  const everyday = holding('transaction', 'Joint everyday', J, 4_210, 3_800, { institution: 'Demo Bank' });
  const offset = holding('offset', 'Joint offset', J, 46_300, 21_000, { institution: 'Demo Bank' });
  const alexSav = holding('savings', 'Alex high-interest saver', ME, 28_450, 17_000, { institution: 'Demo Bank' });
  const jordanTx = holding('transaction', 'Jordan everyday', PA, 2_380, 2_100, { institution: 'Example Credit Union' });
  const jordanSav = holding('savings', 'Jordan savings', PA, 14_100, 9_500, { institution: 'Example Credit Union' });
  const etf = holding('etf', 'Alex ETF portfolio', ME, 38_900, 24_000, { institution: 'Demo Broker' });
  const intl = holding('shares-intl', 'Jordan US shares', PA, 8_200, 6_100, { currency: 'USD', institution: 'Demo Broker' });
  const superA = holding('super', 'Alex super', ME, 112_400, 94_000, { institution: 'Demo Super Fund' });
  const superJ = holding('super', 'Jordan super', PA, 87_900, 74_500, { institution: 'Demo Super Fund' });
  const home = holding('property-home', 'Our home (Brunswick, demo)', J, 920_000, 880_000, { notes: 'Demo valuation' });
  const car = holding('vehicle', 'Family car', J, 21_500, 26_000);
  const mortgage = holding('mortgage-owner', 'Home loan', J, 604_800, 628_000, {
    institution: 'Demo Bank',
    loan: { annualRate: 0.0609, rateType: 'variable', repaymentType: 'PI', repaymentCents: 3_890_00, repaymentFrequency: 'monthly', maturityDate: addMonths(today, 12 * 27), offsetAccountIds: [], creditLimitCents: undefined },
  });
  mortgage.loan!.securedByHoldingId = home.id;
  mortgage.loan!.offsetAccountIds = [offset.id];
  const card = holding('credit-card', 'Rewards credit card', J, 1_840, 2_300, { loan: { annualRate: 0.2099, creditLimitCents: 10_000_00 } });
  const help = holding('help-debt', 'Jordan HELP debt', PA, 17_600, 21_900);
  ws.holdings = [everyday, offset, alexSav, jordanTx, jordanSav, etf, intl, superA, superJ, home, car, mortgage, card, help];

  // ---- Transactions (6 months)
  const txns: Transaction[] = [];
  const add = (date: ISODate, amount: number, accountId: string, description: string, extra: Partial<Transaction> = {}) => {
    if (date > today) return;
    txns.push({
      id: uid('t'),
      date,
      description,
      amountCents: Math.round(amount * 100),
      currency: 'AUD',
      accountId,
      categoryId: null,
      transfer: 'none',
      tags: [],
      categorisation: { source: 'uncategorised', confidence: 0 },
      source: 'demo',
      createdAt: now,
      ...extra,
    });
  };
  const start = addMonths(today, -6);
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const day = Number(d.slice(8, 10));
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    // Alex: fortnightly pay into own account (Thursday every other week)
    if (dow === 4 && Math.floor((Date.parse(d) / 864e5) / 7) % 2 === 0) {
      add(d, 3_640.18, alexSav.id, 'PAYROLL DEMO EMPLOYER PTY LTD SALARY');
      add(d, -1_500, alexSav.id, 'TRANSFER TO JOINT EVERYDAY', { transfer: 'internal' });
      add(d, 1_500, everyday.id, 'TRANSFER FROM ALEX', { transfer: 'internal' });
    }
    if (day === 15) {
      add(d, 6_118.42, jordanTx.id, 'SALARY EXAMPLE HEALTH SERVICE');
      add(d, -2_600, jordanTx.id, 'OSKO PAYMENT TO JOINT EVERYDAY', { transfer: 'between-partners' });
      add(d, 2_600, everyday.id, 'OSKO FROM JORDAN', { transfer: 'between-partners' });
      add(d, -800, jordanTx.id, 'TRANSFER TO SAVINGS', { transfer: 'internal' });
      add(d, 800, jordanSav.id, 'TRANSFER FROM EVERYDAY', { transfer: 'internal' });
    }
    if (day === 1) {
      add(d, -3_890, everyday.id, 'HOME LOAN REPAYMENT', { transfer: 'internal' });
      add(d, 3_890, mortgage.id, 'REPAYMENT RECEIVED', { transfer: 'internal' });
      add(d, -1_000, everyday.id, 'TRANSFER TO OFFSET', { transfer: 'internal' });
      add(d, 1_000, offset.id, 'TRANSFER FROM EVERYDAY', { transfer: 'internal' });
      add(d, -Math.round(2_700 + rand() * 300), mortgage.id, 'INTEREST CHARGED', { categoryId: 'exp-housing', categorisation: { source: 'provider', confidence: 1 } });
    }
    if (day === 3) add(d, -1_000, alexSav.id, 'VANGUARD INVESTMENT ETF PURCHASE');
    if (day === 5) add(d, -22.99, everyday.id, 'NETFLIX.COM SUBSCRIPTION');
    if (day === 8) add(d, -13.99, jordanTx.id, 'SPOTIFY AU');
    if (day === 12) add(d, -89, everyday.id, 'TELSTRA MOBILE BILL');
    if (day === 18) add(d, -Math.round(160 + rand() * 90), everyday.id, 'AGL ENERGY');
    if (day === 20) add(d, -248.5, everyday.id, 'MEDIBANK PRIVATE HEALTH');
    if (day === 22) add(d, -96.4, everyday.id, 'BUDGET DIRECT CAR INSURANCE');
    if (day === 25) add(d, -42, jordanTx.id, 'CHEMIST WAREHOUSE');
    if (dow === 6) add(d, -Math.round((180 + rand() * 90) * 100) / 100, card.id, 'WOOLWORTHS 3056 BRUNSWICK');
    if (dow === 3) add(d, -Math.round((35 + rand() * 40) * 100) / 100, card.id, 'COLES EXPRESS');
    if (dow === 5) add(d, -Math.round((60 + rand() * 80) * 100) / 100, card.id, 'TEDS BISTRO CAFE BRUNSWICK');
    if (dow === 2 && rand() > 0.4) add(d, -Math.round((20 + rand() * 30) * 100) / 100, everyday.id, 'UBER EATS');
    if (dow === 1) add(d, -Math.round((55 + rand() * 25) * 100) / 100, card.id, 'AMPOL FUEL BRUNSWICK');
    if (dow === 0 && rand() > 0.6) add(d, -Math.round((40 + rand() * 160) * 100) / 100, card.id, rand() > 0.5 ? 'KMART BRUNSWICK' : 'BUNNINGS COBURG');
    if (day === 28) {
      const total = txns.filter((t) => t.accountId === card.id && t.date.slice(0, 7) === d.slice(0, 7) && t.amountCents < 0).reduce((a, t) => a - t.amountCents, 0) / 100;
      add(d, -total, everyday.id, 'CREDIT CARD PAYMENT THANK YOU', { transfer: 'internal' });
      add(d, total, card.id, 'PAYMENT RECEIVED THANK YOU', { transfer: 'internal' });
    }
  }
  add(addDays(today, -40), -1_180, card.id, 'QANTAS AIRWAYS FLIGHTS');
  add(addDays(today, -12), -640, everyday.id, 'JB HI-FI ELECTRONICS');
  ws.transactions = txns
    .map((t) => (t.categorisation.source === 'uncategorised' ? applyCategorisation(t, [], BUILTIN_RULES) : t))
    .map((t) => (t.transfer !== 'none' ? { ...t, categoryId: null, categorisation: { source: 'manual' as const, confidence: 1 } } : t))
    .sort((a, b) => b.date.localeCompare(a.date));
  // Unmatched categorisation fallbacks for demo realism.
  for (const t of ws.transactions) if (!t.categoryId && t.transfer === 'none' && /BISTRO|CAFE/.test(t.description)) t.categoryId = 'exp-eating';

  ws.rules = [
    { id: uid('rule'), name: 'Teds Bistro → Eating out', field: 'description', op: 'contains', value: 'TEDS BISTRO', setCategoryId: 'exp-eating', priority: 1, enabled: true, createdAt: now },
  ];

  const month = monthKey(today);
  const bl = (categoryId: string, dollars: number, rollover = false) => ({ id: uid('bud'), categoryId, scope: 'household' as const, monthlyCents: dollars * 100, rollover, startMonth: monthKey(addMonths(today, -3)) });
  ws.budgets = [
    bl('exp-groceries', 1_000),
    bl('exp-eating', 450, true),
    bl('exp-transport', 380),
    bl('exp-utilities', 420),
    bl('exp-insurance', 360),
    bl('exp-subscriptions', 60),
    bl('exp-shopping', 400, true),
    bl('exp-health', 120),
    bl('exp-travel', 300, true),
  ];
  ws.bills = [
    { id: uid('bill'), name: 'Council rates', amountCents: 520_00, frequency: 'quarterly', nextDate: addDays(today, 18), categoryId: 'exp-housing', accountId: everyday.id, scope: 'household', kind: 'bill', matchText: 'COUNCIL', active: true },
    { id: uid('bill'), name: 'Home loan repayment', amountCents: 3_890_00, frequency: 'monthly', nextDate: `${monthKey(addMonths(today, 1))}-01`, categoryId: null, accountId: everyday.id, scope: 'household', kind: 'bill', matchText: 'HOME LOAN', active: true },
    { id: uid('bill'), name: 'Netflix', amountCents: 22_99, frequency: 'monthly', nextDate: `${monthKey(addMonths(today, Number(today.slice(8, 10)) >= 5 ? 1 : 0))}-05`, categoryId: 'exp-subscriptions', accountId: everyday.id, scope: 'household', kind: 'subscription', matchText: 'NETFLIX', active: true },
  ];
  ws.plannedExpenses = [{ id: uid('plan'), name: 'Car service', date: addDays(today, 9), amountCents: 450_00, categoryId: 'exp-transport', scope: 'household' }];
  ws.goals = [
    { id: uid('goal'), name: 'Emergency fund', type: 'emergency-fund', targetCents: 45_000_00, targetDate: addMonths(today, 6), currentCents: 0, linkedHoldingIds: [offset.id], monthlyContributionCents: 1_000_00, expectedReturn: 0, priority: 1, scope: 'household', createdAt: now },
    { id: uid('goal'), name: 'Japan trip', type: 'holiday', targetCents: 9_000_00, targetDate: addMonths(today, 10), currentCents: 0, linkedHoldingIds: [jordanSav.id], monthlyContributionCents: 800_00, expectedReturn: 0.045, priority: 3, scope: 'household', createdAt: now },
    { id: uid('goal'), name: 'Pay off HELP', type: 'debt-repayment', targetCents: 21_900_00, baselineCents: 21_900_00, targetDate: addMonths(today, 30), currentCents: 0, linkedHoldingIds: [help.id], monthlyContributionCents: 450_00, expectedReturn: 0, priority: 4, scope: 'partner', createdAt: now },
  ];
  ws.scenarios[0].assumptions = { ...PRESET_ASSUMPTIONS.base };
  ws.scenarios.push({
    ...ws.scenarios[0],
    id: uid('scn'),
    name: 'Baby in 2028 (Jordan on leave)',
    preset: 'custom',
    color: 'var(--series-2)',
    events: [
      { id: uid('ev'), type: 'parental-leave', person: 'partner', start: `${Number(today.slice(0, 4)) + 2}-03-01`, totalWeeks: 52, employerPaidWeeks: 14, govPaidWeeks: 24, govWeeklyCents: 948_60, returnFte: 0.6 },
      { id: uid('ev'), type: 'child', date: `${Number(today.slice(0, 4)) + 2}-03-01`, monthlyCostCents: 1_100_00 },
      { id: uid('ev'), type: 'salary-change', person: 'me', date: `${Number(today.slice(0, 4)) + 1}-09-01`, mode: 'percent', value: 0.08, label: 'Promotion' },
    ],
  });

  // Run the real parser over fictional listing text, so the review screen shows genuine evidence.
  const rawText = [
    'DEMO LISTING (fictional, not a real property)',
    '4/22 Example Street, Coburg VIC 3058',
    'Apartment · 2 bed 1 bath 1 car',
    'Price guide: $560,000 - $600,000',
    'Owners corporation: $800 per quarter',
    'Council rates: $1,450 p.a.',
    'Water rates: $210 per quarter',
    'Currently leased at $560 per week until March.',
  ].join('\n');
  const demoListing = parseListingText(rawText);
  ws.properties = [
    {
      id: uid('prop'),
      name: 'Demo listing: 2 bed apartment, Coburg VIC',
      rawText,
      listing: demoListing,
      settings: { ...defaultPurchaseSettings(), intendedUse: 'investment', depositCents: 50_000_00 },
      shortlisted: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
  // Pretend the app has been in use for six months, so recorded and reconstructed history both show.
  for (let i = 6; i >= 1; i--) {
    const end = monthEnd(monthKey(addMonths(today, -i)));
    // Values as at that date (historical lookup), stored as if recorded then.
    ws.snapshots.push({ ...takeSnapshot(ws.holdings, ws.settings, end, uid('snap'), 'reconstructed'), kind: 'recorded', coverage: 1 });
  }
  ws.audit.unshift({ id: uid('aud'), at: now, action: 'demo', detail: `Demo workspace generated for ${month}` });
  return ws;
}

export function defaultPurchaseSettings() {
  return {
    buyers: 'joint' as const,
    ownership: { me: 50, partner: 50 },
    intendedUse: 'owner-occupier' as const,
    firstHomeBuyer: false,
    homeGuarantee: false,
    depositCents: 0,
    interestRate: 0.0599,
    termYears: 30,
    repaymentType: 'PI' as const,
    conveyancingCents: 2_200_00,
    inspectionsCents: 800_00,
    movingCents: 1_500_00,
    furnishingCents: 3_000_00,
    buildingInsuranceAnnualCents: 1_800_00,
    maintenanceRate: 0.01,
    lmiOverrideCents: null,
    capitaliseLmi: true,
    stressBuffer: 0.03,
    emergencyFundMonths: 6,
    overrides: {},
    currentRentWeeklyCents: null,
    stampDutyOverrideCents: null,
  };
}
