'use client';
// 官方 mermaid 渲染器在浏览器中绘图，随站点一起打包，离线可用。
import { use, useId, useSyncExternalStore } from 'react';

export function Mermaid({ chart }: { chart: string }) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!isClient) return null;
  return <MermaidContent chart={chart} />;
}

const cache = new Map<string, Promise<unknown>>();
function cachePromise<T>(key: string, create: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, create());
  return cache.get(key) as Promise<T>;
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const theme = useSyncExternalStore(
    subscribeTheme,
    (): 'dark' | 'neutral' => (document.documentElement.classList.contains('dark') ? 'dark' : 'neutral'),
    (): 'dark' | 'neutral' => 'neutral',
  );
  const { default: mermaid } = use(cachePromise('mermaid', () => import('mermaid')));
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', fontFamily: 'inherit', theme });
  const { svg } = use(cachePromise(`${chart}-${theme}`, () => mermaid.render(id.replace(/:/g, ''), chart.replaceAll('\n', '\n'))));
  return <div className="fd-mermaid my-6 flex justify-center [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
