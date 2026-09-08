/** Isolated selector regression fixtures, not solver validation or UI acceptance. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'frontend/package.json'));
const temp=mkdtempSync(join(tmpdir(),'cablesim-evidence-'));
let passed=0;
try {
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--target','ES2022',
  '--module','commonjs','--outDir',temp,join(root,'frontend/src/outputEvidence.ts')],{stdio:'inherit'});
 const {captureOutputSource,selectCurrentOutput}=require(join(temp,'outputEvidence.js'));
 function fixture(){
  // Deliberately small, synthetic input; only selection rules are exercised here.
  const workspace={id:'selector-fixture',revision:1,scenario:{cable:{area_mm2:240},installation:{depth_m:0.8}},
   runs:[{id:'run-fixture',revision:1,input_hash:'a'.repeat(64)}]};
  const output={run_id:'run-fixture',sweep:null,result:{model_version:'test-only',input_sha256:'b'.repeat(64),
   computed_at:'2026-09-08T00:00:00Z',input:structuredClone(workspace.scenario),summary:{ampacity_a:100}}};
  return {workspace,output,source:captureOutputSource(workspace,output,1),drafts:false};
 }
 function check(name,mutate,allowed=false,kind='result'){
  const f=fixture();mutate(f);
  const selected=selectCurrentOutput(f.workspace,f.output,f.source,f.drafts);
  assert.equal(selected.outputCurrent,allowed,name);
  assert.equal(selected.current!==null,allowed&&kind==='result',`${name}: result`);
  assert.equal(selected.currentSweep!==null,allowed&&kind==='sweep',`${name}: sweep`);
  passed++;
 }
 check('server-bound current run',()=>{},true);
 check('workspace/solver hashes are distinct serialization domains',f=>{
  assert.notEqual(f.workspace.runs[0].input_hash,f.output.result.input_sha256);
 },true);
 check('missing workspace',f=>{f.workspace=null});
 check('missing output',f=>{f.output=null});
 check('missing source',f=>{f.source=null});
 check('uncommitted input',f=>{f.drafts=true});
 check('same-value undo is still a newer revision',f=>{f.workspace.revision=3});
 check('history at the current revision remains read-only',f=>{f.source.revision=null});
 check('another workspace with equal values',f=>{f.workspace.id='another'});
 check('invalid workspace revision',f=>{f.workspace.revision=NaN;f.source.revision=NaN});
 check('zero revision',f=>{f.workspace.revision=0;f.source.revision=0});
 check('unbound run',f=>{f.output.run_id='unknown'});
 check('missing run id',f=>{delete f.output.run_id});
 check('run was removed from snapshot',f=>{f.workspace.runs=[]});
 check('run belongs to an older revision',f=>{f.workspace.runs[0].revision=0});
 check('run hash no longer matches captured source',f=>{f.workspace.runs[0].input_hash='c'.repeat(64)});
 check('invalid captured run hash',f=>{f.workspace.runs[0].input_hash='bad';f.source.inputHash='bad'});
 check('different scenario',f=>{f.workspace.scenario.installation.depth_m=1});
 check('different design basis',f=>{f.workspace.design_basis={voltage:'other'}});
 check('matching design basis',f=>{f.workspace.design_basis={voltage:12};f.output.result.design_basis={voltage:12}},true);
 check('missing solver metadata',f=>{f.output.result.model_version=''});
 check('invalid solver fingerprint',f=>{f.output.result.input_sha256='bad'});
 check('missing completion time',f=>{delete f.output.result.computed_at});
 check('invalid completion time',f=>{f.output.result.computed_at='not-a-time'});
 check('non-finite current',f=>{f.output.result.summary.ampacity_a=Infinity});
 check('negative current',f=>{f.output.result.summary.ampacity_a=-1});
 check('unavailable operating point preserves valid rating',f=>{f.output.result.operating=null;f.output.result.operating_error='outside operating range'},true);
 check('bound explanatory task has no numeric result',f=>{f.output.result=null},true,'explanation');
 function sweep(f){f.output.result=null;f.output.sweep={parameter:'soil_rho_k_m_w',points:[{value:1,ampacity_a:100,error:null},{value:2,ampacity_a:null,error:'No steady solution'}]}}
 check('valid sweep preserves explicitly failed points',sweep,true,'sweep');
 check('historical sweep cannot be promoted',f=>{sweep(f);f.source.revision=null});
 check('empty sweep',f=>{sweep(f);f.output.sweep.points=[]});
 check('non-finite sweep input',f=>{sweep(f);f.output.sweep.points[0].value=NaN});
 check('non-finite sweep output',f=>{sweep(f);f.output.sweep.points[0].ampacity_a=Infinity});
 check('missing failure explanation',f=>{sweep(f);f.output.sweep.points[1].error=null});
 assert.equal(captureOutputSource(fixture().workspace,null,1),null);passed++;
 console.log(`${passed} output-evidence selector checks passed. No solver or browser validation is implied.`);
} finally {rmSync(temp,{recursive:true,force:true})}
