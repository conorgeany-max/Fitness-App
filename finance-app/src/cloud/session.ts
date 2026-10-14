/**
 * One signed-in person's connection to their household's data.
 *
 * Loads the shared document, their own private document, their partner's shared totals and
 * the synced provider rows (the database only returns what this person may see), assembles
 * them into a workspace, and saves edits back with optimistic versioning: when the partner
 * saved first, the two edits are merged and the save retried.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { PersonId, WorkspaceData } from '@/domain/types';
import {
  assembleWorkspace,
  emptyPrivate,
  emptyShared,
  isProviderHolding,
  merge3,
  otherPerson,
  providerHoldingId,
  splitWorkspace,
  type PrivateDoc,
  type PrivateSummary,
  type ProviderAccountRow,
  type ProviderBalanceRow,
  type ProviderData,
  type ProviderTxnRow,
  type SharedDoc,
} from '@/store/cloudDocs';
import { migrateShared, migratePrivate } from './migrateDocs';

export interface CloudMember {
  householdId: string;
  person: PersonId;
  displayName: string;
  aiEnabled: boolean;
}

export interface ConnectionStatus {
  id: string;
  person: PersonId;
  provider: 'up' | 'snaptrade';
  status: 'pending' | 'active' | 'error' | 'revoked';
  status_message: string | null;
  last_sync_at: string | null;
  new_account_visibility: 'shared' | 'private';
}

interface Versioned<T> {
  data: T;
  version: number;
}

const PAGE = 1000;
const MAX_ROWS = 50_000;

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class CloudSession {
  readonly sb: SupabaseClient;
  readonly member: CloudMember;
  names: Partial<Record<PersonId, string>> = {};
  partnerJoined = false;
  connections: ConnectionStatus[] = [];
  private shared: Versioned<SharedDoc> = { data: emptyShared(), version: 0 };
  private mine: Versioned<PrivateDoc> = { data: emptyPrivate(), version: 0 };
  private partnerSummary: PrivateSummary | null = null;
  private savedSummary: string | null = null;
  provider: ProviderData = { accounts: [], transactions: [], balances: [] };

  constructor(sb: SupabaseClient, member: CloudMember) {
    this.sb = sb;
    this.member = member;
  }

  private async fetchDoc<T>(scope: string): Promise<Versioned<T> | null> {
    const { data, error } = await this.sb.from('documents').select('data, version').eq('household_id', this.member.householdId).eq('scope', scope).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { data: data.data as T, version: data.version as number } : null;
  }

  private async fetchMembers(): Promise<void> {
    const { data, error } = await this.sb.from('members').select('person, display_name').eq('household_id', this.member.householdId);
    if (error) throw new Error(error.message);
    this.names = Object.fromEntries((data ?? []).map((m) => [m.person, m.display_name]));
    this.partnerJoined = (data ?? []).length > 1;
  }

  private async fetchSummary(): Promise<void> {
    const { data, error } = await this.sb.from('private_summaries').select('person, data').eq('household_id', this.member.householdId);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    this.partnerSummary = (rows.find((r) => r.person === otherPerson(this.member.person))?.data as PrivateSummary | undefined) ?? null;
    const mine = rows.find((r) => r.person === this.member.person);
    this.savedSummary = mine ? JSON.stringify(mine.data) : null;
  }

  async fetchConnections(): Promise<ConnectionStatus[]> {
    const { data, error } = await this.sb.from('connections').select('id, person, provider, status, status_message, last_sync_at, new_account_visibility').eq('household_id', this.member.householdId);
    if (error) throw new Error(error.message);
    this.connections = (data ?? []) as ConnectionStatus[];
    return this.connections;
  }

  async fetchProvider(): Promise<void> {
    const hid = this.member.householdId;
    const accounts = await pages<ProviderAccountRow>((a, b) =>
      this.sb.from('provider_accounts').select('id, provider, external_id, owners, joint, visibility, name, account_type, institution, currency, balance_cents, available_cents, as_at').eq('household_id', hid).order('id').range(a, b),
    );
    const ids = accounts.map((a) => a.id);
    const [transactions, balances] = ids.length
      ? await Promise.all([
          pages<ProviderTxnRow>((a, b) =>
            this.sb.from('provider_transactions').select('account_id, external_id, date, description, amount_cents, pending, merchant, transfer_external_id').in('account_id', ids).order('date', { ascending: false }).order('external_id').range(a, b),
          ),
          pages<ProviderBalanceRow>((a, b) => this.sb.from('provider_balances').select('account_id, date, balance_cents').in('account_id', ids).order('date').order('account_id').range(a, b)),
        ])
      : [[], []];
    // Up reports a 2Up account and its transactions to both partners; the server stores one copy.
    this.provider = { accounts, transactions, balances };
  }

  async load(): Promise<WorkspaceData> {
    const [shared, mine] = await Promise.all([this.fetchDoc<SharedDoc>('shared'), this.fetchDoc<PrivateDoc>(this.member.person), this.fetchMembers(), this.fetchSummary(), this.fetchProvider(), this.fetchConnections()]);
    this.shared = shared ? { data: migrateShared(shared.data), version: shared.version } : { data: emptyShared(), version: 0 };
    this.mine = mine ? { data: migratePrivate(mine.data), version: mine.version } : { data: emptyPrivate(), version: 0 };
    return this.assemble(this.shared.data, this.mine.data);
  }

  private assemble(shared: SharedDoc, mine: PrivateDoc): WorkspaceData {
    return assembleWorkspace({ person: this.member.person, shared, mine, partnerSummary: this.partnerSummary, provider: this.provider, names: this.names });
  }

  /**
   * Re-reads everything and folds in edits this person hasn't saved yet, so a partner's change
   * or a new synced transaction never overwrites local work. Unsaved edits stay unsaved and go
   * out with the next save.
   */
  async pull(current: WorkspaceData): Promise<WorkspaceData> {
    const local = splitWorkspace(current, this.member.person, this.provider);
    const [shared, mine] = await Promise.all([this.fetchDoc<SharedDoc>('shared'), this.fetchDoc<PrivateDoc>(this.member.person), this.fetchMembers(), this.fetchSummary(), this.fetchProvider(), this.fetchConnections()]);
    let sharedDoc = local.shared;
    let mineDoc = local.mine;
    if (shared) {
      const remote = migrateShared(shared.data);
      sharedDoc = merge3(this.shared.data, local.shared, remote);
      this.shared = { data: remote, version: shared.version };
    }
    if (mine) {
      const remote = migratePrivate(mine.data);
      mineDoc = merge3(this.mine.data, local.mine, remote);
      this.mine = { data: remote, version: mine.version };
    }
    return this.assemble(sharedDoc, mineDoc);
  }

  /** Saves one document if it changed, merging with whatever the partner saved in between. */
  private async saveDoc<T>(scope: string, local: T, confirmed: Versioned<T>, migrateRemote: (d: T) => T): Promise<{ doc: Versioned<T>; merged: boolean }> {
    if (confirmed.version > 0 && same(local, confirmed.data)) return { doc: confirmed, merged: false };
    let base = confirmed.data;
    let expected = confirmed.version;
    let data = local;
    let merged = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: version, error } = await this.sb.rpc('save_document', { p_scope: scope, p_data: data, p_expected_version: expected });
      if (!error) return { doc: { data, version: version as number }, merged };
      if (error.code !== '40001') throw new Error(error.message);
      const remote = await this.fetchDoc<T>(scope);
      if (!remote) throw new Error('The saved document disappeared. Reload the page.');
      const r = migrateRemote(remote.data);
      data = merge3(base, data, r);
      base = r;
      expected = remote.version;
      merged = true;
    }
    throw new Error('Your partner is saving at the same time. Try again in a moment.');
  }

  /** Applies visibility changes made to synced accounts; the database is the source of truth. */
  private async pushVisibility(ws: WorkspaceData): Promise<void> {
    for (const row of this.provider.accounts) {
      if (row.joint || row.owners.length !== 1 || row.owners[0] !== this.member.person) continue;
      const h = ws.holdings.find((x) => x.id === providerHoldingId(row.id));
      if (!h || !isProviderHolding(h) || h.visibility === row.visibility) continue;
      const { error } = await this.sb.from('provider_accounts').update({ visibility: h.visibility }).eq('id', row.id);
      if (error) throw new Error(error.message);
      row.visibility = h.visibility;
    }
  }

  /** Saves the workspace. Returns a re-assembled workspace when a partner's edits were merged in. */
  async save(ws: WorkspaceData): Promise<WorkspaceData | null> {
    await this.pushVisibility(ws);
    const split = splitWorkspace(ws, this.member.person, this.provider);
    const sh = await this.saveDoc('shared', split.shared, this.shared, migrateShared);
    this.shared = sh.doc;
    const mi = await this.saveDoc(this.member.person, split.mine, this.mine, migratePrivate);
    this.mine = mi.doc;

    const summaryJson = split.summary ? JSON.stringify({ items: split.summary.items }) : null;
    const savedItems = this.savedSummary ? JSON.stringify({ items: (JSON.parse(this.savedSummary) as PrivateSummary).items }) : null;
    if (summaryJson !== savedItems) {
      const q = split.summary
        ? this.sb.from('private_summaries').upsert({ household_id: this.member.householdId, person: this.member.person, data: split.summary, updated_at: new Date().toISOString() })
        : this.sb.from('private_summaries').delete().eq('household_id', this.member.householdId).eq('person', this.member.person);
      const { error } = await q;
      if (error) throw new Error(error.message);
      this.savedSummary = split.summary ? JSON.stringify(split.summary) : null;
    }
    return sh.merged || mi.merged ? this.assemble(this.shared.data, this.mine.data) : null;
  }

  /** Calls `onChange` (debounced) whenever something this person can see changes. */
  subscribe(onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 800);
    };
    const filter = `household_id=eq.${this.member.householdId}`;
    const channel: RealtimeChannel = this.sb
      .channel(`household:${this.member.householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_summaries', filter }, fire)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_accounts', filter }, fire)
      // New transactions arrive as an update to their account (the server touches it).
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void this.sb.removeChannel(channel);
    };
  }
}

export async function currentMember(sb: SupabaseClient): Promise<CloudMember | null> {
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb.from('members').select('household_id, person, display_name, ai_enabled').eq('user_id', u.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { householdId: data.household_id, person: data.person as PersonId, displayName: data.display_name, aiEnabled: data.ai_enabled } : null;
}
