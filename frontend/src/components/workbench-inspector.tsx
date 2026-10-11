import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { methodCatalog } from '@/api/research';
import { optionalRecord, text } from '@/api/client';
import { moduleConfiguration, rootModule } from '@/lib/study-config';
import type { SolverCapability } from '@/lib/solver-location';
import { useStudy } from './study-provider';
import { SolverLocation } from './solver-location';
import { displayText } from "@/lib/display-names";
import type { DomainDocument } from "@/lib/domain-fields";
import { Icon } from "./icon";
import { SourceBadge } from "./source-badge";
import type { PropertyGroup } from "./property-panel";
import { CableInputs, ConditionsInputs, SectionInputs, DomainNumber, type InputSelection } from "./study-inputs";
import { StudyCrossingInputs } from './study-crossing-inputs';
import { inspectorViews } from './study-workbench-config';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { LoadingState } from './states';
import './workbench-inspector.css';

/** 输入字段按路径归类，决定保存时的说明（电缆 / 敷设 / 工况）。 */
const scopeOf = (path: string) => path.startsWith("/cable_types") ? "cable" : path.startsWith("/load_cases") ? "conditions" : "section";

function StudySolverLocation() {
  const { study, runs, loadingRuns, runError } = useStudy();
  const module = useLocation({ select: location => location.pathname.split('/')[3] });
  const search = useSearch({ strict: false }) as { run?: string };
  const saved = search.run ? runs.find(run => run.id === search.run) : runs[runs.length - 1];
  const catalog = useQuery({ queryKey: ['method-catalog'], queryFn: ({ signal }) => methodCatalog(signal) });
  if (loadingRuns) return <span className="muted">读取执行来源中</span>;
  if (runError) return <span className="field-error">执行来源读取失败</span>;
  if (search.run && !saved) return <span className="muted">{runError ? '执行来源读取失败' : loadingRuns ? '读取执行来源中' : '执行来源未记录'}</span>;
  const configuration = moduleConfiguration(study.definition, module || rootModule(study.definition)) || study.definition;
  const pin = saved ? optionalRecord(saved.method || optionalRecord(optionalRecord(saved.snapshot).definition).method) : configuration.method;
  const plugin = catalog.data?.find(row => text(optionalRecord(row.method).plugin_id) === pin?.plugin_id);
  const capability = (Array.isArray(plugin?.capabilities) ? plugin.capabilities : []).map(optionalRecord).find(cap => cap.id === pin?.capability);
  if (!saved && catalog.isError) return <span className="field-error">能力声明读取失败</span>;
  return <SolverLocation pluginId={text(pin?.plugin_id)} capability={capability as SolverCapability | undefined} savedRun={saved} prefix={false} />;
}

