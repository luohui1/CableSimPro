import { entityLabel } from "@/lib/domain-fields";
import { useRef, useState, type ComponentProps } from "react";
import { api, ApiError, numeric, record, responseData, message } from "@/api/client";
import { StudyErrorState } from './study-error-state';
import type { components } from "@/api/generated/schema";
import {
  CableSection,
  LayingSection,
  type DrawingCommand,
  type LayerTarget,
  type SectionSelection,
} from "@/features/drawing";
import type { Section } from "@/features/drawing/types";
import {
  at,
  change,
  commitFields,
  isLocked,
  pointer,
  type DomainDocument,
  type NumericInput,
} from "@/lib/domain-fields";
import { useStudy } from "./study-provider";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { NumberField } from "./ui/number-field";
import './study-drawing.css';
import { StudyGeometry } from "./study-geometry";
import type { InputSelection } from "./study-inputs";

function sectionPath(section: Section, field: string): string {
  for (const [collection, ids] of [
    ["placements", section.placements.map((item) => item.cable)],
    ["enclosures", (section.enclosures || []).map((item) => item.id)],
    ["soil_layers", (section.soil_layers || []).map((item) => item.id)],
  ] as const)
    for (const id of ids) {
      const prefix = collection + "." + id + ".";
      if (field.startsWith(prefix))
        return pointer(
          "sections",
          section.id,
          collection,
          id,
          ...field.slice(prefix.length).split("."),
        );
    }
  if (section.backfill) {
    const prefix = "backfill." + section.backfill.id + ".";
    if (field.startsWith(prefix))
      return pointer(
        "sections",
        section.id,
        "backfill",
        ...field.slice(prefix.length).split("."),
      );
  }
  if (field.startsWith("backfill."))
    return pointer(
      "sections",
      section.id,
      "backfill",
      ...field.slice(9).split("."),
    );
  throw new ApiError(422, "未知画布字段：" + field);
}
function cablePath(id: string, target: LayerTarget) {
  return target.scope === "common"
    ? pointer("cable_types", id, "common_layers", target.role, "thickness")
    : target.role === "conductor"
      ? pointer(
          "cable_types",
          id,
          "cores",
          target.coreId,
          "conductor",
          "diameter",
        )
      : pointer(
          "cable_types",
          id,
          "cores",
          target.coreId,
          "layers",
          target.role,
          "thickness",
        );
}
export function StudyDrawing({
  document,
  historical,
  readOnly = false,
  kind,
  onSelect,
  annotations,
  run, fieldCase, viewportRef, onExport, preview, onPropose,
}: {
  document: DomainDocument;
  historical: boolean;
  readOnly?: boolean;
  kind: "cable" | "section" | "scene";
  onSelect: (selection: InputSelection) => void;
  annotations?: Record<string, { text: string; emphasis?: boolean }>;
} & Pick<ComponentProps<typeof StudyGeometry>, 'run' | 'fieldCase' | 'viewportRef' | 'onExport' | 'preview' | 'onPropose'>) {
  const context = useStudy();
  const current = useRef(context);
  current.current = context;
  const [chosen, setChosen] = useState("");
  const [templateOpen, setTemplateOpen] = useState(false), [templateId, setTemplateId] = useState('');
  const [templateDepth, setTemplateDepth] = useState<number | null>(0.8);
  const [templateBusy, setTemplateBusy] = useState(false), [templateError, setTemplateError] = useState('');
  const templatePending = useRef(false);
  const templateDepthInput = useRef<HTMLInputElement | null>(null);
  const [layer, setLayer] = useState<LayerTarget | null>(null),
    [selection, setSelection] = useState<SectionSelection>(null);
  const cable =
      document.cable_types.find((item) => item.id === chosen) ||
      document.cable_types[0],
    section =
      document.sections.find((item) => item.id === chosen) ||
      document.sections[0];
  const editable = !historical && !readOnly && !context.saving;
  const editDocument = context.editDomainDocument;
  function command(value: DrawingCommand) {
    if (value === "save") {
      const focused = window.document.activeElement;
      if (focused instanceof HTMLInputElement) focused.blur();
      setTimeout(() => void current.current.save(), 0);
    } else void context[value]();
  }
  function selectSection(value: SectionSelection) {
    setSelection(value);
    if (!value || !section) return;
    // 检查器里可直接修改的字段：都来自截面里该对象真实存在的尺寸，没有的不显示
    const at = (...parts: string[]) => pointer("sections", section.id, ...parts);
    const coordinate = (root: string[], axis: "x" | "z"): NumericInput => ({ path: at(...root, axis), label: axis === "x" ? "水平位置 x" : "高程 z", unit: "m", precision: 3, required: true });
    const size = (root: string[], key: string, label: string, millimetres = true): NumericInput => ({ path: at(...root, key), label, unit: millimetres ? "mm" : "m", scale: millimetres ? 1000 : 1, precision: millimetres ? 1 : 3, min: 0, minExclusive: true });
    const material = (id?: string | null): NumericInput[] => id ? [{ path: pointer("materials", id, "thermal_resistivity"), label: "热阻率", unit: "K·m/W", precision: 3, min: 0, minExclusive: true }] : [];
    let title = entityLabel(document, value.id), fields: NumericInput[] = [];
    if (value.kind === "cable") fields = [coordinate(["placements", value.id], "x"), coordinate(["placements", value.id], "z")];
    else if (value.kind === "enclosure") {
      const item = (section.enclosures || []).find((entry) => entry.id === value.id);
      const root = ["enclosures", value.id];
      title = item?.type === "duct" ? `排管 ${(section.enclosures || []).filter((entry) => entry.type === "duct").indexOf(item) + 1}` : title;
      fields = [coordinate(root, "x"), coordinate(root, "z"),
        ...(item?.inner_diameter != null ? [size(root, "inner_diameter", "内径")] : []), ...(item?.outer_diameter != null ? [size(root, "outer_diameter", "外径")] : []),
        ...(item?.width != null ? [size(root, "width", "宽度", false)] : []), ...(item?.height != null ? [size(root, "height", "高度", false)] : []), ...material(item?.material)];
    } else if (value.kind === "backfill" && section.backfill) {
      title = "回填区";
      fields = [coordinate(["backfill"], "x"), coordinate(["backfill"], "z"), size(["backfill"], "width", "宽度", false), size(["backfill"], "height", "高度", false), ...material(section.backfill.material)];
    } else if (value.kind === "soil") {
      const layer = (section.soil_layers || []).find((entry) => entry.id === value.id);
      title = "土层";
      fields = [{ path: at("soil_layers", value.id, "top_z"), label: "上边界 z", unit: "m", precision: 3 }, { path: at("soil_layers", value.id, "bottom_z"), label: "下边界 z", unit: "m", precision: 3 }, ...material(layer?.material)];
    }
    onSelect({
      id: value.id,
      title,
      fields: fields.length ? fields : undefined,
      groups: [{ label: "敷设对象", items: [{ label: "类型", value: { cable: "电缆", enclosure: "构筑物", backfill: "回填", soil: "土壤层" }[value.kind] }] }],
    });
  }
  const templates: {
    id: components["schemas"]["LayoutPreview"]["kind"];
    label: string;
  }[] =
    cable && cable.cores.length > 1
      ? [
          { id: "three_core_buried_single", label: "三芯直埋" },
          { id: "three_core_buried_horizontal", label: "三芯多回水平" },
          { id: "three_core_ducts_horizontal", label: "三芯排管" },
        ]
      : [
          { id: "trefoil", label: "单回品字" },
          { id: "flat", label: "单回水平" },
          { id: "double_trefoil", label: "双回品字" },
          { id: "ducts", label: "排管" },
          { id: "backfill", label: "回填" },
        ];
  async function applyTemplate(id: string, depth = Math.abs(section?.placements[0]?.z || 0.8)) {
    if (!editable) throw new ApiError(409, '当前敷设只读');
    const option = templates.find(item => item.id === id);
    if (!option || !Number.isFinite(depth) || depth <= 0) throw new ApiError(422, '请选择敷设模板并填写正的中心埋深');
    const result = record(await responseData(api.POST('/api/design/workspaces/{wid}/section-template', {
      params: {path:{wid:context.study.workspace}}, body:{
        expected_revision: context.domainDraft?.revision ?? numeric(context.workspace.revision)!,
        document: context.domainDraft ? commitFields(context.domainDraft) : document,
        kind: option.id, depth,
      },
    })), '敷设模板');
    if (result.schema_version !== 'cablesim.domain/1') throw new ApiError(502, '模板缺少领域输入');
    editDocument(result as DomainDocument, 'section', [pointer('sections')]);
    setSelection(null);
  }
  async function confirmTemplate() {
    if (templatePending.current) return;
    const raw = templateDepthInput.current?.value.trim() || '';
    const depth = raw ? Number(raw) : NaN;
    if (!Number.isFinite(depth) || depth <= 0) {
      setTemplateError('中心埋深：请输入大于 0 的数值，单位 m'); templateDepthInput.current?.focus(); return;
    }
    templatePending.current = true; setTemplateBusy(true); setTemplateError('');
    try { await applyTemplate(templateId, depth); setTemplateOpen(false); }
    catch (error) { setTemplateError(message(error)); }
    finally { templatePending.current = false; setTemplateBusy(false); }
  }
  return (
    <div
      className="study-drawing"
      data-drawing-mount={
        kind === "cable"
          ? "cable-section"
          : kind === "scene"
            ? "laying-cad"
            : "laying-section"
      }
    >
      {kind !== 'cable' && editable && <div className="study-template-action"><Button size="compact" variant="ghost" onClick={() => {
        setTemplateId(templates[0]?.id || ''); setTemplateDepth(Math.abs(section?.placements[0]?.z || 0.8)); setTemplateError(''); setTemplateOpen(true);
      }}>敷设模板</Button></div>}
      <Dialog open={templateOpen} onOpenChange={open => {if(!templatePending.current) setTemplateOpen(open);}} title="敷设模板" description={context.study.definition.input_source === 'study' ? '应用后进入本研究的独立输入草稿；保存不会修改型号或其他研究。' : '本研究使用的内置布置模板；不是组织发布模板。应用后进入工程模型草稿，保存会影响本工程的相关研究。'} initialFocus="form"
        actions={<Button variant="primary" loading={templateBusy} onClick={() => void confirmTemplate()}>应用模板</Button>}>
        <Select label="模板" value={templateId} options={templates.map(item => ({value:item.id,label:item.label}))} onChange={setTemplateId} disabled={templateBusy} />
        <NumberField label="中心埋深" unit="m" value={templateDepth} min={0} minExclusive required precision={3} onCommit={setTemplateDepth} inputRef={templateDepthInput} disabled={templateBusy} submitOnEnter />
        {templateError && <StudyErrorState title="敷设模板未应用" description={templateError} />}
      </Dialog>
      {(kind === "cable" ? document.cable_types : document.sections).length >
        1 && (
        <Select
          label={kind === "cable" ? "电缆型号" : "敷设截面"}
          value={kind === "cable" ? cable?.id : section?.id}
          options={(kind === "cable"
            ? document.cable_types
            : document.sections
          ).map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => {
            setChosen(id);
            setLayer(null);
            setSelection(null);
          }}
        />
      )}
      {kind === "cable" ? (
        <CableSection
          key={cable?.id}
          cableType={cable || null}
          materials={document.materials}
          state={historical ? "historical" : cable ? "success" : "empty"}
          editable={editable}
          selectedObject={layer}
          onCommand={command}
          isLocked={(target) =>
            isLocked(context.workspace.locks, cablePath(cable.id, target))
          }
          onSelectionChange={(target) => {
            setLayer(target);
            if (!target || !cable) return;
            const path = cablePath(cable.id, target);
            onSelect({
              id: path,
              title: target.role,
              fields: [
                {
                  path,
                  label: target.role === "conductor" ? "导体外径" : "层厚度",
                  unit: "mm",
                  scale: 1000,
                  precision: 3,
                },
              ],
              groups: [],
            });
          }}
          onDimensionChange={(edit) => {
            if (!editable || !cable) throw new ApiError(409, "当前输入只读");
            const path = cablePath(cable.id, edit.target);
            if (isLocked(context.workspace.locks, path))
              throw new ApiError(423, "尺寸已锁定");
            context.editDomainValue(path, edit.valueM, "cable");
          }}
        />
      ) : kind === "scene" ? (
        <StudyGeometry
          document={document}
          sectionId={section?.id || ""}
          historical={historical}
          selected={selection}
          onSelect={selectSection}
          run={run} fieldCase={fieldCase} viewportRef={viewportRef} onExport={onExport} preview={preview} onPropose={onPropose}
        />
      ) : (
        <LayingSection
          key={section?.id}
          annotations={annotations}
          preview={preview} onPropose={onPropose} run={run} fieldCase={fieldCase}
          document={document}
          sectionId={section?.id || ""}
          state={historical ? "historical" : section ? "success" : "empty"}
          editable={editable}
          selectedObject={selection}
          onSelectionChange={selectSection}
          onCommand={command}
          canUndo={context.canUndo}
          canRedo={context.canRedo}
          objectCommands={[]}
          templates={templates}
          isLocked={(field) =>
            !section ||
            isLocked(context.workspace.locks, sectionPath(section, field))
          }
          onChange={(next, edit) => {
            if (!editable || !section) throw new ApiError(409, "当前敷设只读");
            const paths = edit.fields.map((field) =>
              sectionPath(section, field),
            );
            if (paths.some((path) => isLocked(context.workspace.locks, path)))
              throw new ApiError(423, "整组画布改动包含锁定字段");
            let updated = document;
            const temporary = {
              ...document,
              sections: document.sections.map((item) =>
                item.id === next.id ? next : item,
              ),
            };
            for (const path of paths)
              updated = change(updated, path, at(temporary, path));
            editDocument(updated, "section", paths);
          }}
          onTemplateRequest={applyTemplate}
        />
      )}
    </div>
  );
}
