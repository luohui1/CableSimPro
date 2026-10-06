import { createElement, lazy, type ComponentProps, type ComponentType } from 'react';

type Tracked<T> = Promise<T> & { status?: 'pending' | 'fulfilled' | 'rejected'; value?: T; reason?: unknown };

/**
 * 可预加载的懒组件。代码块已下载时直接渲染真实组件，完全不经过 Suspense——
 * 否则 React 一旦显示等待提示会至少保留约 300 ms（fallback 节流）。preload() 可在空闲或悬停时调用，只下载一次。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与 React.lazy 自身的约束一致
export function preloadable<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  let promise: Tracked<{ default: C }> | null = null;
  const preload = () => {
    if (promise) return promise;
    const pending: Tracked<{ default: C }> = load();
    pending.status = 'pending';
    pending.then(value => { pending.status = 'fulfilled'; pending.value = value; }, reason => { pending.status = 'rejected'; pending.reason = reason; promise = null; });
    promise = pending;
    return pending;
  };
  const Lazy = lazy(preload);
  function Component(props: ComponentProps<C>) {
    const ready = promise?.status === 'fulfilled' ? promise.value!.default : null;
    return createElement((ready || Lazy) as ComponentType<ComponentProps<C>>, props);
  }
  return { Component, preload };
}
