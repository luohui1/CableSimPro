import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TypeCommandSlot } from './command-slot';
import { CommandBar, type CommandAction } from '@/components/command-bar';
import { commandResultLabel, latestModuleRun, moduleResultStatus, useTypeEvidence } from './evidence';
import { nominalNumber } from './design-summary';
import { message, optionalRecord, text } from '@/api/client';
import { moduleMethods } from './api';
import { AppShell } from '@/components/app-shell';
import { Icon } from '@/components/icon';
import { PropertyPanel, type PropertyGroup } from '@/components/property-panel';
import { StatusMark, type StatusKind } from '@/components/status-mark';
import { Tooltip } from '@/components/ui/tooltip';
import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { fieldSource } from '@/lib/domain-fields';
import { sourceKind } from '@/lib/selection-view';
import { formatNumber } from '@/lib/format';
import type { LayerTarget } from '@/features/drawing/types';
import { targetId } from '@/features/drawing/cable-geometry';
import { deferredView } from '@/components/deferred-view';
const TypeStructure=deferredView(()=>import('./structure').then(m=>({default:m.TypeStructure})));
const TypeNumericField=deferredView(()=>import('./structure').then(m=>({default:m.TypeNumericField})));
const TypeCanvas=deferredView(()=>import('./structure').then(m=>({default:m.TypeCanvas})));
const LayerTable=deferredView(()=>import('./structure').then(m=>({default:m.LayerTable})));
const MaterialComparison = deferredView(() => import('./material-comparison').then(module => ({ default: module.MaterialComparison })));
import { layerRows, nominalArea } from './layers';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import { cleanLabel } from './labels';
import { StructurePropertyInputs, TypeRatingInputs } from './property-inputs';
import { TypeInspectorContext } from './inspector';
const TypeModulePage = deferredView(() => import('./module-page').then(module => ({ default: module.TypeModulePage })));
import { DesignCard } from './design-card';
import { typeComparison, typeSpecification } from './version-api';
import { ResourceBindings } from './resource-bindings';
const AgentPanel = deferredView(() => import('@/features/agent/agent-panel').then(module => ({ default: module.AgentPanel })));
const TypeStudyDialog = deferredView(() => import('./study-dialog').then(module => ({ default: module.TypeStudyDialog })));

