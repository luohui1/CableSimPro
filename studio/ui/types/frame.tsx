// The frame of a workbench screen inside the shell: the workbench column on the grey ground, the screen on one white sheet.
// The shell still draws its own header, so the frame starts under it with a small gap in place of a top bar; when the shell
// moves to the kit's AppFrame, this is the one place to change.
import type { ReactNode } from 'react';
import { AppFrame } from '@/kit/frame';
import { WorkbenchSide, type SideAt } from './side';

export function TypeFrame({ at, children }: { at: SideAt; children: ReactNode }) {
  return <AppFrame top={<div className="h-2 shrink-0" aria-hidden="true" />} side={<WorkbenchSide at={at} />}>{children}</AppFrame>;
}
