// The layout probe of the walks. It runs in the page and returns one line per problem: text that is cut off, text outside the
// window, a label of the drawing over another label, and a label under the canvas frame's tools, view switch or temperature scale.
export function probe(): string[] {
  const issues: string[] = [];
  const box = (element: Element) => element.getBoundingClientRect();
  const shown = (element: Element) => {
    const rect = box(element);
    const style = getComputedStyle(element);
    // Screen-reader labels and the helpers of the controls are intentionally a 1px box; they are not visible text overflow.
    if ((style.position === 'absolute' || style.position === 'fixed') && rect.width <= 1 && rect.height <= 1) return false;
    const scrollTable = element.closest('[data-scroll-table]');
    if (scrollTable) { const area = box(scrollTable); if (rect.right <= area.left || rect.left >= area.right || rect.bottom <= area.top || rect.top >= area.bottom) return false; }
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

  for (const element of document.querySelectorAll('body *')) {
    if (!(element instanceof HTMLElement) || element.children.length || !element.textContent?.trim() || !shown(element)) continue;
    const style = getComputedStyle(element);
    if (style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') {
      issues.push(`cut off: "${element.textContent.trim().slice(0, 40)}"`);
    }
    const rect = box(element);
    if (!element.closest('[data-scroll-table]') && (rect.right > innerWidth + 1 || rect.left < -1)) issues.push(`outside the window: "${element.textContent.trim().slice(0, 40)}"`);
  }

  // What the drawing writes on itself, and what the frame floats over it.
  const labels = [...document.querySelectorAll('[data-chip], [data-dimension], svg[role="img"] text')].filter(shown);
  const legend = [...document.querySelectorAll('span')].filter(span => !span.children.length && /^(颜色是土壤温度|导体的颜色是温度)$/.test(span.textContent ?? '')).map(span => span.parentElement?.parentElement).filter((element): element is HTMLElement => Boolean(element));
  const chrome = [...document.querySelectorAll('[data-overlays] > *, [aria-label="画布工具"], [aria-label="视图"]'), ...legend].filter(shown);
  labels.forEach((label, index) => {
    for (const other of labels.slice(index + 1)) {
      if (cross(box(label), box(other))) issues.push(`labels overlap: "${label.textContent}" × "${other.textContent}"`);
    }
    for (const tool of chrome) {
      if (cross(box(label), box(tool))) issues.push(`label under the frame: "${label.textContent}"`);
    }
  });
  return issues;
}
