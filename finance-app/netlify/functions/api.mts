/**
 * Netlify function for every /api route. Secrets come from the site's environment variables
 * and never reach the browser bundle.
 */
import { cloudSetupOnce } from '../../server/cloud/env';
import { extraRoutesFromProcess } from '../../server/cloud/extras';
import { handleCloudRequest } from '../../server/cloud/handler';

export default async function handler(req: Request): Promise<Response> {
  return handleCloudRequest(req, cloudSetupOnce((repo) => extraRoutesFromProcess(repo))?.env ?? null);
}

export const config = { path: '/api/*' };
