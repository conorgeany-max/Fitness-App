/**
 * Browser client for the local API server. The browser never sees provider API keys;
 * it only receives consent URLs and sync results.
 */
import type { ObConnectionStatus, ObConsentStart, ObInstitution, ObProviderId, ObProviderInfo, ObSyncPayload } from '@/domain/openBanking';
import type { PersonId } from '@/domain/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError('The local API server is not reachable. Start it with `npm run dev` (or `npm start` in production).', 'offline', 0);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new ApiError('The local API server is not running behind this page. Start it with `npm run dev`.', 'offline', res.status);
  const body = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new ApiError(body.message ?? `Request failed (${res.status})`, body.error ?? 'error', res.status);
  return body;
}

export const api = {
  providers: () => call<{ providers: ObProviderInfo[] }>('/api/ob/providers').then((r) => r.providers),
  institutions: (provider: ObProviderId) => call<{ institutions: ObInstitution[] }>(`/api/ob/institutions?provider=${provider}`).then((r) => r.institutions),
  startConsent: (provider: ObProviderId, owner: PersonId, institutionId: string) =>
    call<ObConsentStart>('/api/ob/consent', { method: 'POST', body: JSON.stringify({ provider, owner, institutionId }) }),
  status: (id: string) => call<ObConnectionStatus>(`/api/ob/connections/${id}/status`),
  sync: (id: string, fromDate: string) => call<ObSyncPayload>(`/api/ob/connections/${id}/sync`, { method: 'POST', body: JSON.stringify({ fromDate }) }),
  revoke: (id: string) => call<{ ok: boolean; warning?: string }>(`/api/ob/connections/${id}`, { method: 'DELETE' }),
};
