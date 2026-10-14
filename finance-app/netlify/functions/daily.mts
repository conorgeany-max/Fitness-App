/**
 * Daily safety-net sync for every connection (Up's webhooks deliver changes as they happen).
 * Runs at 18:00 UTC, about 4 to 5 am in Sydney. Calls the same route as the API, with the
 * cron secret, so there is one code path.
 */
import { handleCloudRequest } from '../../server/cloud/handler';
import { cloudSetupOnce } from '../../server/cloud/env';
import { extraRoutesFromProcess } from '../../server/cloud/extras';

export default async function daily(): Promise<Response> {
  const setup = cloudSetupOnce((repo) => extraRoutesFromProcess(repo));
  const secret = process.env.CRON_SECRET;
  if (!setup || !secret) return new Response('not configured', { status: 503 });
  return handleCloudRequest(new Request('https://internal/api/cron/daily', { headers: { Authorization: `Bearer ${secret}` } }), setup.env);
}

export const config = { schedule: '0 18 * * *' };
