import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { ConclusionStrip } from '@/components/conclusion-strip';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ConvergenceChart } from './convergence-chart';
import { HeatCapacityForm } from './heat-capacity-form';
import { hpcJson, hpcStatus, savedRunLabel } from './run-label';
import './field.css';

const records = (value: unknown) => Array.isArray(value) ? value.map(optionalRecord) : [];
const number = (value: unknown, digits = 3) => numeric(value)?.toFixed(digits) ?? '—';

export function StepCurve({ rows }: { rows: Record<string, unknown>[] }) {
  const positive = rows.filter(row => Number(row.time_s) > 0);
  if (positive.length < 2) return null;
  const first = Math.log10(Number(positive[0].time_s)), last = Math.log10(Number(positive.at(-1)?.time_s));
  const maximum = Math.max(...positive.map(row => Number(row.rise_k))) || 1;
  const point = (row: Record<string, unknown>) => `${72+(Math.log10(Number(row.time_s))-first)/(last-first || 1)*820},${192-Number(row.rise_k)/maximum*152}`;
  return <figure className="fem-convergence-chart"><figcaption>导体阶跃温升 · K · 时间为对数轴，初态 0 K</figcaption>
    <svg viewBox="0 0 920 232" role="img" aria-label="保存有限元阶跃温升曲线">
      <path className="fem-chart-axis" d="M72 32V192H892" />
      <path className="fem-chart-line" d={positive.map((row,index) => `${index ? 'L' : 'M'}${point(row)}`).join(' ')} />
      <text x="4" y="40">{maximum.toFixed(2)}</text><text x="4" y="192">0</text>
      {[first,(first+last)/2,last].map((value,index) => <text key={index} x={72+index*410} y="218" textAnchor="middle">{Math.pow(10,value).toPrecision(3)} s</text>)}
    </svg>
  </figure>;
}

