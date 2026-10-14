/**
 * Repo backed by Supabase, using the service role key. That key bypasses row level security,
 * so it lives only in the server's environment and every query here is scoped by household.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ObTransaction } from '../../src/domain/openBanking';
import type { AccountUpsert, CloudProvider, ConnectionRow, Member, Person, Position, Repo } from './types';

interface ConnectionDb {
  id: string;
  household_id: string;
  person: Person;
  provider: CloudProvider;
  secret_ciphertext: string;
  webhook_id: string | null;
  webhook_secret_ciphertext: string | null;
  new_account_visibility: 'shared' | 'private';
  status: ConnectionRow['status'];
  status_message: string | null;
  last_sync_at: string | null;
  created_at: string;
}

const toConnection = (r: ConnectionDb): ConnectionRow => ({
  id: r.id,
  householdId: r.household_id,
  person: r.person,
  provider: r.provider,
  secretCiphertext: r.secret_ciphertext,
  webhookId: r.webhook_id,
  webhookSecretCiphertext: r.webhook_secret_ciphertext,
  newAccountVisibility: r.new_account_visibility,
  status: r.status,
  statusMessage: r.status_message,
  lastSyncAt: r.last_sync_at,
  createdAt: r.created_at,
});

const fromConnectionPatch = (p: Partial<ConnectionRow>) => {
  const out: Record<string, unknown> = {};
  if (p.secretCiphertext !== undefined) out.secret_ciphertext = p.secretCiphertext;
  if (p.webhookId !== undefined) out.webhook_id = p.webhookId;
  if (p.webhookSecretCiphertext !== undefined) out.webhook_secret_ciphertext = p.webhookSecretCiphertext;
  if (p.newAccountVisibility !== undefined) out.new_account_visibility = p.newAccountVisibility;
  if (p.status !== undefined) out.status = p.status;
  if (p.statusMessage !== undefined) out.status_message = p.statusMessage;
  if (p.lastSyncAt !== undefined) out.last_sync_at = p.lastSyncAt;
  return out;
};

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Database error: ${r.error.message}`);
  return r.data;
}

export function serviceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export class SupabaseRepo implements Repo {
  constructor(private readonly db: SupabaseClient) {}

  async memberByUser(userId: string): Promise<Member | null> {
    const r = check(await this.db.from('members').select('household_id, user_id, person, display_name, ai_enabled').eq('user_id', userId).maybeSingle());
    return r ? { userId: r.user_id, householdId: r.household_id, person: r.person, displayName: r.display_name, aiEnabled: r.ai_enabled } : null;
  }

  async getConnection(id: string) {
    const r = check(await this.db.from('connections').select('*').eq('id', id).maybeSingle());
    return r ? toConnection(r as ConnectionDb) : null;
  }

  async findConnection(householdId: string, person: Person, provider: CloudProvider) {
    const r = check(await this.db.from('connections').select('*').eq('household_id', householdId).eq('person', person).eq('provider', provider).maybeSingle());
    return r ? toConnection(r as ConnectionDb) : null;
  }

  async listConnections(filter?: { status?: ConnectionRow['status'] }) {
    let q = this.db.from('connections').select('*');
    if (filter?.status) q = q.eq('status', filter.status);
    return (check(await q) as ConnectionDb[]).map(toConnection);
  }

  async insertConnection(row: Omit<ConnectionRow, 'id' | 'createdAt'>) {
    const r = check(
      await this.db
        .from('connections')
        .upsert({ household_id: row.householdId, person: row.person, provider: row.provider, ...fromConnectionPatch(row) }, { onConflict: 'household_id,person,provider' })
        .select('*')
        .single(),
    );
    return toConnection(r as ConnectionDb);
  }

  async updateConnection(id: string, patch: Partial<ConnectionRow>) {
    check(await this.db.from('connections').update(fromConnectionPatch(patch)).eq('id', id));
  }

  async deleteConnection(id: string) {
    check(await this.db.from('connections').delete().eq('id', id));
  }

  async upsertAccount(householdId: string, a: AccountUpsert): Promise<string> {
    const existing = check(
      await this.db.from('provider_accounts').select('id, owners, joint').eq('household_id', householdId).eq('provider', a.provider).eq('external_id', a.account.externalId).maybeSingle(),
    ) as { id: string; owners: Person[]; joint: boolean } | null;
    const fields = {
      name: a.account.name,
      account_type: a.account.type,
      currency: a.account.currency,
      balance_cents: a.account.balanceCents,
      available_cents: a.account.availableCents ?? null,
      as_at: a.account.asAt,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const owners = existing.owners.includes(a.owner) ? existing.owners : [...existing.owners, a.owner].sort();
      const joint = existing.joint || a.joint;
      check(await this.db.from('provider_accounts').update({ ...fields, owners, joint, ...(joint ? { visibility: 'shared' } : {}) }).eq('id', existing.id));
      return existing.id;
    }
    const r = check(
      await this.db
        .from('provider_accounts')
        .insert({
          household_id: householdId,
          provider: a.provider,
          external_id: a.account.externalId,
          owners: [a.owner],
          joint: a.joint,
          visibility: a.joint ? 'shared' : a.defaultVisibility,
          institution: a.institution,
          ...fields,
        })
        .select('id')
        .single(),
    ) as { id: string };
    return r.id;
  }

  async recordBalance(accountId: string, date: string, balanceCents: number) {
    check(await this.db.from('provider_balances').upsert({ account_id: accountId, date, balance_cents: balanceCents }, { onConflict: 'account_id,date' }));
  }

  async upsertTransactions(accountId: string, txns: (ObTransaction & { transferExternalId?: string | null })[]) {
    const now = new Date().toISOString();
    for (let i = 0; i < txns.length; i += 500) {
      const rows = txns.slice(i, i + 500).map((t) => ({
        account_id: accountId,
        external_id: t.externalId,
        date: t.date,
        description: t.description.slice(0, 500),
        amount_cents: t.amountCents,
        pending: !!t.pending,
        merchant: t.merchant ?? null,
        transfer_external_id: t.transferExternalId ?? null,
        updated_at: now,
      }));
      check(await this.db.from('provider_transactions').upsert(rows, { onConflict: 'account_id,external_id' }));
    }
  }

  async deleteTransaction(householdId: string, provider: CloudProvider, externalId: string) {
    const ids = (check(await this.db.from('provider_accounts').select('id').eq('household_id', householdId).eq('provider', provider)) as { id: string }[]).map((r) => r.id);
    if (ids.length) check(await this.db.from('provider_transactions').delete().eq('external_id', externalId).in('account_id', ids));
  }

  async replacePositions(accountId: string, positions: Position[]) {
    check(await this.db.from('provider_positions').delete().eq('account_id', accountId));
    if (!positions.length) return;
    check(
      await this.db.from('provider_positions').insert(
        positions.map((p) => ({ account_id: accountId, symbol: p.symbol, description: p.description, units: p.units, price_cents: p.priceCents, value_cents: p.valueCents, currency: p.currency })),
      ),
    );
  }

  async releaseAccounts(householdId: string, provider: CloudProvider, person: Person) {
    const rows = check(await this.db.from('provider_accounts').select('id, owners').eq('household_id', householdId).eq('provider', provider)) as { id: string; owners: Person[] }[];
    for (const r of rows) {
      if (!r.owners.includes(person)) continue;
      const owners = r.owners.filter((o) => o !== person);
      if (owners.length === 0) check(await this.db.from('provider_accounts').delete().eq('id', r.id));
      else check(await this.db.from('provider_accounts').update({ owners, joint: false, visibility: 'shared' }).eq('id', r.id));
    }
  }

  async removeMember(member: Member) {
    const hid = member.householdId;
    check(await this.db.from('documents').delete().eq('household_id', hid).eq('scope', member.person));
    check(await this.db.from('private_summaries').delete().eq('household_id', hid).eq('person', member.person));
    check(await this.db.from('members').delete().eq('user_id', member.userId));
    const left = check(await this.db.from('members').select('user_id').eq('household_id', hid)) as unknown[];
    // The last person out takes the household (and everything shared) with them.
    if (left.length === 0) check(await this.db.from('households').delete().eq('id', hid));
    const { error } = await this.db.auth.admin.deleteUser(member.userId);
    if (error) throw new Error(`Could not delete the sign-in: ${error.message}`);
  }

  async getAiUsage(householdId: string, month: string) {
    const r = check(await this.db.from('ai_usage').select('cost_micros, questions').eq('household_id', householdId).eq('month', month).maybeSingle()) as { cost_micros: number; questions: number } | null;
    return { costMicros: Number(r?.cost_micros ?? 0), questions: r?.questions ?? 0 };
  }

  async addAiUsage(householdId: string, month: string, costMicros: number) {
    const cur = await this.getAiUsage(householdId, month);
    check(await this.db.from('ai_usage').upsert({ household_id: householdId, month, cost_micros: cur.costMicros + costMicros, questions: cur.questions + 1 }, { onConflict: 'household_id,month' }));
  }
}
