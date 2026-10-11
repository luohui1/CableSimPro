import { optionalRecord, text } from '@/api/client';
import { displayText } from '@/lib/display-names';
import { Button } from '@/components/ui/button';
import { EvidenceDigest } from './evidence-digest';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import { issuePresentation, reviewGroups } from './result-presentation';
import { layerRows } from './layers';
import { quantityLayer, quantityMissingInputs } from './quantity-inputs';

const modules:Record<string,[string,string,string]>={geometry:['structure','quantities','结构推导'],electrical:['electrical','parameters','电气参数'],rating:['rating-table','parameters','载流量表'],short_circuit:['short-circuit','parameters','短路容量'],standards:['standard-check','results','标准核对'],resources:['structure','materials','资源绑定']};
const readable=(value:string)=>displayText(value).replace(/bonding\.kind/g,'接地方式').replace(/core\/(\d+)/g,'芯 $1').replace(/material\/[\w-]+/g,'对应材料');
export function ReviewIssues({checks}:{checks:Record<string,unknown>[]}){
  const state=useTypeWorkspace(),navigation=useTypeNavigation();
  function issue(check:Record<string,unknown>){const destination=modules[text(check.channel)]||['requirements','list','要求与标准'];if(/historical|过期|历史/.test(text(check.id)+' '+text(check.message)))return{module:destination[0],tab:destination[0]==='structure'?'quantities':destination[0]==='requirements'?'list':'results',layer:'',field:'',action:'重算本模块',reason:'输入或方法已变化；此保存结果需重新运行'};const quantities=Array.isArray(check.quantities)?check.quantities:[];for(const quantity of quantities){const layer=quantityLayer(layerRows(state.document!,state.document!.cable_types[0]),optionalRecord(quantity));const fields=layer&&quantityMissingInputs(state.document!,layer,optionalRecord(quantity).quantity_missing);if(layer&&fields?.length)return{module:'structure',tab:'table',layer:layer.id,field:fields[0].path,action:'填写'+fields[0].label,reason:layer.label+'：待补 '+fields.map(field=>field.label).join('、')};}const row=optionalRecord(check.result);return Object.keys(row).length?issuePresentation(row,destination[0],state.document!.cable_types[0].id):{module:destination[0],tab:destination[1],layer:'',field:'',action:'查看'+destination[2],reason:readable(text(check.message))};}
  function go(check:Record<string,unknown>){const next=issue(check);navigation.navigate(typePath(state.workspace!.id,next.module,next.tab,navigation.location.theme)+(next.layer?'&layer='+encodeURIComponent(next.layer):'')+(next.field?'&field='+encodeURIComponent(next.field):''));}
  return <div className="type-review-groups" aria-label="按原因处理发布阻塞">{reviewGroups(checks).map(group=><section key={group.id}>
    <header><strong>{modules[text(group.items[0].channel)]?.[2]||'要求与标准'} · {group.title}</strong><span>{group.items.filter(item=>item.blocking===true).length} 项阻止发布</span><Button size="compact" onClick={()=>go(group.items[0])}>{group.title==='历史过期'?'重算本模块':issue(group.items[0]).action}</Button></header>
    <details><summary>查看 {group.items.length} 项明细</summary>{group.items.map((check,index)=>{const row=optionalRecord(check.result),next=issue(check);return <div className="type-review-item" key={text(check.id)||index}><span>{text(row.title)?readable(text(row.title))+'：':''}{next.reason}</span><Button size="compact" variant="ghost" onClick={()=>go(check)}>{next.action}</Button><details><summary>追溯记录</summary><p>保存条目 <EvidenceDigest value={check.id}/></p>{text(row.standard)&&<p>{text(row.standard)} · {text(row.clause)}</p>}</details></div>;})}</details>
  </section>)}</div>;
}
