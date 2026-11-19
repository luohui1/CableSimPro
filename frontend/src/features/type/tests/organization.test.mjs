import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const server = await createServer({ configFile: false, root: frontend, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@': path.join(frontend, 'src') } } });
after(() => server.close());
const { designSummary, versionLabel, publicationStatus, approvedStandardNames, executionStandardsSummary } = await server.ssrLoadModule('/src/features/type/design-summary.ts');
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
const {methodErrorText,MethodErrorDetail}=await server.ssrLoadModule('/src/features/type/method-error.tsx');
const {structureIssue}=await server.ssrLoadModule('/src/features/type/structure-issue.tsx');
const {readTypeEvidenceForWorkspace}=await server.ssrLoadModule('/src/features/type/routes.tsx');
const {fixedRatingEvidenceOptions,typeEvidenceOptions,typeRatingResultsOptions}=await server.ssrLoadModule('/src/features/type/evidence-query.ts');
const {loadWorkspace}=await server.ssrLoadModule('/src/features/type/api.ts');
const {ratingBody}=await server.ssrLoadModule('/src/features/type/rating-api.ts');
const {api:typeApi}=await server.ssrLoadModule('/src/api/client.ts');

function ratingArchive() {
  const condition={case_id:'buried',name:'Saved condition',layout:'trefoil',ambient_temperature_c:25,depth_m:0.8,source:'Saved source'};
  return {id:'rating-run',workspace:'type-workspace',study:'rating-study',status:'succeeded',integrity:'verified',
    input_digest:'a'.repeat(64),output_digest:'b'.repeat(64),freshness:'historical',created:'2026-01-01T00:00:00Z',
    snapshot:{workspace_id:'type-workspace',study_id:'rating-study',workspace_revision:3,study_revision:2,
      definition:{method:{plugin_id:'cablesim.iec60287',version:'1.2.0',release_digest:'c'.repeat(64),capability:'steady-rating'},
        parameters:{rating_mode:'simultaneous',source:'Saved method source'},
        driver:{kind:'batch',selected_case_ids:['buried'],cases:[{case_id:'buried',label:'Saved condition',metadata:{kind:'type-rating-table',condition}}]}},
      workspace_state:{type_creation:{source:'unit fixture'},can_undo:true,can_redo:true,
        domain:{schema_version:'cablesim.domain/1',name:'Saved type input',cable_types:[{id:'cable',construction:'single_core'}],materials:[],circuits:[],sections:[],load_cases:[]}}},
    output:{cases:[{case_id:'buried',status:'succeeded',artifacts:{'x-cablesim.iec60287-trace':{schema:'cablesim.iec60287-trace/1'}}}]}};
}
function runReceipt(run) { return Object.fromEntries(['id','workspace','study','status','integrity','input_digest','output_digest','freshness','created'].map(key=>[key,run[key]])); }
function runProjection(run) {
  const value=structuredClone(run);delete value.snapshot.workspace_state;
  value.snapshot.workspace_state_ref={url:`/api/workspaces/${run.workspace}/studies/${run.study}/runs/${run.id}?view=full`,sha256:'d'.repeat(64)};
  return value;
}
function evidenceClient() { return new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,staleTime:15000}}}); }
async function withSavedRunReads(archive, task, responses={}) {
  const originalGet=typeApi.GET,originalFetch=globalThis.fetch,requests=[];
  typeApi.GET=async(path,options)=>{
    assert.equal(path,'/api/workspaces/{wid}/studies/{sid}/runs/{rid}');assert.equal(options.params.query.view,'full');
    requests.push({kind:'full',path:options.params.path});
    return {data:responses.full?await responses.full(options):structuredClone(archive),response:new Response(null,{status:200})};
  };
  globalThis.fetch=async(url,options)=>{
    const address=new URL(String(url),'http://fixture.invalid');
    if(address.pathname.endsWith('/rating-table-runs/'+archive.id)) {
      assert.equal(address.searchParams.get('view'),'rows');requests.push({kind:'rows',path:address.pathname});
      if(responses.rows)return responses.rows(options);
      return Response.json({run:runReceipt(archive),rows:[{case_id:'buried',name:'Saved condition',status:'已计算',value_a:321.25,
        condition:archive.snapshot.definition.driver.cases[0].metadata.condition}]});
    }
    if(address.pathname.endsWith('/display-runs')) {
      requests.push({kind:'history',after:address.searchParams.get('after')});
      if(responses.history)return responses.history(address,options);
    }
    throw new Error('Unexpected fixture request: '+address.pathname);
  };
  try { return await task(requests); }
  finally { typeApi.GET=originalGet;globalThis.fetch=originalFetch; }
}

