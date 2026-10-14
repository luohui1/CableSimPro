import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Slot } from '@radix-ui/react-slot';
import { createContext, useContext, useId, useMemo, useState, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const PanelContext = createContext<{ value?: string; id: string; orientation: 'horizontal' | 'vertical' } | null>(null);

export function Tabs({ value, defaultValue, onValueChange, orientation = 'horizontal', ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  const [selected, setSelected] = useState(defaultValue);
  const id = useId();
  const current = value === undefined ? selected : value;
  const context = useMemo(() => ({ value: current, id, orientation }), [current, id, orientation]);
  return <PanelContext.Provider value={context}><TabsPrimitive.Root {...props} orientation={orientation} value={current}
    onValueChange={next => { if (value === undefined) setSelected(next); onValueChange?.(next); }} /></PanelContext.Provider>;
}
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('tabs-list', className)} {...props} />;
}
export function TabsTrigger({ className, children, value, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const panel = useContext(PanelContext);
  return <TabsPrimitive.Trigger className={cn('tabs-trigger', className)} value={value}
    {...(panel ? { id: `${panel.id}-trigger-${value}`, 'aria-controls': `${panel.id}-content-${value}` } : {})}
    {...props}><span className="tab-label">{children}</span></TabsPrimitive.Trigger>;
}
export function TabsContent({ className, value, forceMount, asChild, children, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  const panel = useContext(PanelContext);
  if (!panel) return <TabsPrimitive.Content className={cn('tabs-content', className)} value={value} forceMount={forceMount} asChild={asChild} {...props}>{children}</TabsPrimitive.Content>;
  const active = panel.value === value;
  const Content = asChild ? Slot : 'div';
  // Panels have no entry/exit animation. Keep Radix keyboard/selection behavior,
  // without Presence's synchronous animationName read on each result commit.
  return <Content className={cn('tabs-content', className)} role="tabpanel" tabIndex={0}
    id={`${panel.id}-content-${value}`} aria-labelledby={`${panel.id}-trigger-${value}`}
    data-state={active ? 'active' : 'inactive'} data-orientation={panel.orientation} hidden={!active}
    {...props}>{(active || forceMount) && children}</Content>;
}
