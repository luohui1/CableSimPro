import { createElement, lazy, Suspense, type ComponentType, type ComponentProps } from 'react';
import { LoadingState } from './states';

/** Keep the workspace shell visible while a heavy view loads. */
export function deferredView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const View = lazy(load);
  return function DeferredView(props: ComponentProps<T>) {
    return <Suspense fallback={<LoadingState title="正在加载视图" />}>{createElement(View, props)}</Suspense>;
  };
}
