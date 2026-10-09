import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const server = await createServer({ configFile: false, root: frontend, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(frontend, 'src') } } });
after(() => server.close());
const { designSummary, versionLabel, publicationStatus, approvedStandardNames } = await server.ssrLoadModule('/src/features/type/design-summary.ts');
const { commandResultLabel, latestModuleRun, moduleResultStatus, moduleEvidenceState, methodLabel } = await server.ssrLoadModule('/src/features/type/evidence.ts');
const document = { name: '测试型号', provenance: {}, materials: [{ id:'cu',category:'conductor' },{ id:'xlpe',category:'insulation' }], cable_types: [{ id:'cable', construction:'single_core', rating:{u0:8700,u:15000}, cores:[{id:'core',conductor:{diameter:.02,nominal_area:300e-6,material:'cu',form:'round'},layers:[{role:'insulation',thickness:.003,material:'xlpe'}]}],common_layers:[] }] };
test('SI display agrees with hand conversion: 8700/15000 V, 300e-6 m², 20+2×3 mm envelope', () => {
  const card = designSummary(document, {});
  assert.equal(card.voltage,'8.7/15 kV'); assert.equal(card.area,'1×300 mm²'); assert.ok(Math.abs(card.diameter-26)<1e-9); assert.equal(card.layers,2);
  assert.equal(card.standards,'未声明'); assert.equal(card.updated,'未提供');
});
test('Nominal display removes padding without rounding away 0.75 mm² or 0.45 kV', () => {
  const next=structuredClone(document); next.cable_types[0].rating={u0:64000,u:110000}; next.cable_types[0].cores[0].conductor.nominal_area=800e-6;
  assert.equal(designSummary(next,{}).voltage,'64/110 kV'); assert.equal(designSummary(next,{}).area,'1×800 mm²');
  next.cable_types[0].rating={u0:450,u:750}; next.cable_types[0].cores[0].conductor.nominal_area=.75e-6;
  assert.equal(designSummary(next,{}).voltage,'0.45/0.75 kV'); assert.equal(designSummary(next,{}).area,'1×0.75 mm²');
});
test('Only current host-approved standards with matching receipt enter the catalog', () => {
  const standard='GB/T 12706.2-2020', item={state:'approved',bindable:true,definition:{standard},approval:{id:'receipt',digest:'a'.repeat(64),definition:{standard}}};
  const ledger={run_id:'run',source_current:true,items:[item,item,{...item,state:'proposed'},{...item,state:'conflict',definition:{standard:'IEC 60502-1'}}]};
  assert.deepEqual(approvedStandardNames(ledger,'run'),[standard]);
  for(const invalid of [{...ledger,source_current:false},{...ledger,run_id:'other'},{...ledger,items:[{...item,approval:null}]},{...ledger,items:[{...item,approval:{...item.approval,definition:{standard:'other'}}}]}]) assert.deepEqual(approvedStandardNames(invalid,'run'),[]);
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
test('Latest current-input running/failed attempts stay visible; old failures do not replace current results', () => {
  const installed={method:{plugin_id:'test-method'},capabilities:[{id:'electrical',artifacts:[{type:'x-cablesim.type-electrical'}]}]};
  const active={...run,created:'2026-10-08T10:00:00Z',status:'queued',output:{},snapshot:{workspace_revision:4,definition:{method:{plugin_id:'test-method',capability:'electrical'}}}};
  assert.equal(moduleResultStatus([{study,run:active}],'electrical',4,false,[installed]).label,'运行中');
  const failed={...active,status:'failed',error:{message:'字段缺项'}};
  assert.equal(moduleResultStatus([{study,run:failed}],'electrical',4,false,[installed]).reason,'字段缺项');
  const good={...run,created:'2026-10-08T11:00:00Z'};
  assert.equal(latestModuleRun([{study,run:failed},{study,run:good}],'electrical',[installed]).id,good.id);
  assert.equal(moduleResultStatus([{study,run:failed},{study,run:good}],'electrical',4,false,[installed]).label,'当前');
});
test('Command status contains one short state, local saved time and method version', () => {
  assert.equal(commandResultLabel({kind:'unknown',label:'未运行'}),'尚未运行');
  assert.equal(commandResultLabel({kind:'current',label:'当前'},run,true),'有未保存修改');
  const saved={...run,created:'2026-10-08T10:57:00Z',snapshot:{definition:{method:{version:'1.0.1'}}}};
  const date=new Date(saved.created), pad=n=>String(n).padStart(2,'0');
  assert.equal(commandResultLabel({kind:'current',label:'当前'},saved),`最近运行 ${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} · 成功`);
  assert.equal(commandResultLabel({kind:'historical',label:'过期'},saved),'已过期 · 方法 1.0.1');
  assert.equal(commandResultLabel({kind:'error',label:'失败'},saved),'失败');
});
