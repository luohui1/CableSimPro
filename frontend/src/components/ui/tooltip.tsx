import * as Primitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return <Primitive.Provider delayDuration={200}><Primitive.Root><Primitive.Trigger asChild>{children}</Primitive.Trigger><Primitive.Portal><Primitive.Content className="tooltip-content" sideOffset={4}>{content}<Primitive.Arrow className="tooltip-arrow" /></Primitive.Content></Primitive.Portal></Primitive.Root></Primitive.Provider>;
}
