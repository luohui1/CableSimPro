// The frame of a workbench screen inside the shell: the workbench column on the grey ground, the screen on one white sheet. The shell's
// top bar is above it, so the frame brings none. The type screens and the rating screens use this one frame, and so one column.
import type { ReactNode } from 'react';
import { AppFrame } from '@/kit/frame';
import { WorkbenchSide, type SideAt } from './side';

export function TypeFrame({ at, children }: { at: SideAt; children: ReactNode }) {
  return <AppFrame top={null} side={<WorkbenchSide at={at} />}>{children}</AppFrame>;
}
