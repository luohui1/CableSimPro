import * as Primitive from '@radix-ui/react-tooltip';
import type { ReactNode, ComponentProps } from 'react';

export function Tooltip({ content, children, ...props }: ComponentProps<typeof Primitive.Root> & { content?: ReactNode }) {
  if (content === undefined) return <Primitive.Root {...props}>{children}</Primitive.Root>;
  return <Primitive.Provider delayDuration={200}><Primitive.Root><Primitive.Trigger asChild>{children}</Primitive.Trigger><Primitive.Portal><Primitive.Content className="tooltip-content" sideOffset={4}>{content}<Primitive.Arrow className="tooltip-arrow" /></Primitive.Content></Primitive.Portal></Primitive.Root></Primitive.Provider>;
}
export const TooltipProvider = Primitive.Provider;
export const TooltipTrigger = Primitive.Trigger;
export function TooltipContent({ className = '', children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content className={`tooltip-content ${className}`} sideOffset={4} {...props}>{children}</Primitive.Content></Primitive.Portal>;
}
