/** fetch() that adds the signed-in person's token in the hosted version, and is plain fetch locally. */
import { cloudConfigured } from './config';

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!cloudConfigured()) return fetch(input, init);
  const { supabase } = await import('./client');
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  return fetch(input, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}
