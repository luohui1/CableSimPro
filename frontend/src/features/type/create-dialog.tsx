import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, message, numeric, optionalRecord, text } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup } from 'radix-ui';
import { Select } from '@/components/ui/select';
import { SourceBadge } from '@/components/source-badge';
import { LoadingState, ErrorState, InlineEmpty } from '@/components/states';
import { creationOptions, newType, proposeType, type Origin, type Proposal } from './creation-api';
import { nominalNumber, versionLabel } from './design-summary';
import { typePath, useTypeNavigation } from './navigation';
import { dimensionBasis } from './dimension-basis';

export function CreateTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { location, navigate } = useTypeNavigation(), queries = useQueryClient();
  const options = useQuery({ queryKey: ['type-creation-options'], queryFn: ({ signal }) => creationOptions(signal), enabled: open, retry: false });
  const [origin, setOrigin] = useState<Origin>('library'), [name, setName] = useState(''), [source, setSource] = useState('');
  const [search,setSearch] = useState('');
  const [generationMode,setGenerationMode] = useState('insulation');
  const [construction, setConstruction] = useState('single_core'), [voltage, setVoltage] = useState(''), [material, setMaterial] = useState('copper_bare');
  const [area, setArea] = useState(''), [form, setForm] = useState(''), [diameter, setDiameter] = useState(''), [gap, setGap] = useState('');
  const [neutralArea,setNeutralArea]=useState(''),[neutralDiameter,setNeutralDiameter]=useState(''),[filler,setFiller]=useState(''),[binder,setBinder]=useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), attempts = useRef<Record<string, string>>({});
  const [repair, setRepair] = useState('');
  const method = options.data?.generation[0], schema = optionalRecord(optionalRecord(method?.schema).properties);
  const choices = origin === 'library' ? options.data?.library : options.data?.imports;
  const filteredChoices=choices?.filter(item=>text(item.name).toLowerCase().includes(search.trim().toLowerCase())||item.id===source)||[];
  function changed() { setProposal(null); setConfirmed(false); setError(''); }
  function chooseOrigin(value: string) { setOrigin(value as Origin); setSource(''); setSearch(''); changed(); }
  function attempt(body: Record<string, unknown>) {
    const key = JSON.stringify(body), storageKey = 'cablesim:type-create-attempt';
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved?.input === key && typeof saved.request === 'string') attempts.current[key] = saved.request; } catch { /* In-memory identity still protects retries. */ }
    const request = attempts.current[key] ||= crypto.randomUUID();
    try { sessionStorage.setItem(storageKey, JSON.stringify({ input: key, request })); } catch { /* No persistent state is required for the host transaction. */ }
    return request;
  }
  function focus(label: string) {
    const field = document.querySelector<HTMLElement>(`[aria-label="${label}"]`), node = [...document.querySelectorAll<HTMLLabelElement>('.type-creation label')].find(node => node.textContent === label);
    (field || (node?.htmlFor ? document.getElementById(node.htmlFor) : null))?.focus();
  }
  function invalid(label: string, reason: string): never { focus(label); throw new Error(label + '：' + reason); }
  function number(value: string, label: string, key: string, scale: number) {
    if (!value.trim() || !Number.isFinite(Number(value))) return invalid(label, '请填写数值并核对单位');
    const result = Number(value) / scale, rule = optionalRecord(schema[key]);
    if (numeric(rule.exclusiveMinimum) !== null && result <= Number(rule.exclusiveMinimum) || numeric(rule.minimum) !== null && result < Number(rule.minimum) || numeric(rule.maximum) !== null && result > Number(rule.maximum)) return invalid(label, '超出插件支持范围，请修正该字段');
    return result;
  }
  async function generate() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setProposal(null); setConfirmed(false);
    try {
      if (!voltage) invalid('额定电压', '请选择电压等级');
      if (!form) invalid('导体几何', '请选择推导条件或提供外径');
      const input = { schema_version: 'cablesim.cable-design-request/2', voltage, conductor: material, construction, form, generation_mode:generationMode,
        area_m2: number(area, '导体截面', 'area_m2', 1e6), ...(form === 'unspecified' ? { diameter_m: number(diameter, '导体外径', 'diameter_m', 1000) } : {}),
        ...(construction !== 'single_core' ? { gap_m: number(gap, '芯间净距', 'gap_m', 1000) } : {}),
        ...(construction==='three_plus_one'?{neutral_area_m2:number(neutralArea,'中性线截面','neutral_area_m2',1e6),...(form==='unspecified'?{neutral_diameter_m:number(neutralDiameter,'中性线外径','neutral_diameter_m',1000)}:{})}:{}),
        ...(['four_core','three_plus_one'].includes(construction)&&filler.trim()?{filler_thickness_m:number(filler,'填充外包厚度','filler_thickness_m',1000)}:{}),
        ...(['four_core','three_plus_one'].includes(construction)&&binder.trim()?{binder_thickness_m:number(binder,'包带等效厚度','binder_thickness_m',1000)}:{}) };
      setProposal(await proposeType(input, attempt(input)));
    } catch (failure) { const reason = message(failure), labels:Record<string,string>={area_m2:'导体截面',diameter_m:'导体外径',gap_m:'芯间净距',voltage:'额定电压',construction:'结构类型',generation_mode:'生成范围',neutral_area_m2:'中性线截面',neutral_diameter_m:'中性线外径',filler_thickness_m:'填充外包厚度',binder_thickness_m:'包带等效厚度'}; const key = Object.keys(labels).find(key => reason.includes('/' + key)); setError(key?reason.replace('/'+key,labels[key]):reason); if (key) requestAnimationFrame(() => focus(labels[key])); } finally { pending.current = false; setBusy(false); }
  }
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (!name.trim()) invalid('型号名称', '请输入名称');
      const base: Record<string, unknown> = { origin, name: name.trim() };
      if (origin === 'blank') base.construction = construction;
      else if (origin === 'standard') {
        if (!proposal || !confirmed) throw new Error('请先生成结构提案并人工确认');
        Object.assign(base, { proposal_id: proposal.id, content_sha256: proposal.content_sha256, human_confirmed: true });
      } else {
        const selected = choices?.find(item => item.id === source);
        if (!selected) throw new Error(origin === 'library' ? '请选择已发布的型号版本' : '请选择已批准的资料结果');
        Object.assign(base, { [origin === 'library' ? 'resource_id' : 'proposal_id']: selected.id, content_sha256: selected.content_sha256 });
      }
      const workspace = await newType({ ...base, request_id: attempt(base) });
      await queries.invalidateQueries({ queryKey: ['type-list'] }); onClose(); navigate(typePath(workspace.id, 'structure', 'section', location.theme));
      delete attempts.current[JSON.stringify(base)];
      try { sessionStorage.removeItem('cablesim:type-create-attempt'); } catch { /* A confirmed response completes this attempt. */ }
    } catch (failure) { setError(message(failure)); setRepair(failure instanceof ApiError ? text(optionalRecord(failure.detail).repair_url) : ''); } finally { pending.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !pending.current) onClose(); }} title="新建型号设计" initialFocus="form"
    actions={origin === 'standard' && !proposal ? <Button variant="primary" loading={busy} disabled={!method || !!options.error} onClick={() => void generate()}>生成结构提案</Button> : <Button variant="primary" loading={busy} disabled={!name.trim() || origin === 'standard' && (!proposal || !confirmed) || ['library', 'import'].includes(origin) && !source} onClick={() => void create()}>{origin === 'standard' ? '确认并建立草稿' : '建立草稿'}</Button>}>
    <div className="type-creation" data-origin={origin} data-creation-state={busy ? 'loading' : error ? 'error' : proposal ? 'success' : 'empty'}>
      <RadioGroup.Root disabled={busy} className="type-origin-choices" aria-label="起点" value={origin} onValueChange={chooseOrigin}>{([['library', '从型号库复制'], ['standard', '按标准生成'], ['import', '从资料导入'], ['blank', '空白']] as const).map(([value, label]) => <label key={value} htmlFor={'type-origin-'+value}><RadioGroup.Item id={'type-origin-'+value} className="type-origin-radio" value={value} aria-label={label}><RadioGroup.Indicator /></RadioGroup.Item>{label}</label>)}</RadioGroup.Root>
      <label className="text-field">型号名称<Input aria-label="型号名称" maxLength={80} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(''); }} /></label>
      {origin === 'blank' ? <Select label="结构类型" value={construction} disabled={busy} onChange={setConstruction} options={[{ value: 'single_core', label: '单芯' }, { value: 'three_core', label: '三芯' },{value:'four_core',label:'四芯等截面'}]} /> : options.isPending ? <LoadingState title="正在读取起点" /> : options.error ? <ErrorState title="起点读取失败" description={message(options.error)} action={<Button onClick={() => void options.refetch()}>重新读取</Button>} /> : origin === 'standard' ? !method ? <InlineEmpty title="未安装结构提案方法，暂不能按标准生成。" /> : <>
        <div className="type-creation-grid">
          <Select label="生成范围" value={generationMode} disabled={busy} onChange={value=>{setGenerationMode(value);changed();}} options={[{value:'insulation',label:'绝缘线芯 · 护层待设计'},{value:'complete',label:'完整护层 · 核对附录依据'}]} />
          <Select label="结构类型" value={construction} disabled={busy} onChange={value => { setConstruction(value); changed(); }} options={[{ value: 'single_core', label: '单芯' }, { value: 'three_core', label: '三芯' },{value:'four_core',label:'四芯等截面'},{value:'three_plus_one',label:'3+1 · 中性线截面减小'}]} />
          <Select label="额定电压" value={voltage} disabled={busy} onChange={value => { setVoltage(value); changed(); }} options={(optionalRecord(schema.voltage).enum as string[] || []).map(value => ({ value, label: value.split('/').map(v => nominalNumber(Number(v) / 1000)).join('/') + ' kV' }))} />
          <Select label="导体材料" value={material} disabled={busy} onChange={value => { setMaterial(value); changed(); }} options={[{ value: 'copper_bare', label: '铜' }, { value: 'aluminium', label: '铝' }]} />
          <label className="text-field">导体截面（mm²）<Input aria-label="导体截面" inputMode="decimal" value={area} disabled={busy} onChange={event => { setArea(event.target.value); changed(); }} /></label>
          <Select label="导体几何" value={form} disabled={busy} onChange={value => { setForm(value); changed(); }} options={[{ value: 'solid_round', label: '等截面积实心圆 · 理想化' }, { value: 'unspecified', label: '提供圆形导体外径' }]} />
          {form === 'unspecified' && <label className="text-field">导体外径 · mm<Input aria-label="导体外径" inputMode="decimal" value={diameter} disabled={busy} onChange={event => { setDiameter(event.target.value); changed(); }} /></label>}
          {construction !== 'single_core' && <label className="text-field">芯间最小净距 · mm<Input aria-label="芯间净距" inputMode="decimal" value={gap} disabled={busy} onChange={event => { setGap(event.target.value); changed(); }} /></label>}
          {construction==='three_plus_one'&&<><label className="text-field">中性线截面 · mm²<Input aria-label="中性线截面" value={neutralArea} inputMode="decimal" onChange={event=>{setNeutralArea(event.target.value);changed();}} disabled={busy}/></label>{form==='unspecified'&&<label className="text-field">中性线外径 · mm<Input aria-label="中性线外径" value={neutralDiameter} inputMode="decimal" onChange={event=>{setNeutralDiameter(event.target.value);changed();}} disabled={busy}/></label>}</>}
          {['four_core','three_plus_one'].includes(construction)&&<><label className="text-field">填充外包厚度 · mm<Input aria-label="填充外包厚度" value={filler} placeholder="可暂缺，须工程师给定" inputMode="decimal" onChange={event=>{setFiller(event.target.value);changed();}} disabled={busy}/></label><label className="text-field">包带等效厚度 · mm<Input aria-label="包带等效厚度" value={binder} placeholder="可暂缺，须工程师给定" inputMode="decimal" onChange={event=>{setBinder(event.target.value);changed();}} disabled={busy}/></label></>}
        </div>
        {proposal && <section aria-label="结构提案" className="type-creation-proposal"><table><thead><tr><th>参数</th><th>建议值</th><th>依据</th></tr></thead><tbody>{proposal.rows.map((row, index) => { const source = optionalRecord(row.source),unit=row.unit==='m2'?'mm²':row.unit==='m'?'mm':text(row.unit),scale=row.unit==='m2'?1e6:row.unit==='m'?1000:1; return <tr key={index}><td>{text(row.label)}</td><td>{nominalNumber(numeric(row.value) === null ? null : Number(row.value) * scale, 3)} {unit}</td><td><SourceBadge kind={row.basis === 'standard_value' ? 'standard' : row.basis === 'user' ? 'user' : 'derived'} detail={dimensionBasis(JSON.stringify(source)) || text(row.formula) || [text(source.standard), text(source.clause)].filter(Boolean).join(' · ')} />{text(source.citation) || [text(source.standard), text(source.clause)].filter(Boolean).join(' · ')}</td></tr>; })}</tbody></table>
          <details><summary>提案范围与缺项</summary><ul>{proposal.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
          <label><Checkbox aria-label="已核对标准值、推导条件与缺项" checked={confirmed} onCheckedChange={value => setConfirmed(value===true)} disabled={busy} /> 已核对标准值、推导条件与缺项</label>
        </section>}
      </> : <>
        {!!choices?.length && <label className="text-field">查找型号<Input aria-label="查找型号版本" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="型号或厂家名称" /></label>}
        {choices?.length ? filteredChoices.length ? <Select label={origin === 'library' ? '型号版本' : '已批准资料结果'} value={source} disabled={busy} onChange={value => { setSource(value); setError(''); }} options={filteredChoices.map(item => ({ value: text(item.id), label: text(item.name) + ' · ' + versionLabel(text(item.version)) }))} /> : <InlineEmpty title="没有匹配的结果" action={<Button size="compact" onClick={()=>setSearch('')}>清除筛选</Button>} /> : <InlineEmpty title={origin === 'library' ? '尚无已发布的型号版本' : '尚无已批准的资料结果'} />}
        {origin==='library'&&source&&choices?.find(item=>item.id===source)?.status&&<span className="muted">{choices.find(item=>item.id===source)?.status==='published'?'已发布':'库参考版本'} · 缺项会保留在新草稿中</span>}
        {origin === 'import' && <Button disabled={busy} onClick={() => { onClose(); navigate('/resources/cables/imports?theme=' + location.theme); }}>打开资料导入</Button>}
      </>}
      {error && <p className="field-error" role="alert">{error}{repair&&<Button size="compact" onClick={()=>{onClose();navigate(repair+'?theme='+location.theme);}}>核对资料结构与来源</Button>}</p>}
    </div>
  </Dialog>;
}
