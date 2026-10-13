import { BUILTIN_RULES, DEFAULT_CATEGORIES } from '@/domain/categories';
import { PRESET_ASSUMPTIONS } from '@/domain/forecast';
import { EMPTY_INCOME } from '@/domain/tax/salary';
import type { Scenario, Settings, WorkspaceData } from '@/domain/types';
import { uid } from '@/lib/id';

export const SCHEMA_VERSION = 1;

export function defaultSettings(): Settings {
  return {
    baseCurrency: 'AUD',
    fx: {},
    theme: 'dark',
    activeUser: 'me',
    shareTotalsOfPrivateItems: { me: false, partner: false },
    staleDays: { synced: 3, manualCash: 45, manualInvestment: 120, property: 365, other: 365 },
    stateOfResidence: 'VIC',
    defaultAssumptions: { ...PRESET_ASSUMPTIONS.base },
    onboarded: false,
    autoSnapshot: true,
  };
}

export function baseScenario(now = new Date().toISOString()): Scenario {
  return {
    id: uid('scn'),
    name: 'Base case',
    preset: 'base',
    assumptions: { ...PRESET_ASSUMPTIONS.base },
    events: [],
    livingCostsMonthlyCents: null,
    horizonYears: 30,
    createdAt: now,
    updatedAt: now,
    color: 'var(--series-1)',
  };
}

export function emptyWorkspace(kind: WorkspaceData['kind'] = 'real'): WorkspaceData {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    people: {
      me: { id: 'me', name: 'Me', income: { ...EMPTY_INCOME } },
      partner: { id: 'partner', name: 'Partner', income: { ...EMPTY_INCOME } },
    },
    holdings: [],
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    budgets: [],
    plannedExpenses: [],
    bills: [],
    goals: [],
    snapshots: [],
    scenarios: [baseScenario()],
    properties: [],
    connections: [],
    insights: { dismissed: {} },
    audit: [],
    settings: defaultSettings(),
  };
}

export { BUILTIN_RULES };

/** Bring older saved data up to the current schema. */
export function migrate(data: WorkspaceData): WorkspaceData {
  const base = emptyWorkspace(data.kind);
  const merged: WorkspaceData = {
    ...base,
    ...data,
    settings: { ...base.settings, ...data.settings, staleDays: { ...base.settings.staleDays, ...data.settings?.staleDays } },
    insights: data.insights ?? { dismissed: {} },
  };
  // Add any new built-in categories without touching edited ones.
  const ids = new Set(merged.categories.map((c) => c.id));
  for (const c of DEFAULT_CATEGORIES) if (!ids.has(c.id)) merged.categories.push({ ...c });
  merged.schemaVersion = SCHEMA_VERSION;
  return merged;
}
