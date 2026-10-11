import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

/** Workbench view switches and this view's controls share one reserved row. */
export function CanvasToolbar({ label, children, secondary }: { label: string; children: ReactNode; secondary?: ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null), [slot, setSlot] = useState<Element | null>(null);
  const [template,setTemplate]=useState<HTMLButtonElement|null>(null);
  useLayoutEffect(() => { const canvas=marker.current?.closest('.workbench-canvas');setSlot(canvas?.querySelector('[data-drawing-toolbar-slot]') || null);if(secondary)setTemplate(canvas?.querySelector<HTMLButtonElement>('.study-template-action button')||null); }, [secondary!==undefined]);
  const tools = <div className="drawing-toolbar" data-template-collected={template?'true':undefined} role="toolbar" aria-label={label}>{children}{secondary&&<Popover><PopoverTrigger asChild><Button size="compact" variant="ghost" aria-label="更多绘图工具">更多工具</Button></PopoverTrigger><PopoverContent align="end" className="drawing-secondary-tools" aria-label="更多绘图工具">{secondary}{template&&<Button size="compact" onClick={()=>template.click()}>敷设模板</Button>}</PopoverContent></Popover>}</div>;
  return <><span ref={marker} hidden />{slot ? createPortal(tools, slot) : tools}</>;
}
