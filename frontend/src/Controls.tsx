import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Cable, Installation, Preset, Scenario, Sweep } from './types';
import { api, canonical, errorText } from './utils';
import { LineChart } from './Visuals';

export function Icon({name, size = 18}: {name: string; size?: number}) {
  const paths: Record<string, string> = {
    cube: 'm12 3 9 5v8l-9 5-9-5V8l9-5Zm0 0v18M3 8l9 5 9-5',
    folder: 'M3 7V5h6l2 3h10v11H3V7Z', save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
    play: 'm8 4 13 8-13 8V4Z', down: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    up: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5', plus: 'M12 4v16M4 12h16',
    info: 'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6', expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    check: 'm5 12 4 4L20 5', close: 'm6 6 12 12M6 18 18 6', chart: 'M3 3v18h18M7 15l4-5 4 3 6-8',
    book: 'M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1m0-16c4-3 8-2 10-1v16c-4-2-7-1-10 1V5Z',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    bolt: 'm13 2-9 12h7l-1 8 10-13h-7l0-7Z', arrow: 'M5 12h14m-5-5 5 5-5 5',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info}/></svg>;
}

export function NumberField({label, value, onChange, min, max, unit, hint}: {label: string; value: number; onChange: (n: number) => void; min: number; max: number; unit?: string; hint?: string}) {
  return <label className="field"><span>{label}{unit && <small>{unit}</small>}</span><input type="number" aria-label={label} required min={min} max={max} step="any" value={Number.isFinite(value) ? value : ''} onChange={e => onChange(e.target.valueAsNumber)}/>{hint && <em>{hint}</em>}</label>;
}

