// The workbench's controls. They follow design/tokens.css (FRONTEND_REQUIREMENTS §5): pill buttons,
// white panels on a grey ground, copper for "run", teal for the agent. Every screen is built from these.
import { Dialog as RadixDialog, DropdownMenu, Select as RadixSelect, Tooltip as RadixTooltip } from 'radix-ui';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useState } from 'react';
import { compact } from '../shared/format.ts';
import type { Tier } from '../shared/types.ts';
import { Icon } from './icon.tsx';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'agent';
type Variant = 'outline' | 'primary' | 'run' | 'agent' | 'ghost';

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return <RadixTooltip.Root>
    <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
    <RadixTooltip.Portal><RadixTooltip.Content className="tooltip" sideOffset={6}>{content}</RadixTooltip.Content></RadixTooltip.Portal>
  </RadixTooltip.Root>;
}

export function Button({ variant = 'outline', size = 'standard', icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'standard' | 'compact'; icon?: string }) {
  return <button type="button" className={`button button-${variant} button-${size} ${className}`} {...rest}>
    {icon && <Icon name={icon} />}{children !== undefined && children !== null && <span>{children}</span>}
  </button>;
}

export function IconButton({ icon, label, pressed, className = '', ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: string; label: string; pressed?: boolean }) {
  return <Tooltip content={label}>
    <button type="button" className={`button button-ghost button-icon ${className}`} aria-label={label} aria-pressed={pressed} {...rest}><Icon name={icon} /></button>
  </Tooltip>;
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
export function NumberField({ label, value, unit, scale = 1, digits = 5, placeholder, onCommit, nullable = false, min, disabled, proposed, autoFocus }: {
  label: string; value: number | null | undefined; unit?: string; scale?: number; digits?: number; placeholder?: string;
  onCommit: (value: number | null) => Promise<void> | void; nullable?: boolean; min?: number; disabled?: boolean; proposed?: string; autoFocus?: boolean;
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

  return <div className={`field ${error ? 'is-error' : ''} ${proposed ? 'is-proposed' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <div className="field-control">
      <input id={id} inputMode="decimal" value={draft} placeholder={placeholder} disabled={disabled || busy} aria-invalid={!!error} autoFocus={autoFocus}
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); void commit(); }
          if (event.key === 'Escape') { setDraft(shown); setError(''); }
        }} />
      {unit && <span className="field-unit">{unit}</span>}
    </div>
    {proposed && <div className="field-note is-agent">Agent 提议改为 {proposed}</div>}
    {error && <div className="field-note" role="alert">{error}</div>}
  </div>;
}

export interface Option { value: string; label: string; group?: string }

export function Select({ value, options, onChange, disabled, label, id }: {
  value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; label: string; id?: string;
}) {
  const groups = [...new Set(options.map(option => option.group ?? ''))];
  const item = (option: Option) => <RadixSelect.Item key={option.value} value={option.value} className="select-item">
    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
    <RadixSelect.ItemIndicator className="select-check"><Icon name="action/check" /></RadixSelect.ItemIndicator>
  </RadixSelect.Item>;
  return <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
    <RadixSelect.Trigger id={id} className="select-trigger" aria-label={label}>
      <RadixSelect.Value /><RadixSelect.Icon className="select-caret"><Icon name="action/chevron-down" /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content className="select-content" position="popper" sideOffset={4}>
        <RadixSelect.Viewport>
          {groups.map(group => group
            ? <RadixSelect.Group key={group}><RadixSelect.Label className="select-label">{group}</RadixSelect.Label>{options.filter(option => option.group === group).map(item)}</RadixSelect.Group>
            : options.filter(option => !option.group).map(item))}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>;
}

export function SelectField({ label, value, options, onChange, disabled, proposed }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => Promise<void> | void; disabled?: boolean; proposed?: string;
}) {
  const id = useId();
  const [error, setError] = useState('');
  return <div className={`field ${error ? 'is-error' : ''} ${proposed ? 'is-proposed' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <Select id={id} label={label} value={value} options={options} disabled={disabled} onChange={async next => {
      try { await onChange(next); setError(''); } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    }} />
    {proposed && <div className="field-note is-agent">Agent 提议改为 {proposed}</div>}
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
        <Icon name={open ? 'action/chevron-down' : 'action/chevron-right'} /><span>{title}</span>
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

export function Notice({ tone = 'neutral', title, children, action, icon }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
    <Icon name={icon ?? (tone === 'bad' ? 'status/error' : tone === 'warn' ? 'status/warning' : 'status/info')} className="notice-icon" />
    <div className="notice-text"><strong>{title}</strong>{children && <div>{children}</div>}</div>
    {action}
  </div>;
}

export function Dialog({ title, onClose, children, footer, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return <RadixDialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="dialog-overlay" />
      <RadixDialog.Content className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-describedby={undefined}>
        <header className="dialog-head"><RadixDialog.Title>{title}</RadixDialog.Title>
          <RadixDialog.Close asChild><button type="button" className="button button-ghost button-icon" aria-label="关闭"><Icon name="action/close" /></button></RadixDialog.Close></header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

/** Underline tabs: views of one object, never navigation between objects. */
export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="tabs" role="tablist" aria-label={label}>{options.map(option =>
    <button key={option.value} type="button" role="tab" aria-selected={option.value === value} className="tab" onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

/** A small pill switch between two or three states of one view. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(option =>
    <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function Menu({ trigger, items, align = 'end' }: {
  trigger: ReactNode; align?: 'start' | 'end';
  items: ({ label: string; detail?: string; icon?: string; onSelect: () => void; disabled?: boolean } | 'separator')[];
}) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="menu" align={align} sideOffset={6}>
        {items.map((item, index) => item === 'separator' ? <DropdownMenu.Separator key={index} className="menu-separator" />
          : <DropdownMenu.Item key={item.label} className="menu-item" disabled={item.disabled} onSelect={item.onSelect}>
            {item.icon && <Icon name={item.icon} />}
            <span className="menu-text"><span>{item.label}</span>{item.detail && <span className="menu-detail">{item.detail}</span>}</span>
          </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export const TooltipProvider = RadixTooltip.Provider;
