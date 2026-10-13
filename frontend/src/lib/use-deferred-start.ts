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

/** 页面读取结束后，在浏览器空闲时读取侧栏计数；网络等待不等于首屏已就绪。 */
export function useIdleStart(timeout = 2000) {
  const [ready, setReady] = useState(false);
  const fetching = useIsFetching(), queries = useQueryClient();
  useEffect(() => {
    if (ready || fetching > 0) return;
    const start = () => { if (!queries.isFetching()) setReady(true); };
    if (window.requestIdleCallback) {
      const handle = window.requestIdleCallback(start, { timeout });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(start, Math.min(timeout, 1500));
    return () => window.clearTimeout(handle);
  }, [timeout, fetching, queries, ready]);
  return ready;
}
