/** In-memory Repo for tests and local development without Supabase. Same rules as the SQL schema. */
import { randomUUID } from 'node:crypto';
import type { ObTransaction } from '../../src/domain/openBanking';
import type { AccountUpsert, CloudProvider, ConnectionRow, Member, Person, Position, Repo } from './types';

export interface MemAccount {
  id: string;
  householdId: string;
  provider: CloudProvider;
  externalId: string;
  owners: Person[];
  joint: boolean;
  visibility: 'shared' | 'private';
  name: string;
  accountType: string;
  institution: string;
  currency: string;
  balanceCents: number;
  availableCents: number | null;
  asAt: string;
}

export class MemoryRepo implements Repo {
  members: Member[] = [];
  connections: ConnectionRow[] = [];
  accounts: MemAccount[] = [];
  balances = new Map<string, number>(); // `${accountId}|${date}`
  transactions = new Map<string, ObTransaction & { accountId: string; transferExternalId?: string | null }>(); // `${accountId}|${externalId}`
  positions = new Map<string, Position[]>();
  aiUsage = new Map<string, { costMicros: number; questions: number }>();

  async memberByUser(userId: string) {
    return this.members.find((m) => m.userId === userId) ?? null;
  }
  async getConnection(id: string) {
    return this.connections.find((c) => c.id === id) ?? null;
  }
  async findConnection(householdId: string, person: Person, provider: CloudProvider) {
    return this.connections.find((c) => c.householdId === householdId && c.person === person && c.provider === provider) ?? null;
  }
  async listConnections(filter?: { status?: ConnectionRow['status'] }) {
    return this.connections.filter((c) => !filter?.status || c.status === filter.status);
  }
  async insertConnection(row: Omit<ConnectionRow, 'id' | 'createdAt'>) {
    const existing = await this.findConnection(row.householdId, row.person, row.provider);
    if (existing) {
      Object.assign(existing, row);
      return existing;
    }
    const c: ConnectionRow = { ...row, id: randomUUID(), createdAt: new Date().toISOString() };
    this.connections.push(c);
    return c;
  }
  async updateConnection(id: string, patch: Partial<ConnectionRow>) {
    const c = this.connections.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }
  async deleteConnection(id: string) {
    this.connections = this.connections.filter((c) => c.id !== id);
  }
  async upsertAccount(householdId: string, a: AccountUpsert) {
    let row = this.accounts.find((x) => x.householdId === householdId && x.provider === a.provider && x.externalId === a.account.externalId);
    if (!row) {
      row = {
        id: randomUUID(),
        householdId,
        provider: a.provider,
        externalId: a.account.externalId,
        owners: [a.owner],
        joint: a.joint,
        visibility: a.joint ? 'shared' : a.defaultVisibility,
        name: a.account.name,
        accountType: a.account.type,
        institution: a.institution,
        currency: a.account.currency,
        balanceCents: a.account.balanceCents,
        availableCents: a.account.availableCents ?? null,
        asAt: a.account.asAt,
      };
      this.accounts.push(row);
    } else {
      if (!row.owners.includes(a.owner)) row.owners = [...row.owners, a.owner].sort() as Person[];
      if (a.joint) {
        row.joint = true;
        row.visibility = 'shared';
      }
      Object.assign(row, { name: a.account.name, accountType: a.account.type, currency: a.account.currency, balanceCents: a.account.balanceCents, availableCents: a.account.availableCents ?? null, asAt: a.account.asAt });
    }
    return row.id;
  }
  async recordBalance(accountId: string, date: string, balanceCents: number) {
    this.balances.set(`${accountId}|${date}`, balanceCents);
  }
  async upsertTransactions(accountId: string, txns: (ObTransaction & { transferExternalId?: string | null })[]) {
    for (const t of txns) this.transactions.set(`${accountId}|${t.externalId}`, { ...t, accountId });
  }
  async deleteTransaction(householdId: string, provider: CloudProvider, externalId: string) {
    const ids = new Set(this.accounts.filter((a) => a.householdId === householdId && a.provider === provider).map((a) => a.id));
    for (const [k, t] of this.transactions) if (t.externalId === externalId && ids.has(t.accountId)) this.transactions.delete(k);
  }
  async replacePositions(accountId: string, positions: Position[]) {
    this.positions.set(accountId, positions);
  }
  async releaseAccounts(householdId: string, provider: CloudProvider, person: Person) {
    for (const a of this.accounts) if (a.householdId === householdId && a.provider === provider) a.owners = a.owners.filter((o) => o !== person);
    const gone = new Set(this.accounts.filter((a) => a.owners.length === 0).map((a) => a.id));
    this.accounts = this.accounts.filter((a) => !gone.has(a.id));
    for (const [k, t] of this.transactions) if (gone.has(t.accountId)) this.transactions.delete(k);
    for (const k of this.balances.keys()) if (gone.has(k.split('|')[0])) this.balances.delete(k);
    for (const id of gone) this.positions.delete(id);
  }
  removed: string[] = [];
  async removeMember(member: Member) {
    this.members = this.members.filter((m) => m.userId !== member.userId);
    this.removed.push(member.userId);
  }
  async getAiUsage(householdId: string, month: string) {
    return this.aiUsage.get(`${householdId}|${month}`) ?? { costMicros: 0, questions: 0 };
  }
  async addAiUsage(householdId: string, month: string, costMicros: number) {
    const k = `${householdId}|${month}`;
    const u = this.aiUsage.get(k) ?? { costMicros: 0, questions: 0 };
    this.aiUsage.set(k, { costMicros: u.costMicros + costMicros, questions: u.questions + 1 });
  }
}
