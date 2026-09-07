import { useEffect, useRef, useState } from 'react';
import { Icon, Modal, Parameters, SweepPanel } from './Controls';
import { CableScene, CrossSection, HeatField, InstallationView, LineChart } from './Visuals';
import { api, canonical, download, errorText, fmt, layers } from './utils';
import type { Preset, Project, ProjectMeta, Result, Scenario } from './types';

type Page = 'workbench' | 'details' | 'compare' | 'method';
type View = '3d' | 'section' | 'installation' | 'heat';
const PAGES: {id: Page; title: string; icon: string}[] = [
  {id: 'workbench', title: '建模工作台', icon: 'cube'}, {id: 'details', title: '计算明细', icon: 'list'},
  {id: 'compare', title: '方案对比', icon: 'chart'}, {id: 'method', title: '方法与边界', icon: 'book'},
];

export default function App() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]), [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null), [saved, setSaved] = useState('');
  const [result, setResult] = useState<Result | null>(null), [snapshots, setSnapshots] = useState<Result[]>([]);
  const [page, setPage] = useState<Page>('workbench'), [view, setView] = useState<View>('3d');
  const [exploded, setExploded] = useState(false), [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [showProjects, setShowProjects] = useState(false), [engineVersion, setEngineVersion] = useState('');
  const running = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  const signature = scenario ? canonical(scenario) : '';
  const dirty = scenario !== null && signature !== saved;
  const fresh = !!result && signature === canonical(result.input);
  const current = fresh ? result : null;

  async function task(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(errorText(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function initialize() {
    await task(async () => {
      const [health, catalogue, list] = await Promise.all([
        api<{model_version: string}>('/api/health'), api<Preset[]>('/api/presets'), api<ProjectMeta[]>('/api/projects'),
      ]);
      const template = catalogue.find(p => p.id === 'copper-240') ?? catalogue[0];
      if (!template) throw new Error('电缆模板库为空。');
      const calculation = await api<Result>('/api/calculate', template.scenario);
      setEngineVersion(health.model_version); setPresets(catalogue); setProjects(list);
      setScenario(calculation.input); setSaved(canonical(calculation.input)); setResult(calculation);
    });
  }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  function mayReplace() { return !dirty || window.confirm('当前参数尚未保存。确定放弃这些修改吗？'); }
  async function calculate() {
    if (!scenario) return;
    await task(async () => {
      const calculation = await api<Result>('/api/calculate', scenario);
      setScenario(calculation.input); setResult(calculation); setNotice('计算完成，结果已与当前输入绑定。');
    });
  }
  async function saveProject() {
    if (!scenario) return;
    await task(async () => {
      const p = await api<Project>(projectId ? `/api/projects/${projectId}` : '/api/projects', scenario, projectId ? 'PUT' : 'POST');
      setProjectId(p.id); setScenario(p.scenario); setSaved(canonical(p.scenario));
      setProjects(await api<ProjectMeta[]>('/api/projects')); setNotice('工程已保存。');
    });
  }
  async function newProject() {
    if (!mayReplace()) return;
    const template = presets.find(p => p.id === 'copper-240') ?? presets[0];
    if (!template) return;
    const s = structuredClone(template.scenario); s.name = '新建中压电缆工程';
    setScenario(s); setProjectId(null); setSaved(canonical(s)); setResult(null); setPage('workbench');
    setError(''); setNotice('已新建工程，请编辑参数并计算。');
  }
  async function openProjects() {
    await task(async () => { setProjects(await api<ProjectMeta[]>('/api/projects')); setShowProjects(true); });
  }
  async function loadProject(id: string) {
    if (!mayReplace()) return;
    await task(async () => {
      const p = await api<Project>(`/api/projects/${id}`);
      setScenario(p.scenario); setProjectId(p.id); setSaved(canonical(p.scenario)); setResult(null);
      setShowProjects(false); setPage('workbench'); setNotice('工程已打开，请执行计算。');
    });
  }
  async function deleteProject(p: ProjectMeta) {
    if (!window.confirm(`删除「${p.name}」？此操作不可撤销。`)) return;
    await task(async () => {
      await api(`/api/projects/${p.id}`, undefined, 'DELETE');
      setProjects(await api<ProjectMeta[]>('/api/projects'));
      if (projectId === p.id) { setProjectId(null); setSaved(''); }
      setNotice('工程已删除。');
    });
  }
  async function importProject(file: File) {
    if (!mayReplace()) return;
    await task(async () => {
      if (file.size > 1024 * 1024) throw new Error('工程文件不能超过 1 MB。');
      let payload: unknown;
      try { payload = JSON.parse(await file.text()); } catch { throw new Error('工程文件不是有效的 JSON。'); }
      const s = await api<Scenario>('/api/validate', payload);
      setScenario(s); setProjectId(null); setSaved(''); setResult(null); setPage('workbench');
      setNotice('工程已导入并通过参数校验，请计算后保存。');
    });
  }
  async function exportProject() {
    if (!scenario) return;
    await task(async () => {
      const s = await api<Scenario>('/api/validate', scenario);
      download('CableSimPro-project.json', JSON.stringify(s, null, 2), 'application/json'); setNotice('工程参数已导出。');
    });
  }
  async function exportReport() {
    if (!current) return;
    await task(async () => {
      const html = await api<string>('/api/report', current.input);
      download('CableSimPro-calculation.html', html, 'text/html;charset=utf-8');
      setNotice('计算书已导出。用浏览器打开后可打印或另存为 PDF。');
    });
  }
  function exportCsv() {
    if (!current?.operating) return;
    const state = current.operating;
    const rows = [['phase', 'current_A', 'conductor_temperature_C', 'surface_temperature_C', 'Rac_ohm_km', 'conductor_loss_W_m', 'screen_loss_W_m', 'dielectric_loss_W_m', 'total_loss_W_m', 'model_version', 'input_sha256'],
      ...['A', 'B', 'C'].map((p, i) => [p, state.current_a, state.temperatures_c[i], state.surface_temperatures_c[i], state.resistances_ohm_km[i], state.conductor_losses_w_m[i], state.screen_losses_w_m[i], state.dielectric_loss_w_m, state.total_losses_w_m[i], current.model_version, current.input_sha256])];
    download('CableSimPro-operating-results.csv', '\ufeff' + rows.map(r => r.join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function addSnapshot() {
    if (!current) return;
    if (snapshots.some(s => s.input_sha256 === current.input_sha256)) { setNotice('当前输入已有对比快照。'); return; }
    if (snapshots.length >= 4) { setError('最多保留 4 个对比快照，请先在方案对比页移除一个。'); return; }
    setSnapshots([...snapshots, current]); setNotice('已加入方案对比。');
  }

  if (!scenario) return <main className="launch"><div className="brand-mark"><Icon name="cube" size={34}/></div><h1>CableSimPro</h1><p>中压电缆工程工作台</p>{busy ? <p role="status"><span className="spinner"/> 正在连接计算引擎…</p> : <><p className="inline-error" role="alert">{error}</p><button className="button primary" onClick={initialize}>重新连接</button><p className="subtle">请先运行 python scripts/run_demo.py</p></>}</main>;
  const summary = current?.summary;
  const geometry = layers(scenario.cable);

  return <div className="app">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Icon name="cube" size={24}/></div><div><strong>CableSim<span>Pro</span></strong><small>电缆工程计算平台</small></div><b className="version">DEMO 0.1</b></div>
      <div className="top-actions"><button className="button small" disabled={busy} onClick={newProject}><Icon name="plus" size={16}/>新建</button><button className="button small" disabled={busy} onClick={openProjects}><Icon name="folder" size={16}/>工程库 <span className="count">{projects.length}</span></button><button className="button small" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="up" size={16}/>导入工程</button><button className="button small" disabled={busy} onClick={exportProject}><Icon name="down" size={16}/>导出工程</button><button className="button small dark" disabled={busy} onClick={saveProject}><Icon name="save" size={16}/>保存工程</button></div>
      <input ref={fileInput} className="hidden" aria-label="导入工程文件" type="file" accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void importProject(file); }}/>
    </header>
    <div className="shell"><nav className="rail" aria-label="主导航">{PAGES.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-label={item.title} title={item.title} onClick={() => setPage(item.id)}><Icon name={item.icon} size={21}/><span>{item.title}</span>{item.id === 'compare' && snapshots.length > 0 && <b>{snapshots.length}</b>}</button>)}<div className="rail-bottom">MV<br/>1φ × 3</div></nav>
      <Parameters scenario={scenario} presets={presets} onChange={setScenario} busy={busy}/>
      <main className="workspace">
        <div className="workspace-heading"><div><div className="breadcrumb">工程空间 <span>/</span> 中压电缆 <span>/</span> {PAGES.find(p => p.id === page)?.title}</div><input className="project-title" aria-label="工程名称" value={scenario.name} maxLength={100} disabled={busy} onChange={e => setScenario({...scenario, name: e.target.value})}/><p className="project-meta"><span className={dirty ? 'save-state unsaved' : 'save-state'}>{dirty ? '有未保存修改' : projectId ? '工程已保存' : '演示工程'}</span><span>单回路 / 单芯 XLPE / 直埋</span></p></div><div className="calculate-actions"><span data-testid="result-status" className={fresh ? 'result-state ready' : 'result-state'}>{fresh ? '已计算 · 输入一致' : '参数已变更，请重新计算'}</span><button className="button primary calculate" disabled={busy} onClick={calculate}>{busy ? <span className="spinner"/> : <Icon name="play" size={17}/>}执行计算</button></div></div>
        {error && <div role="alert" className="message error"><Icon name="info"/><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><Icon name="close" size={15}/></button></div>}
        {notice && <div role="status" className="message success"><Icon name="check"/><span>{notice}</span></div>}
        <div className="demo-notice"><Icon name="info" size={15}/><span>工程辅助 Demo · 尚未经标准算例认证。交流附加和屏蔽损耗系数为显式输入，不代表完整 IEC 60287 实现。</span><button onClick={() => setPage('method')}>查看适用边界 <Icon name="arrow" size={14}/></button></div>

        {page === 'workbench' && <>
          <div className="metrics">
            <Metric label="允许载流量" value={summary?.ampacity_a} unit="A" sub={current ? `限制相 ${summary?.limiting_phase} · ${fmt(current.input.cable.max_temperature_c, 0)} °C 上限` : '等待重新计算'} accent testId="ampacity"/>
            <Metric label="运行最高温度" value={summary?.operating_max_temperature_c} unit="°C" sub={summary ? `运行电流 ${fmt(summary.operating_current_a, 0)} A` : '稳态温升求解'} danger={summary?.thermal_margin_c != null && summary.thermal_margin_c < 0} testId="temperature"/>
            <Metric label="温度裕量" value={summary?.thermal_margin_c} unit="°C" sub={summary?.thermal_margin_c != null && summary.thermal_margin_c < 0 ? '超出温度限制' : '温度上限 − 运行最高温度'} danger={summary?.thermal_margin_c != null && summary.thermal_margin_c < 0}/>
            <Metric label="三相线路总损耗" value={summary?.circuit_loss_kw} unit="kW" sub={`${fmt(scenario.circuit_length_m, 0)} m · 包含导体、屏蔽与介质`}/>
          </div>
          {current?.operating_error && <div className="message error" role="alert"><Icon name="info"/><span>运行工况无稳定解：{current.operating_error} 允许载流量仍有效；运行温度与运行损耗不予输出。</span></div>}
          <section className="model-card"><div className="model-toolbar"><div className="visual-tabs">{([['3d', '三维结构'], ['section', '二维截面'], ['installation', '敷设截面'], ['heat', '土壤温度']] as const).map(([key, title]) => <button className={view === key ? 'active' : ''} key={key} onClick={() => setView(key)}>{title}</button>)}</div><div className="model-tools">{view === '3d' && <><button className={exploded ? 'active' : ''} onClick={() => setExploded(!exploded)} aria-pressed={exploded}><Icon name="expand" size={15}/>分层展开</button><button aria-label="重置视角" title="重置视角" onClick={() => setResetKey(k => k + 1)}><Icon name="reset" size={16}/></button></>}</div></div>
            <div className="viewport-caption"><div><span className="eyebrow">{view === 'heat' ? 'ANALYTICAL THERMAL FIELD' : 'PARAMETRIC CABLE MODEL'}</span><h3>{scenario.cable.conductor === 'copper' ? 'Cu' : 'Al'} / XLPE <span>{fmt(scenario.cable.area_mm2, 0)} mm²</span></h3></div><div className="diameter"><small>电缆外径</small><strong>Ø {fmt(geometry[5].radius_mm * 2, 2)} <span>mm</span></strong></div></div>
            {view === '3d' && <CableScene cable={scenario.cable} exploded={exploded} resetKey={resetKey}/>}
            {view === 'section' && <CrossSection cable={scenario.cable}/>}
            {view === 'installation' && <InstallationView scenario={scenario}/>}
            {view === 'heat' && (current ? <HeatField result={current}/> : <div className="viewport-empty"><Icon name="chart" size={32}/><p>请计算当前工况后查看土壤温度分布。</p></div>)}
            <div className="model-footer"><div className="layer-legend">{geometry.map(layer => <span key={layer.name}><i style={{background: layer.color}}/>{layer.name.replace('（等效层）', '')}</span>)}</div><p>{view === '3d' ? '拖动旋转 · 滚轮缩放 · 径向尺寸联动，轴向长度与绞线为结构示意' : view === 'heat' ? '等距坐标 · 线热源叠加 · 电缆内部不显示 · 非有限元仿真' : '几何预览按当前参数更新，计算结果需重新求解'}</p></div>
          </section>
          <div className="analysis-row"><section className="card"><div className="card-title"><div><span className="eyebrow">CURRENT–TEMPERATURE</span><h3>电流与温度</h3></div><span className="tag">最热相包络</span></div>{current ? <LineChart label="电流温度曲线" data={current.curve.map(p => ({x: p.current_a, y: p.temperature_c}))} xLabel="电流 / A" yLabel="导体温度 / °C" threshold={current.input.cable.max_temperature_c}/> : <Empty text="请重新计算以获取当前温升曲线。"/>}</section>
            <section className="card"><div className="card-title"><div><span className="eyebrow">OPERATING CONDITION</span><h3>三相运行状态</h3></div><span className="tag">{summary ? `负载率 ${fmt(summary.utilization_percent)}%` : '等待计算'}</span></div>{current?.operating ? <div className="phase-rows">{current.operating.temperatures_c.map((t, i) => <div className="phase-row" key={i}><span className="phase-label">{'ABC'[i]}</span><div><div className="phase-values"><span>导体温度</span><strong>{fmt(t)} °C</strong></div><div className="bar"><i className={t > current.input.cable.max_temperature_c ? 'hot' : ''} style={{width: `${Math.max(0, Math.min(100, (t - current.input.installation.ambient_temperature_c) / (current.input.cable.max_temperature_c - current.input.installation.ambient_temperature_c) * 100))}%`}}/></div></div></div>)}<p className="subtle">按三相互热分别求解，非简单复制单根结果。</p></div> : <Empty text={current?.operating_error ?? '请计算以查看运行状态。'}/>}</section></div>
          <SweepPanel scenario={scenario}/>
          <div className="result-actions"><button className="button" disabled={!current || busy} onClick={addSnapshot}><Icon name="plus"/>加入方案对比</button><button className="button" disabled={!current?.operating || busy} onClick={exportCsv}><Icon name="down"/>导出运行 CSV</button><button className="button dark" disabled={!current || busy} onClick={exportReport}><Icon name="book"/>导出计算书</button></div>
        </>}
        {page === 'details' && (current ? <Details result={current} exportReport={exportReport} disabled={busy}/> : <section className="card"><Empty text="参数已变更，请执行计算后查看明细。"/></section>)}
        {page === 'compare' && <section className="card comparison"><div className="card-title"><div><span className="eyebrow">SCENARIO COMPARISON</span><h3>方案对比</h3></div><button className="button small" disabled={!current || snapshots.length >= 4} onClick={addSnapshot}><Icon name="plus" size={15}/>加入当前结果</button></div><p className="subtle">最多 4 个不可变计算快照，仅保留于当前会话。工程参数请单独保存或导出。</p>{snapshots.length ? <div className="table-scroll"><table><thead><tr><th>指标</th>{snapshots.map((r, i) => <th key={r.input_sha256}><span className="snapshot-name">{r.input.name}</span><small>快照 {i + 1} · {new Date(r.computed_at).toLocaleTimeString('zh-CN')}</small><button className="text-button danger" aria-label={`移除快照 ${i + 1}`} onClick={() => setSnapshots(snapshots.filter(s => s.input_sha256 !== r.input_sha256))}>移除</button></th>)}</tr></thead><tbody>{[
          ['截面积 / mm²', (r: Result) => fmt(r.input.cable.area_mm2, 0)], ['排列方式', (r: Result) => r.input.installation.arrangement === 'flat' ? '水平' : '三角'],
          ['土壤热阻率 / K·m/W', (r: Result) => fmt(r.input.installation.soil_rho_k_m_w, 2)], ['埋深 / m', (r: Result) => fmt(r.input.installation.depth_m, 2)],
          ['允许载流量 / A', (r: Result) => fmt(r.summary.ampacity_a)], ['运行电流 / A', (r: Result) => fmt(r.summary.operating_current_a)],
          ['最高温度 / °C', (r: Result) => fmt(r.summary.operating_max_temperature_c)], ['温度裕量 / °C', (r: Result) => fmt(r.summary.thermal_margin_c)],
          ['线路损耗 / kW', (r: Result) => fmt(r.summary.circuit_loss_kw)], ['输入指纹', (r: Result) => r.input_sha256.slice(0, 12)],
        ].map(([label, value]) => <tr key={label as string}><td>{label as string}</td>{snapshots.map(r => <td key={r.input_sha256}>{(value as (r: Result) => string)(r)}</td>)}</tr>)}</tbody></table></div> : <Empty text="先计算一个工况，然后点击“加入方案对比”。"/>}</section>}
        {page === 'method' && <Method result={result}/>}
        <footer className="workspace-footer"><span><span className="dot"/>{engineVersion} · 单位制：mm / m / A / °C</span><span>参数化建模 · 可追溯计算 · 工程辅助 Demo</span></footer>
      </main>
    </div>
    {showProjects && <Modal title="工程库" onClose={() => setShowProjects(false)}><p className="subtle">工程参数保存在当前服务的 SQLite 数据库中。计算结果需打开后重新求解。</p>{projects.length ? <div className="project-list">{projects.map(p => <div className="project-item" key={p.id}><Icon name="folder" size={24}/><div><strong>{p.name}</strong><small>更新于 {new Date(p.updated_at).toLocaleString('zh-CN')}</small></div><button className="button small" disabled={busy} onClick={() => loadProject(p.id)}>打开</button><button className="icon-button danger" aria-label={`删除工程 ${p.name}`} disabled={busy} onClick={() => deleteProject(p)}><Icon name="trash"/></button></div>)}</div> : <Empty text="还没有保存的工程。编辑工况后点击“保存工程”。"/>}</Modal>}
  </div>;
}

function Metric({label, value, unit, sub, accent, danger, testId}: {label: string; value?: number | null; unit: string; sub: string; accent?: boolean; danger?: boolean; testId?: string}) {
  return <section className={`metric ${accent ? 'accent' : ''} ${danger ? 'danger' : ''}`}><span>{label}</span><div><strong data-testid={testId}>{fmt(value)}</strong><b>{unit}</b></div><small>{sub}</small>{accent && <Icon name="bolt" size={35}/>}</section>;
}
function Empty({text}: {text: string}) { return <div className="empty"><Icon name="chart" size={28}/><p>{text}</p></div>; }

function Details({result: r, exportReport, disabled}: {result: Result; exportReport: () => void; disabled: boolean}) {
  const [mode, setMode] = useState<'operating' | 'rating'>('operating');
  const state = mode === 'operating' ? r.operating : r.rating;
  return <div className="details-stack"><section className="card"><div className="card-title"><div><span className="eyebrow">CALCULATION LEDGER</span><h3>损耗与温度明细</h3></div><div className="segmented"><button className={mode === 'operating' ? 'active' : ''} onClick={() => setMode('operating')}>运行工况</button><button className={mode === 'rating' ? 'active' : ''} onClick={() => setMode('rating')}>极限载流</button></div></div>{state ? <><p className="subtle">计算电流 {fmt(state.current_a)} A · 平衡残差 {state.residual_k.toExponential(2)} K · 线路总损耗 {fmt(state.circuit_loss_kw, 3)} kW</p><div className="table-scroll"><table><thead><tr><th>计算项</th><th>A 相</th><th>B 相</th><th>C 相</th><th>单位</th></tr></thead><tbody>{[
    ['导体温度', state.temperatures_c, '°C', 3], ['外表面温度', state.surface_temperatures_c, '°C', 3],
    ['导体交流电阻', state.resistances_ohm_km, 'Ω/km', 6], ['导体损耗', state.conductor_losses_w_m, 'W/m', 4],
    ['屏蔽损耗', state.screen_losses_w_m, 'W/m', 4], ['介质损耗', [state.dielectric_loss_w_m, state.dielectric_loss_w_m, state.dielectric_loss_w_m], 'W/m', 5],
    ['总损耗', state.total_losses_w_m, 'W/m', 4],
  ].map(([label, values, unit, digits]) => <tr key={label as string}><td>{label as string}</td>{(values as number[]).map((v, i) => <td key={i}>{fmt(v, digits as number)}</td>)}<td>{unit as string}</td></tr>)}</tbody></table></div><div className="radial-grid">{state.radial_profiles.map(profile => <div key={profile.phase}><h4>{profile.phase} 相径向节点</h4>{profile.points.map(p => <div className="key-value" key={p.layer}><span>{p.layer}</span><b>{fmt(p.temperature_c, 2)} °C</b></div>)}</div>)}</div></> : <div className="message error" role="alert">运行工况无稳定解：{r.operating_error} 请切换“极限载流”查看额定状态。</div>}</section>
    <div className="analysis-row"><section className="card"><div className="card-title"><div><span className="eyebrow">RADIAL RESISTANCES</span><h3>分层热阻</h3></div><span className="tag">K·m/W</span></div>{r.thermal.layer_resistances_k_m_w.map((v, i) => <div className="key-value" key={i}><span>{r.geometry.layers[i + 1].name}</span><b>{fmt(v, 6)}</b></div>)}<div className="key-value"><span>R₂₀ / Ω·km⁻¹</span><b>{fmt(r.thermal.r20_ohm_km, 6)}</b></div><div className="key-value"><span>电容 / nF·km⁻¹</span><b>{fmt(r.thermal.capacitance_nf_km, 3)}</b></div></section><section className="card"><div className="card-title"><div><span className="eyebrow">MUTUAL HEATING</span><h3>土壤自热 / 互热矩阵</h3></div><span className="tag">K·m/W</span></div><div className="table-scroll"><table><thead><tr><th>受热相 / 热源相</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>{r.thermal.soil_matrix_k_m_w.map((row, i) => <tr key={i}><th>{'ABC'[i]}</th>{row.map((v, j) => <td key={j}>{fmt(v, 5)}</td>)}</tr>)}</tbody></table></div><p className="subtle">对角项为自身对地热阻，非对角项为其他相的热耦合。</p></section></div>
    <section className="card"><div className="card-title"><div><span className="eyebrow">TRACEABILITY</span><h3>计算追溯</h3></div><button className="button small dark" onClick={exportReport} disabled={disabled}>导出计算书</button></div><div className="key-value"><span>模型版本 / UTC 时间</span><b>{r.model_version} / {r.computed_at}</b></div><p className="subtle">输入 SHA-256</p><code className="fingerprint">{r.input_sha256}</code><details className="advanced"><summary>完整输入参数 JSON</summary><pre>{JSON.stringify(r.input, null, 2)}</pre></details><h4>适用限制与警告</h4>{r.warnings.map((w, i) => <p className="warning-line" key={i}><Icon name="info" size={14}/>{w}</p>)}</section>
  </div>;
}

function Method({result}: {result: Result | null}) {
  return <section className="card method"><span className="eyebrow">METHOD & APPLICABILITY</span><h2>知道每个数字从哪里来。</h2><p className="lead">本版采用可审计的稳态热网络，服务于中压电缆参数建模与方案演示；不是经认证的设计定额，也不是完整 IEC 60287 软件。</p>
    <div className="method-grid"><div><h3>支持范围</h3><p>单回路三根相同的单芯无铠装电缆；Cu / Al 导体、同心 XLPE 绝缘与等效金属屏蔽；水平或等边三角排列；均匀土壤直埋、恒温地表和三相平衡持续负荷。</p></div><div><h3>不覆盖的工况</h3><p>排管、空气敷设、回填分区、土壤干燥、多回路、铠装、接头端部、循环或应急负荷，以及按接地方式自动计算屏蔽环流。不得将不支持的工况折算为默认输入后宣称已校核。</p></div></div>
    <h3>从参数到结果</h3><div className="method-steps"><div><b>01</b><h4>构造径向几何</h4><p>截面积与填充系数确定导体包络尺寸，再叠加各层厚度。同一输入用于几何预览与计算。</p></div><div><b>02</b><h4>计算损耗与热阻</h4><p>温度修正导体电阻，计算介质损耗。各层采用圆筒热阻，三相通过半空间互热矩阵耦合。</p></div><div><b>03</b><h4>求解与追溯</h4><p>显式处理电阻热反馈。求解给定电流温度，再搜索最热相达到温度上限的电流。</p></div></div>
    <div className="formula"><span>圆筒层热阻</span><code>T = ρth · ln(rout / rin) / (2π)</code><span>温度修正电阻</span><code>Rac(θ) = R20 · [1 + α(θ − 20)] · (1 + kAC)</code><span>热反馈方程</span><code>u = H · qconductor + d;　[I − Iload² R20,AC α H]u = H qambient + d</code></div>
    <h3>必须明示的假设</h3><p>交流附加系数和屏蔽损耗系数是用户输入，并非软件自动按集肤、邻近或接地模型推导。预设材料常数、绝缘尺寸和电压组合为演示假设，不代表某厂家型号，也不构成绝缘配合设计。</p><p>未填写厂家 R₂₀ 时，采用理想均匀导体电阻率除以截面积的估计，未含绞合增量。填写厂家 R₂₀ 后，即使修改截面积，该指定电阻也不会自动改变。</p><p>土壤图是线热源解析叠加的外部温度场，电缆内部已屏蔽；网络表面温度与云图使用的自热近似存在微小差别。三维剖切、绞线和轴向长度仅用于结构展示，不是有限元网格。</p>
    <h3>验证等级</h3><p>自动测试用于发现程序错误、验证解析退化解、单调性、热平衡和接口行为。通过这些测试不等于与 IEC 正式算例、厂家载流量表或现场实测一致。工程采用前必须用授权标准、实测材料数据和独立参考结果复核。</p>
    <h3>范围参考</h3>{result?.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p className="subtle">详细方程、单位、假设和验收说明见仓库 docs/METHOD.md 与 docs/ACCEPTANCE.md。</p>
  </section>;
}