export function StepResponse({ run }: { run: Record<string, unknown> }) {
  const wid=text(run.workspace),sid=text(run.study),rid=text(run.id);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[budget,setBudget]=useState('16');
  const [capacities,setCapacities]=useState(''),[estimate,setEstimate]=useState<Record<string,unknown>>();
  const [selected,setSelected]=useState('');
  const lock=useRef(false),request=useRef({scope:'',id:''});
  const history=useQuery({queryKey:['step-responses',wid,sid],enabled:!!wid && !!sid,retry:false,
    queryFn:({signal}) => hpcJson(`/workspaces/${wid}/studies/${sid}/step-responses`,{signal}),
    refetchInterval:query => records(query.state.data?.items).some(row => ['queued','running'].includes(text(row.status))) ? 3000 : false});
  const choices=records(history.data?.items).filter(row => row.source_run_id===rid || row.run_id===rid);
  const item=choices.find(row => row.id===selected) ?? choices[0];
  const detail=useQuery({queryKey:['step-response-detail',item?.id,item?.status],enabled:!!item?.id,retry:false,
    queryFn:({signal}) => hpcJson(`/step-responses/${text(item?.id)}`,{signal}),
    refetchInterval:query => ['queued','running'].includes(text(query.state.data?.status)) ? 3000 : false});
  const saved=records(optionalRecord(run.output).cases).map(row => optionalRecord(optionalRecord(optionalRecord(row.artifacts)['x-cablesim.simulation-bundle']).step_response)).find(row => row.schema==='cablesim.fem-step-response-result/1');
  const sourceCheck=useQuery({queryKey:['step-response-source',wid,sid,rid],enabled:!!wid && !!sid && !!rid && run.status==='succeeded' && !saved && (!item || ['failed','cancelled'].includes(text(item.status))),retry:false,
    queryFn:({signal}) => hpcJson(`/workspaces/${wid}/studies/${sid}/step-responses/source-check?source_run_id=${encodeURIComponent(rid)}`,{signal})});
  const unsupported=sourceCheck.data?.status==='unsupported';
  const response=optionalRecord(detail.data?.response ?? saved),convergence=optionalRecord(response.convergence);
  const active=item && ['queued','running'].includes(text(item.status)),execution=optionalRecord(detail.data?.execution ?? item?.execution);
  const exported=detail.data?.emergency_input ?? records(optionalRecord(run.output).cases).map(row => optionalRecord(row.artifacts)['x-cablesim.emergency-input']).find(Boolean);
  const download=useMemo(() => exported ? URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'})) : undefined,[exported]);
  useEffect(() => () => {if(download)URL.revokeObjectURL(download);},[download]);
  useEffect(() => {const handler=(event:KeyboardEvent) => {if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s' && download){event.preventDefault();const a=document.createElement('a');a.href=download;a.download='iec60853-response.json';a.click();}};window.addEventListener('keydown',handler);return () => window.removeEventListener('keydown',handler);},[download]);
  const levels:(Record<string,unknown> & {id:string})[]=records(convergence.levels).map((row,index) => ({...row,id:String(index)}));
  const materials:(Record<string,unknown> & {id:string})[]=Object.entries(optionalRecord(response.capacities)).map(([id,value]) => ({...optionalRecord(value),id}));
  const state=detail.data ?? item;
  async function perform(action:'estimate'|'start'|'cancel'|'resume') {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      if(action==='estimate' || action==='start') {
        const hours=Number(budget);if(!Number.isFinite(hours) || hours<=0 || hours>2000)throw Error('核时预算须大于 0 且不超过 2000。');
        let values:unknown=null;if(capacities.trim()){try{values=JSON.parse(capacities);}catch{throw Error('材料热容格式无效；请填写来源、页码、表号和 J/(m³·K)。');}}
        const scope=JSON.stringify([wid,sid,rid,hours,values,item?.id]);if(request.current.scope!==scope)request.current={scope,id:crypto.randomUUID()};
        const value=await hpcJson(`/workspaces/${wid}/studies/${sid}/step-responses${action==='estimate' ? '/estimate' : ''}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:request.current.id,source_run_id:rid,capacities:values,max_core_hours:hours,budget_confirmed:action==='start'})});
        if(action==='estimate'){setEstimate(value);setOpen(true);}else{setOpen(false);await history.refetch();}
      }else{await hpcJson(`/step-responses/${text(item?.id)}/${action}`,{method:'POST'});await history.refetch();await detail.refetch();}
    }catch(failure){setError(message(failure));}finally{lock.current=false;setBusy(false);}
  }
  return <section className="input-module step-response" aria-label="阶跃热响应">
    <div className="hpc-actions"><h3>阶跃热响应</h3>
      {choices.length>1 && <Select label="保存响应" value={text(item?.id)} onChange={setSelected} options={choices.map(row => ({value:text(row.id),label:savedRunLabel({...row,study_name:text(optionalRecord(row.definition).title)})}))} />}
      {download && <a className="button button-outline" href={download} download="iec60853-response.json">导出应急响应输入</a>}
      {active && <Button disabled={busy || !!state?.cancel_requested} onClick={() => void perform('cancel')}>{state?.cancel_requested ? '取消待确认' : '停止响应作业'}</Button>}
      {item?.status==='interrupted' && <Button disabled={busy} onClick={() => void perform('resume')}>恢复原作业</Button>}
    </div>
    {run.freshness==='historical' && <p className="field-history">历史 · 来源运行已过期，{response.schema ? '曲线仍按其保存输入显示。' : '适用范围按保存输入核对。'}</p>}
    {(error || history.error || detail.error || sourceCheck.error) && <ErrorState description={error || message(history.error ?? detail.error ?? sourceCheck.error)} action={<Button variant="ghost" onClick={() => {void history.refetch();void detail.refetch();void sourceCheck.refetch();}}>重试读取</Button>} />}
    {unsupported && <div className="field-state-note" role="status"><strong>该工况的阶跃响应尚未覆盖</strong>
      <p>{text(sourceCheck.data?.reason)}</p><p>{text(sourceCheck.data?.next_step)}</p></div>}
    {history.isPending || sourceCheck.isFetching && !sourceCheck.data ? <LoadingState title="检查保存来源与暂态适用范围" /> : (!item || ['failed','cancelled'].includes(text(item.status))) && !saved && !response.schema && !history.error && !unsupported ? <>
      <EmptyState title="尚无阶跃响应" description="单回路、均匀土壤与恒温地表；逐材料热容须有正文来源。" />
      {records(sourceCheck.data?.material_regions).length>0&&<HeatCapacityForm regions={records(sourceCheck.data?.material_regions).map(row=>({id:text(row.id),label:text(row.label)}))} onChange={value=>setCapacities(JSON.stringify(value))}/>}
      <details><summary>补充材料热容来源</summary><label className="hpc-budget">区域热容 JSON · J/(m³·K)<textarea value={capacities} onChange={event => setCapacities(event.target.value)} rows={6} placeholder="已保存的来源齐全时留空；缺项预检会列出具体材料域。" /></label></details>
      <label className="hpc-budget">累计核时预算<input type="number" min="0.001" max="2000" step="1" value={budget} onChange={event => setBudget(event.target.value)} /></label>
      <Button variant="primary" disabled={busy || run.status!=='succeeded' || !sourceCheck.data || !!sourceCheck.error} onClick={() => void perform('estimate')}>预检响应与预算</Button>
    </> : null}
    {state && <dl className="field-scope"><div><dt>保存记录</dt><dd>{savedRunLabel({...state,study_name:text(optionalRecord(state.definition).title),sequence:detail.data?.sequence})}</dd></div>
      <div><dt>状态</dt><dd>{hpcStatus(active ? execution.state ?? state.status : state.status)}{execution.job_id ? ` · 作业 ${text(execution.job_id)}` : ''}</dd></div>
      <div><dt>核时</dt><dd>{number(state.used_core_hours,5)} / {number(state.budget_core_hours,2)} 核时{active ? ` · 排队位置 ${numeric(execution.queue_position) ?? '尚未提供'}` : ''}</dd></div>
      {state.reason ? <div><dt>诊断</dt><dd>{text(state.reason)}</dd></div> : null}</dl>}
    {!!response.schema && <>
      <ConclusionStrip label="阶跃响应结论" conclusion={convergence.status==='converged' ? '时间步、网格与稳态末值均达到门槛' : '尚未收敛，禁止导出应急输入'} historical={run.freshness==='historical'} metrics={[
        {label:'收敛门槛',value:numeric(convergence.tolerance_k),unit:'K',precision:1},
        {label:'稳态焦耳温升',value:numeric(response.steady_joule_rise_k),unit:'K',precision:3},
        {label:'参考电流',value:numeric(response.reference_current_a),unit:'A',precision:1},
      ]}/>
      <dl className="field-scope">
        <div><dt>参考工况</dt><dd>{number(response.reference_current_a,1)} A · 固定焦耳损耗 · 镜像暂态远场 · 地表恒温</dd></div>
        <div><dt>稳态焦耳温升</dt><dd>{number(response.steady_joule_rise_k)} K · 末值差 {number(convergence.steady_gap_k)} K · 末值与保存稳态差 {number(convergence.endpoint_saved_difference_k)} K</dd></div>
        <div><dt>解析交叉核对</dt><dd>{response.analytic_cross_check ? `外部均质土壤 E1 镜像解 · 最大差 ${number(optionalRecord(response.analytic_cross_check).maximum_difference_k)} K · 非 IEC 官方算例` : '未覆盖：保存模型没有外部土壤取样点。'}</dd></div></dl>
      <StepCurve rows={records(response.curve)} />
      <ConvergenceChart label="时间步加密最大温升差" unit="K" threshold={.1} values={levels.filter(row => text(row.kind).startsWith('time')).map(row => numeric(row.change_k))} />
      <ConvergenceChart label="网格加密最大温升差" unit="K" threshold={.1} values={levels.filter(row => row.kind==='mesh').map(row => numeric(row.change_k))} />
      <DataTable label="阶跃响应收敛记录" columns={[
        {id:'kind',label:'级别',render:row => `${row.kind==='mesh' ? '网格' : row.kind==='time_final_mesh' ? '最终网格时间步' : '时间步'} ${number(row.level,0)}${row.reused_from_time_level ? ' · 复用已算曲线' : ''}`},
        {id:'nodes',label:'自由度',numeric:true,render:row => number(row.nodes,0)},
        {id:'steps',label:'时间区间',numeric:true,render:row => number(row.time_intervals,0)},
        {id:'difference',label:'最大差 K',numeric:true,render:row => number(row.change_k)},
        {id:'wall',label:'墙钟 s',numeric:true,render:row => number(row.wall_seconds,2)},
        {id:'cpu',label:'求解 CPU 核时',numeric:true,render:row => number(Number(row.cpu_seconds)/3600,5)},
      ]} groups={[{id:'levels',label:'保存的逐级计算',rows:levels}]} rowLabel={row => `加密 ${row.id}`} />
      <details><summary>材料热容与来源 · {materials.length} 个域</summary><DataTable label="材料热容来源" columns={[
        {id:'material',label:'材料',render:row => text(row.material)},
        {id:'value',label:'J/(m³·K)',numeric:true,render:row => number(row.value_j_m3_k,0)},
        {id:'source',label:'正文来源',render:row => `${text(row.reference)} · 页 ${number(row.page,0)} · 表 ${text(row.table)}`},
        {id:'limitations',label:'适用范围',render:row => text(row.limitations)},
      ]} groups={[{id:'materials',label:'有正文来源的材料',rows:materials}]} rowLabel={row => text(row.material)} /></details>
    </>}
    <Dialog open={open} onOpenChange={setOpen} title="确认阶跃热响应核时预算" actions={<Button variant="primary" disabled={busy || Number(budget)<Number(estimate?.budget_core_hours)} onClick={() => void perform('start')}>提交 dg83</Button>}>
      <p>预检与求解上限 {number(estimate?.budget_core_hours,3)} 核时 · 本次累计预算 {budget} 核时。</p>
      <p>当前网格容量 {number(estimate?.node_limit,0)} 自由度；实际规模由超算网格预检确认。时间步和网格逐级加密，门槛 0.1 K。</p>
      {error && <ErrorState description={error} />}
    </Dialog>
  </section>;
}
