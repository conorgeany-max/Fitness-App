/**
 * Hosted mode: how the in-memory workspace maps to what the database stores.
 *
 * The workspace a person sees is always assembled from four parts:
 *   1. the shared document (both partners read and write it),
 *   2. their own private document (only they can read it),
 *   3. their partner's shared totals, if the partner chose to share them,
 *   4. provider data synced from Up and SnapTrade, which the database filters by visibility.
 * Saving does the reverse with splitWorkspace. Synced balances and transactions are never
 * written back into documents: documents hold only what people edit (names, ownership,
 * categories, notes), so a webhook and a person can never overwrite each other.
 *
 * The privacy guarantee comes from the database policies, not from this file: a person's
 * client never receives their partner's private document or private accounts at all.
 */
import { BUILTIN_RULES } from '@/domain/categories';
import { categoryMeta } from '@/domain/holdingCategories';
import { LIABILITY_TYPES, TYPE_TO_CATEGORY, type ObAccountType } from '@/domain/openBanking';
import { toBaseCurrency } from '@/domain/money';
import { applyCategorisation } from '@/domain/transactions';
import type {
  AuditEntry,
  BudgetLine,
  Category,
  CategoryRule,
  Goal,
  Holding,
  HoldingCategory,
  InsightState,
  NetWorthSnapshot,
  Person,
  PersonId,
  PlannedExpense,
  PropertyAnalysis,
  RecurringBill,
  Scenario,
  Settings,
  Transaction,
  ValuationEntry,
  WorkspaceData,
} from '@/domain/types';
import { emptyWorkspace, migrate, SCHEMA_VERSION } from './defaults';

// ------------------------------------------------------------------ stored shapes

/** Fields of a synced transaction a person can change. Stored only when they differ from the automatic result. */
export const TXN_NOTE_FIELDS = ['categoryId', 'subcategory', 'merchant', 'ownershipOverride', 'transfer', 'transferPairId', 'recurring', 'notes', 'tags', 'categorisation', 'possibleDuplicateOf', 'excluded'] as const;
export type TxnNote = Partial<Pick<Transaction, (typeof TXN_NOTE_FIELDS)[number]>>;

export type SharedSettings = Omit<Settings, 'activeUser' | 'shareTotalsOfPrivateItems' | 'theme'>;

export interface SharedDoc {
  schemaVersion: number;
  people: Record<PersonId, Person>;
  holdings: Holding[];
  transactions: Transaction[];
  txnNotes: Record<string, TxnNote>;
  categories: Category[];
  rules: CategoryRule[];
  budgets: BudgetLine[];
  plannedExpenses: PlannedExpense[];
  bills: RecurringBill[];
  goals: Goal[];
  scenarios: Scenario[];
  properties: PropertyAnalysis[];
  settings: SharedSettings;
}

export interface PrivateDoc {
  schemaVersion: number;
  holdings: Holding[];
  transactions: Transaction[];
  txnNotes: Record<string, TxnNote>;
  snapshots: NetWorthSnapshot[];
  audit: AuditEntry[];
  insights: InsightState;
  prefs: { theme: Settings['theme']; shareTotalsOfPrivateItems: boolean };
}

/** What a partner sees of someone's private items: one total per category, nothing else. */
export interface PrivateSummary {
  generatedAt: string;
  items: { category: HoldingCategory; valueCents: number; count: number }[];
}

export interface ProviderAccountRow {
  id: string;
  provider: 'up' | 'snaptrade';
  external_id: string;
  owners: PersonId[];
  joint: boolean;
  visibility: 'shared' | 'private';
  name: string;
  account_type: string;
  institution: string;
  currency: string;
  balance_cents: number;
  available_cents: number | null;
  as_at: string;
}

export interface ProviderTxnRow {
  account_id: string;
  external_id: string;
  date: string;
  description: string;
  amount_cents: number;
  pending: boolean;
  merchant: string | null;
  transfer_external_id: string | null;
}

