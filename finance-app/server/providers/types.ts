import type { ObConnectionStatus, ObInstitution, ObProviderInfo, ObSyncPayload } from '../../src/domain/openBanking';

/** What the server remembers about a connection. Stored encrypted at rest; never sent to the browser. */
export interface ConnectionRecord {
  id: string;
  provider: 'mock' | 'basiq';
  owner: 'me' | 'partner';
  institutionId: string;
  institutionName: string;
  createdAt: string;
  /** Provider-side identifiers (e.g. Basiq user id, connection id). */
  providerUserId?: string;
  providerConnectionId?: string;
  consentExpiresAt?: string;
  revoked?: boolean;
}

export interface StartConsentResult {
  record: ConnectionRecord;
  consentUrl: string | null;
}

/**
 * One adapter per accredited data recipient / intermediary. Adapters run only on the
 * server: API keys never reach the browser, and no adapter ever handles bank passwords.
 */
export interface ProviderAdapter {
  info(): ObProviderInfo;
  institutions(): Promise<ObInstitution[]>;
  /** Begin consent. Returns the provider-hosted consent URL (or null for the in-app mock flow). */
  startConsent(input: { connectionId: string; owner: 'me' | 'partner'; institutionId: string; existingUserId?: string }): Promise<StartConsentResult>;
  status(record: ConnectionRecord): Promise<ObConnectionStatus>;
  sync(record: ConnectionRecord, opts: { fromDate: string }): Promise<ObSyncPayload>;
  /** Revoke consent at the provider and forget provider-side data where the provider allows it. */
  revoke(record: ConnectionRecord): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly code = 'provider_error',
  ) {
    super(message);
  }
}
