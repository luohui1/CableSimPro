import { optionalRecord, text } from '@/api/client';
import { displayText } from '@/lib/display-names';
import { Button } from '@/components/ui/button';
import { EvidenceDigest } from './evidence-digest';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { issuePresentation, reviewGroups } from './result-presentation';
import { layerRows } from './layers';
import { quantityLayer, quantityMissingInputs } from './quantity-inputs';
import { MeasurementEntry, measurementSource } from './measurements';
import { EngineeringInputEntry } from './engineering-inputs';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { message } from '@/api/client';

const modules:Record<string,[string,string,string]>={geometry:['structure','quantities','结构推导'],electrical:['electrical','parameters','电气参数'],rating:['rating-table','parameters','载流量表'],short_circuit:['short-circuit','parameters','短路容量'],standards:['standard-check','results','标准核对'],resources:['structure','materials','资源绑定']};
const readable=(value:string)=>displayText(value).replace(/bonding\.kind/g,'接地方式').replace(/core\/(\d+)/g,'芯 $1').replace(/material\/[\w-]+/g,'对应材料');
export function ReviewIssues({checks, approved=false,digest,onRefresh}:{checks:Record<string,unknown>[];approved?:boolean;digest?:string;onRefresh?:()=>Promise<void>}){
  const state=useTypeWorkspace(),navigation=useTypeNavigation();
  const [scopeReason,setScopeReason]=useState<Record<string,string>>({}),[scopeBusy,setScopeBusy]=useState(false),[scopeError,setScopeError]=useState('');
  const scopePending=useRef(false);
  const excluded=checks.filter(check=>check.excluded===true);
  const eligible=(check:Record<string,unknown>)=>{
    const row=optionalRecord(check.result);
    if(['failed','fail'].includes(text(row.verdict))||['failed','fail'].includes(text(row.status))||row.satisfied===false)return false;
    return check.id==='geometry/mass'&&check.channel==='geometry'||['electrical','short_circuit','standards'].includes(text(check.channel))&&(['missing','uncovered','not_applicable'].includes(text(row.status))||['missing','uncovered'].includes(text(row.verdict)));
  };
  async function declare(check:Record<string,unknown>,remove=false){
    if(!digest||scopePending.current||state.dirty||approved)return;
    scopePending.current=true;setScopeBusy(true);setScopeError('');
    try{
      const response=await fetch(`/api/types/${encodeURIComponent(state.workspace!.id)}/release-scope`,{method:'POST',headers:{'Content-Type':'application/json','X-CableSim-Actor':'human'},body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:state.workspace!.revision,specification_digest:digest,human_confirmed:true,exclusions:[...excluded.filter(item=>item.id!==check.id).map(item=>({check_id:text(item.id),reason:text(item.exclusion_reason)})),...(!remove?[{check_id:text(check.id),reason:scopeReason[text(check.id)]||''}]:[])]}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw new Error(text(optionalRecord(result.detail).message)||text(result.detail)||'范围声明未保存，请重新核对当前清单');
      await onRefresh?.();
    }catch(error){setScopeError(message(error));}finally{scopePending.current=false;setScopeBusy(false);}
  }
  function issue(check:Record<string,unknown>){const destination=modules[text(check.channel)]||['requirements','list','要求与标准'];if(/historical|过期|历史/.test(text(check.id)+' '+text(check.message)))return{module:destination[0],tab:destination[0]==='structure'?'quantities':destination[0]==='requirements'?'list':'results',layer:'',field:'',action:'重算本模块',reason:'输入或方法已变化；此保存结果需重新运行'};const quantities=Array.isArray(check.quantities)?check.quantities:[];for(const quantity of quantities){const layer=quantityLayer(layerRows(state.document!,state.document!.cable_types[0]),optionalRecord(quantity));const fields=layer&&quantityMissingInputs(state.document!,layer,optionalRecord(quantity).quantity_missing);if(layer&&fields?.length)return{module:'structure',tab:'table',layer:layer.id,field:fields[0].path,action:'填写'+fields[0].label,reason:layer.label+'：待补 '+fields.map(field=>field.label).join('、')};}const row=optionalRecord(check.result);return Object.keys(row).length?issuePresentation(row,destination[0],state.document!.cable_types[0].id):{module:destination[0],tab:destination[1],layer:'',field:'',action:'查看'+destination[2],reason:readable(text(check.message))};}
  function go(check:Record<string,unknown>){const next=issue(check);navigation.navigate(typePath(state.workspace!.id,next.module,next.tab,navigation.location.theme)+(next.layer?'&layer='+encodeURIComponent(next.layer):'')+(next.field?'&field='+encodeURIComponent(next.field):''));}
  return <div className="type-review-groups" aria-label="按责任处理发布阻塞">{reviewGroups(checks).map(group=><section key={group.id} data-review-group={group.title}>
    <header><strong>{group.title}</strong><span>{group.items.length} 项阻止发布</span>{group.title==='需要出厂实测值'?<MeasurementEntry checks={group.items}/>:group.title==='需要工程师补输入'&&group.items.some(check=>Array.isArray(optionalRecord(check.result).engineering_inputs))?<EngineeringInputEntry checks={group.items}/>:<Button size="compact" onClick={()=>go(group.items[0])}>{group.title==='标准依据未覆盖'?'查看依据与范围':issue(group.items[0]).action}</Button>}</header>
    <p className="type-review-next" data-typography="note">{group.title==='需要工程师补输入'?'补齐下列输入，保存后重新运行受影响的模块。':group.title==='需要出厂实测值'?'录入同一试样的实测记录，然后重新执行标准核对。':group.title==='标准依据未覆盖'?'保留要求与版本声明；依据库覆盖后重新查询、核对。':'核对固定资源版本与当前输入，再由工程师确认。'}</p>
    <details><summary>查看 {group.items.length} 项明细</summary>{group.items.map((check,index)=>{const row=optionalRecord(check.result),next=issue(check);return <div className="type-review-item" data-check-id={text(check.id)} key={text(check.id)||index}><span>{text(row.title)?readable(text(row.title))+'：':''}{next.reason}</span>{Array.isArray(row.engineering_inputs)&&row.engineering_inputs.length?<EngineeringInputEntry checks={[check]} label={text(row.rule_requirement).includes('短路')?'录入屏蔽设计与依据':'录入本项工程输入'}/>:group.title!=='需要出厂实测值'&&<Button size="compact" variant="ghost" onClick={()=>go(check)}>{next.action}</Button>}{digest&&!approved&&eligible(check)&&<details className="type-scope-declaration"><summary>声明本次发布不含此项</summary><label>具体原因<Input aria-label={'不含原因：'+(text(row.title)||readable(text(check.message)))} value={scopeReason[text(check.id)]||''} maxLength={500} onChange={event=>setScopeReason(current=>({...current,[text(check.id)]:event.target.value}))}/></label><Button size="compact" disabled={state.dirty||scopeBusy||(scopeReason[text(check.id)]||'').trim().length<5} onClick={()=>void declare(check)}>本人确认不含此项</Button></details>}<details><summary>追溯记录</summary><p>保存条目 <EvidenceDigest value={check.id}/></p>{text(row.standard)&&<p>{text(row.citation)||text(row.standard)+' · '+text(row.clause)}</p>}{row.input_source!=null&&<p>{measurementSource(row.input_source)}</p>}</details></div>;})}</details>
  </section>)}{!!excluded.length&&<section data-review-group="已声明不含"><header><strong>已声明不含</strong><span>{excluded.length} 项</span></header>{excluded.map(check=><div className="type-review-item" key={text(check.id)}><span>{text(optionalRecord(check.result).title)||readable(text(check.message))}：{text(check.exclusion_reason)}</span>{!approved&&<Button size="compact" disabled={scopeBusy} onClick={()=>void declare(check,true)}>撤销声明</Button>}</div>)}</section>}{scopeError&&<p role="alert" className="field-error">{scopeError}</p>}{!approved&&<section data-review-group="人工确认关口"><header><strong>人工确认关口</strong><span>4 个关口</span><Button size="compact" onClick={()=>navigation.navigate(typePath(state.workspace!.id,'requirements','list',navigation.location.theme))}>核对要求与声明</Button></header><details><summary>查看批准流程</summary><div className="type-review-item"><span>执行标准声明、要求审核</span><Button size="compact" variant="ghost" onClick={()=>navigation.navigate(typePath(state.workspace!.id,'requirements','list',navigation.location.theme))}>查看批准记录</Button></div><div className="type-review-item"><span>材料固定版本核对</span><Button size="compact" variant="ghost" onClick={()=>navigation.navigate(typePath(state.workspace!.id,'structure','materials',navigation.location.theme))}>查看材料差异</Button></div><p data-typography="note">设计发布：技术校核完成后，使用本页“提交评审 → 人工批准 → 发布型号版本”。批准状态独立于依据核验。</p></details></section>}</div>;
}
