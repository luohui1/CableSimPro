import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const server = await createServer({ configFile: false, root: frontend, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(frontend, 'src') } } });
after(() => server.close());
const { designSummary, versionLabel, publicationStatus, approvedStandardNames } = await server.ssrLoadModule('/src/features/type/design-summary.ts');
const { commandResultLabel, latestModuleRun, moduleResultStatus, moduleEvidenceState, methodLabel, chooseEvidence, currentEvidence } = await server.ssrLoadModule('/src/features/type/evidence.ts');
const { quantityLayer, quantityMissingInputs } = await server.ssrLoadModule('/src/features/type/quantity-inputs.ts');
const { pointer } = await server.ssrLoadModule('/src/lib/domain-fields.ts');
const { resultValue } = await server.ssrLoadModule('/src/features/type/standard-check.tsx');
const { corrugatedDisplay } = await server.ssrLoadModule('/src/features/type/display-envelope.ts');
const { colorScene } = await server.ssrLoadModule('/src/features/cad/saved-thermal.ts');
const { temperatureRgb } = await server.ssrLoadModule('/src/features/cad/difference-colormap.ts');
const tokens = readFileSync(path.join(frontend,'../design/tokens.css'),'utf8');
const palette = [...tokens.matchAll(/--temperature-[1-6]:\s*(#[0-9a-fA-F]{6})/g)].slice(0,6).map(m=>[1,3,5].map(i=>parseInt(m[1].slice(i,i+2),16)/255));
const { sectionComposition } = await server.ssrLoadModule('/src/features/drawing/section-composition.ts');
const { leaderLayout, segmentsIntersect, layerMillimetres } = await server.ssrLoadModule('/src/features/drawing/layer-leaders.ts');
const {identicalCoreRows,issuePresentation,reviewGroups}=await server.ssrLoadModule('/src/features/type/result-presentation.ts');
const {analysisValue}=await server.ssrLoadModule('/src/features/type/analysis.tsx');
const {resultCitation,formulaInput}=await server.ssrLoadModule('/src/features/type/result-detail.tsx');
const {ratingConditionNumber}=await server.ssrLoadModule('/src/features/type/rating-table.tsx');
const {SavedFormula}=await server.ssrLoadModule('/src/features/type/saved-formula.tsx');
const {dimensionBasis}=await server.ssrLoadModule('/src/features/type/dimension-basis.ts');
test('Saved short-circuit expression has semantic subscripts; unknown expressions remain verbatim',()=>{
  const html=renderToStaticMarkup(createElement(SavedFormula,{value:'I_AD=K S √{ln[(θ_f+β)/(θ_i+β)]/t}'}));
  assert.match(html,/<sub>AD<\/sub>/);assert.match(html,/<sub>f<\/sub>/);assert.match(html,/<sub>i<\/sub>/);
  assert.match(html,/K·S·√/);
  assert.equal(dimensionBasis(JSON.stringify({schema:'cablesim.standard-basis-ref/1',record:{citation:'GB/T 12706.2—2020 表 7，第 7 页',value:4.5,quantity:{name:'绝缘标称厚度',unit:'mm'},id:'internal-record'}})), 'GB/T 12706.2—2020 表 7，第 7 页\n绝缘标称厚度：4.5 mm');
  assert.match(renderToStaticMarkup(createElement(SavedFormula,{value:'X = custom(S)'})),/X = custom\(S\)/);
});
test('Rating conditions keep metre precision consistent with the table and counts integral',()=>{
  assert.equal(ratingConditionNumber('depth_m',.800000000000001,'m'),'0.80');
  assert.equal(ratingConditionNumber('circuit_count',3),'3');
  assert.equal(ratingConditionNumber('ambient_temperature_c',20.00000000000003,'°C'),'20.0');
});
test('Saved current uses engineering precision while trace preserves the exact saved value',()=>{
  const row={value:42925.05199845332,unit:'A'};
  assert.equal(analysisValue(row),'42.9 kA');assert.equal(analysisValue(row,true),'42.92505199845332 kA');
  assert.equal(formulaInput('I_AD_A',row.value).value,'42 925.1');
  assert.equal(formulaInput('t_s',1.000000000000003).value,'1');
  assert.equal(formulaInput('beta_K',234.5).unit,'K');
  assert.equal(formulaInput('S_mm2',800).unit,'mm²');
});
test('Saved source joins clause and both page systems without changing evidence or formula',()=>{
  assert.equal(resultCitation({standard:'IEC 60949:1988',clause:'第 3 章；表 I',printed_page:9,pdf_page:3}),'IEC 60949:1988 第 3 章 表 I · 第 9 页（PDF 第 3 页）');
  assert.match(resultCitation({standard:'IEC 60949:1988',clause:'第 3 章'}),/本库暂未收录/);
});
test('Three identical core results collapse; different values, missing cores and different conditions remain separate',()=>{
  const rows=['a','b','c'].map((id,i)=>({id:id+':conductor-adiabatic',title:`芯 ${i+1} · 导体允许短路电流`,target:{scope:'core',core_id:id,role:'conductor'},status:'available',value:42900,unit:'A',formula_inputs:{t_s:1}}));
  const grouped=identicalCoreRows(rows,['a','b','c']);assert.equal(grouped.length,1);assert.match(grouped[0].title,/3 芯相同/);assert.deepEqual(grouped[0].members,rows);
  for(const next of [rows.slice(0,2),rows.map((r,i)=>i===2?{...r,value:43000}:r),rows.map((r,i)=>i===2?{...r,formula_inputs:{t_s:2}}:r)]) assert.equal(identicalCoreRows(next,['a','b','c']).length,next.length);
});
test('Missing-field actions locate frequency; release blockers group by who resolves them',()=>{
  const missing=issuePresentation({status:'missing',formula_inputs:{f_hz:null,U_phase_V:null}},'electrical','cable');
  assert.equal(missing.field,'/frequency_hz');assert.equal(missing.tab,'parameters');assert.match(missing.reason,/频率、运行相电压/);
  const metal=issuePresentation({status:'missing',missing_parameters:['metal_initial_temperature_k','duration_s']},'short-circuit','cable');
  assert.equal(metal.field,'/metal_initial_temperature_k');assert.match(metal.reason,/金属组件初温、短路时间/);
  const coverage=issuePresentation({verdict:'uncovered',standard:'GB/T 11017.2—2024',clause:'表 2',reason:'未覆盖此结构'},'standard-check','cable');
  assert.equal(coverage.kind,'coverage');assert.match(coverage.reason,/GB\/T 11017.2—2024 · 表 2/);
  const groups=reviewGroups([{id:'old',channel:'electrical',message:'输入已过期',blocking:false},{id:'gap',channel:'standards',blocking:true,result:{verdict:'uncovered'}},{id:'gap-input',channel:'standards',blocking:true,result:{verdict:'uncovered',basis_missing_fields:[{field:'/armour_material',label:'铠装材料'}]}},{id:'field',channel:'electrical',blocking:true,result:{status:'missing'}},{id:'measure',channel:'standards',blocking:true,result:{basis:'measurement'}},{id:'approve',channel:'resources',blocking:true,result:{}}]);
  assert.deepEqual(groups.map(g=>[g.title,g.items.map(item=>item.id)]),[['需要工程师补输入',['gap-input','field']],['需要出厂实测值',['measure']],['标准依据未覆盖',['gap']],['需要人工批准',['approve']]]);
});
test('Layer labels preserve 1.35 mm and show a 34.0 mm diameter without padded thickness precision',()=>{
  assert.equal(layerMillimetres(.00135),'1.35');assert.equal(layerMillimetres(.0162),'16.2');assert.equal(layerMillimetres(.034,true),'34.0');
});
test('Eight layer leaders have distinct mid-radius anchors, ordered labels and no crossing segments',()=>{
  const layers=Array.from({length:8},(_,i)=>({center:{x:300,y:220},radius:40+i*12}));
  const leaders=leaderLayout(layers,440,850,440);
  for(let i=0;i<leaders.length;i++) {
    assert.ok(leaders[i].label.x<850 && leaders[i].label.y>=32 && leaders[i].label.y<=396);
    assert.ok(Math.abs(Math.hypot(leaders[i].anchor.x-300,leaders[i].anchor.y-220)-layers[i].radius)<1e-8);
    if(i) { assert.ok(Math.hypot(leaders[i].anchor.x-leaders[i-1].anchor.x,leaders[i].anchor.y-leaders[i-1].anchor.y)>=8);assert.ok(leaders[i].label.y-leaders[i-1].label.y>=28); }
    for(let j=0;j<i;j++)for(let a=1;a<leaders[i].points.length;a++)for(let b=1;b<leaders[j].points.length;b++)assert.equal(segmentsIntersect(leaders[i].points[a-1],leaders[i].points[a],leaders[j].points[b-1],leaders[j].points[b]),false,`leaders ${i}/${j} segments ${a}/${b}`);
  }
});
test('Equal conductor temperatures use one neutral band position, without a fictitious temperature interval',()=>{
  const scene={assets:{a:{core_id:'core'}},objects:[{id:'c',parts:[{asset_id:'a'}]}]},thermal={minimum:80,maximum:80,conductors:[{id:'c',coreId:'core',value:80}]};
  assert.equal(palette.length,6);assert.deepEqual(colorScene(scene,thermal,undefined,palette).assets.a.display_color,temperatureRgb(.5,palette));assert.equal(thermal.maximum,80);
});
test('140 px canvas: the local drawing keeps 40 mm cables at least 24 px and preserves 1.2 m burial coordinates',()=>{
  const section={kind:'ground',enclosures:[]},geometry={cables:[-.05,0,.05].map(x=>({x,z:-1.2,shape:{radiusM:.02}})),bounds:{left:-.07,right:.07,top:0,bottom:-1.22}};
  const result=sectionComposition(section,geometry,{width:850,height:140},8);assert.equal(result.compact,true);assert.ok(.04*850/result.main.widthM>=24);assert.equal(geometry.cables[0].z,-1.2);assert.equal(result.detail,undefined);
  const short=sectionComposition(section,geometry,{width:590,height:90},8);assert.ok(.04*590/short.main.widthM>=24,'Footer is outside the SVG, so 90 px still leaves readable cable geometry');
});
test('Comparison uses the standard table precision: resistance margin and unitless percentages remain legible', () => {
  assert.equal(resultValue(.00104,{id:'r20',unit:'Ω/km',title:'导体R20'}),'0.0010 Ω/km');
  assert.equal(resultValue(.15,{id:'overlap',unit:'1',title:'搭盖率'}),'15.0 %');
});
const document = { name: '测试型号', provenance: {}, materials: [{ id:'cu',category:'conductor' },{ id:'xlpe',category:'insulation' }], cable_types: [{ id:'cable', construction:'single_core', rating:{u0:8700,u:15000}, cores:[{id:'core',conductor:{diameter:.02,nominal_area:300e-6,material:'cu',form:'round'},layers:[{role:'insulation',thickness:.003,material:'xlpe'}]}],common_layers:[] }] };
test('Wave sheath display follows the nominal 20+2×3+2×1 = 28 mm section; it never declares exact volume or mass',async()=>{
  const doc=structuredClone(document);doc.cable_types[0].cores[0].conductor.form='solid_round';doc.cable_types[0].common_layers=[{role:'metallic_sheath',material:'cu',thickness:.001,form:'corrugated'}];
  const original=structuredClone(doc),model=await corrugatedDisplay(doc,doc.cable_types[0]);assert.ok(Math.abs(model.outer_diameter_m-.028)<1e-12);assert.equal(model.envelope,true);assert.ok(model.layers.every(l=>l.volume_m3===undefined&&l.mass_kg_per_km===undefined&&l.brep===undefined));assert.deepEqual(doc,original);
  doc.cable_types[0].construction='three_core';await assert.rejects(corrugatedDisplay(doc,doc.cable_types[0]),/未覆盖/);
});
test('Missing quantities resolve the saved core and material IDs, including escaped pointers; never fill inputs', () => {
  const row = { target:{scope:'core',coreId:'core/2',role:'conductor'},path:pointer('cable_types','cable','cores','core/2','conductor','diameter'),material:{id:'material/cu'} };
  const other = { ...row,target:{...row.target,coreId:'core/1'} };
  assert.equal(quantityLayer([other,row],{source_target:{scope:'core',core_id:'core/2',role:'conductor'}}),row);
  const before=structuredClone(document);
  assert.deepEqual(quantityMissingInputs(document,row,['材料密度','导体绞入系数']),[
    {label:'材料密度',path:'/materials/material~1cu/density'},
    {label:'导体绞入系数',path:'/cable_types/cable/cores/core~12/conductor/lay_factor'},
  ]);
  assert.deepEqual(document,before);
  assert.equal(quantityLayer([row],{source_target:{scope:'core',core_id:'missing',role:'conductor'}}),undefined);
});
test('Unknown tape material quantity locates absent application, width and count, preserving declared thickness', () => {
  const next=structuredClone(document),layer={role:'metallic_screen',form:'tape',thickness:.0002,nominal_tape_thickness:.0001,material:'cu'};
  next.cable_types[0].cores[0].layers.push(layer);
  const row={path:'/cable_types/cable/cores/core/layers/metallic_screen/thickness',material:{id:'cu'}};
  const fields=quantityMissingInputs(next,row,['金属屏蔽构造']);
  assert.deepEqual(fields.map(f=>f.label),['绕包方式','带宽','带材层数']);
  assert.ok(fields[0].path.endsWith('/tape_application'));assert.equal(layer.nominal_tape_thickness,.0001);
});
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
test('Failed top-level run cannot supply a current result even if a successful case remains', () => {
  const failed={...run,status:'failed'};
  assert.equal(chooseEvidence([{run:failed,study}], 'cablesim.type-analysis/1'),null);
  assert.equal(currentEvidence(failed,4,false),false);
  assert.equal(currentEvidence({...run,integrity:'invalid'},4,false),false);
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
