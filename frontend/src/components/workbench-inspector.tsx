import { useState, type ReactNode } from "react";
import { displayText } from "@/lib/display-names";
import type { DomainDocument } from "@/lib/domain-fields";
import { Icon } from "./icon";
import { SourceBadge } from "./source-badge";
import type { PropertyGroup } from "./property-panel";
import { CableInputs, ConditionsInputs, DomainNumber, type InputSelection } from "./study-inputs";
import { inspectorViews } from './study-workbench-config';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';

/** 输入字段按路径归类，决定保存时的说明（电缆 / 敷设 / 工况）。 */
const scopeOf = (path: string) => path.startsWith("/cable_types") ? "cable" : path.startsWith("/load_cases") ? "conditions" : "section";

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
export function WorkbenchInspector({ view = "input", onView, methodPanel, agentPanel, document, historical, selection, candidate, method }: {
  /** 右侧“改输入”分两页：输入（所选对象、工况）与方法（方法参数、问询条件、扫描设置）。 */
  view?: "input" | "method" | "agent";
  onView?: (view: "input" | "method" | "agent") => void;
  methodPanel?: ReactNode;
  /** Agent 与“改输入”同处右侧：它只提出方案，批准由人完成。 */
  agentPanel?: ReactNode;
  document?: DomainDocument;
  historical: boolean;
  selection?: InputSelection;
  candidate?: { title: string; groups: PropertyGroup[] };
  method: { name: string; version: string; hpc: boolean; kind: string; run: string };
  demo: boolean;
}) {
  const [layers, setLayers] = useState(false);
  return <aside className="workbench-inspector" aria-label="属性">
    {(methodPanel || agentPanel) && <div className="inspector-switch" role="tablist" aria-label="属性分页">
      {inspectorViews.filter(item => item.id === 'input' || item.id === 'method' && methodPanel || item.id === 'agent' && agentPanel).map(item =>
        <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => onView?.(item.id)}><Icon name={item.icon} />{item.label}</button>)}
    </div>}
    {agentPanel && view === "agent" ? <div className="inspector-agent">{agentPanel}</div> : methodPanel && view === "method" ? <div className="inspector-method">{methodPanel}</div> : <>
    {candidate ? <Block icon="calc/selection" title={candidate.title}><Groups groups={candidate.groups} /></Block>
      : selection ? <Block icon="object/section" title={selection.title}>
        {selection.fields?.length && document
          ? <div className="inspector-fields">{selection.fields.map((spec) => <DomainNumber key={spec.path} spec={spec} document={document} scope={scopeOf(spec.path)} readOnly={historical} />)}</div>
          : <Groups groups={selection.groups} />}
      </Block> : null}
    <Block icon="calc/ampacity" title="本次计算">
      {method.kind && <p className="inspector-lead">{method.kind}</p>}
      <dl className="inspector-list">
        <div><dt>插件</dt><dd>{method.name} {method.version}</dd></div>
        <div><dt>运行位置</dt><dd>{method.hpc ? "超算（Slurm）" : "本机"}</dd></div>
        <div><dt>状态</dt><dd>{method.run}</dd></div>
      </dl>
    </Block>
    {document && <Block icon="object/conditions" title="工况" id="inspector-conditions">
      <div className="inspector-conditions"><ConditionsInputs document={document} historical={historical} tab="inputs" onSelect={() => {}} /></div>
    </Block>}
    {document && <Button size="compact" variant="ghost" onClick={() => setLayers(true)}>分层参数</Button>}
    <Dialog open={layers} onOpenChange={setLayers} title="电缆分层" initialFocus="form">
      {layers && <CableInputs tab="layers" document={document} historical={historical} onSelect={() => {}} />}
    </Dialog>
    </>}
  </aside>;
}
