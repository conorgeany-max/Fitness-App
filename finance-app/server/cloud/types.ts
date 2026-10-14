/**
 * Server-side shapes for the hosted (cloud) version. Rows mirror supabase/migrations.
 * Nothing in here is sent to the browser except through the routes, which strip secrets.
 */
import type { ObAccount, ObTransaction } from '../../src/domain/openBanking';

export type Person = 'me' | 'partner';
export type CloudProvider = 'up' | 'snaptrade';
export type Visibility = 'shared' | 'private';

export interface Member {
  userId: string;
  householdId: string;
  person: Person;
  displayName: string;
  aiEnabled: boolean;
}

export interface ConnectionRow {
  id: string;
  householdId: string;
  person: Person;
  provider: CloudProvider;
  /** AES-256-GCM ciphertext of the provider token (Up) or user secret (SnapTrade). */
  secretCiphertext: string;
  webhookId: string | null;
  webhookSecretCiphertext: string | null;
  newAccountVisibility: Visibility;
  status: 'pending' | 'active' | 'error' | 'revoked';
  statusMessage: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface AccountUpsert {
  provider: CloudProvider;
  owner: Person;
  joint: boolean;
  /** Used only when the account is seen for the first time. Joint accounts are always shared. */
  defaultVisibility: Visibility;
  institution: string;
  account: ObAccount;
}

export interface Position {
  symbol: string;
  description: string | null;
  units: number;
  priceCents: number | null;
  valueCents: number | null;
  currency: string;
}

/** Everything the server stores. Implemented by Supabase in production and in memory for tests. */
export interface Repo {
  memberByUser(userId: string): Promise<Member | null>;
  getConnection(id: string): Promise<ConnectionRow | null>;
  findConnection(householdId: string, person: Person, provider: CloudProvider): Promise<ConnectionRow | null>;
  listConnections(filter?: { status?: ConnectionRow['status'] }): Promise<ConnectionRow[]>;
  insertConnection(row: Omit<ConnectionRow, 'id' | 'createdAt'>): Promise<ConnectionRow>;
  updateConnection(id: string, patch: Partial<Omit<ConnectionRow, 'id' | 'householdId' | 'person' | 'provider'>>): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  /** Insert or refresh an account; adds the owner when a second person's connection reports it. Returns the row id. */
  upsertAccount(householdId: string, a: AccountUpsert): Promise<string>;
  recordBalance(accountId: string, date: string, balanceCents: number): Promise<void>;
  upsertTransactions(accountId: string, txns: ObTransaction[]): Promise<void>;
  deleteTransaction(householdId: string, provider: CloudProvider, externalId: string): Promise<void>;
  replacePositions(accountId: string, positions: Position[]): Promise<void>;
  /** Removes the person from accounts their connection reported; deletes accounts nobody reports any more. */
  releaseAccounts(householdId: string, provider: CloudProvider, person: Person): Promise<void>;
  getAiUsage(householdId: string, month: string): Promise<{ costMicros: number; questions: number }>;
  addAiUsage(householdId: string, month: string, costMicros: number): Promise<void>;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
