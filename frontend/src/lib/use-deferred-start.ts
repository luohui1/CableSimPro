import { useEffect, useRef, useState, type RefObject } from "react";

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

/** 浏览器空闲（最多等 timeout 毫秒）后才返回 true：侧栏计数这类读取放到首屏之后。 */
export function useIdleStart(timeout = 2000) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.requestIdleCallback) {
      const handle = window.requestIdleCallback(() => setReady(true), { timeout });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => setReady(true), Math.min(timeout, 1500));
    return () => window.clearTimeout(handle);
  }, [timeout]);
  return ready;
}
