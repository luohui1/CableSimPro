import { createElement, use, useEffect, useRef, type ComponentType, type ReactPromise } from 'react';
import type { AsyncRouteComponent } from '@tanstack/react-router';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

function missingChunk(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error
    ? error.message : undefined;
  return typeof message === 'string' && (
    message.startsWith('Failed to fetch dynamically imported module')
    || message.startsWith('error loading dynamically imported module')
    || message.startsWith('Importing a module script failed')
  ) ? message : undefined;
}

function RouteLoadError({ error }: { error: unknown }) {
  const refresh = useRef<HTMLButtonElement>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const message = missingChunk(error);
    if (message) {
      try {
        // Match the router's existing once-per-error recovery. A hover preload
        // never mounts this component, so it cannot refresh an active draft.
        const key = `tanstack_router_reload:${message}`;
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, '1');
          window.location.reload();
          return;
        }
      } catch {
        // Storage may be blocked. Keep the recovery action instead of risking
        // a refresh loop or replacing the import failure with a storage error.
      }
    }
    refresh.current?.focus();
  }, [error]);
  return <section className="work-panel">
    <ErrorState
      title="页面暂时无法打开"
      description="页面文件没有加载成功，可能是网络中断或应用已更新。请刷新页面后重新打开。"
      action={<Button ref={refresh} type="button" variant="primary" onClick={() => window.location.reload()}>刷新页面</Button>}
    />
  </section>;
}

/** Keep one wrapper and page identity for the lifetime of this route, including
 * after preloading. An already loaded page does not need another Suspense wait.
 * Import failures render an explicit refresh action; component render errors
 * still propagate to the router's error boundary. */
export function lazyWorkbenchRoute<
  Module extends Record<string, unknown>,
  Key extends keyof Module,
>(importer: () => Promise<Module>, exportName: Key):
  Module[Key] extends (props: infer Props) => unknown ? AsyncRouteComponent<Props> : never {
  type Props = Module[Key] extends (props: infer Value) => unknown ? Value : never;
  type Page = ComponentType<Props>;
  type LoadedPage = { default: Page };
  type CachedPage = Promise<LoadedPage> & ReactPromise<LoadedPage>;
  let pagePromise: CachedPage | undefined;
  let preloadPromise: Promise<void> | undefined;
  const load = () => {
    if (pagePromise) return pagePromise;
    const pending = Promise.resolve().then(importer)
      .then(module => {
        const component = module[exportName];
        if (typeof component !== 'function') throw new Error(`页面导出不可用：${String(exportName)}`);
        return { default: component as Page };
      })
      .catch(error => ({ default: function LoadError() { return <RouteLoadError error={error} />; } })) as CachedPage;
    // React's documented promise cache lets use() read a preloaded module
    // synchronously while continuing to track that same promise on every render.
    pending.status = 'pending';
    pending.then(value => { Object.assign(pending, { status: 'fulfilled', value }); },
      reason => { Object.assign(pending, { status: 'rejected', reason }); });
    pagePromise = pending;
    return pending;
  };
  function Route(props: Props) {
    const page = use(load());
    return createElement(page.default as ComponentType<Props & object>, props as Props & object);
  }
  const preload = () => preloadPromise ??= load().then(() => undefined, () => undefined);
  return Object.assign(Route, { preload }) as
    Module[Key] extends (props: infer Value) => unknown ? AsyncRouteComponent<Value> : never;
}
