/** Optional route groups, each switched on by its own environment variables. */
import { DomainClient } from '../providers/domain';
import { domainRoutes } from './domainRoutes';
import type { ExtraRoutes } from './routes';
import type { Repo } from './types';

export function extraRoutesFromProcess(_repo: Repo, env: NodeJS.ProcessEnv = process.env): ExtraRoutes[] {
  const domain = env.DOMAIN_CLIENT_ID && env.DOMAIN_CLIENT_SECRET ? new DomainClient(env.DOMAIN_CLIENT_ID, env.DOMAIN_CLIENT_SECRET) : null;
  return [domainRoutes(domain)];
}
