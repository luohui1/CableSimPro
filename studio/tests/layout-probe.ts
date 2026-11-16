// The layout check every walk runs in the page: no text may overlap another label or a tool, and none may be cut off unless it ends
// in an ellipsis (or a fade with its whole name in a tooltip) on purpose or lie outside the window. It runs inside the browser, so it can only use what the page has.
/** Runs in the page: returns one line per layout problem. */
export function probe(): string[] {
  const issues: string[] = [];
  const box = (element: Element) => element.getBoundingClientRect();
  const shown = (element: Element) => {
    const rect = box(element);
    const style = getComputedStyle(element);
    // Screen-reader labels are intentionally clipped to a 1px box; they are not visible text overflow.
    const screenReaderOnly = (style.position === 'absolute' || style.position === 'fixed') && rect.width <= 1 && rect.height <= 1
      && (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)');
    if (screenReaderOnly) return false;
    const scrollTable = element.closest('[data-scroll-table]');
    if (scrollTable) { const area = box(scrollTable); if (rect.right <= area.left || rect.left >= area.right || rect.bottom <= area.top || rect.top >= area.bottom) return false; }
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

  for (const element of document.querySelectorAll('body *')) {
    if (!(element instanceof HTMLElement) || element.children.length || !element.textContent?.trim() || !shown(element)) continue;
    const style = getComputedStyle(element);
    // A name that fades out at the end of its line, with the whole name in its tooltip, is cut on purpose (the kit's list items).
    const named = element.closest('[title]') !== null || element.classList.contains('fade-end');
    if (style.textOverflow !== 'ellipsis' && !named && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') {
      issues.push(`cut off: "${element.textContent.trim().slice(0, 40)}"`);
    }
    const rect = box(element);
    if (!element.closest('[data-scroll-table]') && (rect.right > innerWidth + 1 || rect.left < -1)) issues.push(`outside the window: "${element.textContent.trim().slice(0, 40)}"`);
  }

  const labels = [...document.querySelectorAll('[data-chip], [data-dimension], svg[role="img"] text')].filter(shown);
  const tools = [...document.querySelectorAll('[data-overlays] > *')].filter(shown);
  labels.forEach((label, index) => {
    for (const other of labels.slice(index + 1)) {
      if (cross(box(label), box(other))) issues.push(`labels overlap: "${label.textContent}" × "${other.textContent}"`);
    }
    for (const tool of tools) {
      if (cross(box(label), box(tool))) issues.push(`label under a tool: "${label.textContent}"`);
    }
  });
  return issues;
}
