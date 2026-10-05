import type { KeyboardEvent } from 'react';
import type { DrawingCommand } from './types';

export function drawingShortcut(event: KeyboardEvent, onCommand?: (command: DrawingCommand) => void): boolean {
  const input = event.target instanceof HTMLElement && (!!event.target.closest('input,textarea,select,[contenteditable=true]'));
  if (!(event.ctrlKey || event.metaKey) || !onCommand || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === 's') { event.preventDefault(); event.stopPropagation(); onCommand('save'); return true; }
  if (input) return false;
  if (key === 'z' || key === 'y') {
    event.preventDefault(); event.stopPropagation(); onCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo'); return true;
  }
  return false;
}
