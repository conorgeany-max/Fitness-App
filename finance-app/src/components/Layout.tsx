import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Building2, Calculator, Cloud, CloudOff, Home, LineChart, Menu, Moon, PiggyBank, Receipt, Settings as SettingsIcon, Sun, Wallet, X, Sparkles } from 'lucide-react';
import { useApp } from '@/store/store';
import { useDerived } from '@/store/derived';
import type { Perspective } from '@/domain/types';
import { Segmented, cx } from './ui';

export const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/net-worth', label: 'Net Worth', icon: Wallet },
  { to: '/transactions', label: 'Transactions & Budget', short: 'Budget', icon: Receipt },
  { to: '/forecasts', label: 'Forecasts', icon: LineChart },
  { to: '/property', label: 'Property & Mortgages', short: 'Property', icon: Building2 },
  { to: '/tools', label: 'Financial Tools', short: 'Tools', icon: Calculator },
  { to: '/ask', label: 'Ask the assistant', short: 'Ask', icon: Sparkles },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function PerspectiveSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const perspective = useApp((s) => s.ui.perspective);
  const setPerspective = useApp((s) => s.setPerspective);
  const { names } = useDerived();
  return (
    <Segmented<Perspective>
      ariaLabel="Whose finances to show"
      size={size}
      value={perspective}
      onChange={setPerspective}
      options={[
        { value: 'me', label: names.me },
        { value: 'partner', label: names.partner },
        { value: 'household', label: 'Household' },
      ]}
    />
  );
}

function SaveIndicator() {
  const saving = useApp((s) => s.ui.saving);
  const err = useApp((s) => s.ui.saveError);
  if (saving === 'error')
    return (
      <span className="flex items-center gap-1 text-xs text-bad" title={err ?? ''}>
        <CloudOff className="h-3.5 w-3.5" /> Not saved
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-muted" aria-live="polite">
      <Cloud className="h-3.5 w-3.5" /> {saving === 'saving' ? 'Saving…' : 'Saved on this device'}
    </span>
  );
}

function ThemeToggle() {
  const theme = useApp((s) => s.data.settings.theme);
  const update = useApp((s) => s.updateSettings);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return (
    <button type="button" onClick={() => update({ theme: dark ? 'light' : 'dark' })} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent">
        <PiggyBank className="h-4 w-4" aria-hidden />
      </div>
      <div>
        <div className="text-sm font-semibold tracking-tight">Ledgerline</div>
        <div className="text-2xs text-muted">Household finance</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const kind = useApp((s) => s.data.kind);
  const switchWorkspace = useApp((s) => s.switchWorkspace);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface/60 px-3 py-4 backdrop-blur lg:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col gap-0.5" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-surface-3 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink')}
            >
              <n.icon className="h-4 w-4" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line px-2 pt-3">
          <SaveIndicator />
          <p className="text-2xs leading-relaxed text-muted">Educational estimates only — not financial, tax or credit advice.</p>
        </div>
      </aside>

      <div className="lg:pl-60">
        {kind === 'demo' && (
          <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-demo px-4 py-1.5 text-center text-xs font-medium text-white">
            Demo mode — every figure is fictional sample data, not your finances.
            <button type="button" onClick={() => switchWorkspace('real')} className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30">
              Exit demo
            </button>
          </div>
        )}
        <header className={cx('sticky z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 py-2.5 backdrop-blur sm:px-6', kind === 'demo' ? 'top-[30px] sm:top-[28px]' : 'top-0')}>
          <div className="flex items-center gap-2 lg:hidden">
            <button type="button" className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold">Ledgerline</span>
          </div>
          <div className="hidden sm:block">
            <PerspectiveSwitch size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block lg:hidden">
              <SaveIndicator />
            </div>
            <ThemeToggle />
          </div>
        </header>
        <div className="border-b border-line px-4 py-2 sm:hidden">
          <PerspectiveSwitch size="sm" />
        </div>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
        {NAV.slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-accent' : 'text-muted')}>
            <n.icon className="h-5 w-5" aria-hidden />
            {n.short ?? n.label}
          </NavLink>
        ))}
      </nav>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="h-full w-72 border-r border-line bg-surface p-4 animate-fade-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Menu">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-muted hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="mt-6 flex flex-col gap-0.5" aria-label="All sections">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium', isActive ? 'bg-surface-3 text-ink' : 'text-ink-2')}>
                  <n.icon className="h-4 w-4" aria-hidden />
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-6 px-2">
              <SaveIndicator />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
