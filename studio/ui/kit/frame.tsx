// The application frame, the same in both modes: a top bar and a side column on the grey ground, and the screen itself on
// one white sheet inset beside them. The mode switch stays in the same place on every screen.
import { SunIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Icon, ProductMark } from './icon';
import { Dot } from './marks';

export function AppFrame({ top, side, children, className }: { top: ReactNode; side?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={cn('flex h-full min-h-0 flex-col bg-canvas text-ink', className)}>
    {top}
    <div className="flex min-h-0 flex-1 pr-2 pb-2">
      {side && <aside className="flex w-64 shrink-0 flex-col">{side}</aside>}
      <main className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface', !side && 'ml-2')}>{children}</main>
    </div>
  </div>;
}

export function TopBar({ mode, onModeChange, model, theme, onThemeToggle, className }: {
  mode: Mode;
  onModeChange?: (mode: Mode) => void;
  /** The model the Agent uses; null when none is configured. */
  model?: string | null;
  theme: 'light' | 'dark';
  onThemeToggle?: () => void;
  className?: string;
}) {
  return <header className={cn('flex h-12 shrink-0 items-center gap-6 px-4', className)}>
    <Brand />
    <ModeSwitch value={mode} onValueChange={onModeChange} />
    <div className="flex-1" />
    {model !== undefined && <ModelBadge name={model} />}
    <ThemeToggle theme={theme} onToggle={onThemeToggle} />
  </header>;
}

export const Brand = () => <span className="flex items-center gap-2">
  <ProductMark className="size-5" />
  <span className="text-sm font-semibold tracking-tight">Cable Studio</span>
</span>;

export type Mode = 'agent' | 'workbench';

export function ModeSwitch({ value, onValueChange }: { value: Mode; onValueChange?: (mode: Mode) => void }) {
  return <Tabs value={value} onValueChange={next => onValueChange?.(next as Mode)}>
    <TabsList aria-label="模式">
      <TabsTrigger value="agent"><Icon name="agent/agent" />Agent</TabsTrigger>
      <TabsTrigger value="workbench"><Icon name="nav/workbench" />工作台</TabsTrigger>
    </TabsList>
  </Tabs>;
}

/** The model the Agent works with. A dot says whether it is ready. */
export function ModelBadge({ name, className }: { name: string | null; className?: string }) {
  return <span className={cn('flex h-8 items-center gap-2 rounded-full px-3 text-sm text-ink-2', className)} title="Agent 用的模型">
    <Dot tone={name ? 'success' : 'attention'} />
    {name ?? '模型未配置'}
  </span>;
}

export function ThemeToggle({ theme, onToggle, ...props }: { theme: 'light' | 'dark'; onToggle?: () => void } & Omit<ComponentProps<typeof Button>, 'onClick'>) {
  const label = theme === 'light' ? '换成深色' : '换成浅色';
  return <Tooltip>
    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onToggle} {...props} />}>
      {theme === 'light' ? <Icon name="nav/theme" /> : <SunIcon strokeWidth={1.5} />}
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}
