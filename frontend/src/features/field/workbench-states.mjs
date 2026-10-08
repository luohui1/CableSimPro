// Browser regression: saved physical results are replayed; all scheduler writes are mocked.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openHeadlessBrowser, settle } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';
const origin=process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
assert(!['8100','8200'].includes(new URL(origin).port),'Use an isolated service');
const receipt=JSON.parse(await fs.readFile(process.env.FEM_RECEIPT,'utf8'));
const base=`/api/workspaces/${receipt.workspace}/studies/${receipt.fem}`;
const owned=await openHeadlessBrowser();const {page,context}=owned;
page.setDefaultTimeout(30000);
const saved=await (await page.request.get(origin+base+`/runs/${receipt.femRun}?view=full`,{timeout:180000})).json().catch(async error=>{await owned.close();throw error;});
assert(['succeeded','partial'].includes(saved.status),'Need a saved real result before replay');
let state='empty',submissions=0,cancels=0,offline=false;
const checks=[],failures=[];
const progress=()=>({id:saved.id,status:['queued','running','collecting','validating'].includes(state)?'running':state==='error'?'failed':saved.status,
  execution:{backend:'slurm',job_id:'fixture-999',state:state==='success'||state==='historical'?'succeeded':state,
    actual_cpu_seconds:36,slurm_states:state==='cancelled'?['CANCELLED']:[],cancel_requested:state==='cancelled'},
  error:state==='error'?{code:'REMOTE_TIMEOUT',message:'超算作业超时；保存输入与作业记录保留。'}:null});
const run=()=>({...saved,...progress(),freshness:state==='historical'?'historical':saved.freshness,
  execution:state==='queued'?null:progress().execution,
  // A single real coarse field is sufficient for UI replay; do not push the
  // entire multi-mesh evidence archive through CDP on each synthetic state.
  convergence:{...saved.convergence,reference_case_id:saved.output.cases[0].case_id},
  output:['success','historical'].includes(state)?{...saved.output,cases:[saved.output.cases[0]]}:null});
await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
  const reply=json=>route.fulfill({json});
  if(pathname===base+'/preflight')return reply({ready:true,lock_digest:'fixture-lock',cases:[{case_id:'case-0',status:'succeeded',evidence:{mesh_nodes:100,mesh_elements:180,execution_budget:{partition:'dg83',upper_core_hours:1,case_count:1,wall_seconds:3600}}}]});
  if(pathname===base+'/runs' && request.method()==='POST'){submissions++;state='queued';return reply(run());}
  if(pathname.endsWith('/cancel') && pathname.startsWith(base)){cancels++;state='cancelled';return reply({state:'cancel_requested'});}
  if(pathname.endsWith('/resume') && pathname.startsWith(base)){state='queued';return reply({state:'queued'});}
  if(!['GET','HEAD','OPTIONS'].includes(request.method()))throw Error('Unexpected real write: '+pathname);
  if(pathname===base+'/runs')return reply({items:state==='empty'?[]:[{...run(),output:undefined,snapshot:{module:'thermal-field'},method:saved.snapshot.definition.method}],next_cursor:null});
  if(pathname===base+`/runs/${saved.id}/progress`){if(offline)return route.abort('internetdisconnected');return reply(progress());}
  if(pathname===base+`/runs/${saved.id}`)return reply(run());
  return route.fallback();
});
const go=async(theme='light',tab='field')=>{await page.goto('about:blank');await page.goto(`${origin}/studies/${receipt.fem}/thermal-field/${tab}?workspace=${receipt.workspace}&theme=${theme}${state==='empty'?'':`&run=${saved.id}`}`);await settle(page);};
async function layout(label){try{checks.push({label,...await assertLayout(page,label)});}catch(error){failures.push({label,message:error.message});}}
try{
  await page.setViewportSize({width:1366,height:768});await go();
  await page.evaluate(async()=>{
    const {compareSavedFields}=await import('/src/features/field/saved-comparison.tsx');
    const quantity=value=>({key:'conductor_temperature',entity:'cable/test',unit:'K',case:'operating',status:'available',value});
    const fixture=(plugin,value,parameters)=>({integrity:'verified',status:'succeeded',snapshot:{definition:{method:{plugin_id:plugin}},cases:[{case_id:'case-0',input:{saved:'fixture'},parameters}]},output:{cases:[{case_id:'case-0',status:'succeeded',results:[quantity(value)]}]}});
    const fem=fixture('cablesim.simulation',350,{iec:{operation:'both'}}),iec=fixture('cablesim.iec60287',340,{operation:'both'});
    const comparison=compareSavedFields(fem,iec);
    if(comparison.rows[0].delta!==10 || Math.abs(comparison.rows[0].relative-1000/340)>1e-10)throw Error('Saved-value delta hand check failed');
    for(const change of ['input','parameters','integrity']){
      const other=structuredClone(iec);
      if(change==='integrity')other.integrity='corrupt';else other.snapshot.cases[0][change]={changed:true};
      let refused=false;try{compareSavedFields(fem,other);}catch{refused=true;}
      if(!refused)throw Error('Mismatched saved evidence was compared: '+change);
    }
  });
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});
  await dialog.getByText(/核时预算上限/).waitFor();
  assert(await dialog.getByRole('button',{name:'确认并运行',exact:true}).isDisabled());
  await page.keyboard.press('Escape');assert.equal(submissions,0);
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认并运行',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByRole('region',{name:'超算运行记录'}).getByText('排队',{exact:true}).waitFor();
  assert.equal(submissions,1,'Double-click submitted twice');
  for(const phase of ['running','collecting','validating']){state=phase;await page.getByRole('region',{name:'超算运行记录'}).getByText(({running:'运行',collecting:'后处理',validating:'封存中'})[phase],{exact:true}).waitFor();}
  state='running';offline=true;await page.getByText('进度连接中断，原作业保留',{exact:true}).waitFor();
  offline=false;await page.getByRole('button',{name:'重新读取进度',exact:true}).click();
  await page.getByRole('button',{name:'取消运行',exact:true}).click();
  await page.getByText('已取消',{exact:true}).waitFor();assert.equal(cancels,1);
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const scenario of ['empty','running','error','success','historical']){
    state=scenario;await page.setViewportSize({width,height:width===1366?768:1080});await go(theme);
    if(['success','historical'].includes(state))await page.getByRole('img',{name:'温度场',exact:true}).waitFor({timeout:120000});
    else if(state==='running')await page.getByRole('region',{name:'超算运行记录'}).waitFor();
    await layout(`${width}-${theme}-${state}`);
  }
  state='success';await page.setViewportSize({width:1366,height:768});
  for(const tab of ['samples','diagnostics','convergence']){await go('light',tab);await page.getByRole('button',{name:'放大结果面板'}).click();await settle(page);await layout(tab);}
  assert.deepEqual(failures,[],JSON.stringify(failures,null,2));
}catch(error){
  failures.push({state,message:error.message});
  await fs.writeFile(path.join(receipt.folder,'browser-state-failure.txt'),await page.locator('body').innerText().catch(()=>''));
  throw error;
}finally{
  await fs.writeFile(path.join(receipt.folder,'browser-states.json'),JSON.stringify({submissions,cancels,checks,failures},null,2));
  await owned.close();
}
