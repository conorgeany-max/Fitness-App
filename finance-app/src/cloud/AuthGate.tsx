/**
 * Sign-in for the hosted version: email and password, then a code from an authenticator app
 * (required every time, enforced by the database), then create or join the household.
 * Supabase Auth handles passwords, sessions and the authenticator; this app never sees a
 * password hash or the authenticator secret after enrolment.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Lock, ShieldCheck, Users } from 'lucide-react';
import { Button, Callout, Card, Segmented, TextInput } from '@/components/ui';
import { useApp } from '@/store/store';
import { supabase } from './client';
import { CloudSession, currentMember } from './session';

type Step =
  | { kind: 'checking' }
  | { kind: 'signin' }
  | { kind: 'recovery' }
  | { kind: 'enrol'; factorId: string; qr: string; secret: string }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'household' }
  | { kind: 'opening' };

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          {icon}
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}

const messageOf = (e: unknown, fallback: string) => (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' ? e.message : fallback);

export function AuthGate() {
  const startCloud = useApp((s) => s.startCloud);
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Works out where this person is in the sign-in sequence. */
  const advance = useCallback(async () => {
    const sb = supabase();
    setError(null);
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return setStep({ kind: 'signin' });
    const { data: aal, error: aalError } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) return setStep({ kind: 'signin' });
    if (aal.currentLevel !== 'aal2') {
      const { data: factors, error: fErr } = await sb.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const verified = factors.totp.find((f) => f.status === 'verified');
      if (verified) return setStep({ kind: 'challenge', factorId: verified.id });
      // Clear half-finished enrolments so a fresh QR code can be issued.
      for (const f of factors.all.filter((x) => x.status === 'unverified')) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrol, error: eErr } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
      if (eErr) throw eErr;
      return setStep({ kind: 'enrol', factorId: enrol.id, qr: enrol.totp.qr_code, secret: enrol.totp.secret });
    }
    const member = await currentMember(sb);
    if (!member) return setStep({ kind: 'household' });
    setStep({ kind: 'opening' });
    await startCloud(new CloudSession(sb, member));
  }, [startCloud]);

  useEffect(() => {
    const sb = supabase();
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStep({ kind: 'recovery' });
    });
    advance().catch((e) => {
      setError(messageOf(e, 'Could not reach the server.'));
      setStep({ kind: 'signin' });
    });
    return () => data.subscription.unsubscribe();
  }, [advance]);

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(messageOf(err, 'Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'checking' || step.kind === 'opening')
    return (
      <Shell icon={<Lock className="h-5 w-5 text-accent" />} title={step.kind === 'opening' ? 'Opening your finances…' : 'Checking your sign-in…'}>
        {error && <Callout tone="bad">{error}</Callout>}
      </Shell>
    );

  if (step.kind === 'signin') return <SignIn busy={busy} error={error} notice={notice} run={run} setNotice={setNotice} advance={advance} />;

  if (step.kind === 'recovery') return <Recovery busy={busy} error={error} run={run} advance={advance} />;

  if (step.kind === 'enrol' || step.kind === 'challenge') return <TwoFactor step={step} busy={busy} error={error} run={run} advance={advance} />;

  return <Household busy={busy} error={error} run={run} advance={advance} />;
}

type RunFn = (fn: () => Promise<void>) => (e: FormEvent) => Promise<void>;

function SignIn({ busy, error, notice, run, setNotice, advance }: { busy: boolean; error: string | null; notice: string | null; run: RunFn; setNotice: (s: string) => void; advance: () => Promise<void> }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = run(async () => {
    const sb = supabase();
    if (mode === 'up') {
      if (password.length < 12) throw new Error('Use at least 12 characters for your password.');
      const { data, error: e } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (e) throw e;
      if (!data.session) {
        setNotice('Check your email and open the confirmation link, then sign in here.');
        setMode('in');
        return;
      }
    } else {
      const { error: e } = await sb.auth.signInWithPassword({ email, password });
      if (e) throw e;
    }
    await advance();
  });
  const reset = async () => {
    if (!email) return setNotice('Enter your email first, then choose "Forgot password".');
    await supabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setNotice('If that email has an account, a reset link is on its way.');
  };
  return (
    <Shell icon={<Lock className="h-5 w-5 text-accent" />} title="Household finances">
      <div className="mb-4">
        <Segmented ariaLabel="Sign in or create account" value={mode} onChange={setMode} options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]} />
      </div>
      {notice && (
        <div className="mb-3">
          <Callout tone="info">{notice}</Callout>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput
          label="Password"
          type="password"
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'up' ? 12 : undefined}
          hint={mode === 'up' ? 'At least 12 characters. A password manager is best.' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
        <Button variant="primary" type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy ? 'Please wait…' : mode === 'up' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      {mode === 'in' && (
        <button type="button" className="mt-3 text-sm text-muted underline" onClick={() => void reset()}>
          Forgot password
        </button>
      )}
      <p className="mt-4 text-xs text-muted">Each of you has your own account. You'll set up an authenticator app next; it's needed every time you sign in.</p>
    </Shell>
  );
}

function Recovery({ busy, error, run, advance }: { busy: boolean; error: string | null; run: RunFn; advance: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const submit = run(async () => {
    if (password.length < 12) throw new Error('Use at least 12 characters for your password.');
    const { error: e } = await supabase().auth.updateUser({ password });
    if (e) throw e;
    await advance();
  });
  return (
    <Shell icon={<KeyRound className="h-5 w-5 text-accent" />} title="Choose a new password">
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="New password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy || !password}>
          Save password
        </Button>
      </form>
    </Shell>
  );
}

function TwoFactor({ step, busy, error, run, advance }: { step: Extract<Step, { kind: 'enrol' | 'challenge' }>; busy: boolean; error: string | null; run: RunFn; advance: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const submit = run(async () => {
    const { error: e } = await supabase().auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.replace(/\s/g, '') });
    if (e) throw new Error(e.message.includes('Invalid') ? "That code didn't match. Use the newest code from your authenticator app." : e.message);
    await advance();
  });
  return (
    <Shell icon={<ShieldCheck className="h-5 w-5 text-accent" />} title={step.kind === 'enrol' ? 'Set up two-factor sign-in' : 'Enter your 6-digit code'}>
      {step.kind === 'enrol' && (
        <div className="mb-4 space-y-3 text-sm">
          <p className="text-muted">Scan this with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator or similar), then enter the code it shows.</p>
          <img src={step.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded bg-white p-2" />
          <p className="text-muted">
            Can't scan? Enter this key instead: <code className="break-all">{step.secret}</code>
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} error={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>
      <button type="button" className="mt-3 text-sm text-muted underline" onClick={() => void supabase().auth.signOut().then(advance)}>
        Sign out
      </button>
    </Shell>
  );
}

function Household({ busy, error, run, advance }: { busy: boolean; error: string | null; run: RunFn; advance: () => Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const submit = run(async () => {
    const sb = supabase();
    const { error: e } = mode === 'create' ? await sb.rpc('create_household', { p_display_name: name }) : await sb.rpc('join_household', { p_code: code, p_display_name: name });
    if (e) throw e;
    await advance();
  });
  return (
    <Shell icon={<Users className="h-5 w-5 text-accent" />} title="Your household">
      <div className="mb-4">
        <Segmented ariaLabel="Create or join a household" value={mode} onChange={setMode} options={[{ value: 'create', label: "I'm first" }, { value: 'join', label: 'I have an invite code' }]} />
      </div>
      <p className="mb-3 text-sm text-muted">
        {mode === 'create' ? "Start your household. You'll get an invite code for your partner in Settings." : 'Enter the code your partner gave you. Codes work once and expire after 7 days.'}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Your first name" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
        {mode === 'join' && <TextInput label="Invite code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />}
        {error && <Callout tone="bad">{error}</Callout>}
        <Button variant="primary" type="submit" className="w-full" disabled={busy || !name.trim() || (mode === 'join' && !code.trim())}>
          {mode === 'create' ? 'Create household' : 'Join household'}
        </Button>
      </form>
    </Shell>
  );
}
