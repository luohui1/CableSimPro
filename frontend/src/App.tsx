import { useEffect, useRef, useState } from 'react';
import { Icon, Modal, Parameters, SweepPanel } from './Controls';
import { CableScene, CrossSection, HeatField, InstallationView, LineChart } from './Visuals';
import { Details, Method } from './Results';
import { Composer, Conversation, SUGGESTIONS, type AgentStatus, type Execution, type Message, type Proposal } from './Agent';
import { api, canonical, download, errorText, fmt, layers } from './utils';
import type { Preset, Project, ProjectMeta, Result, Scenario, Sweep } from './types';
import './workspace.css';

type Mode = 'model' | 'properties' | 'results' | 'sweep' | 'compare' | 'method';
type View = '3d' | 'section' | 'installation' | 'heat';
interface Log { time: string; name: string; detail: string }
const TREE = [
  {id: 'geometry', label: '导体与层结构', icon: 'cube', mode: 'properties', tab: 'cable'},
  {id: 'materials', label: '材料与电气参数', icon: 'list', mode: 'properties', tab: 'cable'},
  {id: 'installation', label: '直埋敷设', icon: 'list', mode: 'properties', tab: 'installation'},
  {id: 'study', label: '稳态载流量', icon: 'play', mode: 'properties', tab: 'load'},
  {id: 'sweep', label: '参数扫描', icon: 'chart', mode: 'sweep', tab: 'load'},
  {id: 'results', label: '求解结果', icon: 'chart', mode: 'results', tab: 'load'},
  {id: 'compare', label: '方案对比', icon: 'list', mode: 'compare', tab: 'load'},
] as const;

