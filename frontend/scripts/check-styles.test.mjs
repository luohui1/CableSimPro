import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectStyles } from './check-styles.mjs';

test('拒绝 JSX style、对象展开 style、颜色和任意字号', () => {
  for (const text of [
    '<div style={{ color: "var(--text)" }} />',
    'const props = { style: {} }; <div {...props} />',
    '<div className="bg-red-500 text-sm rounded-lg" />',
    '<div className="text-[14px]" />',
    '<div className="bg-[#ffffff]" />',
    '<div className={`bg-white ${active ? "selected" : ""}`} />',
    'element.style.color = "var(--text)";',
    'element.setAttribute("style", "color: var(--text)");',
  ]) assert.ok(inspectStyles(text, 'page.tsx').length > 0, text);
});
test('拒绝 CSS 色值、命名色、字号和圆角以及 font 简写', () => {
  for (const text of [
    'p { color: #fff; }', 'p { color: rgb(0,0,0); }', 'p { color: white; }',
    'p { font-size: 14px; }', 'p { border-radius: 8px; }', 'p { font: 14px sans-serif; }',
  ]) assert.ok(inspectStyles(text, 'page.css').length > 0, text);
});
test('令牌映射、布局尺寸和真实语义类不误报', () => {
  assert.deepEqual(inspectStyles('p { color: var(--text); font-size: var(--text-body); border-radius: var(--radius-input); width: 100%; }', 'theme.css'), []);
  assert.deepEqual(inspectStyles('<div className="bg-panel text-ui-body rounded-ui-input" />', 'page.tsx'), []);
});
