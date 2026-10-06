import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Outlet, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchCatalogs } from '@/lib/study-queries';
import { preloadCommonChunks } from '@/lib/idle-preload';
import { WorkbenchSidebar } from './workbench-sidebar';

/** 当前页面模块导航应放入的侧栏位置；由常驻外壳提供，AppShell 以 portal 写入。 */
const ShellSlot = createContext<HTMLElement | null>(null);
export const useShellSlot = () => useContext(ShellSlot);

/**
 * 常驻应用外壳（布局路由组件）。侧栏只挂载一次，换页时只替换右侧内容面板，
 * 做法参考 Plane `(projects)/layout.tsx`、Twenty `DefaultLayout.tsx` 与 ZCode `WorkspaceShellLayout.tsx`。
 */
const COLLAPSED_KEY = 'cablesim:shell:sidebar-collapsed';
const WIDTH_KEY = 'cablesim:shell:sidebar-width-px';
const MIN_WIDTH = 220, MAX_WIDTH = 400, DEFAULT_WIDTH = 240;
const clampWidth = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));
function readStored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* 隐私模式下只保留本次会话 */ } }

/**
 * 侧栏宽度写在一张共享样式表里（--sidebar-width）。拖拽时每次 pointermove 只改样式表、不触发 React 渲染，
 * 松手再保存——照搬 ZCode WorkspaceShellLayout 的做法（Apache-2.0，github.com/zai-org/ZCode）。
 */
const widthSheet = typeof CSSStyleSheet === 'function' ? new CSSStyleSheet() : null;
function applyWidth(width: number) {
  if (!widthSheet) return;
  widthSheet.replaceSync(`.shell-workbench { --sidebar-width: ${width}px; }`);
  if (!document.adoptedStyleSheets.includes(widthSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, widthSheet];
}

export function ShellLayout() {
  const search = useSearch({ strict: false }) as { theme?: string };
  const theme = search.theme === 'dark' ? 'dark' : 'light';
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const onTheme = () => void navigate({ to: '.', search: ((previous: Record<string, unknown>) => ({ ...previous, theme: theme === 'light' ? 'dark' : 'light' })) as never, replace: true });
  const loading = useRouterState({ select: state => state.status === 'pending' });
  const queryClient = useQueryClient();
  useEffect(() => {
    const idle = window.requestIdleCallback ? window.requestIdleCallback(() => { prefetchCatalogs(queryClient); preloadCommonChunks(); }, { timeout: 3000 }) : window.setTimeout(() => { prefetchCatalogs(queryClient); preloadCommonChunks(); }, 1500);
    return () => { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); };
  }, [queryClient]);
  // 首帧同步读出收起状态和宽度，不在 effect 里修正，刷新时侧栏不跳。
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === 'true');
  const [animating, setAnimating] = useState(false);
  const width = useRef(clampWidth(Number(readStored(WIDTH_KEY)) || DEFAULT_WIDTH));
  useLayoutEffect(() => applyWidth(width.current), []);
  // 过渡只在用户主动开合的那一次加上，平时不挂，窗口缩放不会触发一串中间尺寸（ZCode useAnimatedResizablePanel）。
  const toggle = useCallback(() => {
    setAnimating(true);
    setCollapsed(value => { store(COLLAPSED_KEY, String(!value)); return !value; });
    window.setTimeout(() => setAnimating(false), 260);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') { event.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX, start = width.current, target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    document.documentElement.dataset.resizing = 'true';
    const move = (next: PointerEvent) => { width.current = clampWidth(start + next.clientX - startX); applyWidth(width.current); };
    const end = () => {
      target.removeEventListener('pointermove', move);
      delete document.documentElement.dataset.resizing;
      store(WIDTH_KEY, String(width.current));
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end, { once: true });
    target.addEventListener('pointercancel', end, { once: true });
  };
  const resizeByKey = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    event.preventDefault();
    width.current = clampWidth(width.current + step); applyWidth(width.current); store(WIDTH_KEY, String(width.current));
  };
  return <div className="app-shell shell-workbench" data-collapsed={collapsed || undefined} data-animating={animating || undefined}>
    {/* 换页时旧页面保留到新页面就绪；顶部细进度条给出即时反馈（延迟 150 ms 出现，快的跳转看不到）。 */}
    <div className="route-progress" data-active={loading || undefined} aria-hidden="true" />
    <WorkbenchSidebar theme={theme} onTheme={onTheme} onSlot={setSlot} collapsed={collapsed} onCollapse={toggle} />
    {!collapsed && <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" tabIndex={0} onPointerDown={startResize} onKeyDown={resizeByKey} onDoubleClick={() => { width.current = DEFAULT_WIDTH; applyWidth(DEFAULT_WIDTH); store(WIDTH_KEY, String(DEFAULT_WIDTH)); }} />}
    <ShellSlot.Provider value={slot}><Outlet /></ShellSlot.Provider>
  </div>;
}

/** 路由等待骨架：形状与内容面板一致（顶栏 + 结论 + 表格行），加载完成时不跳版面。 */
export function RouteSkeleton() {
  return <section className="work-panel route-skeleton" aria-busy="true" aria-label="正在打开">
    <header className="topbar"><span className="skeleton-bar skeleton-title" /></header>
    <div className="main-content">
      <span className="skeleton-bar skeleton-heading" />
      <span className="skeleton-bar skeleton-line" />
      <div className="skeleton-rows">{Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton-bar" />)}</div>
    </div>
  </section>;
}
