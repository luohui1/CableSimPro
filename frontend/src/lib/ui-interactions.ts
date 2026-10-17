/** UI-only keyboard policy. It never rewrites engineering values or triggers a calculation. */
export const interactiveRowSelector = 'a[href],button,label,input,select,textarea,summary,[role="button"],[role="link"],[role="combobox"],[role="checkbox"],[role="switch"],[contenteditable]:not([contenteditable="false"])';
export function composing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
export function neighborIndex(index: number, length: number, key: string): number | null {
  if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(index) || index < 0 || index >= length) return null;
  switch (key) {
    case 'ArrowDown': return Math.min(length - 1, index + 1);
    case 'ArrowUp': return Math.max(0, index - 1);
    case 'Home': return 0;
    case 'End': return length - 1;
    default: return null;
  }
}
export function canConfirmDialog(input: { key: string; defaultPrevented: boolean; composing: boolean; inputType: string | null; insideForm: boolean }): boolean {
  return input.key === 'Enter' && !input.defaultPrevented && !input.composing && !input.insideForm
    && input.inputType !== null && ['text', 'number', 'search', 'email', 'url', 'tel', 'password'].includes(input.inputType);
}
