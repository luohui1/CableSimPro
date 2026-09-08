/** Pure review classification fixtures. No solver, product certification or browser validation is implied. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'frontend/package.json'));
const temp=mkdtempSync(join(tmpdir(),'cablesim-readiness-'));
let passed=0;
try{
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--target','ES2022','--module','commonjs','--outDir',temp,join(root,'frontend/src/engineeringReadiness.ts')],{stdio:'inherit'});
 const {buildEngineeringReadiness}=require(join(temp,'engineeringReadiness.js'));
 const finding=(code,message,target='cable')=>({code,message,target});
 const baseAssessment=()=>({revision:1,domain:'buried',product_reference:null,scope:'单回路直埋；不是完整标准计算或最终工程签审。',findings:[
  finding('r20','R20 按截面积估算；尚无厂家保证电阻。'),finding('source','尚无已核对资料引用。','library'),finding('loss','交流附加与屏蔽损耗系数仍是输入假设。','materials')
 ]});
 const base=()=>({workspaceRevision:1,proposalBaseRevision:1,proposalExpired:false,dirtyCount:0,sourceCount:0,lockCount:2,assessment:baseAssessment(),assessmentPending:false,assessmentFailed:false});
 function check(name,mutate,level){const input=base();mutate(input);const result=buildEngineeringReadiness(input);assert.equal(result.level,level,name);passed++;return result}
 let r=check('default research inputs remain executable with warnings',()=>{},'review');assert.equal(r.blockCount,0);assert.ok(r.warningCount>=3);assert.match(r.scope,/不是完整标准计算/);
 r=check('dirty input blocks approval classification',i=>{i.dirtyCount=1},'blocked');assert.match(r.items.find(x=>x.id==='inputs').detail,/1 项输入/);
 r=check('stale proposal blocks approval classification',i=>{i.workspaceRevision=2},'blocked');assert.match(r.items.find(x=>x.id==='version').detail,/rev\.1.*rev\.2/);
 check('expired proposal blocks approval classification',i=>{i.proposalExpired=true},'blocked');
 check('assessment loading never pretends review is complete',i=>{i.assessment=null;i.assessmentPending=true},'review');
 check('assessment read failure remains an explicit warning',i=>{i.assessment=null;i.assessmentFailed=true},'review');
 check('stale assessment revision remains a warning',i=>{i.assessment.revision=0},'review');
 r=check('aligned reviewed product passes product item',i=>{i.sourceCount=1;i.assessment.findings=[];i.assessment.product_reference={code:'YJV-400',name:'fixture',version:3,aligned:true,is_current_reviewed:true,lifecycle:'reviewed',changed_fields:[]}},'ready');assert.equal(r.items.find(x=>x.id==='product').state,'pass');
 check('modified product remains research warning',i=>{i.sourceCount=1;i.assessment.findings=[];i.assessment.product_reference={code:'YJV-400',name:'fixture',version:3,aligned:false,is_current_reviewed:true,lifecycle:'reviewed',changed_fields:['insulation_mm']}},'review');
 check('superseded product remains research warning',i=>{i.sourceCount=1;i.assessment.findings=[];i.assessment.product_reference={code:'YJV-400',name:'fixture',version:2,aligned:true,is_current_reviewed:false,lifecycle:'withdrawn',changed_fields:[]}},'review');
 r=buildEngineeringReadiness(base());assert.match(r.items.find(x=>x.id==='version').detail,/2 项锁定条件/);passed++;
 console.log(`${passed} engineering-readiness checks passed. Server approval and solver validation remain separate.`);
}finally{rmSync(temp,{recursive:true,force:true})}
