import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { importFieldSource, importSiValue } from '../ui/fusion/import-facts.ts';

const catalogue = JSON.parse(readFileSync(new URL('../core/studio_core/catalogues/people_mv_xlpe.json', import.meta.url), 'utf8'));
const associatedUpload = { file: '人民电器公开结构表.xlsx', sheet: '表2 YJV', row: 5, column: null, reviewed: false };

test('import field source presentation distinguishes actual table cells from declarations and standard lookups', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.fusion.config.ts', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { ImportFieldSource } = await server.ssrLoadModule('/ui/fusion/structure-import.tsx');
  const render = (value: Record<string, unknown>) => renderToStaticMarkup(createElement(ImportFieldSource, { value }));

  await t.test('all four explicit people-mv supplements show their saved basis, not the associated manufacturer row', () => {
    for (const field of ['binder_thickness', 'conductor_screen_thickness', 'insulation_screen_thickness', 'screen_tape_thickness']) {
      const source = { ...associatedUpload, kind: 'user', origin: 'series', field,
        reference: catalogue.import_declaration.common_basis[field] };
      const before = JSON.stringify(source);
      const html = render(source);
      assert.match(html, /data-source-origin="series"/);
      assert.ok(html.includes('显式声明 / 引用补入'));
      assert.ok(html.includes(source.reference), 'the actual saved declaration must be visible without opening another disclosure');
      assert.doesNotMatch(html, /data-source-location|原表抄录|第 5 行/);
      assert.ok(!html.includes(associatedUpload.file), 'the upload associated with a row must not become the source of a supplement');
      assert.equal(JSON.stringify(source), before);
    }
  });

  await t.test('an actual table cell retains its exact file, sheet, row and column without claiming it was reviewed', () => {
    const html = render({ ...associatedUpload, kind: 'manufacturer', origin: 'table', column: 'A', reference: null });
    assert.match(html, /data-source-origin="table"/);
    assert.match(html, /data-source-location/);
    for (const part of ['原表抄录', associatedUpload.file, associatedUpload.sheet, '第 5 行', 'A 列', '来源待核对']) assert.ok(html.includes(part));
    assert.doesNotMatch(html, /来源已核对/);
  });

  await t.test('R20 cites the saved standard maximum and preserves its complete query evidence', () => {
    const reference = { schema: 'cablesim.standard-basis-ref/1', standard: 'GB/T 3956', edition: '2008', locator: '表 2',
      record: { citation: 'GB/T 3956—2008 表 2，第 4 页（PDF 第 7 页）', row_label: '25 mm²',
        quantity: { key: 'resistance_20_max', name: '20 °C最大电阻—不镀金属铜导体', unit: 'ohm/km' },
        value: 0.727, semantic: 'standard_limit', criterion: 'maximum',
        conditions: { conductor_class: { eq: 2 }, conductor_material: { eq: 'copper' }, coating: { eq: 'plain' } },
        limitations: ['表内铝/铝合金列值是直接摘录；铝合金修正及特殊用途注释须另核对相应条款，不能当作已经批准的工程限值。'] },
      query: { quantity: 'resistance_20_max', conditions: { area_m2: 2.4999999999999998e-5, conductor_class: 2 } },
      source_sha256: 'b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939' };
    const source = { ...associatedUpload, kind: 'standard', origin: 'standard', reference };
    const before = JSON.stringify(source);
    const html = render(source);
    assert.match(html, /data-source-origin="standard"/);
    for (const part of ['标准查询', reference.record.citation, reference.record.quantity.name, '适用规格：25 mm²', '标准上限（非厂家实测）', '完整查询依据']) assert.ok(html.includes(part));
    assert.doesNotMatch(html, /data-source-location|原表抄录|第 5 行/);
    assert.ok(!html.includes(associatedUpload.file));
    assert.strictEqual(importFieldSource(source).reference, reference, 'the full saved query, limitations and hashes remain available');
    assert.equal(JSON.stringify(source), before);
    const unspecified = render({ ...source, reference: { record: { quantity: { name: '最大电阻' } } } });
    assert.ok(!unspecified.includes('标准上限（非厂家实测）'), 'the limit classification requires saved semantics, not an inference from a name');
  });

  await t.test('missing or conflicting provenance stays unknown even when an upload location is present', () => {
    for (const value of [{ kind: 'manufacturer' }, { kind: 'standard' }, { kind: 'manufacturer', origin: 'series' }]) {
      const html = render({ ...associatedUpload, ...value });
      assert.match(html, /data-source-origin="unknown"/);
      assert.ok(html.includes('来源类型未明确'));
      assert.doesNotMatch(html, /data-source-location|第 5 行/);
      assert.ok(!html.includes(associatedUpload.file));
    }
    const demo = render({ ...associatedUpload, kind: 'demo', origin: 'table', column: 'B' });
    assert.ok(demo.includes('原表抄录 · 演示数据'), 'a known demo source must retain its qualification');
  });
});

test('SI display removes conversion tails without changing saved values or discarding meaningful precision', () => {
  const saved = { area: 2.4999999999999998e-5, insulation: 0.0045000000000000005 };
  const original = JSON.stringify(saved);
  assert.equal(importSiValue(saved.area), '0.000025');
  assert.equal(importSiValue(saved.insulation), '0.0045');
  assert.equal(JSON.stringify(saved), original);
  for (const value of [1.234567890123456, 1234567890123456, 0.000727, 1e-20, Number.MIN_VALUE])
    assert.equal(importSiValue(value), String(value), 'meaningful saved precision and small nonzero values must remain visible');
  assert.equal(importSiValue('0.0045000000000000005'), '0.0045000000000000005', 'a supplied textual value is not numeric conversion noise');
});
