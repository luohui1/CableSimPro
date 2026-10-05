import { useEffect } from 'react';

export function useShortcuts(onUnavailable: (title: string) => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLElement && !!event.target.closest('input, textarea, [contenteditable="true"]');
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); onUnavailable('保存尚未接入'); }
      if (event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); onUnavailable('已保存修订的撤销尚未接入'); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onUnavailable]);
}
