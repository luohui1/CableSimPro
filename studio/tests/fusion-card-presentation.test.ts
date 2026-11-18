import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('the saved ampacity card keeps its accessible temperature evidence without a hidden text probe', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.fusion.config.ts', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { RatingCard } = await server.ssrLoadModule('/ui/kit/chat/cards.tsx');
  const props = {
    title: '直埋校核 · 第 2 条记录', tier: 'reference', current: '748.3', basis: '全回路共同能力 · IEC 60287 载流量 1.2.3',
    limiting: { name: '回路 1 · A 相', conductor: 65.5, limit: 90, ambient: 25, load: '600 A', margin: '148.3 A' },
  };
  const original = structuredClone(props);
  const html = renderToStaticMarkup(createElement(RatingCard, props));
  const text = html.replace(/<[^>]+>/g, ' ');
  for (const label of [props.title, props.basis, '748.3', '回路 1 · A 相', '65.5', '90', '600 A', '148.3 A']) assert.ok(text.includes(label));
  assert.doesNotMatch(text, /(?:^|\s)x(?:\s|$)/, 'Base UI meter used to append a literal x to copied and extracted card text');
  assert.match(html, /role="meter"/);
  assert.match(html, /aria-valuemin="25"/);
  assert.match(html, /aria-valuemax="90"/);
  assert.match(html, /aria-valuenow="65.5"/);
  assert.match(html, /aria-valuetext="65\.5 °C，限值 90 °C"/);
  const label = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(label && html.includes(`id="${label}"`), 'the meter must be labelled by the rendered conductor-temperature text');
  assert.ok(html.includes('data-icon="calc/ampacity"') && html.includes('<path'), 'the local SVG remains loaded');
  assert.deepEqual(props, original);

  const over = renderToStaticMarkup(createElement(RatingCard, { ...props, limiting: { ...props.limiting, conductor: 95 } }));
  assert.match(over, /aria-valuenow="90"/);
  assert.match(over, /aria-valuetext="95\.0 °C，限值 90 °C"/);
  assert.match(over, /<rect width="100"/);
  assert.match(over, /text-error/);
  assert.ok(over.replace(/<[^>]+>/g, ' ').includes('95.0'), 'an over-limit result remains visible and is not replaced by the clipped bar value');
});
