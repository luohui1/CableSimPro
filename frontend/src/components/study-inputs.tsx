import { Suspense, type ReactNode } from "react";
import { readableCableVersion as versionLabel } from './study-workbench-config';
import { cableLayerGrid } from '@/lib/heavy-components';
const CableLayerGrid = cableLayerGrid.Component;
import { optionalRecord, text, numeric } from "@/api/client";
import {
  displayed,
  entityLabel,
  fieldSource,
  isLocked,
  pointer,
  type DomainDocument,
  type NumericInput,
} from "@/lib/domain-fields";
import { sourceKind } from "@/lib/selection-view";
import { useStudy } from "./study-provider";
import { NumberField } from "./ui/number-field";
import { Tooltip } from "./ui/tooltip";
import { Toolbar } from "./toolbar";
import { DataTable, type Column } from "./data-table";
import { EmptyState, StaleBanner, LoadingState } from "./states";
import {
  formatNumber,
  engineeringInputPrecision,
  engineeringQuantity,
} from "@/lib/format";
import type { PropertyGroup } from "./property-panel";
import { StudyDrawing } from "./study-drawing";
import { StudyCrossingInputs } from './study-crossing-inputs';

export type InputSelection = {
  id: string;
  title: string;
  groups: PropertyGroup[];
  fields?: NumericInput[];
};
type InputProps = {
  tab: string;
  document?: DomainDocument;
  historical: boolean;
  onSelect: (selection: InputSelection) => void;
};
export type InputRow = {
  id: string;
  label: string;
  fields: NumericInput[];
  material?: string;
};
const positive = { min: 0, minExclusive: true, required: true };
export function DomainNumber({
  spec,
  document,
  scope,
  readOnly,
}: {
  spec: NumericInput;
  document: DomainDocument;
  scope: string;
  readOnly: boolean;
}) {
  const context = useStudy();
  const field = readOnly ? undefined : context.domainDraft?.fields[spec.path];
  const source = fieldSource(document, spec.path);
  return (
    <NumberField
      label={spec.label}
      path={spec.path}
      value={displayed(document, spec)}
      unit={spec.unit}
      precision={engineeringInputPrecision(
        spec.path,
        displayed(document, spec),
        spec.unit,
      )}
      fullPrecision={
        engineeringQuantity(spec.path, displayed(document, spec), spec.unit)
          .complete
      }
      min={spec.min}
      max={spec.max}
      required={spec.required}
      minExclusive={spec.minExclusive}
      locked={readOnly || isLocked(context.workspace.locks, spec.path)}
      disabled={context.saving}
      source={field ? "user" : sourceKind(source)}
      sourceDetail={text(source.reference)}
      dirty={!!field}
      draftText={field?.value}
      onDraftChange={
        readOnly
          ? undefined
          : (value) => context.editDomainText(spec, value, scope)
      }
      onCommit={(value) => {
        if (value === displayed(document, spec)) {
          context.editDomainText(spec, undefined, scope);
          return;
        }
        context.editDomainValue(
          spec.path,
          value === null
            ? null
            : (value - (spec.offset ?? 0)) / (spec.scale ?? 1),
          scope,
        );
      }}
    />
  );
}
function selected(row: InputRow, document: DomainDocument): InputSelection {
  return {
    id: row.id,
    title: row.label,
    fields: row.fields,
    groups: [
      {
        label: "参数",
        items: row.fields.map((spec) => {
          const source = fieldSource(document, spec.path);
          return {
            label: spec.label,
            value: formatNumber(displayed(document, spec), spec.precision ?? 1),
            unit: spec.unit,
            source: sourceKind(source),
            sourceDetail: text(source.reference),
          };
        }),
      },
    ],
  };
}
function InputTable({
  label,
  rows,
  document,
  scope,
  historical,
  onSelect,
}: {
  label: string;
  rows: InputRow[];
  document: DomainDocument;
  scope: string;
  historical: boolean;
  onSelect: (selection: InputSelection) => void;
}) {
  const columns: Column<InputRow>[] = [
    {
      id: "name",
      label: "对象",
      render: (row) => (
        <Tooltip content={row.label}>
          <span tabIndex={0}>{row.label}</span>
        </Tooltip>
      ),
    },
    {
      id: "fields",
      label: "参数",
      wrap: true,
      render: (row) => (
        <div className="input-row-fields">
          {row.fields.map((spec) => (
            <DomainNumber
              key={spec.path}
              spec={spec}
              document={document}
              scope={scope}
              readOnly={historical}
            />
          ))}
        </div>
      ),
    },
    {
      id: "material",
      label: "材料 / 引用",
      wrap: true,
      render: (row) =>
        row.material ? entityLabel(document, row.material) : "—",
    },
  ];
  return (
    <DataTable
      label={label}
      columns={columns}
      groups={[{ id: scope, label, rows }]}
      rowLabel={(row) => row.label}
      showGroups={false}
      density="standard"
      onSelect={(row) => onSelect(selected(row, document))}
    />
  );
}
function InputSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="input-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function CableInputs({
  tab,
  document,
  historical,
  onSelect,
}: InputProps) {
  const context = useStudy();
  if (!document) return <EmptyState description="" title="尚无电缆领域输入" />;
  const rows: InputRow[] = document.cable_types.flatMap((cable) => {
    const coreRows = cable.cores.flatMap((core, index) => {
      const root = ["cable_types", cable.id, "cores", core.id];
      return [
        {
          id: core.id,
          label: entityLabel(document, cable.id) + " · 芯 " + (index + 1),
          material: core.conductor.material,
          fields: [
            {
              path: pointer(...root, "conductor", "nominal_area"),
              label: "导体标称截面",
              unit: "mm²",
              scale: 1e6,
              precision: 1,
              ...positive,
            },
            {
              path: pointer(...root, "conductor", "diameter"),
              label: "导体外径",
              unit: "mm",
              scale: 1000,
              precision: 2,
              ...positive,
            },
            {
              path: pointer(...root, "conductor", "r20"),
              label: "R₂₀",
              unit: "Ω/km",
              scale: 1000,
              precision: 4,
              min: 0,
              minExclusive: true,
            },
          ],
        },
        ...core.layers.map((layer) => ({
          id: core.id + "/" + layer.role,
          label: "芯 " + (index + 1) + " · " + layerName(layer.role),
          material: layer.material,
          fields: [
            {
              path: pointer(...root, "layers", layer.role, "thickness"),
              label: "层厚度",
              unit: "mm",
              scale: 1000,
              precision: 3,
              ...positive,
            },
          ],
        })),
      ];
    });
    return [
      ...coreRows,
      ...cable.common_layers.map((layer) => ({
        id: cable.id + "/" + layer.role,
        label: layerName(layer.role),
        material: layer.material,
        fields: [
          {
            path: pointer(
              "cable_types",
              cable.id,
              "common_layers",
              layer.role,
              "thickness",
            ),
            label: "层厚度",
            unit: "mm",
            scale: 1000,
            precision: 3,
            ...positive,
          },
        ],
      })),
    ];
  });
  const reference = optionalRecord(context.workspace.study_cable_reference);
  return (
    <div className="input-module">
      {historical && <StaleBanner description="固定运行输入 · 只读" />}
      {tab === "section" ? (
        <>
          <Toolbar>
            <h2>电缆截面</h2>
            <div className="spacer" />
            <span className="muted">尺寸 / mm</span>
          </Toolbar>
          <StudyDrawing
            document={document}
            historical={historical}
            kind="cable"
            onSelect={onSelect}
          />
          <InputSection title="额定参数">
            <div className="input-form-grid">
              {document.cable_types.flatMap((cable) => [
                <DomainNumber
                  key={cable.id + "/u0"}
                  document={document}
                  scope="cable"
                  readOnly={historical}
                  spec={{
                    path: pointer("cable_types", cable.id, "rating", "u0"),
                    label: entityLabel(document, cable.id) + " · U₀",
                    unit: "kV",
                    scale: 0.001,
                    precision: 1,
                    min: 0,
                    required: true,
                  }}
                />,
                <DomainNumber
                  key={cable.id + "/temperature"}
                  document={document}
                  scope="cable"
                  readOnly={historical}
                  spec={{
                    path: pointer(
                      "cable_types",
                      cable.id,
                      "rating",
                      "max_conductor_temperature",
                      "normal",
                    ),
                    label: "导体正常温限",
                    unit: "°C",
                    offset: -273.15,
                    precision: 1,
                    min: -273.15,
                    minExclusive: true,
                    required: true,
                  }}
                />,
              ])}
            </div>
          </InputSection>
        </>
      ) : tab === "layers" ? (
        <Suspense fallback={<LoadingState title="正在读取分层表" />}><CableLayerGrid rows={rows} document={document} historical={historical} onSelect={row => onSelect(selected(row,document))} /></Suspense>
      ) : (
        <InputSection title="固定引用">
          <dl className="reference-list">
            <div>
              <dt>型号</dt>
              <dd>
                {text(reference.name) || document.cable_types[0]?.label || "—"}
              </dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>
                <Tooltip content={text(reference.version)}>
                  <span tabIndex={0}>
                    {versionLabel(text(reference.version))}
                  </span>
                </Tooltip>
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{text(reference.source) || "未提供引用说明"}</dd>
            </div>
            <div>
              <dt>输入状态</dt>
              <dd>{historical ? "固定快照" : "已保存型号版本"}</dd>
            </div>
          </dl>
        </InputSection>
      )}
    </div>
  );
}
export function ConditionsInputs({ document, historical }: InputProps) {
  if (!document) return <EmptyState description="" title="尚无工况领域输入" />;
  return (
    <div className="input-module">
      {historical && <StaleBanner description="固定运行工况 · 只读" />}
      <StudyCrossingInputs historical={historical} placement="active" />
      {document.load_cases.map((load) => (
        <InputSection key={load.id} title={entityLabel(document, load.id)}>
          <div className="input-form-grid">
            {Object.keys(load.currents || {}).map((entity) => (
              <DomainNumber
                key={entity}
                document={document}
                scope="conditions"
                readOnly={historical}
                spec={{
                  path: pointer("load_cases", load.id, "currents", entity),
                  label: entityLabel(document, entity) + " · 电流",
                  unit: "A",
                  precision: 1,
                  min: 0,
                  required: true,
                }}
              />
            ))}
            {load.duration !== null && load.duration !== undefined && (
              <DomainNumber
                document={document}
                scope="conditions"
                readOnly={historical}
                spec={{
                  path: pointer("load_cases", load.id, "duration"),
                  label: "持续时间",
                  unit: "s",
                  precision: 1,
                  ...positive,
                }}
              />
            )}
            {load.period !== null && load.period !== undefined && (
              <DomainNumber
                document={document}
                scope="conditions"
                readOnly={historical}
                spec={{
                  path: pointer("load_cases", load.id, "period"),
                  label: "周期",
                  unit: "s",
                  precision: 1,
                  ...positive,
                }}
              />
            )}
          </div>
          {Object.keys(load.profile || {}).length > 0 && (
            <DataTable
              label="保存负荷时间序列"
              columns={[
                { id: "entity", label: "对象", render: (row) => row.label },
                {
                  id: "time",
                  label: "时刻",
                  unit: "s",
                  numeric: true,
                  render: (row) => formatNumber(row.time, 1),
                },
                {
                  id: "value",
                  label: "负荷值",
                  numeric: true,
                  render: (row) => formatNumber(row.value, 2),
                },
                {
                  id: "scale",
                  label: "尺度",
                  render: (row) =>
                    row.scale === "absolute" ? "电流 / A" : "标幺",
                },
              ]}
              groups={[
                {
                  id: load.id,
                  label: "时间序列",
                  rows: Object.entries(load.profile || {}).flatMap(
                    ([entity, series]) =>
                      series.time.map((time, index) => ({
                        id: entity + "/" + index,
                        label: entityLabel(document, entity),
                        time,
                        value: series.value[index],
                        scale: series.scale,
                      })),
                  ),
                },
              ]}
              rowLabel={(row) => row.label + " " + row.time}
              showGroups={false}
            />
          )}
        </InputSection>
      ))}
      <InputSection title="供电系统">
        <div className="input-form-grid">
          {document.circuits.map(circuit => <DomainNumber key={circuit.id}
            document={document} scope="conditions" readOnly={historical}
            spec={{path:pointer('circuits',circuit.id,'system','voltage'),
              label:entityLabel(document,circuit.id)+' · 系统线电压',
              unit:'kV',scale:0.001,precision:1,min:0,minExclusive:true}} />)}
        </div>
      </InputSection>
      {document.sections.map((section) => (
        <InputSection key={section.id} title={section.label + " · 环境"}>
          <div className="input-form-grid">
            {section.kind === "ground" &&
              (section.medium.surface_temperature == null ||
                typeof section.medium.surface_temperature !== "object") && (
                <DomainNumber
                  document={document}
                  scope="conditions"
                  readOnly={historical}
                  spec={{
                    path: pointer(
                      "sections",
                      section.id,
                      "medium",
                      "surface_temperature",
                    ),
                    label: "地表温度",
                    unit: "°C",
                    offset: -273.15,
                    precision: 1,
                    min: -273.15,
                    minExclusive: true,
                  }}
                />
              )}
            {section.kind !== "ground" &&
              (section.medium.air_temperature == null ||
                typeof section.medium.air_temperature !== "object") && (
                <DomainNumber
                  document={document}
                  scope="conditions"
                  readOnly={historical}
                  spec={{
                    path: pointer(
                      "sections",
                      section.id,
                      "medium",
                      "air_temperature",
                    ),
                    label: "空气温度",
                    unit: "°C",
                    offset: -273.15,
                    precision: 1,
                    min: -273.15,
                    minExclusive: true,
                  }}
                />
              )}
            {section.medium.material && (
              <DomainNumber
                document={document}
                scope="conditions"
                readOnly={historical}
                spec={{
                  path: pointer(
                    "materials",
                    section.medium.material,
                    "thermal_resistivity",
                  ),
                  label: "介质热阻率",
                  unit: "K·m/W",
                  precision: 3,
                  min: 0,
                  minExclusive: true,
                }}
              />
            )}
            {section.kind !== "ground" && (
              <>
                <DomainNumber
                  document={document}
                  scope="conditions"
                  readOnly={historical}
                  spec={{
                    path: pointer(
                      "sections",
                      section.id,
                      "medium",
                      "wind_speed",
                    ),
                    label: "风速",
                    unit: "m/s",
                    precision: 2,
                    min: 0,
                  }}
                />
                <DomainNumber
                  document={document}
                  scope="conditions"
                  readOnly={historical}
                  spec={{
                    path: pointer(
                      "sections",
                      section.id,
                      "medium",
                      "solar_irradiance",
                    ),
                    label: "太阳辐照度",
                    unit: "W/m²",
                    precision: 1,
                    min: 0,
                  }}
                />
              </>
            )}
          </div>
        </InputSection>
      ))}
      {numeric(document.criteria?.max_conductor_temperature) !== null && (
        <InputSection title="设计准则">
          <div className="input-form-grid">
            <DomainNumber
              document={document}
              scope="conditions"
              readOnly={historical}
              spec={{
                path: pointer("criteria", "max_conductor_temperature"),
                label: "导体温限",
                unit: "°C",
                offset: -273.15,
                precision: 1,
                min: -273.15,
                minExclusive: true,
                required: true,
              }}
            />
          </div>
        </InputSection>
      )}
      <StudyCrossingInputs historical={historical} placement="optional" />
    </div>
  );
}
export function SectionInputs({
  tab,
  document,
  historical,
  onSelect,
}: InputProps) {
  if (!document) return <EmptyState description="" title="尚无敷设截面输入" />;
  const coordinates: InputRow[] = document.sections.flatMap((section) => [
    ...section.placements.map((item) => ({
      id: section.id + "/" + item.cable,
      label: entityLabel(document, item.cable),
      material: undefined,
      fields: [
        {
          path: pointer("sections", section.id, "placements", item.cable, "x"),
          label: "x 坐标",
          unit: "m",
          precision: 3,
          required: true,
        },
        {
          path: pointer("sections", section.id, "placements", item.cable, "z"),
          label: "z 坐标",
          unit: "m",
          precision: 3,
          required: true,
        },
      ],
    })),
    ...(section.enclosures || []).map((item) => ({
      id: item.id,
      label: "围护 " + item.type,
      material: item.material || undefined,
      fields: [
        {
          path: pointer("sections", section.id, "enclosures", item.id, "x"),
          label: "x 坐标",
          unit: "m",
          precision: 3,
          required: true,
        },
        {
          path: pointer("sections", section.id, "enclosures", item.id, "z"),
          label: "z 坐标",
          unit: "m",
          precision: 3,
          required: true,
        },
        ...(item.inner_diameter === null || item.inner_diameter === undefined
          ? []
          : [
              {
                path: pointer(
                  "sections",
                  section.id,
                  "enclosures",
                  item.id,
                  "inner_diameter",
                ),
                label: "内径",
                unit: "mm",
                scale: 1000,
                precision: 1,
                ...positive,
              },
            ]),
        ...(item.outer_diameter === null || item.outer_diameter === undefined
          ? []
          : [
              {
                path: pointer(
                  "sections",
                  section.id,
                  "enclosures",
                  item.id,
                  "outer_diameter",
                ),
                label: "外径",
                unit: "mm",
                scale: 1000,
                precision: 1,
                ...positive,
              },
            ]),
      ],
    })),
  ]);
  const materials: InputRow[] = document.materials
    .filter((material) =>
      ["soil", "backfill", "concrete", "duct", "fluid"].includes(
        material.category,
      ),
    )
    .map((material) => ({
      id: material.id,
      label: material.label,
      material: material.id,
      fields: [
        {
          path: pointer("materials", material.id, "thermal_resistivity"),
          label: "热阻率",
          unit: "K·m/W",
          precision: 3,
          min: 0,
          minExclusive: true,
        },
        {
          path: pointer("materials", material.id, "volumetric_heat_capacity"),
          label: "体积热容",
          unit: "J/(m³·K)",
          precision: 0,
          min: 0,
          minExclusive: true,
        },
      ],
    }));
  return (
    <div className="input-module">
      {historical && <StaleBanner description="固定运行敷设输入 · 只读" />}
      {tab === "coordinates" ? (
        <InputTable
          label="敷设坐标与尺寸"
          rows={coordinates}
          document={document}
          scope="section"
          historical={historical}
          onSelect={onSelect}
        />
      ) : tab === "media" ? (
        <InputTable
          label="介质参数"
          rows={materials}
          document={document}
          scope="section"
          historical={historical}
          onSelect={onSelect}
        />
      ) : (
        <>
          <Toolbar>
            <h2>{tab === "three-dimensional" ? "三维敷设" : "敷设截面"}</h2>
            <div className="spacer" />
            <span className="muted">坐标 / m · z 向上</span>
          </Toolbar>
          <StudyDrawing
            document={document}
            historical={historical}
            kind={tab === "three-dimensional" ? "scene" : "section"}
            onSelect={onSelect}
          />
        </>
      )}
    </div>
  );
}
export { readableCableVersion as versionLabel } from './study-workbench-config';
function layerName(role: string) {
  return (
    (
      {
        conductor_screen: "导体屏蔽",
        insulation: "绝缘",
        insulation_screen: "绝缘屏蔽",
        metallic_screen: "金属屏蔽",
        metallic_sheath: "金属护套",
        bedding: "内衬",
        separator: "隔离层",
        filler: "填充",
        binder: "包带",
        armour: "铠装",
        oversheath: "外护套",
      } as Record<string, string>
    )[role] || role
  );
}
