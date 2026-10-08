import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const server = await createServer({ configFile: false, root: frontend, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(frontend, 'src') } } });
after(() => server.close());
const { designSummary, versionLabel, publicationStatus } = await server.ssrLoadModule('/src/features/type/design-summary.ts');
const { moduleResultStatus, moduleEvidenceState, methodLabel } = await server.ssrLoadModule('/src/features/type/evidence.ts');
const document = { name: '测试型号', provenance: {}, materials: [{ id:'cu',category:'conductor' },{ id:'xlpe',category:'insulation' }], cable_types: [{ id:'cable', construction:'single_core', rating:{u0:8700,u:15000}, cores:[{id:'core',conductor:{diameter:.02,nominal_area:300e-6,material:'cu',form:'round'},layers:[{role:'insulation',thickness:.003,material:'xlpe'}]}],common_layers:[] }] };
test('SI display agrees with hand conversion: 8700/15000 V, 300e-6 m², 20+2×3 mm envelope', () => {
  const card = designSummary(document, {});
  assert.equal(card.voltage,'8.7/15.0 kV'); assert.equal(card.area,'1×300.0 mm²'); assert.ok(Math.abs(card.diameter-26)<1e-9); assert.equal(card.layers,2);
  assert.equal(card.standards,'未声明'); assert.equal(card.updated,'未提供');
});
test('Reference standards are not execution declarations; missing geometry remains missing', () => {
  const next = structuredClone(document); next.provenance['/name']={kind:'standard',reference:'GB/T 12706.2-2020 表 1'}; next.cable_types[0].cores[0].conductor.diameter=0;
  const card = designSummary(next,{type_origin_reference:{version:'1.0.0+engineering',source:'IEC 60502'},declared_standards:['GB/T 12706.2-2020']});
  assert.equal(card.diameter,null); assert.equal(card.version,'1.0.0（工程版）'); assert.equal(card.standards,'GB/T 12706.2-2020');
  assert.equal(designSummary(next,{}).standards,'未声明');
});
test('Publication and edit status remain separate; stale approval returns draft', () => {
  assert.equal(versionLabel('1.0.0+engineering'),'1.0.0（工程版）'); assert.equal(versionLabel(''),'未提供');
  for(const [status,expected] of [['draft','draft'],['submitted','review'],['approved','review'],['published','published']]) assert.equal(publicationStatus({type_lifecycle:{status}}),expected);
  assert.equal(publicationStatus({type_lifecycle:{status:'approved',stale:true}}),'draft');
});
const method = {platform_supported:true,capabilities:[{input_schema:'cablesim.domain/1',artifacts:[{type:'x-cablesim.type-electrical'}]}]};
const run = { id:'run',status:'succeeded',integrity:'verified',freshness:'current',snapshot:{workspace_revision:4},output:{cases:[{status:'succeeded',artifacts:{result:{schema:'cablesim.type-analysis/1'}}}]} };
const study = {definition:{method:{capability:'electrical'}}};
test('Result state covers unavailable, never run, current and stale from saved evidence', () => {
  assert.equal(moduleResultStatus([],'electrical',4,false,[]).label,'未接入');
  assert.equal(moduleResultStatus([],'electrical',4,false,[method]).label,'未运行');
  assert.equal(moduleResultStatus([{run,study}],'electrical',4,false,[method]).label,'当前');
  assert.equal(moduleResultStatus([{run,study}],'electrical',4,true,[method]).label,'过期');
  assert.equal(moduleResultStatus([{run,study}],'electrical',5,false,[method]).label,'过期');
});
test('Invalid integrity and failed cases cannot be labeled current', () => {
  assert.equal(moduleEvidenceState([{run:{...run,integrity:'invalid'},study}],'electrical',4,false),'none');
  const failed=structuredClone(run); failed.output.cases[0].status='failed';
  assert.equal(moduleEvidenceState([{run:failed,study}],'electrical',4,false),'none');
  assert.equal(moduleResultStatus([],'electrical',4,false,[{...method,platform_supported:false}]).label,'未接入');
});
test('Display method labels keep release identity out of visible text', () => {
  assert.doesNotMatch(methodLabel({snapshot:{definition:{method:{plugin_id:'cablesim.type-electrical',version:'0.3.0',release_digest:'a'.repeat(64)}}}}),/cablesim\.|[a-f0-9]{64}/);
});
test('Rating result needs a successful saved trace; a driver configuration alone is not a result', () => {
  const ratingMethod={platform_supported:true,capabilities:[{input_schema:'cablesim.domain/1',artifacts:[{type:'x-cablesim.iec60287-trace'}]}]};
  const rating=structuredClone(run); rating.snapshot.definition={driver:{kind:'batch',cases:[{metadata:{kind:'type-rating-table'}}]}};
  assert.equal(moduleResultStatus([{run:rating,study}],'rating-table',4,false,[ratingMethod]).label,'未运行');
  rating.output.cases[0].artifacts={'x-cablesim.iec60287-trace':{ampacity_a:100}};
  assert.equal(moduleResultStatus([{run:rating,study}],'rating-table',4,false,[ratingMethod]).label,'当前');
  rating.output.cases[0].status='failed';
  assert.equal(moduleResultStatus([{run:rating,study}],'rating-table',4,false,[ratingMethod]).label,'未运行');
});
