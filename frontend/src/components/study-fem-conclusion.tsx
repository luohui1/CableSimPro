import { useQuery } from '@tanstack/react-query';
import { array, message, numeric, optionalRecord, text } from '@/api/client';
import { isVersionStale } from '@/lib/version-status';
import { Conclusion } from './conclusion';
import { DataTable } from './data-table';
import { ErrorState, InlineEmpty, LoadingState } from './states';
import { Button } from './ui/button';

export function useFemEvidence(run?: Record<string,unknown>) {
  const method=optionalRecord(run?.method || optionalRecord(optionalRecord(run?.snapshot).definition).method);
  return useQuery({queryKey:['fem-conclusion',run?.workspace,run?.id], enabled:!!run && method.capability==='iec-thermal-field' && ['succeeded','partial'].includes(text(run.status)), retry:false,staleTime:30000,
    queryFn:async({signal})=>{
      const response=await fetch(`/api/workspaces/${encodeURIComponent(text(run?.workspace))}/runs/${encodeURIComponent(text(run?.id))}/fem-conclusion`,{signal});
      const data=await response.json();if(!response.ok)throw Error(text(optionalRecord(data.detail).message) || text(data.detail) || `保存证明读取失败（${response.status}）`);
      return optionalRecord(data);
    }});
}

export function FemConclusionBar({run}:{run:Record<string,unknown>}) {
  const evidence=useFemEvidence(run),data=evidence.data;
  if(evidence.isPending)return <LoadingState title="正在核验保存的网格与扩域证明" />;
  if(evidence.error)return <ErrorState title="收敛证明不可用" description={message(evidence.error)} action={<Button size="compact" onClick={()=>void evidence.refetch()}>重新读取</Button>} />;
  if(!data || data.status!=='converged')return <InlineEmpty title={'有限元 · 未收敛 · '+text(data?.reason)} />;
  const margin=numeric(data.margin_k),temperature=numeric(data.hottest_temperature_k);
  return <Conclusion title="有限元负荷校核结论" model={margin===null ? '保存工况已收敛，温限资料缺项' : margin<0 ? '保存负荷超出温限' : '保存负荷满足温限'}
    description={`有限元 · 已收敛（网格与扩域均 < ${data.tolerance_k} K）· ${text(data.boundary_label)}`}
    historical={run.freshness==='historical' || isVersionStale(run)} metrics={[
      {label:text(data.rating_basis)==='rating-simultaneous' ? '共同允许电流' : '允许电流',value:numeric(data.allowable_current_a),unit:'A',precision:1},
      {label:'最热导体',value:temperature===null ? null : temperature-273.15,unit:'°C',precision:1},
      {label:'温限余量',value:margin,unit:'K',precision:1}]} />;
}

export function FemSavedComparison({run}:{run:Record<string,unknown>}) {
  const evidence=useFemEvidence(run),data=evidence.data;
  if(evidence.isPending)return <LoadingState title="正在核对保存结果" />;
  if(evidence.error)return <ErrorState title="保存结果不可用" description={message(evidence.error)} />;
  if(data?.status!=='converged')return <InlineEmpty title="查看诊断与逐级收敛记录。" />;
  const rows=array(data.comparison).map<Record<string,unknown> & {id:string}>((value,index)=>({...optionalRecord(value),id:String(index)})).filter(row=>row.fem!==null);
  if(!rows.length)return <InlineEmpty title="尚无同输入的 IEC 保存运行，按同工况运行 IEC 后自动对照。" />;
  const value=(v:unknown,unit:unknown)=>typeof v==='number' ? (unit==='K' ? v-273.15 : v).toFixed(2) : '—';
  return <section aria-label="有限元与 IEC 保存结果对照"><DataTable label="有限元与 IEC 同输入对照" showGroups={false} rowLabel={row=>text(row.label)}
    columns={[{id:'object',label:'对象',render:row=>text(row.label)},
      {id:'quantity',label:'量值',render:row=>row.quantity==='conductor_temperature' ? '导体温度 °C' : row.condition==='rating-simultaneous' ? '共同允许电流 A' : '条件允许电流 A'},
      {id:'fem',label:'有限元',numeric:true,render:row=>value(row.fem,row.unit)},
      {id:'iec',label:'IEC',numeric:true,render:row=>value(row.iec,row.unit)},
      {id:'delta',label:'差值 K / A',numeric:true,render:row=>typeof row.delta==='number' ? row.delta.toFixed(2) : '—'},
      {id:'relative',label:'相对差 %',numeric:true,render:row=>typeof row.relative_percent==='number' ? row.relative_percent.toFixed(2) : '—'}]}
    groups={[{id:'comparison',label:'保存结果',rows}]} />
    <p className="muted">仅比较同输入保存结果；温度相对差以 IEC 绝对温度 K 为分母，差异作为信息展示。</p>
  </section>;
}
