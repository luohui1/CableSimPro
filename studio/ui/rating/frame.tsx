// The frame of the rating screens until the application's shell builds the one for both modes: the grey ground with the
// workbench column and the white sheet. The shell's own header is above it, so the frame brings no top bar. When the shell
// provides the column, this file goes and the screens (project-screen, new-project) are used as they are.
import type { ReactNode } from 'react';
import { AppFrame } from '@/kit/frame';
import { RatingSide } from './nav';

export function RatingFrame({ active, creating, children }: { active?: string; creating?: boolean; children?: ReactNode }) {
  return <AppFrame top={null} side={<RatingSide active={active} creating={creating} />}>{children}</AppFrame>;
}
