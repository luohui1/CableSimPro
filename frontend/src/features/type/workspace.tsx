import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { message, text } from '@/api/client';
import { AppShell } from '@/components/app-shell';
import { CheckArea } from '@/components/check-area';
import { Icon } from '@/components/icon';
import { PropertyPanel, type PropertyGroup } from '@/components/property-panel';
import { SourceBadge } from '@/components/source-badge';
import { StatusMark } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { fieldSource } from '@/lib/domain-fields';
import { sourceKind } from '@/lib/selection-view';
import { formatNumber } from '@/lib/format';
import type { LayerTarget } from '@/features/drawing/types';
import { targetId } from '@/features/drawing/cable-geometry';
import { TypeStructure, TypeNumericField, nominalArea } from './structure';
import { layerRows } from './layers';
import { useTypeWorkspace } from './provider';
import { typePath, useTypeNavigation } from './navigation';
import './type.css';
import { cleanLabel } from './labels';
import { StructurePropertyInputs } from './property-inputs';
import { TypeInspectorContext } from './inspector';
import { TypeModulePage } from './module-page';

export const typeModules = [
  { id: 'structure', label: '结构设计', icon: 'module/structure', tabs: [['section', '截面'], ['three', '三维剥切'], ['table', '分层表'], ['quantities', '外径与用料']] },
  { id: 'standard-check', label: '标准核对', icon: 'module/standard-check', tabs: [['results', '标准核对']] },
  { id: 'electrical', label: '电气参数', icon: 'module/electrical', tabs: [['results', '结果'], ['parameters', '方法参数']] },
  { id: 'short-circuit', label: '短路容量', icon: 'module/short-circuit', tabs: [['results', '结果'], ['parameters', '方法参数']] },
  { id: 'rating-table', label: '载流量表', icon: 'module/rating-table', tabs: [['results', '结果表'], ['parameters', '方法参数']] },
  { id: 'comparison', label: '方案对比', icon: 'module/method-compare', tabs: [['matrix', '结果矩阵'], ['parameters', '参数差异'], ['geometry', '截面对比']] },
  { id: 'specification', label: '规格书', icon: 'module/datasheet', tabs: [['content', '内容'], ['preview', '预览'], ['review', '审核与发布'], ['revisions', '修订记录']] },
] as const;
export function TypeWorkspace() {
  const state = useTypeWorkspace(), { location, navigate, onTheme } = useTypeNavigation();
  const module = typeModules.find(module => module.id === location.module);
  const activeTab = module?.tabs.some(([id]) => id === location.tab) ? location.tab : module?.tabs[0][0] || location.tab;
  const [cableId, setCableId] = useState(''), [selected, setSelected] = useState<LayerTarget | null>(null), [collapsed, setCollapsed] = useState(false), [info, setInfo] = useState('');
  const [resultProperty, setResultProperty] = useState<{ title: string; groups: PropertyGroup[] } | null>(null);
  const showProperty = useCallback((title: string, groups: PropertyGroup[]) => { setResultProperty({ title, groups }); setCollapsed(false); }, []);
  const clearProperty = useCallback(() => setResultProperty(null), []);
  const document = state.document, cable = document?.cable_types.find(cable => cable.id === cableId) || document?.cable_types[0] || null;
  let rows: ReturnType<typeof layerRows> = [], structureError = '';
  try { if (document && cable) rows = layerRows(document, cable); } catch (error) { structureError = message(error); }
  const row = selected ? rows.find(row => row.id === targetId(selected)) : undefined;
  const source = row && document ? fieldSource(document, row.path) : {};
  const demo = Object.values(document?.provenance || {}).some(source => source.kind === 'demo');
  const status = state.readOnly ? state.workspace?.raw.historical ? 'historical' : 'locked' : state.dirty ? 'draft' : 'saved';
  function choose(target: LayerTarget | null) { setSelected(target); if (target) setCollapsed(false); }
  const go = (module: string, tab: string) => navigate(typePath(location.wid!, module, tab, location.theme) + (location.revision ? '&revision=' + location.revision : '') + (location.run && module === location.module ? '&run=' + encodeURIComponent(location.run) : ''));
  function shortcut(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void state.save(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) { event.preventDefault(); void state.undo(); }
    if (event.key === 'Escape' && !(event.target as HTMLElement).closest('input,textarea,[role=dialog],[role=combobox]')) { choose(null); setInfo(''); }
  }
  useEffect(() => { setInfo(''); setResultProperty(null); setCollapsed(location.module !== 'structure' || location.tab === 'table' && !selected); }, [location.module, location.tab, selected]);
  useEffect(() => { if (location.module === 'structure' && location.layer) { const row = rows.find(row => row.id === location.layer); if (row) { setSelected(row.target); setCollapsed(false); } } }, [location.module, location.layer, cable?.id]);
  const property = location.module === 'structure' && document && row ? <div className="type-property-wrapper">
    <PropertyPanel title={row.label} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} groups={[{ label: '结构输入', items: [
      { label: '材料', value: cleanLabel(row.material.label), source: sourceKind(fieldSource(document, row.materialPath)), sourceDetail: text(fieldSource(document, row.materialPath).reference) || undefined },
      ...(row.target.role === 'conductor' ? [{ label: '标称截面', value: formatNumber(nominalArea(document, row) === null ? null : nominalArea(document, row)! * 1e6, 1), unit: 'mm²', source: sourceKind(fieldSource(document, row.path.replace(/diameter$/, 'nominal_area'))) }] : []),
      { label: '绘图外径', value: formatNumber(row.outerM === null ? null : row.outerM * 2000, 2), unit: 'mm', source: row.outerM === null ? undefined : 'derived', sourceDetail: '参数截面尺寸，原始实体结果见外径与用料页签' },
    ] }]} />
    {!collapsed && <div className="type-property-fields"><TypeNumericField row={row} />
      <Select label="材料引用" value={row.material.id} disabled={state.busy || state.locked(row.materialPath)} options={document.materials.filter(item => item.category === row.material.category).map(item => ({ value: item.id, label: cleanLabel(item.label) }))} onChange={material => state.edit(row.materialPath, material)} />
      {!sourceKind(source) && source.kind !== 'demo' && <p className="muted">此尺寸未提供来源。</p>}<StructurePropertyInputs row={row} /></div>}
  </div> : location.module === 'structure' ? <PropertyPanel title="所选结构层" groups={[{ label: '未选择结构层', items: [{ label: '提示', value: '选择截面编号或分层表中的行' }] }]} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} /> : <PropertyPanel title={resultProperty?.title || '所选结果'} groups={resultProperty?.groups || [{ label: '未选择结果', items: [{ label: '提示', value: '选择结果行查看依据与来源' }] }]} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} />;
  return <TypeInspectorContext.Provider value={{ show: showProperty, clear: clearProperty }}><Tabs className="type-root" data-save-validation={state.fieldError ? 'error' : undefined} value={activeTab} onValueChange={tab => go(location.module, tab)} onKeyDown={shortcut}><AppShell title={cleanLabel(document?.name || '型号工作区')} status={<><StatusMark kind={status} label={location.run ? state.workspace?.raw.historical ? '历史运行快照 · 只读' : '运行快照 · 只读' : status === 'locked' ? '已发布 · 只读' : undefined} />{demo && <SourceBadge kind="demo" detail="型号基准与部分物性来自系统演示版本；各字段来源独立保留。" />}</>}
    activeNavigation="型号" theme={location.theme} onTheme={onTheme} onUnavailable={name => setInfo(name + '入口尚未接入')}
    sidebar={<><button className="module-item" type="button" onClick={() => navigate('/types?theme=' + location.theme)}><Icon name="nav/cable-type" /><span>型号列表</span></button>{typeModules.map(module => <button key={module.id} className="module-item" type="button" aria-current={location.module === module.id ? 'page' : undefined} onClick={() => go(module.id, module.tabs[0][0])}><Icon name={module.icon} /><span>{module.label}</span></button>)}</>}
    actions={<><Button variant="ghost" size="compact" onClick={() => void state.undo()} disabled={state.busy || state.readOnly || !state.dirty && state.workspace?.raw.can_undo !== true}>撤销</Button>
      <Button variant={location.module === 'structure' ? 'primary' : 'default'} size="compact" loading={state.busy} disabled={!state.dirty || state.readOnly || !state.workspace} onClick={() => void state.save()}>保存</Button></>}
    tabs={module && module.tabs.length > 1 ? <TabsList aria-label={module.label + '页签'}>{module.tabs.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList> : undefined}
    property={property} propertyCollapsed={collapsed}
    checks={<CheckArea summary={state.error ? '输入保存失败' : state.dirty ? '输入待保存 · 原结果已失效' : state.readOnly ? '只读型号版本' : '输入已保存 · 标准判定见标准核对'}><p>{structureError || '尺寸与材料由宿主校验；标准判定从保存的插件结果读取。'}</p></CheckArea>}>
    <TabsContent asChild value={activeTab}><div className="type-page" aria-label={module?.label || '型号模块'} data-type-page={location.module} data-type-state={state.loading ? 'loading' : !document && state.error ? 'error' : !document || !document.cable_types.length ? 'empty' : state.workspace?.raw.historical ? 'historical' : 'success'}>
      {state.error && document && <p className="type-notice is-error" role="alert">{state.error}</p>}{(info || state.notice) && <p className="type-notice" role="status">{info || state.notice}</p>}
      {state.loading ? <LoadingState title="正在读取型号输入" /> : !document && state.error ? <ErrorState title="型号读取失败" description={state.error} action={<Button onClick={state.reload}>重新读取</Button>} /> : !document ? <EmptyState title="尚无型号输入" description="从型号列表选择型号。" /> : !module ? <ErrorState title="型号模块不存在" description="此地址未注册为型号模块。" /> : <>
        {location.module === 'structure' && !state.readOnly && <div className="type-name-row"><label htmlFor="type-name">型号名称</label><input id="type-name" className="type-name-input" value={cleanLabel(document.name)} disabled={state.busy} onChange={event => state.edit('/name', event.target.value)} />{document.cable_types.length > 1 && <Select label="电缆结构" value={cable?.id} disabled={state.busy} options={document.cable_types.map(item => ({ value: item.id, label: cleanLabel(item.label) }))} onChange={value => { setCableId(value); choose(null); }} />}</div>}
        {location.tab !== activeTab ? <ErrorState title="页签不存在" description="选择此模块的有效页签继续。" action={<Button onClick={() => go(location.module, activeTab)}>打开默认页签</Button>} /> : location.module === 'structure' ? <TypeStructure tab={location.tab} cable={cable} selected={selected} onSelect={choose} /> : <TypeModulePage module={location.module} tab={location.tab} />}
      </>}
    </div></TabsContent>
  </AppShell></Tabs></TypeInspectorContext.Provider>;
}
