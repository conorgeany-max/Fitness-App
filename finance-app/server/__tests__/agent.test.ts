import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentRoutes, renderAnswer, validateFacts, type AgentConfig, type AgentFact } from '../cloud/agent';
import { MemoryRepo } from '../cloud/memoryRepo';
import { cloudApi, errorResponse, type CloudEnv } from '../cloud/routes';

const FACTS: AgentFact[] = [
  { id: 'net_worth', label: 'Household net worth', kind: 'money', value: 123_456_78 },
  { id: 'savings_rate', label: 'Share of income not spent', kind: 'percent', value: 0.215 },
];

function setup(reply: string | { stop_reason: string }, aiEnabled = true, capAud = 10) {
  const repo = new MemoryRepo();
  repo.members.push({ userId: 'u', householdId: 'h', person: 'me', displayName: 'A', aiEnabled });
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          sent.push(params);
          const stop = typeof reply === 'string' ? 'end_turn' : reply.stop_reason;
          return { content: typeof reply === 'string' ? [{ type: 'text', text: reply }] : [], stop_reason: stop, usage: { input_tokens: 2000, output_tokens: 500 } };
        },
      },
    },
  } as unknown as AgentConfig['client'];
  const cfg: AgentConfig = { client, capAud, audPerUsd: 1.6, now: () => new Date('2026-10-14T00:00:00Z') };
  const env: CloudEnv = { repo, key: randomBytes(32), publicUrl: 'https://x', verifyToken: async () => ({ userId: 'u', aal: 'aal2' }), extraRoutes: [agentRoutes(cfg)] };
  const ask = async (body: unknown) => {
    let res: Response | null;
    try {
      res = await cloudApi(new Request('http://localhost/api/agent/ask', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) }), env);
    } catch (e) {
      res = errorResponse(e);
    }
    return { status: res!.status, body: (await res!.json()) as Record<string, unknown> };
  };
  return { repo, sent, ask };
}

describe('AI assistant', () => {
  it('fills in figures and removes any amount the model wrote itself', () => {
    const r = renderAnswer('You have {{net_worth}}, about $5,000 more than last year, saving {{savings_rate}} (or 30% by my maths). {{nope}}', FACTS);
    expect(r.answer).toBe('You have $123,457, about [figure removed] more than last year, saving 21.5% (or [figure removed] by my maths). [unknown figure]');
    expect(r.removed).toBe(2);
    expect(r.used).toEqual(['Household net worth', 'Share of income not spent']);
  });

  it('removes bare numbers and spelled-out amounts, but keeps placeholders with digits in their ids', () => {
    const facts: AgentFact[] = [{ id: 'goal_1_target', label: 'Goal target', kind: 'money', value: 5_000_000 }];
    const r = renderAnswer('Target {{goal_1_target}}; you have 48,000 dollars, or 1.2k, or 90000 in 3 accounts.', facts);
    expect(r.answer).toBe('Target $50,000; you have [figure removed], or [figure removed], or [figure removed] in [figure removed] accounts.');
    expect(r.removed).toBe(4);
  });

  it('rejects malformed figures', () => {
    expect(() => validateFacts([{ id: 'Bad Id', label: 'x', kind: 'money', value: 1 }])).toThrow();
    expect(() => validateFacts([{ id: 'a', label: 'x', kind: 'money', value: 'lots' }])).toThrow();
    expect(() => validateFacts([])).toThrow();
  });

  it('answers with the app figures, sends only totals, and records the cost', async () => {
    const s = setup(JSON.stringify({ answer: 'Your net worth is {{net_worth}}.', missing: [] }));
    const r = await s.ask({ question: 'How are we doing?', facts: FACTS });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, answer: 'Your net worth is $123,457.' });
    const p = s.sent[0];
    expect(p).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    expect(p.tools).toBeUndefined();
    // 2000 in at $5/M + 500 out at $25/M = US$0.0225 -> A$0.036
    expect(s.repo.aiUsage.get('h|2026-10')).toEqual({ costMicros: 36_000, questions: 1 });
  });

  it('is off until the person turns it on', async () => {
    const s = setup('{}', false);
    expect((await s.ask({ question: 'Hi', facts: FACTS })).status).toBe(403);
    expect(s.sent).toHaveLength(0);
  });

  it('refuses before calling the model when a question could pass the monthly ceiling', async () => {
    const s = setup(JSON.stringify({ answer: 'ok', missing: [] }), true, 10);
    s.repo.aiUsage.set('h|2026-10', { costMicros: 9_900_000, questions: 50 });
    const r = await s.ask({ question: 'Hi', facts: FACTS });
    expect(r.status).toBe(429);
    expect(String(r.body.message)).toMatch(/A\$10\.00 limit/);
    expect(s.sent).toHaveLength(0);
  });

  it('lets only one of two simultaneous questions through when there is room for one', async () => {
    const s = setup(JSON.stringify({ answer: 'ok', missing: [] }), true, 10);
    s.repo.aiUsage.set('h|2026-10', { costMicros: 9_700_000, questions: 50 });
    const [a, b] = await Promise.all([s.ask({ question: 'One', facts: FACTS }), s.ask({ question: 'Two', facts: FACTS })]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(s.sent).toHaveLength(1);
    expect(s.repo.aiUsage.get('h|2026-10')!.costMicros).toBeLessThanOrEqual(10_000_000);
  });

  it('reports a refusal plainly', async () => {
    const s = setup({ stop_reason: 'refusal' });
    const r = await s.ask({ question: 'Hi', facts: FACTS });
    expect(r.body).toMatchObject({ ok: false });
  });
});
