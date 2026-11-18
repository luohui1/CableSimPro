import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Children, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('large fusion proposals retain every reviewed change while keeping decisions outside the disclosure', async t => {
  // Render the actual kit components and Base UI disclosure. Browser geometry and keyboard interaction remain in the real walk.
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.fusion.config.ts', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { ProposalCard } = await server.ssrLoadModule('/ui/kit/chat/cards.tsx');
  const { Disclosure } = await server.ssrLoadModule('/ui/kit/disclosure.tsx');
  const changes = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `change-${index}`, label: `工况 ${index + 1} 的输入字段与来源`,
    before: `${index + 1} K·m/W · 保存来源 ${index + 1}`, after: `${index + 2} K·m/W · 已声明的新来源 ${index + 1}`,
  }));
  function render(count: number, collapseChangesAfter?: number) {
    let tree: ReactNode;
    function Capture() {
      tree = ProposalCard({ action: '新建载流量表', subject: '保存的工况', phase: 'pending', changes: changes(count),
        collapseChangesAfter, onAccept() {}, onReject() {}, busy: false });
      return tree;
    }
    const html = renderToStaticMarkup(createElement(Capture));
    return { html, tree };
  }
  function disclosure(node: ReactNode): ReactElement<{ defaultOpen?: boolean; children?: ReactNode }> | undefined {
    if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
    if (node.type === Disclosure) return node;
    return Children.toArray(node.props.children).map(disclosure).find(Boolean);
  }
  function hasDecisions(html: string) {
    const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1];
    assert.ok(footer, 'decision controls must remain in the outer proposal footer');
    assert.match(footer, /接受/);
    assert.match(footer, /拒绝/);
    assert.doesNotMatch(footer, /\sdisabled(?:\s|=|>)|\saria-disabled="true"/);
    assert.doesNotMatch(footer, /data-slot="collapsible/);
  }
  await t.test('eight changes remain expanded with their original values and enabled decisions', () => {
    const { html, tree } = render(8, 8);
    assert.equal(disclosure(tree), undefined);
    for (const change of changes(8)) for (const value of [change.label, change.before, change.after]) assert.ok(html.includes(value));
    hasDecisions(html);
  });
  await t.test('twenty-four changes start collapsed and expand to every full value, unit and source', () => {
    const { html, tree } = render(24, 8);
    const panel = disclosure(tree);
    assert.ok(panel);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /完整改动/);
    assert.match(html, /共 24 项/);
    assert.ok(!html.includes(changes(24)[0].label), 'the large change list starts closed');
    hasDecisions(html);
    const expanded = renderToStaticMarkup(cloneElement(panel, { defaultOpen: true }));
    assert.match(expanded, /aria-expanded="true"/);
    assert.match(expanded, /data-proposal-changes/);
    assert.equal((expanded.match(/<dt\b/g) ?? []).length, 24);
    for (const change of changes(24)) for (const value of [change.label, change.before, change.after]) assert.ok(expanded.includes(value));
    assert.doesNotMatch(expanded, /接受|拒绝/, 'human decision controls must not be inside the collapsible content');
  });
  await t.test('callers that do not opt in keep the previous expanded presentation', () => {
    const { html, tree } = render(24);
    assert.equal(disclosure(tree), undefined);
    assert.ok(html.includes(changes(24).at(-1)!.after));
    hasDecisions(html);
  });
});
