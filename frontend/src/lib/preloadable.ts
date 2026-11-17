import { createElement, use, type ComponentProps, type ComponentType, type ReactPromise } from 'react';

type Tracked<T> = Promise<T> & ReactPromise<T>;

/**
 * 预载与渲染共用代码块，始终保留包装组件与正文组件的身份。
 * 未被渲染采用的预载失败可以重试；已采用的拒绝只由显式预载重试，渲染本身不重启加载。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与 React.lazy 自身的约束一致
export function preloadable<C extends ComponentType<any>>(load: () => Promise<{ default: C }>) {
  let promise: Tracked<{ default: C }> | null = null;
  let renderPromise: Tracked<{ default: C }> | null = null;
  const read = () => {
    if (promise) return promise;
    const pending = Promise.resolve().then(load) as Tracked<{ default: C }>;
    pending.status = 'pending';
    pending.then(value => { Object.assign(pending, { status: 'fulfilled', value }); }, reason => {
      Object.assign(pending, { status: 'rejected', reason });
      if (renderPromise !== pending && promise === pending) promise = null;
    });
    promise = pending;
    return pending;
  };
  const preload = () => {
    if (promise?.status === 'rejected') {
      if (renderPromise === promise) renderPromise = null;
      promise = null;
    }
    return read();
  };
  function Component(props: ComponentProps<C>) {
    renderPromise ??= read();
    const loaded = use(renderPromise);
    return createElement(loaded.default as ComponentType<ComponentProps<C>>, props);
  }
  return { Component, preload };
}