export interface ProviderBalanceRow {
  account_id: string;
  date: string;
  balance_cents: number;
}

export interface ProviderData {
  accounts: ProviderAccountRow[];
  transactions: ProviderTxnRow[];
  balances: ProviderBalanceRow[];
}

export const EMPTY_PROVIDER: ProviderData = { accounts: [], transactions: [], balances: [] };

export const otherPerson = (p: PersonId): PersonId => (p === 'me' ? 'partner' : 'me');
export const providerHoldingId = (accountId: string) => `pa_${accountId}`;
export const providerTxnId = (row: Pick<ProviderTxnRow, 'external_id'>) => `pt_${row.external_id}`;
export const isProviderHolding = (h: Pick<Holding, 'id'>) => h.id.startsWith('pa_');
export const isProviderTxn = (t: Pick<Transaction, 'id'>) => t.id.startsWith('pt_');

// ------------------------------------------------------------------ provider data -> workspace records

function accountIsLiability(row: ProviderAccountRow): boolean {
  return LIABILITY_TYPES.includes(row.account_type as ObAccountType) || (row.balance_cents < 0 && row.account_type === 'other');
}

const signedToValue = (row: ProviderAccountRow, cents: number) => (accountIsLiability(row) ? Math.abs(cents) : cents);

/** A synced account as a holding, with any edits the household made to it. */
export function providerHolding(row: ProviderAccountRow, balances: ProviderBalanceRow[], saved: Holding | undefined): Holding {
  const liability = accountIsLiability(row);
  const date = row.as_at.slice(0, 10);
  const history: ValuationEntry[] = balances
    .filter((b) => b.account_id === row.id)
    .map((b) => ({ id: `pb_${row.id}_${b.date}`, date: b.date, valueCents: signedToValue(row, b.balance_cents), source: 'live' as const, reason: 'sync' as const, recordedAt: b.date }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ownership = row.joint || row.owners.length > 1 ? { me: 50, partner: 50 } : row.owners[0] === 'me' ? { me: 100, partner: 0 } : { me: 0, partner: 100 };
  const base: Holding = saved
    ? { ...saved }
    : {
        id: providerHoldingId(row.id),
        kind: liability ? 'liability' : 'asset',
        category: TYPE_TO_CATEGORY[row.account_type as ObAccountType] ?? (liability ? 'other-liability' : 'other-asset'),
        name: row.name,
        institution: row.institution,
        ownership,
        visibility: row.visibility,
        currency: row.currency,
        valueCents: null,
        valuedAt: null,
        source: 'live',
        history: [],
        createdAt: row.as_at,
        updatedAt: row.as_at,
      };
  // Saved edits keep a holding's kind consistent with its category.
  if (saved && categoryMeta(saved.category).kind !== base.kind) base.kind = categoryMeta(saved.category).kind;
  return {
    ...base,
    // Visibility is whatever the database enforces; it is changed through the account row.
    visibility: row.joint ? 'shared' : row.visibility,
    // A private item must be solely owned; keep the owner's full share.
    ownership: row.visibility === 'private' && !row.joint && row.owners.length === 1 ? (row.owners[0] === 'me' ? { me: 100, partner: 0 } : { me: 0, partner: 100 }) : base.ownership,
    currency: row.currency,
    valueCents: signedToValue(row, row.balance_cents),
    valuedAt: date,
    availableCents: row.available_cents,
    source: 'live',
    connectionId: `cloud:${row.provider}`,
    externalAccountId: row.external_id,
    lastSyncedAt: row.as_at,
    history,
  };
}

/** A synced transaction before any household edits: categorised by rules, transfers detected. */
export function autoTransaction(row: ProviderTxnRow, ctx: { holdingIdByAccount: Map<string, string>; ownersByExternal: Map<string, PersonId[]>; ownersOfAccount: Map<string, PersonId[]>; rules: CategoryRule[] }): Transaction {
  let transfer: Transaction['transfer'] = 'none';
  if (row.transfer_external_id) {
    const theirs = ctx.ownersByExternal.get(row.transfer_external_id);
    const ours = ctx.ownersOfAccount.get(row.account_id) ?? [];
    if (theirs) transfer = theirs.length === 1 && ours.length === 1 && theirs[0] !== ours[0] ? 'between-partners' : 'internal';
  }
  const t: Transaction = {
    id: providerTxnId(row),
    date: row.date,
    description: row.description,
    amountCents: row.amount_cents,
    currency: 'AUD',
    accountId: ctx.holdingIdByAccount.get(row.account_id) ?? null,
    categoryId: null,
    merchant: row.merchant ?? undefined,
    transfer,
    tags: [],
    categorisation: { source: 'uncategorised', confidence: 0 },
    source: 'live',
    externalId: row.external_id,
    pending: row.pending,
    createdAt: row.date,
  };
  if (transfer !== 'none') return { ...t, categoryId: 'transfer', categorisation: { source: 'provider', confidence: 1 } };
  return applyCategorisation(t, ctx.rules, BUILTIN_RULES);
}

function noteFor(auto: Transaction, current: Transaction): TxnNote | null {
  const note: Record<string, unknown> = {};
  for (const f of TXN_NOTE_FIELDS) if (JSON.stringify(auto[f]) !== JSON.stringify(current[f])) note[f] = current[f];
  return Object.keys(note).length ? (note as TxnNote) : null;
}

// ------------------------------------------------------------------ assemble

export interface AssembleInput {
  person: PersonId;
  shared: SharedDoc | null;
  mine: PrivateDoc | null;
  partnerSummary: PrivateSummary | null;
  provider: ProviderData;
  names?: Partial<Record<PersonId, string>>;
}

export function emptyShared(): SharedDoc {
  const w = emptyWorkspace('real');
  const { activeUser: _a, shareTotalsOfPrivateItems: _s, theme: _t, ...settings } = w.settings;
  return {
    schemaVersion: SCHEMA_VERSION,
    people: w.people,
    holdings: [],
    transactions: [],
    txnNotes: {},
    categories: w.categories,
    rules: [],
    budgets: [],
    plannedExpenses: [],
    bills: [],
    goals: [],
    scenarios: w.scenarios,
    properties: [],
    settings,
  };
}

export function emptyPrivate(): PrivateDoc {
  return { schemaVersion: SCHEMA_VERSION, holdings: [], transactions: [], txnNotes: {}, snapshots: [], audit: [], insights: { dismissed: {} }, prefs: { theme: 'dark', shareTotalsOfPrivateItems: false } };
}

function summaryHoldings(owner: PersonId, summary: PrivateSummary): Holding[] {
  return summary.items
    .filter((i) => i.count > 0)
    .map((i) => {
      const meta = categoryMeta(i.category);
      return {
        id: `sum_${owner}_${i.category}`,
        kind: meta.kind,
        category: i.category,
        name: `${meta.label} (private, total only)`,
        ownership: owner === 'me' ? { me: 100, partner: 0 } : { me: 0, partner: 100 },
        visibility: 'private',
        currency: 'AUD',
        valueCents: i.valueCents,
        valuedAt: summary.generatedAt.slice(0, 10),
        source: 'estimate',
        history: [],
        summaryOf: owner,
        createdAt: summary.generatedAt,
        updatedAt: summary.generatedAt,
      } satisfies Holding;
    });
}

export function assembleWorkspace(input: AssembleInput): WorkspaceData {
  const shared = input.shared ?? emptyShared();
  const mine = input.mine ?? emptyPrivate();
  const savedHoldings = [...shared.holdings, ...mine.holdings];
  const savedById = new Map(savedHoldings.map((h) => [h.id, h]));

  const providerHoldings = input.provider.accounts.map((row) => providerHolding(row, input.provider.balances, savedById.get(providerHoldingId(row.id))));
  const manualHoldings = savedHoldings.filter((h) => !isProviderHolding(h) && !h.summaryOf);

  const holdingIdByAccount = new Map(input.provider.accounts.map((a) => [a.id, providerHoldingId(a.id)]));
  const ownersByExternal = new Map(input.provider.accounts.map((a) => [a.external_id, a.owners]));
  const ownersOfAccount = new Map(input.provider.accounts.map((a) => [a.id, a.owners]));
  const notes = { ...shared.txnNotes, ...mine.txnNotes };
  const providerTxns = input.provider.transactions.map((row) => {
    const auto = autoTransaction(row, { holdingIdByAccount, ownersByExternal, ownersOfAccount, rules: shared.rules });
    const note = notes[auto.id];
    return note ? { ...auto, ...note } : auto;
  });

  const other = otherPerson(input.person);
  const base = emptyWorkspace('real');
  const people = { ...base.people, ...shared.people };
  for (const p of ['me', 'partner'] as PersonId[]) {
    const n = input.names?.[p];
    if (n && (people[p].name === 'Me' || people[p].name === 'Partner')) people[p] = { ...people[p], name: n };
  }
  const settings: Settings = {
    ...base.settings,
    ...shared.settings,
    theme: mine.prefs.theme,
    activeUser: input.person,
    shareTotalsOfPrivateItems: { [input.person]: mine.prefs.shareTotalsOfPrivateItems, [other]: !!input.partnerSummary } as Record<PersonId, boolean>,
  };

  const data: WorkspaceData = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'real',
    people,
    holdings: [...providerHoldings, ...manualHoldings, ...(input.partnerSummary ? summaryHoldings(other, input.partnerSummary) : [])],
    transactions: [...providerTxns, ...shared.transactions, ...mine.transactions].sort((a, b) => b.date.localeCompare(a.date)),
    categories: shared.categories,
    rules: shared.rules,
    budgets: shared.budgets,
    plannedExpenses: shared.plannedExpenses,
    bills: shared.bills,
    goals: shared.goals,
    snapshots: mine.snapshots,
    scenarios: shared.scenarios,
    properties: shared.properties,
    connections: [],
    insights: mine.insights,
    audit: mine.audit,
    settings,
  };
  return migrate(data);
}

// ------------------------------------------------------------------ split

export interface SplitResult {
  shared: SharedDoc;
  mine: PrivateDoc;
  /** Null when the person hasn't chosen to share their private totals. */
  summary: PrivateSummary | null;
}

/**
 * True when a holding belongs in the person's private document. A partner's private items never
 * reach this client, so every private item here is this person's; anything marked private stays
 * out of the shared document even if its ownership split is unusual.
 */
export function isMyPrivate(h: Holding): boolean {
  return h.visibility === 'private' && !h.summaryOf;
}

export function splitWorkspace(data: WorkspaceData, person: PersonId, provider: ProviderData, now = new Date().toISOString()): SplitResult {
  const stripValues = (h: Holding): Holding => (isProviderHolding(h) ? { ...h, valueCents: null, valuedAt: null, availableCents: null, history: [], lastSyncedAt: undefined } : h);
  const holdings = data.holdings.filter((h) => !h.summaryOf);
  const privateIds = new Set(holdings.filter((h) => isMyPrivate(h)).map((h) => h.id));

  // Synced transactions are stored only as the edits that differ from the automatic result.
  const holdingIdByAccount = new Map(provider.accounts.map((a) => [a.id, providerHoldingId(a.id)]));
  const ownersByExternal = new Map(provider.accounts.map((a) => [a.external_id, a.owners]));
  const ownersOfAccount = new Map(provider.accounts.map((a) => [a.id, a.owners]));
  const rows = new Map(provider.transactions.map((r) => [providerTxnId(r), r]));
  const sharedNotes: Record<string, TxnNote> = {};
  const myNotes: Record<string, TxnNote> = {};
  const sharedTxns: Transaction[] = [];
  const myTxns: Transaction[] = [];
  for (const t of data.transactions) {
    const isPrivate = !!t.accountId && privateIds.has(t.accountId);
    if (isProviderTxn(t)) {
      const row = rows.get(t.id);
      if (!row) continue;
      const note = noteFor(autoTransaction(row, { holdingIdByAccount, ownersByExternal, ownersOfAccount, rules: data.rules }), t);
      if (note) (isPrivate ? myNotes : sharedNotes)[t.id] = note;
    } else (isPrivate ? myTxns : sharedTxns).push(t);
  }

  const { activeUser: _a, shareTotalsOfPrivateItems, theme, ...settings } = data.settings;
  const shared: SharedDoc = {
    schemaVersion: SCHEMA_VERSION,
    people: data.people,
    holdings: holdings.filter((h) => !privateIds.has(h.id)).map(stripValues),
    transactions: sharedTxns,
    txnNotes: sharedNotes,
    categories: data.categories,
    rules: data.rules,
    budgets: data.budgets,
    plannedExpenses: data.plannedExpenses,
    bills: data.bills,
    goals: data.goals,
    scenarios: data.scenarios,
    properties: data.properties,
    settings,
  };
  const mine: PrivateDoc = {
    schemaVersion: SCHEMA_VERSION,
    holdings: holdings.filter((h) => privateIds.has(h.id)).map(stripValues),
    transactions: myTxns,
    txnNotes: myNotes,
    snapshots: data.snapshots,
    audit: data.audit,
    insights: data.insights,
    prefs: { theme, shareTotalsOfPrivateItems: !!shareTotalsOfPrivateItems[person] },
  };

  let summary: PrivateSummary | null = null;
  if (shareTotalsOfPrivateItems[person]) {
    const byCategory = new Map<HoldingCategory, { valueCents: number; count: number }>();
    for (const h of holdings) {
      if (!privateIds.has(h.id) || h.archived || h.valueCents === null) continue;
      const aud = toBaseCurrency(h.valueCents, h.currency, data.settings.fx);
      if (aud === null) continue;
      const cur = byCategory.get(h.category) ?? { valueCents: 0, count: 0 };
      byCategory.set(h.category, { valueCents: cur.valueCents + aud, count: cur.count + 1 });
    }
    summary = { generatedAt: now, items: [...byCategory].map(([category, v]) => ({ category, ...v })).sort((a, b) => a.category.localeCompare(b.category)) };
  }
  return { shared, mine, summary };
}

// ------------------------------------------------------------------ three-way merge

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdArray = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.id === 'string');

