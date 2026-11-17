import { lazy, useEffect, useRef, type ComponentType } from 'react';
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

/** Keep one React.lazy identity for the lifetime of this route, including
 * after preloading. Never switch a mounted provider to another element type.
 * Import failures render an explicit refresh action; component render errors
 * still propagate to the router's error boundary. */
export function lazyWorkbenchRoute<
  Module extends Record<string, unknown>,
  Key extends keyof Module,
>(importer: () => Promise<Module>, exportName: Key):
  Module[Key] extends (props: infer Props) => unknown ? AsyncRouteComponent<Props> : never {
  type Props = Module[Key] extends (props: infer Value) => unknown ? Value : never;
  type Page = ComponentType<Props>;
  let lazyPromise: Promise<{ default: Page }> | undefined;
  let preloadPromise: Promise<void> | undefined;
  const load = () => lazyPromise ??= Promise.resolve().then(importer)
    .then(module => {
      const component = module[exportName];
      if (typeof component !== 'function') throw new Error(`页面导出不可用：${String(exportName)}`);
      return { default: component as Page };
    })
    .catch(error => ({ default: function LoadError() { return <RouteLoadError error={error} />; } }));
  const Lazy = lazy(load);
  const preload = () => preloadPromise ??= load().then(() => undefined, () => undefined);
  return Object.assign(Lazy, { preload }) as
    Module[Key] extends (props: infer Value) => unknown ? AsyncRouteComponent<Value> : never;
}
