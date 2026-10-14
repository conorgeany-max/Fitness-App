/**
 * The AI assistant. Read-only and figures-only:
 * - It receives totals the app already computed for the person asking (never accounts,
 *   transactions, account numbers or tokens) and has no tools, so it can't fetch or change anything.
 * - It must refer to figures by id; the server writes the numbers in. Any number it writes
 *   itself is removed before the answer is shown, so it can't invent a balance.
 * - Each person turns it on for themselves, and the household has a hard monthly ceiling:
 *   a question is refused if its worst-case cost could take the month past the ceiling.
 */
import Anthropic from '@anthropic-ai/sdk';
import { json, readJson } from './http';
import { limit, type ExtraRoutes } from './routes';
import { HttpError } from './types';

export const AGENT_MODEL = 'claude-opus-5-5';
const MAX_OUTPUT_TOKENS = 6000;
const MAX_FACTS = 120;
// Priced at the highest rate of the model or its possible fallbacks, so the ceiling is never exceeded.
const USD_PER_INPUT_TOKEN = 5 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 25 / 1_000_000;

export interface AgentFact {
  id: string;
  label: string;
  kind: 'money' | 'percent' | 'count' | 'months' | 'date';
  value: number | string;
}

export interface AgentConfig {
  client: Pick<Anthropic, 'beta'>;
  /** Monthly ceiling for the household, in Australian dollars. */
  capAud: number;
  /** Australian dollars per US dollar, for converting the API's US-dollar prices. Kept high on purpose. */
  audPerUsd: number;
  now?: () => Date;
}

export function validateFacts(raw: unknown): AgentFact[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'no_facts', 'There are no figures to answer from yet.');
  if (raw.length > MAX_FACTS) throw new HttpError(400, 'too_many_facts', 'Too many figures.');
  const seen = new Set<string>();
  return raw.map((f) => {
    const x = (f ?? {}) as Record<string, unknown>;
    const id = typeof x.id === 'string' && /^[a-z0-9_]{1,40}$/.test(x.id) ? x.id : null;
    const label = typeof x.label === 'string' && x.label.length <= 160 ? x.label.replace(/[{}<>]/g, '') : null;
    const kind = ['money', 'percent', 'count', 'months', 'date'].includes(x.kind as string) ? (x.kind as AgentFact['kind']) : null;
    const value = kind === 'date' ? (typeof x.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.value) ? x.value : null) : typeof x.value === 'number' && Number.isFinite(x.value) && Math.abs(x.value) < 1e13 ? x.value : null;
    if (!id || !label || !kind || value === null || seen.has(id)) throw new HttpError(400, 'bad_fact', 'A figure was malformed.');
    seen.add(id);
    return { id, label, kind, value };
  });
}

export function formatFact(f: AgentFact): string {
  const v = f.value;
  if (f.kind === 'date') return new Date(`${v}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const n = v as number;
  if (f.kind === 'money') return `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n) / 100).toLocaleString('en-AU')}`;
  if (f.kind === 'percent') return `${(n * 100).toFixed(1)}%`;
  if (f.kind === 'months') return `${n} month${n === 1 ? '' : 's'}`;
  return n.toLocaleString('en-AU');
}

// Any number the model writes itself (with or without $, %, "dollars" or "k") is removed. Only
// {{id}} placeholders, filled from the app's figures, can put a number in an answer.
const NUMBER = /(?:A?\$|AUD\s?)?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|thousand|dollars?|bucks|%|per\s?cent|percent)\b|%)?/gi;
const PLACEHOLDER = /\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g;

function scrubNumbers(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(NUMBER, (m) => {
    removed++;
    return `${/^\s/.test(m) ? ' ' : ''}[figure removed]`;
  });
  return { text: out, removed };
}

/** Puts the app's figures into the answer and strips any number the model wrote itself. */
export function renderAnswer(text: string, facts: AgentFact[]): { answer: string; used: string[]; removed: number } {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const used = new Set<string>();
  let removed = 0;
  // Scrub only the text between placeholders (ids contain digits), then insert our figures.
  const parts = text.split(PLACEHOLDER);
  const answer = parts
    .map((part, i) => {
      if (i % 2 === 0) {
        const s = scrubNumbers(part);
        removed += s.removed;
        return s.text;
      }
      const f = byId.get(part);
      if (!f) return '[unknown figure]';
      used.add(f.label);
      return formatFact(f);
    })
    .join('');
  return { answer, used: [...used], removed };
}

const SYSTEM = `You help a couple in Australia understand their own finances, using only the figures the app gives you.

How to write figures: never type a number of any kind yourself (amounts, percentages, counts, balances or dates); the app deletes any you write. Refer to a figure only by writing its id in double braces, for example {{net_worth}}; the app replaces it with the exact value. You may compare figures in words ("more than", "about half"), but you cannot calculate new numbers, so don't state sums, differences or projections. If the question needs a figure you weren't given, say which one is missing and how they could add it in the app.

Scope: explain and compare what the figures show, point out what looks notable, and suggest general things they could look into. This is general information, not personal financial, tax or credit advice; don't recommend specific financial products, and suggest a licensed adviser for decisions that need one. You can't see individual accounts or transactions and can't move money or change anything.

