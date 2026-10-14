/**
 * Builds the hosted API's environment from process.env. Returns null when Supabase isn't
 * configured, in which case the local server keeps its single-computer mode.
 */
import type { ExtraRoutes } from './routes';
import { serviceClient, SupabaseRepo } from './supabaseRepo';
import type { CloudEnv } from './routes';
import type { Repo } from './types';

export function publicUrlFrom(env: NodeJS.ProcessEnv): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, '');
  // Netlify sets URL to the site's main address.
  if (env.NETLIFY === 'true' && env.URL) return env.URL.replace(/\/$/, '');
  return `http://localhost:${env.WEB_PORT ?? 5173}`;
}

export function encryptionKeyFrom(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.SERVER_ENCRYPTION_KEY;
  if (!raw) throw new Error('SERVER_ENCRYPTION_KEY is required: `openssl rand -base64 32`.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SERVER_ENCRYPTION_KEY must be 32 bytes, base64-encoded (`openssl rand -base64 32`).');
  return key;
}

/** Decodes a JWT payload without checking it. Only used after Supabase has verified the token. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export interface CloudSetup {
  env: CloudEnv;
  repo: Repo;
}

export function cloudEnvFromProcess(env: NodeJS.ProcessEnv = process.env, extraRoutes: (repo: Repo) => ExtraRoutes[] = () => []): CloudSetup | null {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const db = serviceClient(url, serviceKey);
  const repo = new SupabaseRepo(db);
  const cloud: CloudEnv = {
    repo,
    key: encryptionKeyFrom(env),
    publicUrl: publicUrlFrom(env),
    cronSecret: env.CRON_SECRET || undefined,
    async verifyToken(token) {
      // getUser asks Supabase Auth to validate the token (signature, expiry, revocation).
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return null;
      return { userId: data.user.id, aal: String(jwtClaims(token).aal ?? 'aal1') };
    },
    extraRoutes: extraRoutes(repo),
  };
  return { env: cloud, repo };
}

let cached: CloudSetup | null | undefined;

/** The hosted API's setup, built once per server instance. */
export function cloudSetupOnce(extraRoutes: (repo: Repo) => ExtraRoutes[]): CloudSetup | null {
  if (cached === undefined) cached = cloudEnvFromProcess(process.env, extraRoutes);
  return cached;
}
