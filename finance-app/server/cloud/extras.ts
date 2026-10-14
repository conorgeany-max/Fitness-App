/** Optional route groups, each switched on by its own environment variables. */
import type { ExtraRoutes } from './routes';
import type { Repo } from './types';

export function extraRoutesFromProcess(_repo: Repo, _env: NodeJS.ProcessEnv = process.env): ExtraRoutes[] {
  return [];
}
