import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, message, optionalRecord, responseData, text } from '@/api/client';
import { AddStudyDialog } from '@/components/add-study-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingState, ErrorState } from '@/components/states';
import { formatNumber } from '@/lib/format';
import { compileRating, typeStudies } from './rating-api';
import { useTypeWorkspace } from './provider';
import { useTypeNavigation } from './navigation';

/** Keep the saved design and its study in one workspace; runs pin that revision. */
export function TypeStudyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const state = useTypeWorkspace(), { location, navigate } = useTypeNavigation();
  const queries = useQueryClient();
  const [name, setName] = useState(''), [parameterSource, setParameterSource] = useState('defaults'), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const studies = useQuery({ queryKey: ['type-studies', state.workspace?.id], queryFn: ({signal}) => typeStudies(state.workspace!.id, signal), enabled: open && !!state.workspace });
  const fourCore = state.document?.cable_types[0]?.construction === 'multi_core';
  const prepared = useQuery({ queryKey: ['type-study-buried-condition', state.workspace?.id, state.workspace?.revision],
    queryFn: () => compileRating(state.workspace!.id, state.workspace!.revision, { rows: [{case_id:'buried-single',name:'直埋单回',layout:state.document!.cable_types[0].construction === 'three_core'?'three_core_buried_single':'trefoil'}],parameters:{} }),
    enabled: open && !!state.workspace && !fourCore });
  if (!state.workspace || !state.document) return null;
  if (fourCore) return <AddStudyDialog open={open} onOpenChange={onOpenChange} theme={location.theme}
    workspaceId={state.workspace.id} projectName={state.document.name}
    workspacePicker={<section aria-label="型号与研究的关联">
      <p>研究使用已保存的型号与敷设输入；每次运行固定输入修订。可在型号名片的“被用于”中返回研究。</p>
      <p>四芯及 3+1 的完整载流量热路尚未接入。10 kV 及以下可在“要回答的问题”选择“按 GB 50217 校正”，先提供同型号、同敷设条件且有出处的单根基准值。型号截面不等于直埋工况：进入研究后先填写敷设环境与回路；基准缺失时不能计算电流。</p>
    </section>} />;
  const configuration = prepared.data;
  const recent = studies.data?.filter(study => study.definition.method.plugin_id === configuration?.method.plugin_id && study.definition.method.capability === configuration?.method.capability && study.definition.method.version === configuration?.method.version && study.definition.method.release_digest === configuration?.method.release_digest).sort((a,b)=>b.created.localeCompare(a.created))[0];
  const cases = configuration?.driver?.cases, condition = optionalRecord(optionalRecord(cases?.[0]?.metadata).condition);
  const problem = error || (prepared.error || studies.error ? message(prepared.error || studies.error) : '');
  async function create() {
    if (!configuration || !cases?.length || !ack || !name.trim() || busy || state.dirty || state.readOnly) return;
    setBusy(true); setError('');
    try {
      const caseInput = cases[0].input;
      const parameters = parameterSource === 'recent' && recent ? structuredClone(recent.definition.parameters || {}) : {};
      const saved = await responseData(api.POST('/api/workspaces/{wid}/studies', {params:{path:{wid:state.workspace!.id}},body:{
        title:name.trim(),task:'rating',expected_revision:state.workspace!.revision,method:configuration.method,input_source:'study',method_input:caseInput,
        parameters,driver:{kind:'single'},input_sources:{
          '/method_input':{kind:'user',reference:`型号设计修订 ${state.workspace!.revision}；直埋单回模板：${JSON.stringify(condition)}；工程师确认的设计条件，非现场测量`,reviewed:false},
          '/parameters':{kind:parameterSource==='recent'?'user':'derived',reference:parameterSource==='recent'&&recent?`沿用「${recent.definition.title}」保存的方法条件；未覆盖项仍需补齐`:'建立研究后按匹配插件契约填写方法参数；未补齐时禁止运行',reviewed:false},
          '/title':{kind:'user',reference:'工程师填写研究名称',reviewed:false},
        },
      }}));
      const id = text(optionalRecord(saved).id); if (!id) throw Error('新研究未返回身份，请重新读取研究列表');
      await queries.invalidateQueries({queryKey:['study-index']}); await queries.invalidateQueries({queryKey:['object-relations','type',state.workspace!.id]});
      onOpenChange(false); locationNavigate(id);
    } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }
  function locationNavigate(id:string) { navigate(`/studies/${encodeURIComponent(id)}/ampacity/results?workspace=${encodeURIComponent(state.workspace!.id)}&theme=${location.theme}&inspector=method`); }
  return <Dialog open={open} onOpenChange={value=>{if(!busy){onOpenChange(value);setError('');setAck(false);}}} title="新建研究" description="型号结构保持原样；直埋条件另存为研究输入，运行固定来源修订。" actions={<Button variant="primary" loading={busy} disabled={!configuration||!name.trim()||!ack||state.dirty||state.readOnly||!!problem} onClick={()=>void create()}>建立研究</Button>}>
    {prepared.isPending || studies.isPending ? <LoadingState title="正在读取型号与直埋模板" /> : problem ? <ErrorState description={problem} action={<Button onClick={()=>{setError('');void prepared.refetch();void studies.refetch();}}>重新读取</Button>} /> : <>
      <label className="type-form-label">研究名称<Input aria-label="研究名称" value={name} maxLength={120} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void create();}}} /></label>
      <p>直埋单回 · 交流 {formatNumber(Number(condition.frequency_hz),0)} Hz · {formatNumber(Number(condition.ambient_temperature_c),1)} °C · 中心埋深 {formatNumber(Number(condition.depth_m),2)} m · 土壤热阻率 {formatNumber(Number(condition.soil_rho_k_m_w),2)} K·m/W</p>
      <Select label="方法参数来源" value={parameterSource} onChange={setParameterSource} options={[{value:'defaults',label:'新填方法参数'},...(recent?[{value:'recent',label:`沿用最近研究 · ${recent.definition.title}`}]:[])]} />
      <label className="type-check-label"><Checkbox aria-label="已核对直埋模板条件" checked={ack} onCheckedChange={checked=>setAck(checked===true)} />已核对直埋模板条件；进入研究后可修改</label>
    </>}
  </Dialog>;
}
