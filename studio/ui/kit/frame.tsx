// The application frame, the same in both modes: a top bar and a side column on the grey ground, and the screen itself on
// one white sheet inset beside them. The mode switch stays in the same place on every screen.
import chatglm from '@lobehub/icons-static-svg/icons/chatglm-color.svg?url';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?url';
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg?url';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import { SunIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Icon, ProductMark } from './icon';
import { Dot } from './marks';

// Makers' marks from @lobehub/icons-static-svg (MIT), matched by the start of the model's name. The coloured mark where the
// set has one; a one-colour mark is inverted in the dark theme.
const BRANDS: { test: RegExp; maker: string; src: string; mono?: boolean }[] = [
  { test: /^(glm|chatglm)/i, maker: '智谱', src: chatglm },
  { test: /^deepseek/i, maker: 'DeepSeek', src: deepseek },
  { test: /^claude/i, maker: 'Anthropic', src: claude },
  { test: /^(gpt|o\d)/i, maker: 'OpenAI', src: openai, mono: true },
  { test: /^qwen/i, maker: '通义', src: qwen },
  { test: /^(kimi|moonshot)/i, maker: '月之暗面', src: kimi },
  { test: /^minimax/i, maker: 'MiniMax', src: minimax },
  { test: /^doubao/i, maker: '豆包', src: doubao },
];
const brandOf = (name: string) => BRANDS.find(brand => brand.test.test(name));

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

/** The model the Agent works with: its maker's mark when the name says who (LobeHub icons), a dot for whether it is ready. */
export function ModelBadge({ name, className }: { name: string | null; className?: string }) {
  const mark = name ? brandOf(name) : undefined;
  return <span className={cn('flex h-8 items-center gap-2 rounded-full px-3 text-sm text-ink-2', className)} title="Agent 用的模型">
    <Dot tone={name ? 'success' : 'attention'} />
    {mark && <img src={mark.src} alt={mark.maker} className={cn('size-4 shrink-0', mark.mono && 'dark:invert')} />}
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