export default function App() {
  const [scenario, setScenario] = useState<Scenario | null>(null), [presets, setPresets] = useState<Preset[]>([]);
  const [status, setStatus] = useState<AgentStatus>({cloud_configured: false, model: null});
  const [mode, setMode] = useState<Mode>('model'), [view, setView] = useState<View>('3d');
  const [landing, setLanding] = useState(true), [node, setNode] = useState('geometry');
  const [propertyTab, setPropertyTab] = useState<'cable' | 'installation' | 'load'>('cable');
  const [result, setResult] = useState<Result | null>(null), [snapshots, setSnapshots] = useState<Result[]>([]);
  const [sweep, setSweep] = useState<{data: Sweep; signature: string} | null>(null);
  const [messages, setMessages] = useState<Message[]>([]), [activeProposal, setActiveProposal] = useState<number | null>(null);
  const [agentMode, setAgentMode] = useState<'local' | 'openai'>('local'), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [projects, setProjects] = useState<ProjectMeta[]>([]), [projectId, setProjectId] = useState<string | null>(null);
  const [saved, setSaved] = useState(''), [revision, setRevision] = useState(1), [logs, setLogs] = useState<Log[]>([]);
  const [showProjects, setShowProjects] = useState(false), [settings, setSettings] = useState(false);
  const [agentVisible, setAgentVisible] = useState(true), [exploded, setExploded] = useState(false), [resetKey, setResetKey] = useState(0);
  const [dock, setDock] = useState<'summary' | 'log'>('summary');
  const [undo, setUndo] = useState<{before: Scenario; result: Result | null; after: string} | null>(null);
  const running = useRef(false), nextId = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const signature = scenario ? canonical(scenario) : '';
  const dirty = !!scenario && saved !== signature;
  const current = result && canonical(result.input) === signature ? result : null;
  const validSweep = sweep && sweep.signature === signature ? sweep.data : null;
  function log(name: string, detail: string) { setLogs(old => [...old.slice(-49), {time: new Date().toLocaleTimeString('zh-CN'), name, detail}]); }
  function add(message: Omit<Message, 'id'>) { const id = ++nextId.current; setMessages(old => [...old, {...message, id}]); return id; }
  async function task(run: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await run(); } catch (e) { setError(errorText(e)); log('操作未完成', errorText(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function initialize() { await task(async () => {
    const [catalogue, agent] = await Promise.all([api<Preset[]>('/api/presets'), api<AgentStatus>('/api/agent/status')]);
    const initial = catalogue.find(p => p.id === 'copper-240')?.scenario;
    if (!initial) throw new Error('未找到默认工程模板。');
    setPresets(catalogue); setScenario(initial); setSaved(canonical(initial)); setStatus(agent);
    log('读取模板', '12/20 kV · Cu 240 mm² · 演示假设；尚未求解。');
  }); }
  useEffect(() => { void initialize(); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!dirty) return; const protect = (e: BeforeUnloadEvent) => {e.preventDefault(); e.returnValue = '';}; window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [dirty]);
  function edit(s: Scenario) { setScenario(s); setRevision(r => r + 1); }
  function mayReplace() { return !dirty || window.confirm('放弃当前尚未保存的修改？'); }
  function resetSession() { setMessages([]); setActiveProposal(null); setUndo(null); setSweep(null); setLogs([]); setRevision(1); setError(''); }
  async function send(message: string) {
    if (!scenario || running.current) return;
    setLanding(false); setAgentVisible(true);
    const base = signature; setActiveProposal(null); add({role: 'user', text: message});
    await task(async () => {
      const p = await api<Proposal>('/api/agent/plan', {scenario, message, mode: agentMode, consent});
      const id = add({role: 'assistant', text: p.ready ? '方案已生成。检查下面的参数和假设，确认后执行。' : p.questions.join('\n'), proposal: p, base});
      if (p.ready) setActiveProposal(id);
      log(p.ready ? '操作方案待确认' : '需要补充任务', agentMode === 'local' ? '有限命令语法 · 未调用大模型' : 'OpenAI 工具调用 · 尚未执行求解');
    });
  }
  async function execute(message: Message) {
    if (!scenario || !message.proposal?.ticket || message.base !== signature || message.id !== activeProposal) return;
    await task(async () => {
      const out = await api<Execution>('/api/agent/execute', {scenario, ticket: message.proposal!.ticket});
      setUndo({before: scenario, result: current, after: canonical(out.scenario)});
      setScenario(out.scenario); setRevision(r => r + 1); setActiveProposal(null);
      if (out.result) { setResult(out.result); setMode('model'); }
      else if (canonical(out.scenario) !== signature) setResult(null);
      if (out.sweep) { setSweep({data: out.sweep, signature: canonical(out.scenario)}); setMode('sweep'); }
      if (out.action === 'inspect') setMode('method');
      add({role: 'assistant', text: out.statement, execution: out});
      for (const event of out.events) log(event.tool, event.detail);
    });
  }
  async function calculate() { if (!scenario) return; await task(async () => {
    const r = await api<Result>('/api/calculate', scenario); setResult(r); setScenario(r.input); setLanding(false);
    log('solve_steady_state', `${r.model_version} · ${r.input_sha256.slice(0, 12)}`); setNotice('求解完成。');
  }); }
  function undoAgent() { if (!undo || undo.after !== signature) return; setScenario(undo.before); setResult(undo.result); setUndo(null); setActiveProposal(null); setRevision(r => r + 1); setSweep(null); log('撤销 Agent 操作', '恢复确认前的工程参数与结果。'); add({role: 'assistant', text: '已恢复操作前的工程版本。磁盘中的已保存工程未改变。'}); }
  async function saveProject() { if (!scenario) return; await task(async () => {
    const p = await api<Project>(projectId ? `/api/projects/${projectId}` : '/api/projects', scenario, projectId ? 'PUT' : 'POST');
    setProjectId(p.id); setScenario(p.scenario); setSaved(canonical(p.scenario)); setNotice('工程已保存。'); log('保存工程', p.name);
  }); }
  function newProject() { if (!mayReplace()) return; const p = presets.find(p => p.id === 'copper-240'); if (!p) return; resetSession(); setScenario(structuredClone(p.scenario)); setSaved(canonical(p.scenario)); setProjectId(null); setResult(null); setLanding(true); setMode('model'); }
  async function openProjects() { await task(async () => { setProjects(await api<ProjectMeta[]>('/api/projects')); setShowProjects(true); }); }
  async function loadProject(id: string) { if (!mayReplace()) return; await task(async () => {
    const p = await api<Project>(`/api/projects/${id}`); resetSession(); setScenario(p.scenario); setSaved(canonical(p.scenario)); setProjectId(id); setResult(null); setShowProjects(false); setLanding(false); setMode('model'); setNotice('工程已打开，请重新求解。');
  }); }
  async function deleteProject(p: ProjectMeta) { if (!window.confirm(`删除「${p.name}」？`)) return; await task(async () => { await api(`/api/projects/${p.id}`, undefined, 'DELETE'); setProjects(await api<ProjectMeta[]>('/api/projects')); if (projectId === p.id) {setProjectId(null); setSaved('');} }); }
  async function importProject(file: File) { if (!mayReplace()) return; await task(async () => {
    if (file.size > 1024 * 1024) throw new Error('工程文件不能超过 1 MB。');
    let input: unknown; try { input = JSON.parse(await file.text()); } catch { throw new Error('无效 JSON 文件。'); }
    const p = await api<Scenario>('/api/validate', input); resetSession(); setScenario(p); setSaved(''); setProjectId(null); setResult(null); setLanding(false); setMode('model'); setNotice('工程已导入。');
  }); }
  async function exportProject() { if (!scenario) return; await task(async () => { const s = await api<Scenario>('/api/validate', scenario); download('CableSimPro-project.json', JSON.stringify(s, null, 2), 'application/json'); }); }
  async function exportReport() { if (!current) return; await task(async () => { download('CableSimPro-calculation.html', await api<string>('/api/report', current.input), 'text/html;charset=utf-8'); }); }
  function exportCsv() {
    if (!current?.operating) return; const s = current.operating;
    const rows = [['phase','current_A','temperature_C','total_loss_W_m','input_sha256'], ...['A','B','C'].map((p,i) => [p,s.current_a,s.temperatures_c[i],s.total_losses_w_m[i],current.input_sha256])];
    download('CableSimPro-operating.csv', '\ufeff' + rows.map(r => r.join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function snapshot() { if (!current || snapshots.some(r => r.input_sha256 === current.input_sha256)) return; if (snapshots.length === 4) {setError('最多保留四个方案快照。'); return;} setSnapshots([...snapshots, current]); setNotice('已加入方案对比。'); }
  function selectNode(item: typeof TREE[number]) { setLanding(false); setNode(item.id); setMode(item.mode); setPropertyTab(item.tab); }
  if (!scenario) return <div className="boot"><strong>CableSimPro</strong><p>{error || '正在读取工程环境…'}</p>{error && <button className="button" onClick={initialize}>重试连接</button>}</div>;
  const composer = {onSend: send, busy, mode: agentMode, setMode: setAgentMode, status, consent, setConsent};
  return <div className={`studio ${landing ? 'at-home' : ''} ${agentVisible ? '' : 'agent-hidden'}`}>
    <aside className="model-sidebar">
      <a className="wordmark" href="#" onClick={e => {e.preventDefault(); setLanding(true);}}><svg viewBox="0 0 28 28" width="25" height="25" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="14" cy="14" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="14" cy="14" r="2.5" fill="currentColor"/></svg><strong>CableSimPro</strong></a>
      <div className="sidebar-actions"><button disabled={busy} onClick={newProject}><Icon name="plus"/>新任务</button><button disabled={busy} onClick={openProjects}><Icon name="folder"/>工程库</button></div>
      <div className="tree-label">当前工程 <span>r{String(revision).padStart(2,'0')}</span></div>
      <nav className="model-tree" aria-label="模型树"><button className={mode === 'model' && !landing ? 'selected root-node' : 'root-node'} onClick={() => {setLanding(false); setMode('model');}}><Icon name="folder" size={16}/><span>{scenario.name}</span></button>
        <p>模型定义</p>{TREE.slice(0,3).map(item => <button key={item.id} aria-label={item.label} className={node === item.id && mode === item.mode && !landing ? 'selected' : ''} onClick={() => selectNode(item)}><Icon name={item.icon} size={15}/>{item.label}</button>)}
        <p>研究</p>{TREE.slice(3,5).map(item => <button key={item.id} aria-label={item.label} className={node === item.id && mode === item.mode && !landing ? 'selected' : ''} onClick={() => selectNode(item)}><Icon name={item.icon} size={15}/>{item.label}<small>{item.id === 'study' ? '1' : ''}</small></button>)}
        <p>结果</p>{TREE.slice(5).map(item => <button key={item.id} aria-label={item.label} className={mode === item.mode && !landing ? 'selected' : ''} onClick={() => selectNode(item)}><Icon name={item.icon} size={15}/>{item.label}<small>{item.id === 'results' ? current ? '✓' : '—' : snapshots.length || ''}</small></button>)}
      </nav>
      <div className="sidebar-bottom"><button onClick={() => {setLanding(false); setMode('method');}}><Icon name="book" size={16}/>方法与边界</button><button onClick={() => setSettings(true)}><Icon name="info" size={16}/>Agent 设置</button><div><span className="connection-dot"/>本地计算引擎<span>0.2</span></div></div>
    </aside>
    <header className="studio-header"><div className="document-title"><input aria-label="工程名称" value={scenario.name} maxLength={100} disabled={busy} onChange={e => edit({...scenario, name:e.target.value})}/><span>{dirty ? '未保存' : projectId ? '已保存' : '参考模型'}</span></div><div className="header-tools"><button aria-label="导入工程" title="导入工程" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="up" size={17}/></button><button aria-label="导出工程" title="导出工程" disabled={busy} onClick={exportProject}><Icon name="down" size={17}/></button><button className="save-button" aria-label="保存工程" disabled={busy} onClick={saveProject}><Icon name="save" size={16}/><span>保存工程</span></button><button aria-label="切换 Agent 面板" aria-pressed={agentVisible} onClick={() => {setAgentVisible(!agentVisible); setLanding(false);}}><Icon name="list" size={18}/></button></div></header>
    <input ref={fileInput} type="file" className="hidden" aria-label="导入工程文件" accept=".json" onChange={e => {const file=e.target.files?.[0];e.target.value='';if(file)void importProject(file);}}/>
    <main className="studio-main">
      {error && <div className="notification error" role="alert"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><Icon name="close" size={15}/></button></div>}
      {notice && <div className="notification" role="status">{notice}</div>}
      {landing ? <section className="start-page"><div className="start-content"><p className="start-kicker">电缆建模与计算</p><h1>这次要研究什么？</h1><Composer {...composer}/><div className="reference-model"><Icon name="cube" size={18}/><div><strong>U₀ {fmt(scenario.cable.u0_kv, 1)} kV · {scenario.cable.conductor === 'copper' ? 'Cu' : 'Al'} {fmt(scenario.cable.area_mm2, 0)} mm²</strong><span>当前模型 · 三根单芯 XLPE · 均匀土壤直埋</span></div><button aria-label="检查参考参数" onClick={() => selectNode(TREE[0])}><Icon name="arrow"/></button></div><div className="suggestions">{SUGGESTIONS.map((s,i) => <button key={s} disabled={busy} onClick={() => send(s)}><span>{['计算参考方案','研究土壤热阻率的影响','检查模型假设'][i]}</span><Icon name="arrow" size={15}/></button>)}</div><p className="start-boundary">先审查模型，再执行求解。当前版本使用稳态热网络，尚未完成工程认证。</p></div></section> : <>
        <div className="document-tabs"><div>{([['model','模型'],['properties','属性'],['results','计算明细']] as const).map(([m,label]) => <button key={m} className={mode===m ? 'active' : ''} onClick={() => setMode(m)}>{label}</button>)}</div><div><button className="undo-button" disabled={busy || !undo || undo.after!==signature} onClick={undoAgent} title="撤销上次 Agent 操作"><Icon name="reset" size={15}/>撤销</button><button className="button primary solve" disabled={busy} onClick={calculate}><Icon name="play" size={14}/>{busy ? '处理中…' : '执行计算'}</button></div></div>
        <div className="document-content">
          {mode === 'model' && <div className="model-document"><div className="view-toolbar"><div>{([['3d','三维结构'],['section','二维截面'],['installation','敷设截面'],['heat','土壤温度']] as const).map(([v,label]) => <button key={v} className={view===v?'active':''} onClick={() => setView(v)}>{label}</button>)}</div><div>{view==='3d' && <><button aria-pressed={exploded} onClick={() => setExploded(!exploded)}><Icon name="expand" size={14}/>分层展开</button><button aria-label="重置视角" onClick={() => setResetKey(k=>k+1)}><Icon name="reset" size={15}/></button></>}</div></div>
            <section className="model-viewport"><div className="viewport-caption"><strong>{scenario.cable.conductor==='copper'?'Cu':'Al'} / XLPE</strong><span>Ø {fmt(layers(scenario.cable)[5].radius_mm*2,2)} mm</span></div>{view==='3d'?<CableScene cable={scenario.cable} exploded={exploded} resetKey={resetKey}/>:view==='section'?<CrossSection cable={scenario.cable}/>:view==='installation'?<InstallationView scenario={scenario}/>:current?<HeatField result={current}/>:<div className="empty">尚无当前参数的温度结果。请执行计算。</div>}<div className="viewport-note">{view==='heat'?'半空间解析场 · 非有限元':'径向尺寸联动 · 轴向剖切仅为结构示意'}</div></section>
            <div className="material-legend">{layers(scenario.cable).map(l=><span key={l.name}><i style={{background:l.color}}/>{l.name.replace('（等效层）','')}</span>)}</div>
            <section className="results-dock"><div className="dock-tabs"><div><button className={dock==='summary'?'active':''} onClick={()=>setDock('summary')}>研究结果</button><button className={dock==='log'?'active':''} onClick={()=>setDock('log')}>操作记录 <small>{logs.length}</small></button></div><span data-testid="result-status">{current?'已计算 · 输入一致':result?'参数已变更，请重新计算':'尚未求解'}</span></div>{dock==='summary'?<><div className="result-strip"><div><span>允许载流量</span><strong data-testid="ampacity">{fmt(current?.summary.ampacity_a)} <small>A</small></strong></div><div><span>运行最高温度</span><strong data-testid="temperature">{fmt(current?.summary.operating_max_temperature_c)} <small>°C</small></strong></div><div><span>温度裕量</span><strong>{fmt(current?.summary.thermal_margin_c)} <small>°C</small></strong></div><div><span>线路损耗</span><strong>{fmt(current?.summary.circuit_loss_kw)} <small>kW</small></strong></div></div>{current?.operating_error && <p className="inline-error" role="alert">运行工况无稳定解：{current.operating_error}</p>}<div className="dock-actions"><span>{current?`${current.model_version} · ${current.input_sha256.slice(0,12)}`:'研究 1 · 稳态热网络'}</span><div><button disabled={!current||busy} onClick={snapshot}>加入方案对比</button><button disabled={!current?.operating||busy} onClick={exportCsv}>导出运行 CSV</button><button disabled={!current||busy} onClick={exportReport}>导出计算书</button></div></div></>:<div className="operation-log">{logs.map((l,i)=><div key={i}><time>{l.time}</time><strong>{l.name}</strong><span>{l.detail}</span></div>)}</div>}</section>
          </div>}
          {mode === 'properties' && <div className="property-document"><Parameters scenario={scenario} presets={presets} busy={busy} selectedTab={propertyTab} onTabChange={setPropertyTab} onChange={edit}/><div className="property-preview"><h3>{propertyTab==='installation'?'敷设截面':'几何预览'}</h3>{propertyTab==='installation'?<InstallationView scenario={scenario}/>:<CrossSection cable={scenario.cable}/>}<p>参数是唯一数据源。修改后，模型视图即时更新，旧解自动失效。</p><button className="button" onClick={()=>{setMode('model');setView('3d');}}>返回模型视图</button></div></div>}
          {mode === 'results' && <div className="page-content">{current?<><LineChart label="电流温度曲线" data={current.curve.map(p=>({x:p.current_a,y:p.temperature_c}))} xLabel="电流 / A" yLabel="导体温度 / °C" threshold={current.input.cable.max_temperature_c}/><Details result={current} exportReport={exportReport} disabled={busy}/></>:<div className="empty">没有与当前参数一致的结果。请先执行计算。</div>}</div>}
          {mode === 'sweep' && <div className="page-content"><h2>参数研究</h2>{validSweep && <section className="agent-sweep"><h3>Agent 执行结果</h3><LineChart label="Agent 参数扫描" data={validSweep.points.filter(p=>p.ampacity_a!==null).map(p=>({x:p.value,y:p.ampacity_a!}))} xLabel={validSweep.parameter} yLabel="允许载流量 / A"/><div className="table-scroll"><table><thead><tr><th>参数值</th><th>允许载流量 / A</th></tr></thead><tbody>{validSweep.points.map(p=><tr key={p.value}><td>{p.value}</td><td>{fmt(p.ampacity_a)}</td></tr>)}</tbody></table></div></section>}<SweepPanel scenario={scenario}/></div>}
          {mode === 'compare' && <div className="page-content"><h2>方案对比</h2><p className="subtle">当前会话的不可变快照；最多四项。保存工程不包含这些快照。</p><button className="button" disabled={!current||busy} onClick={snapshot}>加入当前结果</button><div className="table-scroll"><table><thead><tr><th>方案</th><th>截面积 / mm²</th><th>载流量 / A</th><th>最高温度 / °C</th><th/></tr></thead><tbody>{snapshots.map((r,i)=><tr key={r.input_sha256}><td>{r.input.name}<small>快照 {i+1} · {r.input_sha256.slice(0,8)}</small></td><td>{r.input.cable.area_mm2}</td><td>{fmt(r.summary.ampacity_a)}</td><td>{fmt(r.summary.operating_max_temperature_c)}</td><td><button className="text-button" aria-label={`移除快照 ${i+1}`} onClick={()=>setSnapshots(snapshots.filter(s=>s!==r))}>移除</button></td></tr>)}</tbody></table></div></div>}
          {mode === 'method' && <div className="page-content"><Method result={result}/></div>}
        </div>
      </>}
    </main>
    {!landing && agentVisible && <aside className="agent-panel"><div className="agent-panel-heading"><strong>Agent</strong><button aria-label="打开 Agent 设置" onClick={()=>setSettings(true)}><span>{agentMode==='local'?'本地命令':'OpenAI'}</span><Icon name="info" size={14}/></button></div><Conversation messages={messages} signature={signature} activeProposal={activeProposal} busy={busy} onExecute={execute}/>{busy && <div className="agent-busy" role="status">正在处理请求…</div>}<div className="agent-bottom"><div className="quick-task"><button disabled={busy} onClick={()=>send('解释当前模型的假设')}>检查假设</button><button disabled={busy} onClick={()=>send('截面积改为 400 mm²，重新计算')}>改为 400 mm²</button></div><Composer {...composer} compact/><small>任务记录仅保留在当前会话。</small></div></aside>}
    <footer className="statusbar"><span>单回路 · 无铠装单芯 · 均匀土壤直埋</span><button onClick={()=>{setLanding(false);setMode('method');}}>热网络近似 · 未经工程认证</button><span>mm / m / A / °C</span></footer>
    {showProjects && <Modal title="工程库" onClose={()=>setShowProjects(false)}><p className="subtle">保存于当前服务。打开工程后需重新求解。</p><div className="project-list">{projects.length?projects.map(p=><div className="project-item" key={p.id}><Icon name="folder"/><div><strong>{p.name}</strong><small>{new Date(p.updated_at).toLocaleString('zh-CN')}</small></div><button className="button" disabled={busy} onClick={()=>loadProject(p.id)}>打开</button><button className="icon-button" aria-label={`删除工程 ${p.name}`} disabled={busy} onClick={()=>deleteProject(p)}><Icon name="trash" size={16}/></button></div>):<p>尚未保存工程。</p>}</div></Modal>}
    {settings && <Modal title="Agent 设置" onClose={()=>setSettings(false)}><h3>本地命令</h3><p>无需密钥，仅解析有限的明确命令，不具备通用自然语言理解。所有计算使用同一个真实求解器。</p><h3>OpenAI 工具调用</h3><p>{status.cloud_configured?`服务端已配置模型 ${status.model}；配置状态不代表连接已验证。`:'服务端尚未配置大模型。'}</p><p>在启动服务的终端设置 OPENAI_API_KEY 与 CABLESIM_AGENT_MODEL，然后重启。密钥只在服务端读取，不会写入浏览器或工程文件。</p><p>选择 OpenAI 模式并勾选同意后，任务与当前工程参数（包括名称、说明）会发送到 OpenAI。模型只能提出结构化方案，不能运行任意代码或直接保存工程。</p><p>当前仍是单用户本地 Demo。不要直接暴露到公网。</p></Modal>}
  </div>;
}
