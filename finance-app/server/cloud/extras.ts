/** Optional route groups, each switched on by its own environment variables. */
import Anthropic from '@anthropic-ai/sdk';
import { DomainClient } from '../providers/domain';
import { agentRoutes } from './agent';
import { domainRoutes } from './domainRoutes';
import type { ExtraRoutes } from './routes';
import type { Repo } from './types';

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function extraRoutesFromProcess(_repo: Repo, env: NodeJS.ProcessEnv = process.env): ExtraRoutes[] {
  const domain = env.DOMAIN_CLIENT_ID && env.DOMAIN_CLIENT_SECRET ? new DomainClient(env.DOMAIN_CLIENT_ID, env.DOMAIN_CLIENT_SECRET) : null;
  const agent = env.ANTHROPIC_API_KEY
    ? { client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 50_000, maxRetries: 1 }), capAud: positive(env.AI_MONTHLY_CAP_AUD, 10), audPerUsd: positive(env.AI_AUD_PER_USD, 1.6) }
    : null;
  return [domainRoutes(domain), agentRoutes(agent)];
}
