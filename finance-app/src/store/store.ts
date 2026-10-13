/**
 * Application store (zustand + immer). All writes go through actions so that balance
 * changes are recorded in the valuation history and audit log, and the workspace is
 * persisted (debounced) after every change.
 */
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import { todayISO } from '@/domain/dates';
import { BUILTIN_RULES } from '@/domain/categories';
import { takeSnapshot } from '@/domain/history';
import { applyCategorisation, mergeTransactions, type ImportOutcome } from '@/domain/transactions';
import type {
  AuditEntry,
  BankConnection,
  BudgetLine,
  Category,
  CategoryRule,
  Goal,
  Holding,
  Perspective,
  PersonId,
  PlannedExpense,
  PropertyAnalysis,
  RecurringBill,
  Scenario,
  Settings,
  Transaction,
  ValuationEntry,
  ValuationReason,
  WorkspaceData,
} from '@/domain/types';
import { uid } from '@/lib/id';
import { emptyWorkspace, migrate } from './defaults';
import * as db from './persistence';

export type AppStatus = 'loading' | 'locked' | 'ready' | 'error';

interface UiState {
  perspective: Perspective;
  saving: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: string | null;
  saveError: string | null;
}

export interface AppState {
  status: AppStatus;
  error: string | null;
  meta: db.Meta;
  data: WorkspaceData;
  ui: UiState;
  // lifecycle
  init(): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  setPassphrase(passphrase: string | null): Promise<void>;
  switchWorkspace(kind: WorkspaceData['kind'], seed?: () => WorkspaceData): Promise<void>;
  replaceWorkspace(data: WorkspaceData, note: string): void;
  deleteAllData(): Promise<void>;
  setPerspective(p: Perspective): void;
  // generic
  mutate(recipe: (d: Draft<WorkspaceData>) => void, audit?: { action: string; detail: string }): void;
  // domain actions
  updateSettings(patch: Partial<Settings>): void;
  upsertHolding(h: Holding, note?: string): void;
  recordValuation(holdingId: string, entry: Omit<ValuationEntry, 'id' | 'recordedAt'>): void;
  archiveHolding(id: string, archived: boolean): void;
  deleteHolding(id: string): void;
  addTransactions(txns: Transaction[], note: string): ImportOutcome;
  updateTransactions(ids: string[], patch: Partial<Transaction>): void;
  deleteTransactions(ids: string[]): void;
  upsertRule(rule: CategoryRule, reapply: boolean): number;
  deleteRule(id: string): void;
  reapplyRules(): number;
  upsertCategory(c: Category): void;
  upsertBudget(b: BudgetLine): void;
  deleteBudget(id: string): void;
  upsertPlanned(p: PlannedExpense): void;
  deletePlanned(id: string): void;
  upsertBill(b: RecurringBill): void;
  deleteBill(id: string): void;
  upsertGoal(g: Goal): void;
  deleteGoal(id: string): void;
  upsertScenario(s: Scenario): void;
  deleteScenario(id: string): void;
  upsertProperty(p: PropertyAnalysis): void;
  deleteProperty(id: string): void;
  upsertConnection(c: BankConnection): void;
  removeConnection(id: string, deleteData: boolean): void;
  dismissInsight(id: string): void;
  restoreInsights(): void;
  recordSnapshot(): void;
}

let keyMaterial: db.KeyMaterial | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function audit(by: PersonId, action: string, detail: string): AuditEntry {
  return { id: uid('aud'), at: new Date().toISOString(), by, action, detail };
}

