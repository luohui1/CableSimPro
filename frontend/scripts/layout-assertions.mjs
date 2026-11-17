import assert from "node:assert/strict";
import { assertVisibleNames } from './visible-names.mjs';
export async function assertLayout(page, label, nameOptions) {
  await assertVisibleNames(page, label, nameOptions);
  await assertDropdownArrows(page, label);
  const result = await page.evaluate(() => {
    const seen = [
      ...document.querySelectorAll(
        "h1,h2,h3,p,span,small,b,strong,summary,legend,output,label,button,a,td,th,dt,dd,input,select,textarea,text",
      ),
    ].filter((node) => {
      const box = node.getBoundingClientRect();
      if (getComputedStyle(node).visibility === 'hidden') return false;
      let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(node)) return false;
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/(hidden|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      return (
        right - left > 1 &&
        bottom - top > 1 &&
        (node.textContent.trim() || node.value) &&
        !node.closest('[aria-hidden="true"]')
      );
    });
    const font = Math.min(
      ...seen.map((node) => parseFloat(getComputedStyle(node).fontSize)),
    );
    function rgba(color) {
      const values = color.match(/[\d.]+/g)?.map(Number) || [];
      return values.length >= 3
        ? [...values.slice(0, 3), values[3] ?? 1]
        : [0, 0, 0, 0];
    }
    function over(a, b) {
      return [0, 1, 2]
        .map((index) => a[index] * a[3] + b[index] * (1 - a[3]))
        .concat(1);
    }
    function background(node) {
      if (!node) return [255, 255, 255, 1];
      const color = rgba(getComputedStyle(node).backgroundColor);
      return color[3] === 1
        ? color
        : over(color, background(node.parentElement));
    }
    function luminance(rgb) {
      return rgb
        .slice(0, 3)
        .map((value) => value / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    }
    const contrast = [];
    for (const node of seen.filter(
      (node) =>
        !node.children.length &&
        !node.matches("svg text") &&
        !node.closest("svg,[disabled],[data-disabled]"),
    )) {
      const style = getComputedStyle(node);
      if (parseFloat(style.opacity) < 1) continue;
      const fg = rgba(style.color),
        bg = background(node),
        a = luminance(over(fg, bg)),
        b = luminance(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const threshold = parseFloat(style.fontSize) >= 24 ? 3 : 4.5;
      if (ratio + 0.02 < threshold)
        contrast.push({
          text: (node.textContent || node.value || "").slice(0, 80),
          ratio,
          color: style.color,
          background: bg,
        });
    }
    const zones = [".nav-rail", ".module-sidebar", ".workbench-sidebar", ".work-panel"].map(
      (selector) => ({
        selector,
        box: document.querySelector(selector)?.getBoundingClientRect(),
      }),
    );
    const overlap = [];
    for (let i = 0; i < zones.length; i++)
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i].box,
          b = zones[j].box;
        if (
          a &&
          b &&
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        )
          overlap.push([zones[i].selector, zones[j].selector]);
      }
    const collapsed = [...document.querySelectorAll(".property-collapsed")].map(
      (node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }),
    );
    const painted = node => {
      if (node.closest('[aria-hidden="true"],[inert]') || !node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
    };
    const primaryScope = [...document.querySelectorAll('[role="dialog"]')].find(painted) || document;
    const primaryLabels = [
      ...primaryScope.querySelectorAll(".button-primary,.button-run"),
    ].filter(node => painted(node) && !node.disabled)
      .map(node => node.textContent.trim() || node.getAttribute('aria-label'));
    const primary = primaryLabels.length;
    return {
      overflow:
        document.documentElement.scrollWidth > innerWidth + 1 ||
        document.documentElement.scrollHeight > innerHeight + 1,
      font,
      contrast,
      overlap,
      collapsed,
      primary,
      primaryLabels,
    };
  });
  assert.equal(result.overflow, false, label + ": 页面越界");
  assert.ok(result.font >= 13, label + ": 字号不足 " + result.font);
  assert.deepEqual(result.overlap, [], label + ": 工作区重叠");
  assert.deepEqual(
    result.contrast,
    [],
    label + ": 文字对比度 " + JSON.stringify(result.contrast.slice(0, 4)),
  );
  assert.ok(
    result.collapsed.every((value) => value.scrollWidth <= value.width),
    label + ": 收起属性栏横向溢出",
  );
  assert.ok(result.primary <= 1, label + ": 多个主操作 " + JSON.stringify(result.primaryLabels));
  return result;
}

/** 共用断言覆盖所有页面和门户下拉；浏览器原生 select 的箭头由浏览器绘制。 */
export async function assertDropdownArrows(page, label) {
  const oversized = await page.locator('[data-select-arrow] svg, .icon[data-icon="action/chevron-down"], .icon[data-icon="action/chevrons-up-down"]').evaluateAll(nodes => nodes.flatMap(node => {
    const box = node.getBoundingClientRect();
    return box.width > 16.1 || box.height > 16.1 ? [{ width: box.width, height: box.height, control: node.closest('button')?.textContent?.trim() }] : [];
  }));
  assert.deepEqual(oversized, [], label + ': 下拉箭头超过 16 px');
}
