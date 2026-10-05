import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/600.css';
import 'virtual:design-tokens.css';
import '@/styles/theme.css';
import { galleryEntries as cadEntries } from './gallery-entry';
import { galleryEntries as drawingEntries } from '../drawing/gallery-entry';
import type { CanvasState } from './types';
import './gallery.css';

const entries = [...cadEntries, ...drawingEntries];
function FeatureGallery() {
  const search = new URLSearchParams(location.search);
  const [active, setActive] = useState(search.get('entry') || 'cad');
  const [state, setState] = useState<CanvasState>((search.get('state') || 'success') as CanvasState);
  const [theme, setTheme] = useState<'light' | 'dark'>(search.get('theme') === 'dark' ? 'dark' : 'light');
  const entry = entries.find(item => item.id === active) || entries[0];
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.canvasGallery ||= {}; window.canvasGallery.setState = setState;
  }, [theme]);
  return <AppShell title={entry.title} gallery theme={theme} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
    onUnavailable={() => {}} status={<span className="muted">演示</span>}
    actions={<Select label="组件状态" value={state} onChange={value => setState(value as CanvasState)} options={[
      { value: 'success', label: '成功' }, { value: 'empty', label: '空' }, { value: 'loading', label: '加载' },
      { value: 'error', label: '错误' }, { value: 'historical', label: '历史结果' },
    ]} />} sidebar={<>{entries.map(item => <Button key={item.id} variant="ghost" size="compact" aria-current={item.id === active ? 'page' : undefined}
      onClick={() => { setActive(item.id); setState('success'); }} data-gallery-nav={item.id}>{item.title}</Button>)}</>}>
    <entry.Component key={entry.id} state={state} />
  </AppShell>;
}
const root = createRootRoute();
const gallery = createRoute({ getParentRoute: () => root, path: '/gallery', component: FeatureGallery });
const router = createRouter({ routeTree: root.addChildren([gallery]) });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
