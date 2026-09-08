export type ReadinessState='pass'|'warn'|'block'|'pending';
export type ReadinessTarget='cable'|'documents'|'methods'|'products';

export interface EngineeringFinding {code:string;message:string;target:string}
export interface ProductReference {
 code:string;name:string;version:number;aligned:boolean;is_current_reviewed:boolean;lifecycle:string;changed_fields:string[];
}
export interface EngineeringAssessment {
 revision:number;domain:string;product_reference:ProductReference|null;findings:EngineeringFinding[];scope:string;
 input_sha256?:string;
}
export interface ReadinessItem {
 id:'version'|'inputs'|'evidence'|'product'|'method';label:string;state:ReadinessState;detail:string;target:ReadinessTarget;
}
export interface EngineeringReadiness {
 level:'ready'|'review'|'blocked';title:string;summary:string;scope:string;items:ReadinessItem[];warningCount:number;blockCount:number;
}
export interface ReadinessInput {
 workspaceRevision:number;proposalBaseRevision:number;proposalExpired:boolean;dirtyCount:number;sourceCount:number;lockCount:number;
 assessment:EngineeringAssessment|null;assessmentPending:boolean;assessmentFailed:boolean;
}

const finding=(assessment:EngineeringAssessment|null,code:string)=>assessment?.findings.find(item=>item.code===code);

/**
 * UI review classification only. It never replaces the server-side revision lock,
 * product binding validation, parameter validation or solver applicability checks.
 */
export function buildEngineeringReadiness(input:ReadinessInput):EngineeringReadiness {
 const currentAssessment=!!input.assessment&&input.assessment.revision===input.workspaceRevision;
 const versionBlocked=input.proposalExpired||input.proposalBaseRevision!==input.workspaceRevision;
 const items:ReadinessItem[]=[];
 items.push({
  id:'version',label:'工程版本',state:versionBlocked?'block':'pass',target:'cable',
  detail:input.proposalExpired?'提案已过有效期，必须重新规划':input.proposalBaseRevision!==input.workspaceRevision
   ?`提案基于 rev.${input.proposalBaseRevision}，当前工程为 rev.${input.workspaceRevision}`
   :`提案绑定 rev.${input.workspaceRevision}；${input.lockCount} 项锁定条件保持`,
 });
 items.push({
  id:'inputs',label:'输入状态',state:input.dirtyCount?'block':'pass',target:'cable',
  detail:input.dirtyCount?`${input.dirtyCount} 项输入尚未提交，不能继续批准`:'当前参数输入已提交并可参与版本校验',
 });
 if(input.assessmentPending){
  items.push({id:'evidence',label:'参数依据',state:'pending',target:'documents',detail:'正在读取当前版本的资料与参数依据检查'});
 }else if(input.assessmentFailed){
  items.push({id:'evidence',label:'参数依据',state:'warn',target:'documents',detail:'依据摘要暂不可读；不会据此宣称参数已核对'});
 }else if(!currentAssessment){
  items.push({id:'evidence',label:'参数依据',state:'warn',target:'documents',detail:'依据摘要尚未同步到当前工程版本'});
 }else {
  const source=finding(input.assessment,'source'),r20=finding(input.assessment,'r20');
  const details:string[]=[];
  if(source||input.sourceCount===0)details.push('无已核对资料引用');else details.push(`${input.sourceCount} 份资料已关联`);
  if(r20)details.push('R20 仍为估算');else details.push('R20 未被标记为估算值');
  items.push({id:'evidence',label:'参数依据',state:source||r20||input.sourceCount===0?'warn':'pass',target:'documents',detail:details.join(' · ')});
 }
 if(input.assessmentPending){
  items.push({id:'product',label:'企业型号',state:'pending',target:'products',detail:'正在核对当前工程的型号引用状态'});
 }else if(input.assessmentFailed||!currentAssessment){
  items.push({id:'product',label:'企业型号',state:'warn',target:'products',detail:'型号一致性摘要暂不可用；不宣称企业型号一致'});
 }else if(!input.assessment!.product_reference){
  items.push({id:'product',label:'企业型号',state:'warn',target:'products',detail:'当前为自定义电缆，不宣称与企业已核对型号一致'});
 }else {
  const reference=input.assessment!.product_reference;
  const valid=reference.aligned&&reference.is_current_reviewed;
  items.push({id:'product',label:'企业型号',state:valid?'pass':'warn',target:'products',detail:valid
   ?`${reference.code} v${reference.version} · 已核对且与当前结构一致`
   :`${reference.code} v${reference.version} · ${reference.aligned?'结构一致':'项目参数已偏离'} · ${reference.is_current_reviewed?'当前已核对':'已停用或被新版替代'}`});
 }
 if(input.assessmentPending){
  items.push({id:'method',label:'方法边界',state:'pending',target:'methods',detail:'正在读取当前计算域与方法边界'});
 }else if(input.assessmentFailed||!currentAssessment){
  items.push({id:'method',label:'方法边界',state:'warn',target:'methods',detail:'方法摘要暂不可读；不可扩大当前研究范围'});
 }else {
  const loss=finding(input.assessment,'loss');
  const domain=input.assessment!.domain==='buried'?'单回路直埋':'单根隔离竖向';
  items.push({id:'method',label:'方法边界',state:loss?'warn':'pass',target:'methods',detail:loss?`${domain} · ${loss.message}`:`${domain} · 当前方法边界已读取`});
 }
 const blockCount=items.filter(item=>item.state==='block').length;
 const warningCount=items.filter(item=>item.state==='warn'||item.state==='pending').length;
 const level=blockCount?'blocked':warningCount?'review':'ready';
 return {
  level,
  title:level==='blocked'?'当前提案不可执行':level==='review'?'可执行研究计算，需保留边界':'输入与依据检查完成',
  summary:level==='blocked'?`${blockCount} 项阻断条件必须先处理`:level==='review'?`${warningCount} 项研究边界将在结果复核中继续显示`:'版本、输入、参数依据与型号状态均已通过当前检查',
  scope:currentAssessment?input.assessment!.scope:'计算范围待读取；本界面不会据此宣称标准符合性或最终工程签审。',
  items,warningCount,blockCount,
 };
}
