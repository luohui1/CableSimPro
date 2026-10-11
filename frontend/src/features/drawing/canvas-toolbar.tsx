import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Workbench view switches and this view's controls share one reserved row. */
export function CanvasToolbar({ label, children }: { label: string; children: ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null), [slot, setSlot] = useState<Element | null>(null);
  useLayoutEffect(() => { setSlot(marker.current?.closest('.workbench-canvas')?.querySelector('[data-drawing-toolbar-slot]') || null); }, []);
  const tools = <div className="drawing-toolbar" role="toolbar" aria-label={label}>{children}</div>;
  return <><span ref={marker} hidden />{slot ? createPortal(tools, slot) : tools}</>;
}