export const useApp = create<AppState>()((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set((s) => ({ ui: { ...s.ui, saving: 'saving' } }));
    saveTimer = setTimeout(async () => {
      try {
        await db.saveWorkspace(get().data, keyMaterial);
        set((s) => ({ ui: { ...s.ui, saving: 'saved', lastSavedAt: new Date().toISOString(), saveError: null } }));
      } catch (e) {
        set((s) => ({ ui: { ...s.ui, saving: 'error', saveError: e instanceof Error ? e.message : 'Save failed' } }));
      }
    }, 400);
  };

  const mutate: AppState['mutate'] = (recipe, a) => {
    const next = produce(get().data, (d) => {
      recipe(d);
      if (a) {
        d.audit.unshift(audit(d.settings.activeUser, a.action, a.detail));
        if (d.audit.length > 2000) d.audit.length = 2000;
      }
    });
    set({ data: next });
    scheduleSave();
  };

  const maybeAutoSnapshot = () => {
    const d = get().data;
    if (!d.settings.autoSnapshot || d.holdings.length === 0) return;
    const month = todayISO().slice(0, 7);
    if (d.snapshots.some((s) => s.kind === 'recorded' && s.date.slice(0, 7) === month)) return;
    get().recordSnapshot();
  };

  return {
    status: 'loading',
    error: null,
    meta: { activeWorkspace: 'real', encrypted: false },
    data: emptyWorkspace('real'),
    ui: { perspective: 'household', saving: 'idle', lastSavedAt: null, saveError: null },

    async init() {
      try {
        const meta = await db.loadMeta();
        set({ meta });
        if (meta.encrypted) {
          set({ status: 'locked' });
          return;
        }
        const data = (await db.loadWorkspace(meta.activeWorkspace, null)) ?? emptyWorkspace(meta.activeWorkspace);
        set({ data: migrate(data), status: 'ready' });
        void db.requestPersistentStorage();
        maybeAutoSnapshot();
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : 'Could not open local storage.' });
      }
    },

    async unlock(passphrase) {
      const meta = get().meta;
      keyMaterial = await db.unlock(passphrase, meta);
      const data = (await db.loadWorkspace(meta.activeWorkspace, keyMaterial)) ?? emptyWorkspace(meta.activeWorkspace);
      set({ data: migrate(data), status: 'ready' });
      maybeAutoSnapshot();
    },

    async setPassphrase(passphrase) {
      const meta = { ...get().meta };
      // Re-save both workspaces with the new key (or in plain form when removing).
      const real = await db.loadWorkspace('real', keyMaterial);
      const demo = await db.loadWorkspace('demo', keyMaterial);
      if (passphrase) {
        const { km, check } = await db.createKey(passphrase);
        keyMaterial = km;
        meta.encrypted = true;
        meta.check = check;
      } else {
        keyMaterial = null;
        meta.encrypted = false;
        delete meta.check;
      }
      const current = get().data;
      for (const ws of [real, demo]) if (ws && ws.kind !== current.kind) await db.saveWorkspace(ws, keyMaterial);
      await db.saveWorkspace(current, keyMaterial);
      await db.saveMeta(meta);
      set({ meta });
    },

    async switchWorkspace(kind, seed) {
      await db.saveWorkspace(get().data, keyMaterial);
      let data = await db.loadWorkspace(kind, keyMaterial);
      if (!data) data = seed ? seed() : emptyWorkspace(kind);
      const meta = { ...get().meta, activeWorkspace: kind };
      await db.saveMeta(meta);
      await db.saveWorkspace(data, keyMaterial);
      set({ data: migrate(data), meta });
      maybeAutoSnapshot();
    },

    replaceWorkspace(data, note) {
      const kind = get().data.kind;
      const next = migrate({ ...data, kind });
      next.audit.unshift(audit(next.settings.activeUser, 'import', note));
      set({ data: next });
      scheduleSave();
    },

    async deleteAllData() {
      await db.deleteEverything();
      keyMaterial = null;
      set({ data: emptyWorkspace('real'), meta: { activeWorkspace: 'real', encrypted: false } });
    },

    setPerspective(p) {
      set((s) => ({ ui: { ...s.ui, perspective: p } }));
      try {
        localStorage.setItem('ledgerline:perspective', p);
      } catch {
        /* storage unavailable */
      }
    },

    mutate,

    updateSettings(patch) {
      mutate((d) => {
        Object.assign(d.settings, patch);
      });
    },

    upsertHolding(h, note) {
      const prev = get().data.holdings.find((x) => x.id === h.id);
      mutate(
        (d) => {
          const now = new Date().toISOString();
          const next = { ...h, updatedAt: now } as Holding;
          // Any change of value is recorded in the valuation history (audit trail).
          if (next.valueCents !== null && next.valuedAt && (!prev || prev.valueCents !== next.valueCents || prev.valuedAt !== next.valuedAt)) {
            const reason: ValuationReason = prev ? 'manual-update' : 'opening';
            next.history = [
              ...next.history.filter((e) => e.date !== next.valuedAt || e.source !== next.source),
              { id: uid('val'), date: next.valuedAt, valueCents: next.valueCents, source: next.source, reason, note, recordedAt: now, recordedBy: d.settings.activeUser },
            ].sort((a, b) => a.date.localeCompare(b.date));
          }
          const i = d.holdings.findIndex((x) => x.id === h.id);
          if (i >= 0) d.holdings[i] = next as Draft<Holding>;
          else d.holdings.push(next as Draft<Holding>);
        },
        { action: prev ? 'update-item' : 'add-item', detail: `${prev ? 'Updated' : 'Added'} ${h.name}${prev && prev.valueCents !== h.valueCents ? ` (value ${prev.valueCents ?? 'none'} → ${h.valueCents ?? 'none'} cents)` : ''}` },
      );
      if (get().data.settings.autoSnapshot) get().recordSnapshot();
    },

    recordValuation(holdingId, entry) {
      const h = get().data.holdings.find((x) => x.id === holdingId);
      if (!h) return;
      mutate(
        (d) => {
          const target = d.holdings.find((x) => x.id === holdingId)!;
          const now = new Date().toISOString();
          target.history.push({ ...entry, id: uid('val'), recordedAt: now, recordedBy: d.settings.activeUser });
          target.history.sort((a, b) => a.date.localeCompare(b.date));
          const latest = target.history[target.history.length - 1];
          if (!target.valuedAt || latest.date >= target.valuedAt) {
            target.valueCents = latest.valueCents;
            target.valuedAt = latest.date;
            target.source = latest.source;
          }
          target.updatedAt = now;
        },
        { action: 'valuation', detail: `${h.name}: ${entry.valueCents} cents on ${entry.date} (${entry.reason})` },
      );
      if (get().data.settings.autoSnapshot) get().recordSnapshot();
    },

    archiveHolding(id, archived) {
      mutate(
        (d) => {
          const h = d.holdings.find((x) => x.id === id);
          if (h) h.archived = archived;
        },
        { action: archived ? 'archive-item' : 'restore-item', detail: id },
      );
    },

    deleteHolding(id) {
      const h = get().data.holdings.find((x) => x.id === id);
      mutate(
        (d) => {
          d.holdings = d.holdings.filter((x) => x.id !== id);
          for (const t of d.transactions) if (t.accountId === id) t.accountId = null;
          for (const g of d.goals) g.linkedHoldingIds = g.linkedHoldingIds.filter((x) => x !== id);
        },
        { action: 'delete-item', detail: `Deleted ${h?.name ?? id}` },
      );
    },

    addTransactions(txns, note) {
      const d0 = get().data;
      const categorised = txns.map((t) => applyCategorisation(t, d0.rules, BUILTIN_RULES));
      const outcome = mergeTransactions(d0.transactions, categorised);
      mutate(
        (d) => {
          d.transactions.push(...(outcome.added as Draft<Transaction>[]));
          d.transactions.sort((a, b) => b.date.localeCompare(a.date));
        },
        { action: 'import-transactions', detail: `${note}: ${outcome.added.length} added, ${outcome.skipped.length} duplicates skipped, ${outcome.flagged.length} flagged` },
      );
      return outcome;
    },

    updateTransactions(ids, patch) {
      const set_ = new Set(ids);
      mutate((d) => {
        for (const t of d.transactions) if (set_.has(t.id)) Object.assign(t, patch);
      });
    },

    deleteTransactions(ids) {
      const set_ = new Set(ids);
      mutate(
        (d) => {
          d.transactions = d.transactions.filter((t) => !set_.has(t.id));
          for (const t of d.transactions) if (t.transferPairId && set_.has(t.transferPairId)) {
            t.transferPairId = undefined;
            t.transfer = 'none';
          }
        },
        { action: 'delete-transactions', detail: `${ids.length} transaction(s)` },
      );
    },

    upsertRule(rule, reapply) {
      mutate((d) => {
        const i = d.rules.findIndex((r) => r.id === rule.id);
        if (i >= 0) d.rules[i] = rule;
        else d.rules.push(rule);
      });
      return reapply ? get().reapplyRules() : 0;
    },

    deleteRule(id) {
      mutate((d) => {
        d.rules = d.rules.filter((r) => r.id !== id);
      });
    },

    reapplyRules() {
      let changed = 0;
      mutate((d) => {
        d.transactions = d.transactions.map((t) => {
          const next = applyCategorisation(t as Transaction, d.rules as CategoryRule[], BUILTIN_RULES);
          if (next.categoryId !== t.categoryId || next.transfer !== t.transfer) changed++;
          return next as Draft<Transaction>;
        });
        const counts = new Map<string, number>();
        for (const t of d.transactions) if (t.categorisation.ruleId) counts.set(t.categorisation.ruleId, (counts.get(t.categorisation.ruleId) ?? 0) + 1);
        for (const r of d.rules) r.matchCount = counts.get(r.id) ?? 0;
      });
      return changed;
    },

    upsertCategory(c) {
      mutate((d) => {
        const i = d.categories.findIndex((x) => x.id === c.id);
        if (i >= 0) d.categories[i] = c;
        else d.categories.push(c);
      });
    },

    upsertBudget(b) {
      mutate((d) => {
        const i = d.budgets.findIndex((x) => x.id === b.id);
        if (i >= 0) d.budgets[i] = b;
        else d.budgets.push(b);
      });
    },
    deleteBudget(id) {
      mutate((d) => {
        d.budgets = d.budgets.filter((x) => x.id !== id);
      });
    },
    upsertPlanned(p) {
      mutate((d) => {
        const i = d.plannedExpenses.findIndex((x) => x.id === p.id);
        if (i >= 0) d.plannedExpenses[i] = p;
        else d.plannedExpenses.push(p);
      });
    },
    deletePlanned(id) {
      mutate((d) => {
        d.plannedExpenses = d.plannedExpenses.filter((x) => x.id !== id);
      });
    },
    upsertBill(b) {
      mutate((d) => {
        const i = d.bills.findIndex((x) => x.id === b.id);
        if (i >= 0) d.bills[i] = b;
        else d.bills.push(b);
      });
    },
    deleteBill(id) {
      mutate((d) => {
        d.bills = d.bills.filter((x) => x.id !== id);
      });
    },
    upsertGoal(g) {
      mutate((d) => {
        const i = d.goals.findIndex((x) => x.id === g.id);
        if (i >= 0) d.goals[i] = g;
        else d.goals.push(g);
      });
    },
    deleteGoal(id) {
      mutate((d) => {
        d.goals = d.goals.filter((x) => x.id !== id);
      });
    },
    upsertScenario(s) {
      mutate((d) => {
        const i = d.scenarios.findIndex((x) => x.id === s.id);
        const next = { ...s, updatedAt: new Date().toISOString() };
        if (i >= 0) d.scenarios[i] = next as Draft<Scenario>;
        else d.scenarios.push(next as Draft<Scenario>);
      });
    },
    deleteScenario(id) {
      mutate((d) => {
        d.scenarios = d.scenarios.filter((x) => x.id !== id);
      });
    },
    upsertProperty(p) {
      mutate((d) => {
        const i = d.properties.findIndex((x) => x.id === p.id);
        const next = { ...p, updatedAt: new Date().toISOString() };
        if (i >= 0) d.properties[i] = next as Draft<PropertyAnalysis>;
        else d.properties.unshift(next as Draft<PropertyAnalysis>);
      });
    },
    deleteProperty(id) {
      mutate((d) => {
        d.properties = d.properties.filter((x) => x.id !== id);
      });
    },
    upsertConnection(c) {
      mutate(
        (d) => {
          const i = d.connections.findIndex((x) => x.id === c.id);
          if (i >= 0) d.connections[i] = c;
          else d.connections.push(c);
        },
        { action: 'connection', detail: `${c.institutionName}: ${c.status}` },
      );
    },
    removeConnection(id, deleteData) {
      const c = get().data.connections.find((x) => x.id === id);
      mutate(
        (d) => {
          d.connections = d.connections.filter((x) => x.id !== id);
          const accIds = new Set(d.holdings.filter((h) => h.connectionId === id).map((h) => h.id));
          if (deleteData) {
            d.holdings = d.holdings.filter((h) => !accIds.has(h.id));
            d.transactions = d.transactions.filter((t) => !t.accountId || !accIds.has(t.accountId));
          } else {
            // Keep the history but stop presenting it as synchronised.
            for (const h of d.holdings) if (accIds.has(h.id)) {
              h.connectionId = undefined;
              h.notes = `${h.notes ? `${h.notes}\n` : ''}Disconnected from ${c?.institutionName ?? 'provider'} on ${todayISO()}; balance is no longer updated.`;
            }
          }
        },
        { action: 'disconnect', detail: `${c?.institutionName ?? id}${deleteData ? ' (data deleted)' : ' (data kept)'}` },
      );
    },
    dismissInsight(id) {
      mutate((d) => {
        d.insights.dismissed[id] = new Date().toISOString();
      });
    },
    restoreInsights() {
      mutate((d) => {
        d.insights.dismissed = {};
      });
    },
    recordSnapshot() {
      const d0 = get().data;
      const snap = takeSnapshot(d0.holdings, d0.settings, todayISO(), uid('snap'));
      mutate((d) => {
        const month = snap.date.slice(0, 7);
        d.snapshots = d.snapshots.filter((s) => !(s.kind === 'recorded' && s.date.slice(0, 7) === month));
        d.snapshots.push(snap);
        d.snapshots.sort((a, b) => a.date.localeCompare(b.date));
      });
    },
  };
});

try {
  const p = localStorage.getItem('ledgerline:perspective');
  if (p === 'me' || p === 'partner' || p === 'household') useApp.setState((s) => ({ ui: { ...s.ui, perspective: p } }));
} catch {
  /* storage unavailable */
}
