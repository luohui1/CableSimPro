// The one shell around both modes: the kit's top bar (the mode switch in the same place on every screen), and below it the screen. A
// screen draws its own side column and sheet in the kit's frame.
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TopBar } from '@/kit/frame';
import { useStatus } from '@/state/queries';
import { useTheme } from '@/state/theme';
import { lastPlace, modeOf, remember } from './modes';

export function Shell() {
  const router = useRouter();
  const location = useRouterState({ select: state => state.location });
  const { theme, toggle } = useTheme();
  const agent = useStatus().data?.agent;
  useEffect(() => remember(location.pathname, location.searchStr), [location.pathname, location.searchStr]);
  return <div className="flex h-full min-h-0 flex-col bg-canvas">
    <TopBar mode={modeOf(location.pathname)} onModeChange={mode => router.history.push(lastPlace(mode))}
      model={agent ? (agent.configured ? agent.model : null) : undefined} theme={theme} onThemeToggle={toggle} />
    <div className="min-h-0 flex-1"><Outlet /></div>
  </div>;
}