test('A fixed rating archive and rows complete while genuine full history remains pending',async()=>{
  const archive=ratingArchive(),client=evidenceClient();let finishHistory;
  const historyReply=new Promise(resolve=>{finishHistory=resolve;});
  try { await withSavedRunReads(archive,async requests=>{
    const historyOptions=typeEvidenceOptions(archive.workspace,true,'rating-table');
    const history=client.fetchQuery(historyOptions);
    client.setQueryData(['saved-run',archive.workspace,archive.study,archive.id,'detail'],structuredClone(archive));
    const selected=await client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id));
    assert.deepEqual(requests.map(item=>item.kind),['history','rows','full']);
    assert.equal(client.getQueryData(historyOptions.queryKey),undefined);
    assert.equal(client.getQueryState(historyOptions.queryKey).fetchStatus,'fetching');
    assert.equal(client.getQueryData(['type-evidence-history',archive.workspace]),undefined);
    assert.equal(selected[0].run.input_digest,archive.input_digest);
    const older={...runProjection(archive),id:'older-rating',created:'2025-01-01T00:00:00Z'};
    finishHistory(Response.json({items:[runProjection(archive),older],next_cursor:null,history_complete:true}));
    assert.equal((await history).length,2);
    assert.equal(client.getQueryData(historyOptions.queryKey).length,2);
    assert.equal(requests.filter(item=>item.kind==='full').length,1);
  },{history:()=>historyReply}); } finally {client.clear();}
});
test('A cold fixed rating link discovers its study from rows and preserves immutable read-only inputs',async()=>{
  const archive=ratingArchive(),original=structuredClone(archive),client=evidenceClient();
  try { await withSavedRunReads(archive,async requests=>{
    const selected=await client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id));
    assert.deepEqual(requests.map(item=>item.kind),['rows','full']);
    assert.deepEqual(requests[1].path,{wid:archive.workspace,sid:archive.study,rid:archive.id});
    const workspace=await loadWorkspace(archive.workspace,new AbortController().signal,undefined,archive.id,Promise.resolve(selected));
    assert.equal(workspace.revision,3);assert.equal(workspace.document.name,'Saved type input');
    assert.equal(workspace.raw.fixed_run,true);assert.equal(workspace.raw.historical,true);
    assert.equal(workspace.raw.can_undo,false);assert.equal(workspace.raw.can_redo,false);
    const body=ratingBody({id:selected[0].study.id,definition:selected[0].study.definition});
    assert.deepEqual(body.rows,[{...archive.snapshot.definition.driver.cases[0].metadata.condition,rating_basis:'individual'}]);
    assert.deepEqual(body.parameters,archive.snapshot.definition.parameters);assert.deepEqual(body.selected_case_ids,['buried']);
    const rows=await client.fetchQuery(typeRatingResultsOptions(archive.workspace,archive.id));
    assert.equal(rows.rows[0].value_a,321.25);assert.equal(rows.rows[0].condition.source,'Saved source');
    assert.equal(requests.length,2);assert.deepEqual(archive,original);
    assert.equal(client.getQueryCache().findAll({queryKey:['type-evidence']}).length,0);
  }); } finally {client.clear();}
});
test('Fixed rating consumers reuse the verified route reads even after a slow bundle mount',async()=>{
  const archive=ratingArchive(),client=evidenceClient();
  try { await withSavedRunReads(archive,async requests=>{
    const fixedOptions=fixedRatingEvidenceOptions(client,archive.workspace,archive.id);
    const saved=await client.fetchQuery(fixedOptions),rowsOptions=typeRatingResultsOptions(archive.workspace,archive.id);
    const rows=client.getQueryData(rowsOptions.queryKey);
    client.setQueryData(rowsOptions.queryKey,rows,{updatedAt:Date.now()-60000});
    const observers=[new QueryObserver(client,{...fixedOptions,refetchOnMount:false}),
      new QueryObserver(client,{...fixedOptions,refetchOnMount:false}),
      new QueryObserver(client,{...rowsOptions,refetchOnMount:false})];
    const leave=observers.map(observer=>observer.subscribe(()=>{}));
    try {
      await Promise.resolve();
      assert.equal(observers[0].getCurrentResult().data,saved);
      assert.equal(observers[1].getCurrentResult().data,saved);
      assert.equal(observers[2].getCurrentResult().data,rows);
      assert.deepEqual(observers.map(observer=>observer.getCurrentResult().fetchStatus),['idle','idle','idle']);
      assert.deepEqual(requests.map(item=>item.kind),['rows','full']);
    } finally {leave.forEach(unsubscribe=>unsubscribe());}
  }); } finally {client.clear();}
});
test('Fixed rating reads reject mismatched archive identities, digests, snapshots and row receipts',async()=>{
  const mutations=[
    run=>{run.id='another-run';},run=>{run.workspace='another-workspace';},run=>{run.study='another-study';},
    run=>{run.integrity='corrupt';},run=>{run.input_digest='e'.repeat(64);},run=>{run.output_digest='f'.repeat(64);},
    run=>{run.snapshot.workspace_id='another-workspace';},run=>{run.snapshot.study_id='another-study';},
    run=>{run.snapshot.workspace_revision=0;},run=>{delete run.snapshot.workspace_state;},
    run=>{run.snapshot.workspace_state.study_cable_reference={};},
    run=>{run.snapshot.definition.method.plugin_id='cablesim.type-electrical';run.snapshot.definition.method.capability='electrical';},
  ];
  for(const mutate of mutations) {
    const archive=ratingArchive(),client=evidenceClient();
    try { await withSavedRunReads(archive,async()=>{
      client.setQueryData(['saved-run',archive.workspace,archive.study,archive.id,'detail'],structuredClone(archive));
      await assert.rejects(client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id)));
      assert.equal(client.getQueryData(['type-fixed-rating-run',archive.workspace,archive.id]),undefined);
    },{full:()=>{const value=structuredClone(archive);mutate(value);return value;}}); } finally {client.clear();}
  }
  for(const key of ['id','workspace','study','integrity','input_digest','output_digest']) {
    const archive=ratingArchive(),client=evidenceClient();
    try { await withSavedRunReads(archive,async()=>{
      client.setQueryData(['saved-run',archive.workspace,archive.study,archive.id,'detail'],structuredClone(archive));
      await assert.rejects(client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id)));
    },{rows:()=>Response.json({run:{...runReceipt(archive),[key]:key.endsWith('digest')?'e'.repeat(64):'wrong'},rows:[]})}); } finally {client.clear();}
  }
});
test('History errors remain observable without replacing an independently verified selected rating result',async()=>{
  const archive=ratingArchive(),client=evidenceClient(),failure=new Error('History transport failed');
  try { await withSavedRunReads(archive,async()=>{
    const selectedOptions=fixedRatingEvidenceOptions(client,archive.workspace,archive.id);
    const selected=await client.fetchQuery(selectedOptions);
    const historyOptions=typeEvidenceOptions(archive.workspace,true,'rating-table');
    await assert.rejects(client.fetchQuery(historyOptions),error=>error===failure);
    assert.equal(client.getQueryState(historyOptions.queryKey).error,failure);
    assert.equal(client.getQueryData(historyOptions.queryKey),undefined);
    assert.equal(client.getQueryData(selectedOptions.queryKey),selected);
  },{history:()=>{throw failure;}}); } finally {client.clear();}
  for(const channel of ['rows','full']) {
    const client=evidenceClient(),failure=new Error(channel+' transport failed');
    try { await withSavedRunReads(archive,async()=>{
      await assert.rejects(client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id)),error=>error===failure);
      assert.equal(client.getQueryCache().find({queryKey:typeRatingResultsOptions(archive.workspace,archive.id).queryKey}).getObserversCount(),0);
    },{[channel]:()=>{throw failure;}}); } finally {client.clear();}
  }
});
test('A failed warm archive releases its pending rows dependency without cancelling another row consumer',async()=>{
  for(const otherConsumer of [false,true]) {
    const archive=ratingArchive(),client=evidenceClient(),failure=new Error('Full archive failed');
    let rowSignal,finishRows;
    try { await withSavedRunReads(archive,async()=>{
      const rowsOptions=typeRatingResultsOptions(archive.workspace,archive.id);
      const observer=otherConsumer?new QueryObserver(client,rowsOptions):undefined;
      const leave=observer?.subscribe(()=>{});
      client.setQueryData(['saved-run',archive.workspace,archive.study,archive.id,'detail'],structuredClone(archive));
      try {
        await assert.rejects(client.fetchQuery(fixedRatingEvidenceOptions(client,archive.workspace,archive.id)),error=>error===failure);
        assert.equal(client.getQueryCache().find({queryKey:rowsOptions.queryKey}).getObserversCount(),otherConsumer?1:0);
        assert.equal(rowSignal.aborted,!otherConsumer);
        if(otherConsumer) {
          finishRows(Response.json({run:runReceipt(archive),rows:[]}));
          assert.equal((await client.fetchQuery(rowsOptions)).run.id,archive.id);
        }
      } finally {leave?.();}
    },{rows:options=>new Promise((resolve,reject)=>{
      finishRows=resolve;rowSignal=options.signal;
      rowSignal.addEventListener('abort',()=>reject(rowSignal.reason),{once:true});
    }),full:()=>{throw failure;}}); } finally {client.clear();}
  }
});
test('The ordinary saved-workspace fallback still finishes full history and rejects missing or corrupt selection',async()=>{
  const archive=ratingArchive();archive.snapshot.definition.method={plugin_id:'cablesim.type-electrical',capability:'electrical',version:'1.1.1',release_digest:'c'.repeat(64)};
  archive.snapshot.definition.driver={kind:'single'};
  await withSavedRunReads(archive,async requests=>{
    const workspace=await loadWorkspace(archive.workspace,undefined,undefined,archive.id);
    assert.equal(workspace.raw.fixed_run,true);assert.equal(workspace.document.name,'Saved type input');
    assert.deepEqual(requests.map(item=>item.kind),['history','history','full']);
    assert.deepEqual(requests.filter(item=>item.kind==='history').map(item=>item.after),['0','1']);
    await assert.rejects(loadWorkspace(archive.workspace,undefined,undefined,'missing',Promise.resolve([])),/固定运行不存在/);
    await assert.rejects(loadWorkspace(archive.workspace,undefined,undefined,archive.id,Promise.resolve([
      {study:{id:archive.study},run:{...runProjection(archive),integrity:'corrupt'}}])),/完整性未通过/);
  },{history:address=>Response.json({items:address.searchParams.get('after')==='0'?[runProjection(archive)]:[],
    next_cursor:address.searchParams.get('after')==='0'?1:null,history_complete:true})});
});
test('Other saved modules retain their existing workspace-alias archive compatibility',async()=>{
  const archive=ratingArchive();archive.snapshot.definition.method={plugin_id:'cablesim.type-electrical',capability:'electrical',version:'1.1.1',release_digest:'c'.repeat(64)};
  archive.snapshot.definition.driver={kind:'single'};
  archive.snapshot.workspace=archive.workspace;delete archive.snapshot.workspace_id;
  await withSavedRunReads(archive,async requests=>{
    const workspace=await loadWorkspace(archive.workspace,undefined,undefined,archive.id);
    assert.equal(workspace.raw.fixed_run,true);assert.equal(workspace.revision,3);
    assert.equal(workspace.document.name,'Saved type input');
    assert.deepEqual(requests.map(item=>item.kind),['history','full']);
  },{history:()=>Response.json({items:[runProjection(archive)],next_cursor:null,history_complete:true})});
});

function pendingHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let resolve, reject, signal, reads = 0, shared;
  const response = new Promise((done, fail) => { resolve = done; reject = fail; });
  const options = { queryKey: ['type-evidence', 'workspace', 'history', 'electrical'], retry: false, staleTime: 30000,
    queryFn: context => {
      reads++; signal = context.signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      return response;
    } };
  return { client, options, resolve, reject, get signal() { return signal; }, get reads() { return reads; },
    read: () => shared ??= client.fetchQuery(options),
    observers: () => client.getQueryCache().find({ queryKey: options.queryKey })?.getObserversCount() || 0 };
}
test('A saved workspace retains the shared history read after the old view unsubscribes', async () => {
  for (const stale of [false, true]) {
    const history = pendingHistory(), controller = new AbortController();
    if (stale) history.client.setQueryData(history.options.queryKey, [{ run: { id: 'older' } }], { updatedAt: Date.now() - 60000 });
    const oldView = new QueryObserver(history.client, history.options), leave = oldView.subscribe(() => {});
    const retained = readTypeEvidenceForWorkspace(history.options, history.read, controller.signal, history.client);
    leave();
    assert.equal(history.observers(), 1); assert.equal(history.signal.aborted, false); assert.equal(history.reads, 1);
    const saved = Object.freeze([{ run: Object.freeze({ id: 'selected', integrity: 'verified' }) }]);
    history.resolve(saved);
    assert.equal(await retained, saved); assert.equal(await history.read(), saved);
    assert.equal(history.reads, 1); assert.equal(history.observers(), 0);
    history.client.clear();
  }
});
test('An aborted workspace releases only its history observer and cannot consume the saved result', async () => {
  for (const otherConsumer of [false, true]) {
    const history = pendingHistory(), controller = new AbortController();
    const oldView = new QueryObserver(history.client, history.options), leave = oldView.subscribe(() => {});
    const retained = readTypeEvidenceForWorkspace(history.options, history.read, controller.signal, history.client);
    if (!otherConsumer) leave();
    const reason = new DOMException('Workspace navigation cancelled', 'AbortError');
    controller.abort(reason);
    await assert.rejects(retained, error => error === reason);
    assert.equal(history.observers(), otherConsumer ? 1 : 0); assert.equal(history.signal.aborted, !otherConsumer);
    assert.equal(history.reads, 1);
    if (otherConsumer) { const saved = [{ run: { id: 'still-needed' } }]; history.resolve(saved); assert.equal(await history.read(), saved); leave(); }
    history.client.clear();
  }
});
test('Shared history errors remain failures; an already cancelled workspace starts no read', async () => {
  const history = pendingHistory(), controller = new AbortController();
  const retained = readTypeEvidenceForWorkspace(history.options, history.read, controller.signal, history.client);
  const failure = new Error('Saved history transport failed'); history.reject(failure);
  await assert.rejects(retained, error => error === failure);
  assert.equal(history.reads, 1); assert.equal(history.observers(), 0);
  history.client.clear();
  const cancelled = pendingHistory(); controller.abort();
  await assert.rejects(readTypeEvidenceForWorkspace(cancelled.options, cancelled.read, controller.signal, cancelled.client), error => error === controller.signal.reason);
  assert.equal(cancelled.reads, 0); assert.equal(cancelled.observers(), 0);
  cancelled.client.clear();
});
test('Input-basis rejection and missing coefficients retain their real diagnosis without an installation claim',()=>{
  const rejected='标准依据快照与已封签的判据不一致，请重新查询当前发行。';
  assert.match(methodErrorText(rejected),/标准依据/);
  assert.doesNotMatch(methodErrorText(rejected),/重新安装|文件与发布记录/);
  const missing='载流量表：/parameters/ks：参数不符合所选封签契约（required）。';
  assert.equal(methodErrorText(missing),'载流量表：请填写集肤效应系数及其工程来源，再重新计算。');
  assert.match(renderToStaticMarkup(createElement(MethodErrorDetail,{value:missing})),/\/parameters\/ks/);
  assert.match(methodErrorText('方法文件摘要不一致，请核对发行'),/重新安装/);
});
test('A core-overlap diagnostic locates the real escaped core identity and keeps engineering labels',()=>{
  const cable=Object.freeze({id:'cable/type',cores:Object.freeze([{id:'core/1'},{id:'core/2'}])});
  const problem=structureIssue(cable,'cores.core/2：芯坐标造成截面重叠，请提供真实芯位置。');
  assert.equal(problem.message,'芯 2：芯坐标造成截面重叠，请提供真实芯位置。');
  assert.equal(problem.path,'/cable_types/cable~1type/cores/core~12/x');
  assert.deepEqual(problem.target,{scope:'core',coreId:'core/2',role:'conductor'});
  assert.equal(problem.action,'定位芯 2位置');
});
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
test('Explicit edition declarations stay visible before any requirement approval; approval does not invent a declaration', () => {
  const next=structuredClone(document), names=['GB/T 11017.2—2024','GB/T 3956—2008'];
  next.provenance['/execution_standards']={kind:'standard',reviewed:true,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items:names.map(standard=>({standard,source_digest:'a'.repeat(64)}))})};
  const before=structuredClone(next), declared=executionStandardsSummary(next,{standards:[]});
  assert.deepEqual(declared.standards,names);assert.deepEqual(declared.approvedStandards,[]);assert.equal(declared.declarationState,'declared');assert.equal(declared.standardsLabel,names.join('、'));
  assert.match(declared.standardsReason,/声明不等于批准要求/);assert.deepEqual(next,before);
  const approvedOnly=executionStandardsSummary(document,{standards:[names[0]]});
  assert.deepEqual(approvedOnly.standards,[]);assert.deepEqual(approvedOnly.approvedStandards,[names[0]]);assert.equal(approvedOnly.declarationState,'undeclared');assert.match(approvedOnly.standardsLabel,/未声明.*已有批准要求/);
});
test('Reference prose, unconfirmed editions and damaged declaration records cannot become execution standards', () => {
  const next=structuredClone(document);next.provenance['/name']={kind:'standard',reviewed:true,reference:'GB/T 11017.2—2024'};
  assert.equal(executionStandardsSummary(next,{standards:[]}).standardsLabel,'未声明');
  const items=[{standard:'GB/T 11017.2—2024',source_digest:'a'.repeat(64)}];
  for(const [source,state] of [
    [{kind:'standard',reviewed:false,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items})},'unconfirmed'],
    [{kind:'standard',reviewed:true,reference:'GB/T 11017.2—2024'},'invalid'],
    [{kind:'standard',reviewed:true,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items:[...items,{standard:'GB/T 3956—2008'}]})},'invalid'],
  ]) {
    next.provenance['/execution_standards']=source;const result=executionStandardsSummary(next,{standards:[]});
    assert.deepEqual(result.standards,[]);assert.equal(result.declarationState,state);assert.notEqual(result.standardsLabel,'未声明');
  }
});
test('Unavailable approval summaries retain known declarations and never masquerade as an empty successful read', () => {
  const missing=executionStandardsSummary(document,{error:'型号修订已变化，请刷新目录'});
  assert.equal(missing.approvalState,'error');assert.equal(missing.standardsLabel,'标准读取失败');assert.match(missing.standardsReason,/型号修订已变化/);
  const next=structuredClone(document),standard='GB/T 11017.2—2024';
  next.provenance['/execution_standards']={kind:'standard',reviewed:true,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items:[{standard,source_digest:'a'.repeat(64)}]})};
  const result=executionStandardsSummary(next,{error:'要求目录离线'});
  assert.deepEqual(result.standards,[standard]);assert.deepEqual(result.approvedStandards,[]);assert.equal(result.approvalState,'error');assert.equal(result.standardsLabel,standard+'；批准状态读取失败');assert.match(result.standardsReason,/要求目录离线/);
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
