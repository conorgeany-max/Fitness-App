import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { buildFacts, type Fact } from '@/domain/agentFacts';
import { reportableTransactions, useDerived, usePerspective } from '@/store/derived';
import { cloudSession, useApp } from '@/store/store';
import { api } from '@/cloud/client';
import { Button, Callout, Card, Disclosure, PageHeader, ProgressBar, TextArea, Toggle, toast } from '@/components/ui';

interface Status {
  available: boolean;
  enabled: boolean;
  capAud: number;
  spentAud: number;
  questions: number;
}

interface Answer {
  ok: boolean;
  answer?: string;
  message?: string;
  figuresUsed?: string[];
  removedNumbers?: number;
  missing?: string[];
  spentAud: number;
  capAud: number;
}

const showFact = (f: Fact) =>
  f.kind === 'money' ? `$${Math.round((f.value as number) / 100).toLocaleString('en-AU')}` : f.kind === 'percent' ? `${((f.value as number) * 100).toFixed(1)}%` : String(f.value);

export default function Ask() {
  const cloud = useApp((s) => s.mode === 'cloud');
  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader title="Ask the assistant" subtitle="Questions about your own numbers, answered in plain English." />
      {cloud ? <Assistant /> : <Callout tone="info">The assistant is part of the online version, where it runs on the server with a monthly spending limit. This copy keeps everything on this device.</Callout>}
    </div>
  );
}

function Assistant() {
  const data = useApp((s) => s.data);
  const d = useDerived();
  const perspective = usePerspective();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ q: string; a: Answer }[]>([]);
  const facts = useMemo(() => buildFacts(data, d, perspective, reportableTransactions(data)), [data, d, perspective]);

  const load = () =>
    api<Status>('/api/agent/status')
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const setEnabled = async (on: boolean) => {
    const s = cloudSession();
    if (!s) return;
    const { data: u } = await s.sb.auth.getUser();
    const { error: e } = await s.sb.from('members').update({ ai_enabled: on }).eq('user_id', u.user?.id ?? '');
    if (e) return toast(e.message, 'bad');
    await load();
  };

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    try {
      const a = await api<Answer>('/api/agent/ask', { body: { question: q, facts } });
      setAnswers((x) => [{ q, a }, ...x]);
      setQuestion('');
      setStatus((s) => (s ? { ...s, spentAud: a.spentAud, questions: s.questions + 1 } : s));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Callout tone="bad">{error}</Callout>;
  if (!status) return null;
  if (!status.available) return <Callout tone="info">The assistant isn't set up on this server yet. docs/DEPLOY.md explains how to add an Anthropic API key.</Callout>;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5 text-sm">
        <Toggle checked={status.enabled} onChange={(v) => void setEnabled(v)} label="Turn the assistant on for me" hint="Only affects you. Your partner decides for themselves." />
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>It only sees the totals listed below, worked out from what you can already see. Never account names, numbers, transactions, logins or bank tokens.</li>
          <li>It can't fetch anything, change anything or move money.</li>
          <li>Every number in an answer is written in by the app from your data. If the assistant types a number itself, the app removes it.</li>
          <li>Questions go to Anthropic's paid API, which doesn't use them to train models.</li>
        </ul>
        <div>
          <ProgressBar value={Math.min(1, status.spentAud / status.capAud)} tone={status.spentAud / status.capAud > 0.8 ? 'warn' : 'accent'} label={`A$${status.spentAud.toFixed(2)} of A$${status.capAud.toFixed(2)} used this month`} />
          <p className="mt-1 text-xs text-muted">A${status.spentAud.toFixed(2)} of A${status.capAud.toFixed(2)} used this month. A hard limit shared by the household. Questions stop when it's reached and start again on the 1st.</p>
        </div>
        <Disclosure summary={`The ${facts.length} figures it can see (${perspective === 'household' ? 'household view' : `${d.names[perspective]}'s view`})`}>
          <ul className="grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
            {facts.map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <span className="text-muted">{f.label}</span>
                <span className="num">{showFact(f)}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </Card>

      {status.enabled && (
        <Card className="p-5">
          <form onSubmit={ask} className="space-y-3">
            <TextArea label="Your question" rows={3} maxLength={1000} placeholder="Are we saving enough? What's our biggest spending area? How far are we from our house deposit goal?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            <Button variant="primary" type="submit" icon={<Sparkles className="h-4 w-4" />} disabled={busy || !question.trim()}>
              {busy ? 'Thinking…' : 'Ask'}
            </Button>
          </form>
        </Card>
      )}

      {answers.map(({ q, a }, i) => (
        <Card key={i} className="space-y-2 p-5 text-sm">
          <p className="font-medium">{q}</p>
          {a.ok ? (
            <>
              <p className="whitespace-pre-line leading-relaxed text-ink-2">{a.answer}</p>
              {!!a.removedNumbers && <p className="text-xs text-warn">{a.removedNumbers} number{a.removedNumbers === 1 ? '' : 's'} the assistant wrote itself {a.removedNumbers === 1 ? 'was' : 'were'} removed, because only figures from your data are shown.</p>}
              {!!a.missing?.length && <p className="text-xs text-muted">Would need: {a.missing.join('; ')}</p>}
              {!!a.figuresUsed?.length && <p className="text-xs text-muted">Figures used: {a.figuresUsed.join(', ')}</p>}
            </>
          ) : (
            <Callout tone="warn">{a.message}</Callout>
          )}
          <p className="text-xs text-muted">General information, not financial advice.</p>
        </Card>
      ))}
    </div>
  );
}
