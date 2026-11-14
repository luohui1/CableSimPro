// The workbench's own small set of controls. Every screen is built from these and the
// tokens in styles.css; nothing is styled page by page.
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { compact } from '../shared/format.ts';
import type { Tier } from '../shared/types.ts';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'agent' | 'accent';

export function Button({ variant = 'default', icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'agent' | 'danger'; icon?: ReactNode }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...rest}>{icon}{children && <span>{children}</span>}</button>;
}

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

const TIER_TONES: Record<string, Tone> = { deliverable: 'ok', reference: 'warn', exploratory: 'agent' };
const TIER_LABELS: Record<string, string> = { deliverable: '可交付', reference: '参考', exploratory: '探索' };

export function TierBadge({ tier }: { tier: Tier | string | undefined }) {
  if (!tier) return null;
  const key = typeof tier === 'string' ? tier : tier.tier;
  return <Badge tone={TIER_TONES[key] ?? 'neutral'} title={typeof tier === 'string' ? undefined : tier.meaning}>{TIER_LABELS[key] ?? key}</Badge>;
}

/** A labelled number with its unit. Commits on Enter or blur; Escape restores the saved value. */
export function NumberField({ label, value, unit, scale = 1, digits = 5, placeholder, onCommit, nullable = false, min, disabled, proposed }: {
  label: string; value: number | null | undefined; unit?: string; scale?: number; digits?: number; placeholder?: string;
  onCommit: (value: number | null) => Promise<void> | void; nullable?: boolean; min?: number; disabled?: boolean; proposed?: string;
}) {
  const id = useId();
  const shown = value === null || value === undefined ? '' : compact(value * scale, digits);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(shown); setError(''); }, [shown]);

  async function commit() {
    const text = draft.trim();
    if (text === shown) { setError(''); return; }
    if (!text) {
      if (!nullable) { setError('请填写数值。'); return; }
    } else if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) {
      setError('请输入数字。'); return;
    }
    const next = text ? Number(text) / scale : null;
    if (next !== null && min !== undefined && next <= min) { setError(`须大于 ${compact(min * scale)}${unit ? ' ' + unit : ''}。`); return; }
    setBusy(true);
    try { await onCommit(next); setError(''); } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); } finally { setBusy(false); }
  }

  return <div className={`field ${error ? 'field-error' : ''} ${proposed ? 'field-proposed' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <div className="field-control">
      <input id={id} inputMode="decimal" value={draft} placeholder={placeholder} disabled={disabled || busy} aria-invalid={!!error}
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); void commit(); }
          if (event.key === 'Escape') { setDraft(shown); setError(''); }
        }} />
      {unit && <span className="field-unit">{unit}</span>}
    </div>
    {proposed && <div className="field-note field-note-agent">Agent 提议改为 {proposed}</div>}
    {error && <div className="field-note" role="alert">{error}</div>}
  </div>;
}

export function SelectField({ label, value, options, onChange, disabled, proposed }: {
  label: string; value: string; options: { value: string; label: string; group?: string }[];
  onChange: (value: string) => Promise<void> | void; disabled?: boolean; proposed?: string;
}) {
  const id = useId();
  const [error, setError] = useState('');
  const groups = [...new Set(options.map(option => option.group ?? ''))];
  return <div className={`field ${error ? 'field-error' : ''} ${proposed ? 'field-proposed' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <div className="field-control">
      <select id={id} value={value} disabled={disabled} onChange={async event => {
        try { await onChange(event.target.value); setError(''); } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
      }}>
        {groups.map(group => group
          ? <optgroup key={group} label={group}>{options.filter(option => option.group === group).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>
          : options.filter(option => !option.group).map(option => <option key={option.value} value={option.value}>{option.label}</option>))}
      </select>
    </div>
    {proposed && <div className="field-note field-note-agent">Agent 提议改为 {proposed}</div>}
    {error && <div className="field-note" role="alert">{error}</div>}
  </div>;
}

/** A collapsible group that shows its summary value while closed. */
export function Group({ title, summary, defaultOpen = true, children, action }: {
  title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode; action?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="group">
    <header className="group-head">
      <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span>{title}</span>
      </button>
      {!open && summary !== undefined && <span className="group-summary">{summary}</span>}
      {action}
    </header>
    {open && <div className="group-body">{children}</div>}
  </section>;
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="facts">{rows.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function Notice({ tone = 'neutral', title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
    <div><strong>{title}</strong>{children && <div className="notice-body">{children}</div>}</div>
    {action}
  </div>;
}

export function Dialog({ title, onClose, children, footer, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-close)')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="dialog-head"><h2>{title}</h2><button type="button" className="icon-btn dialog-close" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-foot">{footer}</footer>}
    </div>
  </div>;
}

/** Underline tabs: used for views of one object, never for navigation between objects. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="tabs" role="tablist">{options.map(option =>
    <button key={option.value} type="button" role="tab" aria-selected={option.value === value} className="tab" onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
