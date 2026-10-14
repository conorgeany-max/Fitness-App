/**
 * The browser's Supabase client. Only the public URL and the anon key are used here; both are
 * safe to ship because every table is protected by row level security that also requires
 * two-factor sign-in. Provider tokens and the service key exist only on the server.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export { cloudConfigured } from './config';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error('Supabase is not configured for this build.');
  client ??= createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

/** Calls the app's own API with the signed-in person's access token. */
export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return body;
}
