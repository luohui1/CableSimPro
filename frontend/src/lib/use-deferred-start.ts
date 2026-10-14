import { useEffect, useRef, useState, type RefObject } from "react";
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

/** 元素进入可视区后才返回 true：次要读取（如关联面板）不和首屏的主要数据抢宿主。 */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    if (typeof IntersectionObserver !== "function") { setSeen(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setSeen(true); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** 次要目录/代码预取只在正文提交并绘制后启动；查询间的空档不是首屏就绪。 */
export function useIdleStart(timeout = 2000) {
  const [ready, setReady] = useState(false);
  const fetching = useIsFetching(), queries = useQueryClient();
  useEffect(() => {
    if (ready || fetching > 0) return;
    let frame = 0, idle = 0, stopped = false, queued = false;
    const contentReady = () => {
      const main = document.querySelector<HTMLElement>('.main-content,.provider-state');
      if (queries.isFetching() || !main?.checkVisibility({ checkVisibilityCSS: true }) || main.matches('[aria-busy="true"]') || document.querySelector('.route-skeleton,.route-progress[data-active="true"]')) return false;
      return ![...main.querySelectorAll('[aria-busy="true"],.skeleton-lines,.skeleton-bar')].some(node => node.checkVisibility({ checkVisibilityCSS: true }));
    };
    const start = () => { queued = false; if (!stopped && contentReady()) setReady(true); };
    const schedule = () => {
      if (queued || stopped) return;
      queued = true;
      // Two frames separate React's commit from speculative work. No fixed page delay.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
        if (!contentReady()) { queued = false; return; }
        if (window.requestIdleCallback) idle = window.requestIdleCallback(start, { timeout });
        else start();
      }); });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-active', 'class', 'hidden'] });
    schedule();
    return () => { stopped = true; observer.disconnect(); cancelAnimationFrame(frame); if (idle) window.cancelIdleCallback(idle); };
  }, [timeout, fetching, queries, ready]);
  return ready;
}
