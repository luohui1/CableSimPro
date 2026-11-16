// The rating screens sit in the workbench's one frame, the same column as the type screens (types/side.tsx lists both workspaces).
import type { ReactNode } from 'react';
import { TypeFrame } from '@/types/frame';

export function RatingFrame({ active, creating, children }: { active?: string; creating?: boolean; children?: ReactNode }) {
  return <TypeFrame at={{ kind: 'project', id: active, creating }}>{children}</TypeFrame>;
}