const layerFields: {key: keyof Cable; label: string; min: number; max: number}[] = [
  {key: 'conductor_screen_mm', label: '导体屏蔽厚度', min: 0.1, max: 2},
  {key: 'insulation_mm', label: '绝缘厚度', min: 2, max: 15},
  {key: 'insulation_screen_mm', label: '绝缘屏蔽厚度', min: 0.1, max: 2},
  {key: 'metallic_screen_mm', label: '等效金属屏蔽厚度', min: 0.05, max: 3},
  {key: 'jacket_mm', label: '外护套厚度', min: 1, max: 8},
];
export function Parameters({scenario, onChange, presets, busy, selectedTab}: {scenario: Scenario; onChange: (s: Scenario) => void; presets: Preset[]; busy: boolean; selectedTab?: 'cable' | 'installation' | 'load'}) {
  const [tab, setTab] = useState<'cable' | 'installation' | 'load'>('cable');
  useEffect(() => { if (selectedTab) setTab(selectedTab); }, [selectedTab]);
  const c = scenario.cable, e = scenario.installation;
  function cable<K extends keyof Cable>(key: K, value: Cable[K]) { onChange({...scenario, cable: {...c, [key]: value}}); }
  function env<K extends keyof Installation>(key: K, value: Installation[K]) { onChange({...scenario, installation: {...e, [key]: value}}); }
  return <aside className="parameters">
    <div className="panel-heading"><h2>参数属性</h2></div>
    <div className="parameter-tabs">{(['cable', 'installation', 'load'] as const).map((t, i) => <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{['电缆', '敷设', '运行'][i]}</button>)}</div>
    <form id="parameter-form" className="parameter-body" onSubmit={event => event.preventDefault()}><fieldset disabled={busy}>
      {tab === 'cable' && <>
        <label className="field"><span>电缆模板<small>演示参数</small></span><select aria-label="电缆模板" value="" onChange={event => { const p = presets.find(p => p.id === event.target.value); if (p) onChange({...scenario, cable: {...p.scenario.cable}}); }}><option value="" disabled>选择 Cu / Al 演示模板</option>{presets.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}</select></label>
        <div className="form-section"><i/>导体与电气参数</div>
        <label className="field"><span>导体材料</span><select aria-label="导体材料" value={c.conductor} onChange={event => cable('conductor', event.target.value as Cable['conductor'])}><option value="copper">铜 Cu</option><option value="aluminium">铝 Al</option></select></label>
        <NumberField label="导体截面积" unit="mm²" value={c.area_mm2} min={50} max={1000} onChange={v => cable('area_mm2', v)}/>
        <NumberField label="相对地电压 U₀" unit="kV" value={c.u0_kv} min={1} max={26} onChange={v => cable('u0_kv', v)}/>
        <NumberField label="导体温度上限" unit="°C" value={c.max_temperature_c} min={50} max={110} onChange={v => cable('max_temperature_c', v)}/>
        <div className="form-section"><i/>同心层结构</div>
        {layerFields.map(f => <NumberField key={f.key} label={f.label} unit="mm" value={c[f.key] as number} min={f.min} max={f.max} onChange={v => cable(f.key, v)}/>)}
        <details className="advanced"><summary>高级电气与材料参数</summary>
          <NumberField label="导体填充系数" value={c.fill_factor} min={0.7} max={1} onChange={v => cable('fill_factor', v)}/>
          <label className="field"><span>厂家 R₂₀<small>Ω/km</small></span><input aria-label="厂家 R20" type="number" min="0.000001" max="10" step="any" placeholder="留空按截面积估算" value={c.r20_ohm_km ?? ''} onChange={event => cable('r20_ohm_km', event.target.value === '' ? null : event.target.valueAsNumber)}/><em>填写后电阻不再随截面积自动推算。</em></label>
          <label className="field"><span>频率<small>Hz</small></span><select aria-label="频率" value={c.frequency_hz} onChange={event => cable('frequency_hz', Number(event.target.value) as 50 | 60)}><option>50</option><option>60</option></select></label>
          <NumberField label="交流附加系数" value={c.ac_extra_factor} min={0} max={1} onChange={v => cable('ac_extra_factor', v)} hint="输入假设；不是自动计算的集肤/邻近系数。"/>
          <NumberField label="屏蔽损耗系数 λ" value={c.screen_loss_factor} min={0} max={2} onChange={v => cable('screen_loss_factor', v)} hint="需按实际接地与结构校核。"/>
          <NumberField label="相对介电常数" value={c.relative_permittivity} min={1} max={10} onChange={v => cable('relative_permittivity', v)}/>
          <NumberField label="介质损耗角正切" value={c.tan_delta} min={0} max={0.02} onChange={v => cable('tan_delta', v)}/>
          <NumberField label="绝缘热阻率" unit="K·m/W" value={c.insulation_rho_k_m_w} min={0.1} max={10} onChange={v => cable('insulation_rho_k_m_w', v)}/>
          <NumberField label="护套热阻率" unit="K·m/W" value={c.jacket_rho_k_m_w} min={0.1} max={10} onChange={v => cable('jacket_rho_k_m_w', v)}/>
          <NumberField label="半导电层热阻率" unit="K·m/W" value={c.semicon_rho_k_m_w} min={0.1} max={10} onChange={v => cable('semicon_rho_k_m_w', v)}/>
        </details>
      </>}
      {tab === 'installation' && <>
        <div className="scope-label"><Icon name="check" size={14}/> 单回路 · 均匀土壤直埋</div>
        <label className="field"><span>三相排列方式</span><select aria-label="三相排列方式" value={e.arrangement} onChange={event => env('arrangement', event.target.value as Installation['arrangement'])}><option value="flat">水平平行排列</option><option value="trefoil">等边三角排列</option></select></label>
        <NumberField label="平均中心埋深" unit="m" value={e.depth_m} min={0.2} max={3} onChange={v => env('depth_m', v)} hint="三角排列时，A 相高于平均中心。"/>
        <NumberField label="相邻中心间距" unit="m" value={e.spacing_m} min={0.02} max={2} onChange={v => env('spacing_m', v)}/>
        <NumberField label="环境温度" unit="°C" value={e.ambient_temperature_c} min={-20} max={60} onChange={v => env('ambient_temperature_c', v)}/>
        <NumberField label="土壤热阻率" unit="K·m/W" value={e.soil_rho_k_m_w} min={0.3} max={5} onChange={v => env('soil_rho_k_m_w', v)}/>
        <div className="parameter-note"><Icon name="info"/><p>本版不支持排管、回填分区或土壤干燥。几何边界与电缆重叠由后端统一校验。</p></div>
      </>}
      {tab === 'load' && <>
        <div className="scope-label"><Icon name="bolt" size={14}/> 三相平衡 · 持续稳态负荷</div>
        <NumberField label="运行电流" unit="A" value={scenario.operating_current_a} min={0} max={3000} onChange={v => onChange({...scenario, operating_current_a: v})}/>
        <NumberField label="线路长度" unit="m" value={scenario.circuit_length_m} min={1} max={100000} onChange={v => onChange({...scenario, circuit_length_m: v})} hint="影响三相线路总损耗，不影响无限长截面模型的载流量。"/>
        <label className="field"><span>工程说明</span><textarea aria-label="工程说明" maxLength={1000} value={scenario.description} onChange={event => onChange({...scenario, description: event.target.value})}/></label>
        <label className="field"><span>电缆名称</span><input aria-label="电缆名称" required maxLength={100} value={c.name} onChange={event => cable('name', event.target.value)}/></label>
        <div className="parameter-note"><Icon name="info"/><p>允许载流量由最热相达到导体温度上限确定。输入的运行电流用于求解实际温度和损耗。</p></div>
      </>}
    </fieldset></form>
    <div className="parameter-footer"><span className="dot"/> 参数变更后请重新计算</div>
  </aside>;
}

