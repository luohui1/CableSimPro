import { useEffect, type ReactNode } from 'react';
import { Link, useSearch, type ErrorComponentProps } from '@tanstack/react-router';
import { preferredTheme } from '@/lib/preferences';
import { LoadingState, ErrorState } from './states';
import { Button } from './ui/button';
import '../styles/route-feedback.css';

function Frame({ children }: { children: ReactNode }) {
  const search = useSearch({ strict: false }), theme = preferredTheme(search.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <main className="route-feedback">{children}<nav aria-label="页面恢复导航"><Link to="/" search={{ theme }}>返回首页</Link><Link to="/studies" search={{ theme }}>研究列表</Link></nav></main>;
}
export function RoutePending() { return <Frame><LoadingState title="正在打开页面" description="正在加载页面内容。" /></Frame>; }
export function RouteFailure({ reset }: ErrorComponentProps) { return <Frame><ErrorState title="页面暂时无法显示" description="页面加载或渲染遇到问题。请重试当前页面，或从首页重新进入；不会自动重算工程。" action={<Button onClick={reset}>重新显示页面</Button>} /></Frame>; }
export function RouteNotFound() { return <Frame><section className="state-view" data-state-kind="empty"><h1>页面不存在</h1><p className="muted">此地址未注册，或模块与页签不匹配。请从原有导航重新进入。</p></section></Frame>; }