/** 检查器的一节：图标 + 标题，内容紧随其后。 */
function Block({ icon, title, aside, children, id }: { icon: string; title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="inspector-block" aria-label={title} id={id}>
    <header><Icon name={icon} /><h2>{title}</h2>{aside}</header>
    {children}
  </section>;
}

function Groups({ groups }: { groups: PropertyGroup[] }) {
  return <>{groups.map((group) => <dl key={group.label} className="inspector-list" aria-label={group.label}>
    {group.items.map((item) => <div key={item.label}>
      <dt>{item.label}</dt>
      <dd>{typeof item.value === "string" ? displayText(item.value) : item.value}{item.unit && <span className="unit">{item.unit}</span>}{item.source && <SourceBadge kind={item.source} detail={item.sourceDetail} />}</dd>
    </div>)}
  </dl>)}</>;
}

/**
 * 工作窗口右侧检查器：所选对象（截面中的电缆、排管、介质，或结果表中的候选）在上，
 * 工况始终可改，计算方法在最下。字段直接编辑，进入同一份模型草稿。
 */
export function WorkbenchInspector({ view = "input", onView, methodPanel, agentPanel, relationPanel, document, historical, selection, candidate, method }: {
  /** 右侧“改输入”分两页：输入（所选对象、工况）与方法（方法参数、问询条件、扫描设置）。 */
  view?: "input" | "method" | "agent";
  onView?: (view: "input" | "method" | "agent") => void;
  methodPanel?: ReactNode;
  /** Agent 与“改输入”同处右侧：它只提出方案，批准由人完成。 */
  agentPanel?: ReactNode;
  relationPanel?: ReactNode;
  document?: DomainDocument;
  historical: boolean;
  selection?: InputSelection;
  candidate?: { title: string; groups: PropertyGroup[] };
  method: { name: string; version: string; hpc: boolean; kind: string; run: string };
  demo: boolean;
}) {
  const [layers, setLayers] = useState(false);
  const [relations,setRelations]=useState(false);
  const hash=useLocation({select:location=>location.hash});
  const [section,setSection]=useState(false);
  const [sectionTab,setSectionTab]=useState('coordinates');
  useEffect(()=>{if(hash==='edit-model' && document && !historical)setSection(true);},[hash,!!document,historical]);
  return <aside className="workbench-inspector study-inspector" aria-label="属性">
    {(methodPanel || agentPanel) && <div className="inspector-switch" role="tablist" aria-label="属性分页">
      {inspectorViews.filter(item => item.id === 'input' || item.id === 'method' && methodPanel || item.id === 'agent' && agentPanel).map(item =>
        <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => onView?.(item.id)}><Icon name={item.icon} />{item.label}</button>)}
    </div>}
    {agentPanel && view === "agent" ? <div className="inspector-agent"><Suspense fallback={<LoadingState title="正在读取 Agent" />}>{agentPanel}</Suspense></div> : methodPanel && view === "method" ? <div className="inspector-method">{methodPanel}</div> : <>
    {candidate ? <Block icon="calc/selection" title={candidate.title}><Groups groups={candidate.groups} /></Block>
      : selection ? <Block icon="object/section" title={selection.title}>
        {selection.fields?.length && document
          ? <div className="inspector-fields">{selection.fields.map((spec) => <DomainNumber key={spec.path} spec={spec} document={document} scope={scopeOf(spec.path)} readOnly={historical} />)}</div>
          : <Groups groups={selection.groups} />}
      </Block> : null}
    <details className="inspector-calculation-meta">
      <summary title={`${method.name} ${method.version} · ${method.run}`}>{method.kind || '本次计算'}<span className="muted">方法信息</span></summary>
      <dl className="inspector-list">
        <div title={`${method.name} ${method.version} · ${method.run}`}><dt>方法</dt><dd>{method.name} {method.version}</dd></div>
        <div><dt>运行位置</dt><dd><StudySolverLocation /></dd></div>
      </dl>
    </details>
    {document && <Block icon="object/conditions" title="工况" id="inspector-conditions">
      <div className="inspector-conditions"><ConditionsInputs document={document} historical={historical} tab="inputs" onSelect={() => {}} /></div>
    </Block>}
    {/* 独立研究的几何输入只读，交叉热源仍属于可编辑的方法工况。 */}
    {!document && <div className="inspector-conditions"><StudyCrossingInputs historical={historical} /></div>}
    {document && <div className="inspector-layers"><span>敷设参数</span><Button size="compact" variant="ghost" onClick={() => setSection(true)}>{historical?'查看':'编辑'}</Button></div>}
    <Dialog open={section} onOpenChange={setSection} title="编辑工程模型" description="坐标与介质修改进入本地草稿；保存后影响本工程相关研究。" initialFocus="form">
      <div role="tablist" aria-label="模型参数"><Button variant={sectionTab==='coordinates'?'primary':'ghost'} onClick={()=>setSectionTab('coordinates')}>坐标与尺寸</Button><Button variant={sectionTab==='media'?'primary':'ghost'} onClick={()=>setSectionTab('media')}>介质参数</Button></div>
      {section && <SectionInputs tab={sectionTab} document={document} historical={historical} onSelect={()=>{}} />}
    </Dialog>
    {document && <div className="inspector-layers"><span>分层参数</span><Button size="compact" variant="ghost" onClick={() => setLayers(true)}>{historical?'查看':'编辑'}</Button></div>}
    <Dialog open={layers} onOpenChange={setLayers} title="电缆分层" initialFocus="form">
      {layers && <CableInputs tab="layers" document={document} historical={historical} onSelect={() => {}} />}
    </Dialog>
    {relationPanel && <Block icon="object/study" title="关联" aside={<Button size="compact" variant="ghost" aria-expanded={relations} onClick={()=>setRelations(value=>!value)}>{relations ? '收起' : '查看关联'}</Button>}>{relations && relationPanel}</Block>}
    </>}
  </aside>;
}