export function SweepPanel({scenario}: {scenario: Scenario}) {
  const [parameter, setParameter] = useState('soil_rho_k_m_w');
  const [result, setResult] = useState<Sweep | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const revision = canonical(scenario) + parameter, latest = useRef(revision);
  latest.current = revision;
  useEffect(() => { setResult(null); setError(''); }, [revision]);
  const config: Record<string, {label: string; unit: string; values: number[]}> = {
    soil_rho_k_m_w: {label: '土壤热阻率', unit: 'K·m/W', values: [0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3]},
    ambient_temperature_c: {label: '环境温度', unit: '°C', values: [10, 15, 20, 25, 30, 35, 40, 45]},
    depth_m: {label: '平均中心埋深', unit: 'm', values: [0.4, 0.6, 0.8, 1, 1.2, 1.5, 2]},
    spacing_m: {label: '中心间距', unit: 'm', values: [0.06, 0.08, 0.12, 0.16, 0.2, 0.3, 0.5]},
  };
  async function run() {
    const started = revision; setBusy(true); setError('');
    try { const data = await api<Sweep>('/api/sweep', {scenario, parameter, values: config[parameter].values}); if (latest.current === started) setResult(data); }
    catch (e) { if (latest.current === started) setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="card sweep-card"><div className="card-title"><div><span className="eyebrow">PARAMETRIC STUDY</span><h3>敏感性分析</h3></div><span className="tag">独立工况扫描</span></div>
    <div className="sweep-controls"><select aria-label="扫描参数" value={parameter} disabled={busy} onChange={e => setParameter(e.target.value)}>{Object.entries(config).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select><button className="button small" onClick={run} disabled={busy}>{busy ? '计算中…' : '运行扫描'}<Icon name="arrow" size={14}/></button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {result ? <><LineChart label="敏感性分析曲线" xLabel={`${config[parameter].label} / ${config[parameter].unit}`} yLabel="允许载流量 / A" data={result.points.filter(p => p.ampacity_a !== null).map(p => ({x: p.value, y: p.ampacity_a!}))}/>{result.points.some(p => p.error) && <details className="sweep-errors"><summary>部分点超出模型边界，未连入曲线</summary>{result.points.filter(p => p.error).map(p => <p key={p.value}>{p.value}：{p.error}</p>)}</details>}</> : <div className="sweep-empty"><Icon name="chart" size={30}/><strong>找到更合适的敷设条件</strong><p>改变一个参数，比较其对载流量的影响。</p></div>}
  </section>;
}

export function Modal({title, onClose, children}: {title: string; onClose: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={onClose}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭窗口" onClick={onClose}><Icon name="close"/></button></div>{children}</dialog>;
}