/**
 * Merges a local edit with a newer remote version of the same document.
 * Whatever this person changed since `base` wins; everything else comes from `remote`.
 * Lists of records merge by id, so two people adding different items both keep theirs.
 */
export function merge3<T>(base: T, local: T, remote: T): T {
  if (deepEqual(local, base)) return remote;
  if (deepEqual(remote, base) || deepEqual(remote, local)) return local;
  if (isIdArray(base ?? []) && isIdArray(local) && isIdArray(remote)) {
    const b = new Map((base as { id: string }[] | undefined ?? []).map((x) => [x.id, x]));
    const l = new Map(local.map((x) => [x.id, x]));
    const out: { id: string }[] = [];
    for (const r of remote) {
      const lb = b.get(r.id);
      const li = l.get(r.id);
      if (lb && !li) continue; // deleted locally
      out.push(li && lb ? merge3(lb, li, r) : li ?? r);
    }
    for (const li of local) if (!b.has(li.id) && !out.some((x) => x.id === li.id)) out.push(li); // added locally
    return out as T;
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = (isPlainObject(base) ? base : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      if (k in local && !(k in remote) && !(k in b)) out[k] = local[k];
      else if (!(k in local) && k in b) continue; // removed locally
      else if (k in remote || k in local) {
        const v = merge3(b[k], local[k], remote[k]);
        if (v !== undefined) out[k] = v;
      }
    }
    return out as T;
  }
  return local;
}
