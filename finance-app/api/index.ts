/**
 * Vercel function for every /api route (vercel.json rewrites /api/* here).
 * Secrets come from Vercel's environment variables and never reach the browser bundle.
 */
import { cloudEnvFromProcess, type CloudSetup } from '../server/cloud/env';
import { extraRoutesFromProcess } from '../server/cloud/extras';
import { handleCloudRequest } from '../server/cloud/handler';

let setup: CloudSetup | null | undefined;

async function handler(req: Request): Promise<Response> {
  if (setup === undefined) setup = cloudEnvFromProcess(process.env, (repo) => extraRoutesFromProcess(repo));
  return handleCloudRequest(req, setup?.env ?? null);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
