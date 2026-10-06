import { createElement, useCallback, useLayoutEffect, useRef, type ComponentPropsWithRef, type CSSProperties, type Ref } from 'react';

type Layout = CSSProperties | Partial<Record<`--${string}`, string | number>>;
type Entry = { sheet: HTMLStyleElement; id: string; react: Layout; live: Layout };
const entries = new WeakMap<HTMLElement, Entry>();
let sequence = 0;
const unitless = new Set(['opacity','zIndex','flex','flexGrow','flexShrink','order','gridRowStart','gridRowEnd','gridColumnStart','gridColumnEnd','fontWeight','lineHeight','scale']);
/** Virtual coordinates belong to a stylesheet; no inline style attributes or literal theme colours. */
export function setGridLayout(element: HTMLElement, values: Layout, channel: 'react' | 'live' = 'live') {
  let entry = entries.get(element);
  if (!entry) {
    const sheet = document.createElement('style'), id = 'grid-layout-' + ++sequence;
    sheet.dataset.gridLayoutSheet = id;
    element.dataset.gridLayout = id;
    document.head.append(sheet);
    entry = { sheet, id, react: {}, live: {} };
    entries.set(element, entry);
  }
  entry[channel] = channel === 'react' ? values : {...entry.live, ...values};
  const declarations = Object.entries({...entry.react, ...entry.live}).flatMap(([property, raw]) => {
    if (raw === undefined || raw === null || raw === '') return [];
    const key = property.startsWith('--') ? property : property.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
    const value = typeof raw === 'number' && raw !== 0 && !unitless.has(property) && !property.startsWith('--') ? raw + 'px' : String(raw);
    if (/[{};<>]/.test(value) || /#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|lch)\(/i.test(value)) throw new Error('网格布局只能使用坐标或设计令牌');
    return [key + ':' + value];
  });
  entry.sheet.textContent = `[data-grid-layout="${entry.id}"]{${declarations.join(';')}}`;
}
export function clearGridLayout(element: HTMLElement) {
  entries.get(element)?.sheet.remove();
  entries.delete(element);
  delete element.dataset.gridLayout;
}
export function GridBox<E extends 'div' | 'span' = 'div'>({ as, layout, ref, ...props }: {as?: E; layout?: Layout} & ComponentPropsWithRef<E>) {
  const node = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { if (node.current && layout) setGridLayout(node.current, layout, 'react'); }, [layout]);
  useLayoutEffect(() => { const element = node.current; return () => {if (element) clearGridLayout(element);}; }, []);
  const attach = useCallback((element: HTMLElement | null) => {
    node.current = element;
    const forwarded = ref as Ref<HTMLElement> | undefined;
    if (typeof forwarded === 'function') forwarded(element);
    else if (forwarded) forwarded.current = element;
  }, [ref]);
  return createElement(as || 'div', { ...props, ref: attach });
}