import { typeModules } from "./module-definitions";
import { WorkbenchSplitter } from "@/components/workbench-splitter";
export { typeModules } from "./module-definitions";
export function TypeWorkspace() {
  const state = useTypeWorkspace(), { location, navigate, onTheme } = useTypeNavigation();
  const evidence = useTypeEvidence();
  const methods = useQuery({ queryKey: ['type-method-catalog'], queryFn: ({ signal }) => moduleMethods(signal) });
  const specificationState = useQuery({ queryKey: ['type-specification', state.workspace?.id, 'customer'], queryFn: ({ signal }) => typeSpecification(state.workspace!.id, signal, 'customer'), enabled: !!state.workspace && location.module==='specification', staleTime:30000 });
  const comparisonState = useQuery({ queryKey: ['type-comparison', state.workspace?.id], queryFn: ({ signal }) => typeComparison(state.workspace!.id, signal), enabled: !!state.workspace && location.module==='comparison', staleTime:30000 });
  const module = typeModules.find(module => module.id === location.module);
  const activeTab = module?.tabs.some(([id]) => id === location.tab) ? location.tab : module?.tabs[0][0] || location.tab;
  const [cableId, setCableId] = useState(''), [selected, setSelected] = useState<LayerTarget | null>(null), [collapsed, setCollapsed] = useState(false), [info, setInfo] = useState('');
  const [view, setView] = useState<'section' | 'three'>(location.tab === 'three' ? 'three' : 'section'), [dockMax, setDockMax] = useState(location.module !== 'structure' || ['quantities', 'materials'].includes(location.tab));
  const [resultProperty, setResultProperty] = useState<{ title: string; groups: PropertyGroup[]; extra?: ReactNode } | null>(null);
  const [primaryAction, setPrimaryAction] = useState<CommandAction | null>(null);
  // 电气参数、短路容量的方法参数属于“改输入”，放在右侧方法页；数据区只留结果
  const methodModule = location.module === 'electrical' || location.module === 'short-circuit';
  const [inspectorView, setInspectorView] = useState<'input' | 'method' | 'agent'>(methodModule && location.tab === 'parameters' ? 'method' : 'input');
  const [agentOpened, setAgentOpened] = useState(false);
  const [renaming, setRenaming] = useState(false), [newName, setNewName] = useState('');
  const [studyOpen, setStudyOpen] = useState(false);
  useEffect(() => { if (inspectorView === 'agent') setAgentOpened(true); }, [inspectorView]);
  // 地址指向方法参数页签（如结果空状态里的“在方法页填写参数”）时打开右侧方法页
  useEffect(() => { if (methodModule && location.tab === 'parameters') setInspectorView('method'); }, [methodModule, location.tab]);
  const showProperty = useCallback((title: string, groups: PropertyGroup[], extra?: ReactNode) => { setResultProperty({ title, groups, extra }); setCollapsed(false); }, []);
  const clearProperty = useCallback(() => setResultProperty(null), []);
  const document = state.document, cable = document?.cable_types.find(cable => cable.id === cableId) || document?.cable_types[0] || null;
  const planName = text(optionalRecord(state.workspace?.raw.type_lifecycle).name);
  const { rows, structureError } = useMemo(() => {
    try { return { rows: document && cable ? layerRows(document, cable) : [] as ReturnType<typeof layerRows>, structureError: '' }; }
    catch (error) { return { rows: [] as ReturnType<typeof layerRows>, structureError: message(error) }; }
  }, [document, cable]);
  const row = selected ? rows.find(row => row.id === targetId(selected)) : undefined;
  const source = row && document ? fieldSource(document, row.path) : {};
  const demo = Object.values(document?.provenance || {}).some(source => source.kind === 'demo');
  const status: StatusKind = state.loading ? 'running' : state.error ? 'error' : state.readOnly ? state.workspace?.raw.historical ? 'historical' : 'locked' : state.dirty ? 'draft' : 'saved';
  const statusLabel = state.loading ? '读取中' : state.error ? state.workspace ? '保存失败' : '读取失败' : state.readOnly ? state.workspace?.raw.fixed_run ? '保存运行 · ' + (state.workspace.raw.historical ? '历史 · ' : '') + '只读' : state.workspace?.raw.historical ? '历史 · 只读' : '已发布 · 只读' : state.dirty ? '未保存' : '已保存';
  function resultStatus(id: string) {
    if (id === 'comparison') {
      if (comparisonState.error) return { kind: 'error' as const, label: '读取失败', reason: message(comparisonState.error) };
      if (!comparisonState.data) return { kind: 'unknown' as const, label: '未接入', reason: '方案对照状态尚未读取。' };
      const metrics = comparisonState.data.items.flatMap(item => Object.values(item.values)).filter(metric => metric.state !== 'missing');
      if (!metrics.length) return { kind: 'unknown' as const, label: '未运行', reason: '各方案尚无可对照的保存结果。' };
      const stale = state.dirty || metrics.some(metric => metric.state !== 'current');
      return { kind: stale ? 'historical' as const : 'current' as const, label: stale ? '过期' : '当前', reason: stale ? '对照引用了过期结果；请重新运行对应方案。' : '对照指标来自各方案的当前保存结果；缺项保持未提供。' };
    }
    if (id === 'specification') {
      const spec = specificationState.data;
      if (specificationState.error) return { kind: 'error' as const, label: '读取失败', reason: message(specificationState.error) };
      if (!spec) return { kind: 'unknown' as const, label: '未接入', reason: '规格书状态尚未读取。' };
      const sources = Array.isArray(spec.payload.sources) ? spec.payload.sources : [];
      if (!sources.length) return { kind: 'unknown' as const, label: '未运行', reason: '尚无由保存结果生成的规格书。' };
      const stale = state.dirty || spec.lifecycle.stale || spec.payload.revision !== state.workspace?.revision || sources.some(source => optionalRecord(source).freshness !== 'current');
      return { kind: stale ? 'historical' as const : 'current' as const, label: stale ? '过期' : '当前', reason: stale ? '规格书引用的输入或结果已变化，需重新生成。' : '规格书对应当前输入及保存结果。' };
    }
    if (evidence.error || methods.error) return { kind: 'error' as const, label: '读取失败', reason: message(evidence.error || methods.error) };
    if (id === 'structure' && !state.inputDirty && !evidence.data?.some(item=>optionalRecord(optionalRecord(item.study.definition).method).plugin_id==='cablesim.cable-geometry' && ['succeeded','partial'].includes(text(item.run.status))) && rows.some(row => row.outerM !== null)) return {kind:'current' as const,label:'当前',reason:'参数截面对应当前输入；外径与用料尚未运行。'};
    return moduleResultStatus(evidence.data, id, state.workspace?.revision, state.inputDirty || !!state.methodDrafts[id] || id === 'rating-table' && !!state.ratingDraft, methods.data);
  }
  function resultMark(id: string) { const value = resultStatus(id); return <Tooltip content={value.reason}><span className="type-module-status" title={value.reason} aria-label={value.label}>{value.kind === 'unknown' ? <span className="type-module-idle" aria-hidden="true" /> : <StatusMark kind={value.kind} label={value.label} />}</span></Tooltip>; }
  const choose = useCallback((target: LayerTarget | null) => { setSelected(target); if (target) setCollapsed(false); }, []);
  const go = (module: string, tab: string) => navigate(typePath(location.wid!, module, tab, location.theme) + (location.revision ? '&revision=' + location.revision : '') + (location.run && module === location.module ? '&run=' + encodeURIComponent(location.run) : ''));
  function shortcut(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void state.save(); return; }
    if ((event.ctrlKey || event.metaKey) && !(event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); void (event.shiftKey ? state.redo() : state.undo()); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); void state.redo(); }
    }
    if (event.key === 'Escape' && !(event.target as HTMLElement).closest('input,textarea,[role=dialog],[role=combobox]')) { choose(null); setInfo(''); }
  }
  useEffect(() => {
    // A closed portal can return focus to body, outside the React workbench tree.
    // Keep document undo/save usable there; input editors retain their native undo.
    const fallback=(event:globalThis.KeyboardEvent)=>{
      const target=event.target instanceof HTMLElement?event.target:null;
      if(event.defaultPrevented||!(event.ctrlKey||event.metaKey)||target?.closest('.type-root,input,textarea,[contenteditable=true]')||window.document.querySelector('[role=dialog][data-state=open]'))return;
      if(event.key.toLowerCase()==='z'){event.preventDefault();void(event.shiftKey?state.redo():state.undo());}
      if(event.key.toLowerCase()==='y'){event.preventDefault();void state.redo();}
      if(event.key.toLowerCase()==='s'){event.preventDefault();void state.save();}
    };
    window.addEventListener('keydown',fallback);
    return()=>window.removeEventListener('keydown',fallback);
  },[state]);
  useEffect(() => { setInfo(''); setResultProperty(null); setCollapsed(false); }, [location.module, location.tab, selected]);
  // 文档型模块（规格书、要求清单、方案对比）默认放大下方面板
  useEffect(() => { setDockMax(location.module !== 'structure' || ['quantities', 'materials'].includes(location.tab)); }, [location.module, location.tab]);
  useEffect(() => { if (location.module === 'structure' && location.layer) { const row = rows.find(row => row.id === location.layer); if (row) { setSelected(row.target); setCollapsed(false); } } }, [location.module, location.layer, cable?.id]);
  useEffect(() => {
    if (location.module !== 'structure' || !location.field) return;
    const frame = requestAnimationFrame(() => {
      const node = [...window.document.querySelectorAll<HTMLElement>('.type-property-fields [data-field-path]')].find(node => node.dataset.fieldPath === location.field);
      if (!node) return;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      node.querySelector<HTMLElement>('input,[role=combobox]')?.focus(); node.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.module, location.field, row?.id]);
  useEffect(()=>{
    if(!methodModule||!location.field)return;
    const focus=()=>{
      const node=[...window.document.querySelectorAll<HTMLElement>('.type-method-fields [data-field-path]')].find(node=>node.dataset.fieldPath===location.field);
      if(!node)return false;
      for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
      node.querySelector<HTMLElement>('input,[role=combobox]')?.focus();node.scrollIntoView({block:'nearest'});
      return true;
    };
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});
    observer.observe(window.document.body,{childList:true,subtree:true});
    const frame=requestAnimationFrame(()=>{if(focus())observer.disconnect();});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[methodModule,location.field,location.tab,methods.data]);
  const property = location.module === 'structure' && activeTab !== 'quantities' && document && row ? <div className="type-property-wrapper">
    <PropertyPanel title={row.label} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} groups={[{ label: '结构输入', items: [
      { label: '材料', value: cleanLabel(row.material.label), source: sourceKind(fieldSource(document, row.materialPath)), sourceDetail: text(fieldSource(document, row.materialPath).reference) || undefined },
      ...(row.target.role === 'conductor' ? [{ label: '标称截面', value: nominalNumber(nominalArea(document, row) === null ? null : nominalArea(document, row)! * 1e6), unit: 'mm²', source: sourceKind(fieldSource(document, row.path.replace(/diameter$/, 'nominal_area'))) }] : []),
      { label: '绘图外径', value: formatNumber(row.outerM === null ? null : row.outerM * 2000, 2), unit: 'mm', source: row.outerM === null ? undefined : 'derived', sourceDetail: '参数截面尺寸，原始实体结果见外径与用料页签' },
    ] }]} />
    {!collapsed && <div className="type-property-fields"><TypeNumericField row={row} />
      <div title={cleanLabel(row.material.label)}><Select label="材料引用" value={row.material.id} disabled={state.busy || state.locked(row.materialPath)} options={document.materials.filter(item => item.category === row.material.category).map(item => ({ value: item.id, label: cleanLabel(item.label) }))} onChange={material => state.edit(row.materialPath, material)} /></div>
      <ResourceBindings materialId={row.material.id} />
      {!sourceKind(source) && source.kind !== 'demo' && <span className="type-field-source" title="此尺寸未提供来源；编辑后请补充工程依据。">来源未提供</span>}<StructurePropertyInputs row={row} /></div>}
  </div> : location.module === 'structure' && activeTab !== 'quantities' ? document && state.workspace ? <DesignCard document={document} raw={state.workspace.raw} extra={state.workspace.raw.type_creation ? <TypeRatingInputs /> : undefined} /> : null
    : resultProperty ? <PropertyPanel title={resultProperty.title} groups={resultProperty.groups} extra={resultProperty.extra} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />
      : document && state.workspace ? <DesignCard document={document} raw={state.workspace.raw} extra={location.module === 'structure' && state.workspace.raw.type_creation ? <TypeRatingInputs /> : undefined} /> : null;
  // 型号工作窗口：画布 = 电缆截面 / 三维剥切；下方停靠栏 = 当前模块的页签；右侧 = 型号名称 + 所选结构层或结果
  const dockTabs = module?.id === 'structure' ? module.tabs.filter(([id]) => id === 'table' || id === 'materials' || id === 'quantities') : module?.tabs || [];
  const dockTab = module?.id === 'structure' ? (location.tab === 'quantities' ? 'quantities' : location.tab === 'materials' ? 'materials' : 'table') : activeTab;
  const groups: [string, string, string[]][] = [['结构', 'module/structure', ['structure']], ['要求', 'module/standard-check', ['requirements', 'standard-check']], ['分析', 'calc/electrical-params', ['electrical', 'short-circuit', 'rating-table', 'comparison']], ['交付', 'module/datasheet', ['specification']]];
  // 型号浏览器：侧栏右侧第二层。结构下列出型号里真实的电缆结构，其余为型号的设计与分析环节
  const explorer = <nav className="project-explorer" aria-label="型号浏览器">
    <header><span className="explorer-kicker"><Icon name="nav/cable-type" />型号设计</span></header>
    {groups.map(([label, icon, ids]) => <section key={label} className="explorer-section" aria-label={label}>
      <h3><Icon name={icon} />{label}</h3>
      <div className="explorer-items">
        {label === '结构' && document ? document.cable_types.map(item => <button key={item.id} type="button" className="explorer-item" aria-current={location.module === 'structure' && cable?.id === item.id ? 'page' : undefined} onClick={() => { setCableId(item.id); choose(null); go('structure', 'table'); }}>
          <Icon name="object/cable" /><span>结构 · {item.cores.length} 芯 · {item.common_layers.length + item.cores.reduce((n, core) => n + core.layers.length + 1, 0)} 层</span>{resultMark('structure')}
        </button>) : ids.map(id => { const item = typeModules.find(entry => entry.id === id)!; return <button key={id} type="button" className="explorer-item" aria-current={location.module === id ? 'page' : undefined} onClick={() => go(id, item.tabs[0][0])}><Icon name={item.icon} /><span>{item.label}</span>{resultMark(id)}</button>; })}
      </div>
    </section>)}
  </nav>;
  // 命令栏与研究工作台一致：模型（保存 / 撤销）、交付（规格书）；分析在各模块里运行
  const specification = typeModules.find(entry => entry.id === 'specification');
  const commandBar = <CommandBar label="型号命令" status={state.dirty ? `${state.changeCount} 处未保存` : location.module === 'specification' ? undefined : commandResultLabel(resultStatus(location.module), latestModuleRun(evidence.data, location.module, methods.data), false)} actions={[
    { id:'save', label:'保存', icon:'action/save', role:'save', loading:state.busy, disabledReason:state.readOnly?'此版本只读':!state.dirty?'没有未保存修改':!state.workspace?'型号尚未读取':undefined, onSelect:()=>void state.save() },
    ...(primaryAction ? [primaryAction] : []),
    { id:'undo', label:'撤销', icon:'action/undo', priority:40, disabledReason:state.readOnly?'此版本只读':state.busy?'正在保存或恢复修改':state.undoReason||(!state.canUndo?'当前模块没有可撤销的修改':undefined), onSelect:()=>void state.undo() },
    { id:'redo', label:'重做', icon:'action/redo', priority:40, disabledReason:state.readOnly?'此版本只读':state.busy?'正在保存或恢复修改':state.redoReason||(!state.canRedo?'当前模块没有可重做的修改':undefined), onSelect:()=>void state.redo() },
    { id:'study', label:'用于载流量研究', icon:'nav/study', priority:30, disabledReason:state.readOnly?'先基于此版本建立设计草稿':state.dirty?'请先保存型号修改':state.busy||!state.workspace?'型号尚未就绪':undefined, onSelect:()=>setStudyOpen(true) },
    ...(specification&&location.module!=='specification'?[{id:'specification',label:'规格书',icon:'result/report',priority:20,disabledReason:state.dirty?'请先保存修改':undefined,onSelect:()=>go('specification',specification.tabs[0][0])}]:[]),
  ]} />;
  const inspector = <div className="type-property-wrapper">
    <div className="inspector-switch" role="tablist" aria-label="属性分页">
      <button type="button" role="tab" aria-selected={inspectorView === 'input' || inspectorView === 'method' && !methodModule} onClick={() => setInspectorView('input')}><Icon name="object/conditions" />输入</button>
      {methodModule && <button type="button" role="tab" aria-selected={inspectorView === 'method'} onClick={() => setInspectorView('method')}><Icon name="nav/plugin" />方法</button>}
      <button type="button" role="tab" aria-selected={inspectorView === 'agent'} onClick={() => setInspectorView('agent')}><Icon name="agent/agent" />Agent</button>
    </div>
    {methodModule && inspectorView === 'method' ? <div className="inspector-method"><Button onClick={() => go(location.module, 'parameters')}>打开方法参数</Button></div> : inspectorView !== 'agent' && <>
    {document && <section className="inspector-block" aria-label="型号">
      {document.cable_types.length > 1 && <Select label="电缆结构" value={cable?.id} disabled={state.busy} options={document.cable_types.map(item => ({ value: item.id, label: cleanLabel(item.label) }))} onChange={value => { setCableId(value); choose(null); }} />}
    </section>}
    {property}</>}
    {agentOpened && state.workspace && <div className="type-agent-panel" hidden={inspectorView !== 'agent'}><AgentPanel key={state.workspace.id} workspaceId={state.workspace.id} context={cleanLabel(document?.name || '型号设计')} suggestions={['检查这个型号的问题', '绝缘厚度改到 15.8 mm 会怎样？', '检查规格书还缺哪些来源与结果']} /></div>}
  </div>;
  return <TypeCommandSlot.Provider value={setPrimaryAction}><TypeInspectorContext.Provider value={{ show: showProperty, clear: clearProperty }}><Tabs className="type-root" data-save-validation={state.fieldError ? 'error' : undefined} value={dockTab} onValueChange={tab => go(location.module, tab)} onKeyDown={shortcut}><AppShell path={planName ? '方案' : undefined} title={cleanLabel(planName || document?.name || '型号工作区')} status={<StatusMark kind={status} label={statusLabel + (demo ? ' · 演示' : '')} detail={state.error || (demo ? '型号基准含演示来源，请核对各字段工程依据。' : state.readOnly ? '所选输入快照只读；基准版本与来源见型号名片。' : state.dirty ? '保存后更新型号输入；原运行结果保留并标为过期。' : '当前编辑已保存；各模块保存结果的状态见型号浏览器。')} />}
    activeNavigation="型号" theme={location.theme} onTheme={onTheme} onUnavailable={name => setInfo(name + '入口尚未接入')}
    actions={<><IconButton icon="action/edit" label="修改型号名称" disabled={state.busy || state.readOnly || !document} onClick={() => { setNewName(document?.name || ''); setRenaming(true); }} /></>}
    property={inspector}>
    {commandBar}
    <div className="workbench-frame">{explorer}
    <div className="workbench" data-dock={dockMax ? 'max' : undefined}>
      <section className="workbench-canvas type-canvas" aria-label="电缆模型">
        <div className="workbench-views" role="group" aria-label="模型视图">
          {([['section', 'object/cable', '电缆截面'], ['three', 'result/field', '三维剥切']] as const).map(([value, icon, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}><Icon name={icon} />{label}</button>)}
        </div>
        {!dockMax && (state.loading ? <LoadingState title="正在读取型号输入" /> : !document && state.error ? <ErrorState title="型号读取失败" description={state.error} action={<Button onClick={state.reload}>重新读取</Button>} /> : !document ? <EmptyState title="尚无型号输入" description="从型号列表选择型号。" /> : <TypeCanvas view={view} cable={cable} selected={selected} onSelect={choose} />)}
        {structureError && <p className="type-notice is-error" role="alert">{structureError}</p>}
      </section>
      <WorkbenchSplitter kind="type" />
      <section className="workbench-dock" aria-label={module?.label || '型号模块'}>
        <div className="workbench-dock-bar">
          {dockTabs.length > 1 ? <TabsList aria-label={(module?.label || '') + '页签'}>{dockTabs.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList> : <span className="workbench-dock-title">{module?.label}</span>}
          <Button variant="ghost" size="compact" onClick={() => setDockMax(!dockMax)}><Icon name={dockMax ? 'action/chevron-down' : 'action/chevron-up'} />{dockMax ? '显示模型' : '展开结果'}</Button>
        </div>
        <TabsContent asChild value={dockTab}><div className="type-page workbench-dock-body" aria-label={module?.label || '型号模块'} data-type-page={location.module} data-type-state={state.loading ? 'loading' : !document && state.error ? 'error' : !document || !document.cable_types.length ? 'empty' : state.workspace?.raw.historical ? 'historical' : 'success'}>
          {state.error && document && <p className="type-notice is-error" role="alert">{state.error}</p>}{(info || state.notice) && <p className="type-notice" role="status">{info || state.notice}</p>}
          {state.dirty && <p className="type-notice">{state.changeCount} 处未保存 · {state.inputDirty ? evidence.data?.length ? '保存后重算受影响的结果。' : '保存后用于计算和交付。' : '保存方法条件后可运行。'}</p>}
          {!document || state.loading ? null : !module ? <ErrorState title="型号模块不存在" description="此地址未注册为型号模块。" />
            : location.module === 'structure' ? (dockTab === 'materials' ? <MaterialComparison /> : dockTab === 'quantities' ? <TypeStructure tab="quantities" cable={cable} selected={selected} onSelect={choose} /> : <LayerTable rows={rows} selected={selected} onSelect={choose} />)
              : location.tab !== activeTab ? <ErrorState title="页签不存在" description="选择此模块的有效页签继续。" action={<Button onClick={() => go(location.module, activeTab)}>打开默认页签</Button>} />
                : <TypeModulePage module={location.module} tab={methodModule ? dockTab : location.tab} />}
        </div></TabsContent>
      </section>
    </div>
    </div>
    <Dialog open={renaming} onOpenChange={setRenaming} title="修改型号名称" actions={<Button variant="primary" disabled={!newName.trim() || state.readOnly} onClick={() => { state.edit('/name', newName.trim()); setRenaming(false); }}>确认</Button>}><Input aria-label="新的型号名称" value={newName} maxLength={200} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && newName.trim()) { state.edit('/name', newName.trim()); setRenaming(false); } }} /></Dialog>
    {state.workspace && studyOpen && <TypeStudyDialog open onOpenChange={setStudyOpen} />}
  </AppShell></Tabs></TypeInspectorContext.Provider></TypeCommandSlot.Provider>;
}
