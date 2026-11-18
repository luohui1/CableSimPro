import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  assertFormalSource, formalPreview, formalExport, formalFilename,
} from '../src/api/formal-deliveries.ts';

const zero = '0'.repeat(64);
const one = '1'.repeat(64);
const two = '2'.repeat(64);
const request = () => ({
  kind: 'calculation',
  source: { workspace_id: 'saved-engineering-workspace', expected_revision: 3,
    runs: [{run_id: 'complete-saved-run', input_digest: one, output_digest: two}] },
  document: {organization: '测试工程单位', number: 'ENGINEERING-001', revision: 'A',
    header: '原样数据', footer: '完整追溯'},
});
const model = () => ({
  kind: 'calculation', model_digest: zero, source_digest: two,
  title: '计算书', sections: [{role: 'body', heading: '工程值', table_ids: []}],
  signatures: [{role: 'design', label: '设计', name: null, date: null}],
  sources: {'run:complete-saved-run': {kind: 'run', payload_digest: one}},
});
const response = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

test('正式交付必须固定当前型号摘要或完整保存运行，不能临时补数', () => {
  assert.doesNotThrow(() => assertFormalSource(request()));
  assert.throws(() => assertFormalSource({...request(), source: {...request().source, expected_revision: -1}}));
  assert.throws(() => assertFormalSource({...request(), source: {...request().source, runs: [{run_id:'r', input_digest:'bad', output_digest:two}]}}));
  assert.throws(() => assertFormalSource({...request(), kind: 'specification'}));
  const spec = {kind:'specification',source:{workspace_id:'saved-type',expected_revision:4,specification_digest:one},
    document: request().document};
  assert.doesNotThrow(() => assertFormalSource(spec));
  assert.throws(() => assertFormalSource({...spec, source: {...spec.source, runs: request().source.runs}}));
  assert.throws(() => assertFormalSource({...spec, document: {...spec.document, organization: ''}}));
});

test('预览只接受可验证摘要，且不允许回传未经授权的完整来源', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {globalThis.fetch = previous;});
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([url, JSON.parse(init.body)]);
    return response(model());
  };
  const preview = await formalPreview(request());
  assert.equal(preview.model_digest, zero);
  assert.deepEqual(seen, [['/api/formal-deliveries/preview', request()]]);
  globalThis.fetch = async () => response({...model(), sources: {source: {payload: {secret:'must not leak'}}}});
  await assert.rejects(() => formalPreview(request()), /未授权/);
  globalThis.fetch = async () => response({detail: {code:'FORMAL_SOURCE_CHANGED',message:'来源版本变化'}}, 409);
  await assert.rejects(() => formalPreview(request()), /来源版本变化/);
});

test('下载只接受同一预览摘要、同一来源和确切文件字节 SHA256', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {globalThis.fetch = previous;});
  const pdf = '%PDF-1.7\\nverified';
  const fileHash = createHash('sha256').update(pdf).digest('hex');
  const headers = {
    'X-Delivery-Model-SHA256': zero,
    'X-Delivery-Source-SHA256': two,
    'X-Artifact-SHA256': fileHash,
    'Cache-Control': 'no-store',
  };
  const outgoing = [];
  globalThis.fetch = async (url, init) => {
    outgoing.push([url, JSON.parse(init.body)]);
    return new Response(pdf, {status:200, headers});
  };
  const result = await formalExport(request(), model(), 'pdf');
  assert.equal(result.type, 'application/pdf');
  assert.equal(await result.text(), pdf);
  assert.equal(outgoing[0][0], '/api/formal-deliveries/export');
  assert.equal(outgoing[0][1].expected_model_digest, zero);
  assert.equal(outgoing[0][1].source.runs[0].output_digest, two);
  globalThis.fetch = async () => new Response(pdf, {status:200, headers: {...headers, 'X-Artifact-SHA256': one}});
  await assert.rejects(() => formalExport(request(), model(), 'pdf'), /字节摘要/);
  globalThis.fetch = async () => new Response(pdf, {status:200, headers: {...headers, 'X-Delivery-Source-SHA256': one}});
  await assert.rejects(() => formalExport(request(), model(), 'pdf'), /来源不一致/);
  globalThis.fetch = async () => response({detail: {message:'预览后的来源已经变化'}}, 409);
  await assert.rejects(() => formalExport(request(), model(), 'pdf'), /已经变化/);
});

test('文件名使用用户提供的编号但拒绝路径字符', () => {
  assert.equal(formalFilename({...request(),document:{...request().document,number:'规格/A:*001'}}, 'xlsx'), '规格_A__001-calculation.xlsx');
});
