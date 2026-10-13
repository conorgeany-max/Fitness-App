/**
 * Accessible UI primitives built on the design tokens in index.css.
 */
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, Info, X } from 'lucide-react';
import { formatMoney, parseMoney, type Cents } from '@/domain/money';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Button
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent/90',
        variant === 'secondary' && 'border border-line bg-surface-2 text-ink hover:bg-surface-3',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'subtle' && 'bg-accent/10 text-accent hover:bg-accent/15',
        variant === 'danger' && 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card
export function Card({ className, children, as: As = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <As {...rest} className={cx('rounded-2xl border border-line/70 bg-surface shadow-card', className)}>
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-5 pt-4', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 pb-5 pt-3', className)}>{children}</div>;
}

// ---------------------------------------------------------------- Page header
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------- Badges
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'demo';
export function Badge({ tone = 'neutral', children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-3/60 text-ink-2 ring-line',
        tone === 'good' && 'bg-good/10 text-good ring-good/25',
        tone === 'warn' && 'bg-warn/10 text-warn ring-warn/25',
        tone === 'bad' && 'bg-bad/10 text-bad ring-bad/25',
        tone === 'info' && 'bg-info/10 text-info ring-info/25',
        tone === 'accent' && 'bg-accent/10 text-accent ring-accent/25',
        tone === 'demo' && 'bg-demo/15 text-demo ring-demo/30',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Inputs
const inputBase =
  'h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-2xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const input = <input id={id} {...rest} className={cx(inputBase, error && 'border-bad', !label && className)} aria-invalid={!!error} />;
  if (!label) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} className={className}>
      {input}
    </Field>
  );
}

export function TextArea({ label, hint, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <textarea id={id} {...rest} className={cx(inputBase, 'h-auto min-h-[90px] py-2 leading-relaxed')} />
    </Field>
  );
}

export function Select({ label, hint, options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; options: { value: string; label: string; disabled?: boolean }[] }) {
  const id = useId();
  const select = (
    <div className={cx('relative', !label && className)}>
      <select id={id} {...rest} className={cx(inputBase, 'appearance-none pr-8')}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
  if (!label) return select;
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      {select}
    </Field>
  );
}

/** Money input: shows formatted dollars, edits as free text, commits cents on blur/enter. */
export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  allowNegative = false,
  allowEmpty = false,
  className,
  placeholder,
  disabled,
  suffix,
}: {
  label?: ReactNode;
  value: Cents | null;
  onChange: (v: Cents | null) => void;
  hint?: ReactNode;
  allowNegative?: boolean;
  allowEmpty?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
}) {
  const id = useId();
  const fmt = (v: Cents | null) => (v === null ? '' : formatMoney(v, { cents: v % 100 !== 0 }).replace('$', ''));
  const [text, setText] = useState(fmt(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  const commit = () => {
    if (text.trim() === '') {
      if (allowEmpty) {
        setError(null);
        onChange(null);
      } else {
        setError(null);
        onChange(0);
        setText('0');
      }
      return;
    }
    const v = parseMoney(text);
    if (v === null) return setError('Enter an amount, e.g. 1,250 or 850k');
    if (!allowNegative && v < 0) return setError('Must be zero or more');
    setError(null);
    onChange(v);
    setText(fmt(v));
  };
  const input = (
    <div className={cx('relative', !label && className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        className={cx(inputBase, 'num pl-6', suffix && 'pr-14', error && 'border-bad')}
        value={text}
        aria-invalid={!!error}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
  if (!label) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id} className={className}>
      {input}
    </Field>
  );
}

/** Percentage input that stores a fraction (0.05 = 5%). */
export function PercentInput({ label, value, onChange, hint, step = 0.1, min, max, className, disabled }: { label?: ReactNode; value: number; onChange: (v: number) => void; hint?: ReactNode; step?: number; min?: number; max?: number; className?: string; disabled?: boolean }) {
  const id = useId();
  const [text, setText] = useState(String(round(value * 100)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round(value * 100)));
  }, [value]);
  const input = (
    <div className={cx('relative', !label && className)}>
      <input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        className={cx(inputBase, 'num pr-7')}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n / 100);
        }}
        onBlur={() => {
          focused.current = false;
          setText(String(round(value * 100)));
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
    </div>
  );
  if (!label) return input;
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      {input}
    </Field>
  );
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function NumberInput({ label, value, onChange, hint, step = 1, min, max, className, suffix }: { label?: ReactNode; value: number; onChange: (v: number) => void; hint?: ReactNode; step?: number; min?: number; max?: number; className?: string; suffix?: string }) {
  const id = useId();
  const input = (
    <div className={cx('relative', !label && className)}>
      <input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        className={cx(inputBase, 'num', suffix && 'pr-14')}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
  if (!label) return input;
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      {input}
    </Field>
  );
}

export function Slider({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="font-medium text-ink-2">
          {label}
        </label>
        <span className="num font-medium text-ink">{format(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-inset ring-line')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm">
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md'; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface-3 text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded bg-surface-3 px-1.5 text-2xs text-ink-2">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-pop animate-fade-in sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Feedback
export function Callout({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'bad' | 'good' | 'demo'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'good' ? Check : tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'note'}
      className={cx(
        'flex gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'info' && 'border-info/25 bg-info/5',
        tone === 'warn' && 'border-warn/30 bg-warn/5',
        tone === 'bad' && 'border-bad/30 bg-bad/5',
        tone === 'good' && 'border-good/30 bg-good/5',
        tone === 'demo' && 'border-demo/30 bg-demo/5',
      )}
    >
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', tone === 'info' && 'text-info', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad', tone === 'good' && 'text-good', tone === 'demo' && 'text-demo')} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className="text-ink-2 [&_a]:text-accent">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 rounded-xl bg-surface-2 p-3 text-muted">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton h-4', className)} aria-hidden />;
}

export function ProgressBar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad'; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', tone === 'accent' && 'bg-accent', tone === 'good' && 'bg-good', tone === 'warn' && 'bg-warn', tone === 'bad' && 'bg-bad')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone, badge, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'muted'; badge?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}
        {badge}
      </div>
      <div className={cx('num mt-1 break-words text-lg font-semibold tracking-tight sm:text-xl', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad', tone === 'muted' && 'text-ink-2')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-line bg-surface-2/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-ink-2 hover:text-ink">
        {summary}
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm text-ink-2">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------- Toasts
type ToastItem = { id: number; text: string; tone: 'good' | 'bad' | 'info' };
let pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
export function toast(text: string, tone: ToastItem['tone'] = 'good') {
  pushToast?.({ text, tone });
}
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 lg:bottom-6">
      {items.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto rounded-xl border bg-surface px-4 py-2.5 text-sm shadow-pop animate-fade-in', t.tone === 'good' && 'border-good/30', t.tone === 'bad' && 'border-bad/40 text-bad', t.tone === 'info' && 'border-line')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
