import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { Icon } from './icon';
import { Tooltip } from './ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

export type CommandAction = {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
  /** 主操作与保存固定可见；其余操作按 priority 从低到高收入更多菜单。 */
  role?: 'primary' | 'save';
  priority?: number;
  variant?: 'outline' | 'ghost' | 'run' | 'primary' | 'agent';
  disabledReason?: string;
  loading?: boolean;
};

export function CommandBar({ actions, leading, status, label = '研究操作' }: { actions: CommandAction[]; leading?: ReactNode; status?: string; label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  useLayoutEffect(() => {
    const target = root.current, sample = measure.current;
    if (!target || !sample) return;
    const leadingElement = target.querySelector<HTMLElement>('.command-leading');
    const fit = () => {
      const css = getComputedStyle(target);
      const gap = parseFloat(css.columnGap) || 0;
      const available = target.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const widths = new Map([...sample.querySelectorAll<HTMLElement>('[data-command-id]')].map(node => [node.dataset.commandId!, node.getBoundingClientRect().width]));
      const fixed = leadingElement?.getBoundingClientRect().width || 0;
      const more = sample.querySelector('[data-more]')?.getBoundingClientRect().width || 0;
      const visible = [...actions];
      const removed: string[] = [];
      const size = () => fixed + visible.reduce((sum, item) => sum + (widths.get(item.id) || 0), 0) + (removed.length ? more : 0)
        + gap * Math.max(0, visible.length + (leading ? 1 : 0) + (removed.length ? 1 : 0) - 1);
      const candidates = actions.filter(action => !action.role).sort((a, b) => (a.priority || 0) - (b.priority || 0));
      while (size() > available && candidates.length) {
        const next = candidates.shift()!;
        visible.splice(visible.findIndex(item => item.id === next.id), 1);
        removed.push(next.id);
      }
      setHidden(previous => previous.join('|') === removed.join('|') ? previous : removed);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target); observer.observe(sample);
    if (leadingElement) observer.observe(leadingElement);
    let active = true;
    void document.fonts.ready.then(() => { if (active) fit(); });
    return () => { active = false; observer.disconnect(); };
  }, [actions, leading]);
  const button = (action: CommandAction, measuring = false) => {
    const control = <Button key={action.id} size="compact" variant={action.variant || (action.role === 'primary' ? 'primary' : 'outline')}
      data-command-id={action.id} data-command-role={action.role} disabled={!!action.disabledReason} loading={action.loading}
      onClick={measuring ? undefined : action.onSelect}>{action.icon && <Icon name={action.icon} />}{action.label}</Button>;
    return action.disabledReason && !measuring ? <Tooltip key={action.id} content={action.disabledReason}><span className="command-disabled">{control}</span></Tooltip> : control;
  };
  return <div ref={root} className="command-bar adaptive-command-bar" role="toolbar" aria-label={label}>
    {leading && <div className="command-leading">{leading}</div>}
    {actions.filter(action => !hidden.includes(action.id)).map(action => button(action))}
    {!!hidden.length && <DropdownMenu><DropdownMenuTrigger asChild><Button size="compact" variant="ghost" aria-label="更多操作">更多<Icon name="action/chevron-down" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">{actions.filter(action => hidden.includes(action.id)).map(action => <DropdownMenuItem key={action.id} disabled={!!action.disabledReason || action.loading} onSelect={action.onSelect}>
        {action.icon && <Icon name={action.icon} />}<span>{action.label}{action.disabledReason && <small className="command-menu-reason">{action.disabledReason}</small>}</span>
      </DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
    {status && <span className="command-state" title={status}>{status}</span>}
    <div ref={measure} className="command-measure" aria-hidden="true" inert>
      {actions.map(action => button(action, true))}<Button data-more size="compact" variant="ghost">更多<Icon name="action/chevron-down" /></Button>
    </div>
  </div>;
}