Style: plain, warm, direct. Short paragraphs, no headings. Under 200 words unless the question needs more.`;

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The reply, with figures written only as {{id}} placeholders.' },
    missing: { type: 'array', items: { type: 'string' }, description: 'Figures that would be needed but were not provided.' },
  },
  required: ['answer', 'missing'],
  additionalProperties: false,
} as const;

const month = (d: Date) => d.toISOString().slice(0, 7);
const toAudMicros = (usd: number, audPerUsd: number) => Math.ceil(usd * audPerUsd * 1_000_000);

export function agentRoutes(cfg: AgentConfig | null): ExtraRoutes {
  return async (req, url, { env, member }) => {
    if (url.pathname === '/api/agent/status' && req.method === 'GET') {
      const m = await member();
      const usage = await env.repo.getAiUsage(m.householdId, month(cfg?.now?.() ?? new Date()));
      return json(200, { available: !!cfg, enabled: m.aiEnabled, capAud: cfg?.capAud ?? 0, spentAud: usage.costMicros / 1_000_000, questions: usage.questions });
    }
    if (url.pathname !== '/api/agent/ask' || req.method !== 'POST') return null;

    const m = await member();
    if (!cfg) throw new HttpError(404, 'not_configured', 'The assistant is not set up on this server.');
    if (!m.aiEnabled) throw new HttpError(403, 'ai_off', 'Turn the assistant on for yourself first.');
    limit(env, `agent:${m.householdId}`, 6, 'Too many questions in a row. Wait a minute.');

    const body = await readJson<{ question?: unknown; facts?: unknown }>(req);
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 1000) throw new HttpError(400, 'bad_question', 'Ask a question of up to 1000 characters.');
    const facts = validateFacts(body.facts);

    const factText = JSON.stringify(facts.map((f) => ({ id: f.id, label: f.label, value: formatFact(f) })));
    const thisMonth = month(cfg.now?.() ?? new Date());
    const capMicros = Math.round(cfg.capAud * 1_000_000);
    // Worst case: every input character a token, plus the full output allowance. Reserved
    // atomically before the call, so simultaneous questions can't pass the ceiling together.
    const worst = toAudMicros((SYSTEM.length + factText.length + question.length + 2000) * USD_PER_INPUT_TOKEN + MAX_OUTPUT_TOKENS * USD_PER_OUTPUT_TOKEN, cfg.audPerUsd);
    if (!(await env.repo.reserveAiUsage(m.householdId, thisMonth, worst, capMicros))) {
      throw new HttpError(429, 'ai_cap', `This month's A$${cfg.capAud.toFixed(2)} limit for the assistant has been reached. It resets on the 1st.`);
    }

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await cfg.client.beta.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Figures (id, what it is, value):\n${factText}\n\nQuestion: ${question}` }],
      });
    } catch (e) {
      // A failed request may still have been billed if it timed out mid-answer, so only clear
      // refusals before the model ran are refunded; anything else keeps the reservation.
      if (e instanceof Anthropic.APIError && e.status !== undefined && e.status < 500) await env.repo.settleAiUsage(m.householdId, thisMonth, -worst, -1);
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy', 'The assistant is busy. Try again in a minute.');
      if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'ai_key', "The assistant's API key was rejected. Check ANTHROPIC_API_KEY.");
      if (e instanceof Anthropic.APIError) throw new HttpError(502, 'ai_error', 'The assistant had a problem. Try again shortly.');
      throw new HttpError(502, 'ai_unreachable', "Couldn't reach the assistant. Try again shortly.");
    }

    const u = res.usage;
    const inTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const cost = toAudMicros(inTokens * USD_PER_INPUT_TOKEN + u.output_tokens * USD_PER_OUTPUT_TOKEN, cfg.audPerUsd);
    await env.repo.settleAiUsage(m.householdId, thisMonth, cost - worst, 0);
    const spentAud = (await env.repo.getAiUsage(m.householdId, thisMonth)).costMicros / 1_000_000;

    if (res.stop_reason === 'refusal') return json(200, { ok: false, message: "The assistant couldn't help with that question. Try asking it differently.", spentAud, capAud: cfg.capAud });
    if (res.stop_reason === 'max_tokens') return json(200, { ok: false, message: 'The answer ran too long. Try a narrower question.', spentAud, capAud: cfg.capAud });
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: { answer?: unknown; missing?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return json(200, { ok: false, message: 'The assistant returned an unreadable answer. Try again.', spentAud, capAud: cfg.capAud });
    }
    const rendered = renderAnswer(typeof parsed.answer === 'string' ? parsed.answer : '', facts);
    const missing = Array.isArray(parsed.missing) ? parsed.missing.filter((x): x is string => typeof x === 'string').slice(0, 5).map((s) => scrubNumbers(s.replace(PLACEHOLDER, '')).text) : [];
    return json(200, { ok: true, answer: rendered.answer, figuresUsed: rendered.used, removedNumbers: rendered.removed, missing, spentAud, capAud: cfg.capAud });
  };
}
