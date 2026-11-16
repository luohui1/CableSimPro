// The one shell around both modes. The mode switch sits in the same place on every screen; below it is the screen itself.
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Mark } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStatus } from '@/state/queries';
import { useTheme } from '@/state/theme';
import { lastPlace, modeOf, remember, type Mode } from './modes';

export function Shell() {
  const router = useRouter();
  const location = useRouterState({ select: state => state.location });
  const mode = modeOf(location.pathname);
  const { theme, toggle } = useTheme();
  const status = useStatus();
  useEffect(() => remember(location.pathname, location.searchStr), [location.pathname, location.searchStr]);

  const model = status.data?.agent;
  return <div className="bg-background flex h-full flex-col">
    <header className="flex h-12 shrink-0 items-center gap-5 border-b px-4">
      <div className="flex items-center gap-2"><Mark /><span className="text-base font-semibold">Cable Studio</span></div>
      <Tabs value={mode} onValueChange={value => router.history.push(lastPlace(value as Mode))}>
        <TabsList aria-label="模式" className="h-9">
          <TabsTrigger value="agent" className="px-5">Agent</TabsTrigger>
          <TabsTrigger value="workbench" className="px-5">工作台</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex-1" />
      {model && <span className="text-muted-foreground text-sm" title="Agent 用的模型">{model.configured ? model.model : '模型未配置'}</span>}
      <Button variant="ghost" size="icon" aria-label={theme === 'light' ? '换成深色' : '换成浅色'} onClick={toggle}>{theme === 'light' ? <MoonIcon /> : <SunIcon />}</Button>
    </header>
    <div className="min-h-0 flex-1"><Outlet /></div>
  </div>;
}
