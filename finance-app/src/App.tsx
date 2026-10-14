import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Layout } from './components/Layout';
import { Button, Callout, Card, Skeleton, TextInput, Toaster } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useApp } from './store/store';
import Home from './pages/Home';

const NetWorth = lazy(() => import('./pages/NetWorth'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Forecasts = lazy(() => import('./pages/Forecasts'));
const Property = lazy(() => import('./pages/Property'));
const Tools = lazy(() => import('./pages/Tools'));
const Settings = lazy(() => import('./pages/Settings'));
const Ask = lazy(() => import('./pages/Ask'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const AuthGate = lazy(() => import('./cloud/AuthGate').then((m) => ({ default: m.AuthGate })));

function useTheme() {
  const theme = useApp((s) => s.data.settings.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

function UnlockScreen() {
  const unlock = useApp((s) => s.unlock);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-full place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-semibold">Unlock your finances</h1>
        </div>
        <p className="mb-4 text-sm text-muted">Your data is encrypted on this device. Enter your passphrase to decrypt it.</p>
        <form onSubmit={submit} className="space-y-3">
          <TextInput label="Passphrase" type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} error={error} />
          <Button variant="primary" type="submit" className="w-full" disabled={busy || !pass}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const init = useApp((s) => s.init);
  const onboarded = useApp((s) => s.data.settings.onboarded);
  useTheme();
  useEffect(() => {
    void init();
  }, [init]);

  if (status === 'loading')
    return (
      <div className="p-6">
        <PageFallback />
      </div>
    );
  if (status === 'auth')
    return (
      <Suspense fallback={<div className="p-6"><PageFallback /></div>}>
        <AuthGate />
      </Suspense>
    );
  if (status === 'locked') return <UnlockScreen />;
  if (status === 'error')
    return (
      <div className="mx-auto max-w-lg p-6">
        <Callout tone="bad" title="Could not open local storage">
          {error} Private browsing modes and some browser settings block IndexedDB, which this app needs to keep your data on this device.
        </Callout>
      </div>
    );

  return (
    <>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={onboarded ? <Home /> : <Navigate to="/welcome" replace />} />
              <Route path="/welcome" element={<Onboarding />} />
              <Route path="/net-worth" element={<NetWorth />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/forecasts" element={<Forecasts />} />
              <Route path="/property" element={<Property />} />
              <Route path="/tools" element={<Tools />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/ask" element={<Ask />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
      <Toaster />
    </>
  );
}
