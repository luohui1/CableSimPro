import type { ReactNode } from "react";
import { displayText } from "@/lib/display-names";
import type { DomainDocument } from "@/lib/domain-fields";
import { Icon } from "./icon";
import { SourceBadge } from "./source-badge";
import type { PropertyGroup } from "./property-panel";
import { ConditionsInputs, DomainNumber, type InputSelection } from "./study-inputs";

/** 输入字段按路径归类，决定保存时的说明（电缆 / 敷设 / 工况）。 */
const scopeOf = (path: string) => path.startsWith("/cable_types") ? "cable" : path.startsWith("/load_cases") ? "conditions" : "section";

/** 检查器的一节：图标 + 标题，内容紧随其后。 */
function Block({ icon, title, aside, children }: { icon: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="inspector-block" aria-label={title}>
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
export function WorkbenchInspector({ document, historical, selection, candidate, method, demo }: {
  document?: DomainDocument;
  historical: boolean;
  selection?: InputSelection;
  candidate?: { title: string; groups: PropertyGroup[] };
  method: { name: string; version: string; hpc: boolean };
  demo: boolean;
}) {
  return <aside className="workbench-inspector" aria-label="属性">
    {demo && <p className="inspector-note" role="note">敷设与部分工况来自模板，应按实际条件核对。</p>}
    {candidate ? <Block icon="calc/selection" title={candidate.title}><Groups groups={candidate.groups} /></Block>
      : selection ? <Block icon="object/section" title={selection.title}>
        {selection.fields?.length && document
          ? <div className="inspector-fields">{selection.fields.map((spec) => <DomainNumber key={spec.path} spec={spec} document={document} scope={scopeOf(spec.path)} readOnly={historical} />)}</div>
          : <Groups groups={selection.groups} />}
      </Block>
        : <Block icon="object/section" title="所选对象"><p className="inspector-empty">在截面中点选电缆、排管或土层，在这里修改尺寸与参数。</p></Block>}
    {document && <Block icon="object/conditions" title="工况">
      <div className="inspector-conditions"><ConditionsInputs document={document} historical={historical} tab="inputs" onSelect={() => {}} /></div>
    </Block>}
    <Block icon="nav/plugin" title="计算方法">
      <dl className="inspector-list">
        <div><dt>插件</dt><dd>{method.name}</dd></div>
        <div><dt>版本</dt><dd>{method.version}</dd></div>
        <div><dt>运行位置</dt><dd>{method.hpc ? "超算（Slurm）" : "本机"}</dd></div>
      </dl>
    </Block>
  </aside>;
}
