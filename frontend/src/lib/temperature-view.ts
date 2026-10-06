import {
  array,
  record,
  optionalRecord,
  text,
  numeric,
  ApiError,
} from "@/api/client";
import type { DomainDocument } from "@/lib/domain-fields";
import {
  sectionGeometry,
  type SectionGeometry,
} from "@/features/drawing/section-geometry";
export type FieldPoint = [number, number];
export type FieldSample = {
  id: string;
  entity: string;
  point: FieldPoint;
  temperature: number;
  time: number;
  method: string;
};
export type TemperatureView = {
  points: FieldPoint[];
  triangles: [number, number, number][];
  temperatures: number[];
  samples: FieldSample[];
  minimum: number;
  maximum: number;
  hotspot: FieldSample;
  case: Record<string, unknown>;
  field: Record<string, unknown>;
  /** 有限元原始场束；IEC 解析土壤场没有场束，为空对象。 */
  bundle: Record<string, unknown>;
  /** fem：有限元求解的完整截面场；iec：IEC 60287 计算轨迹叠加 Kennelly 镜像得到的土壤场（电缆与排管内部不出值）。 */
  kind: "fem" | "iec";
  limitations: string[];
  section?: DomainDocument["sections"][number];
  geometry?: SectionGeometry;
  geometryError?: string;
};
export function temperatureView(
  run: Record<string, unknown>,
  preferredCase?: string,
): TemperatureView | undefined {
  if (run.integrity !== "verified")
    throw new ApiError(409, "运行完整性未通过，拒绝绘制温度场");
  const output = record(run.output, "温度场输出");
  const cases = array(output.cases, "工况").map((value) =>
    record(value, "工况"),
  );
  const reference = text(optionalRecord(run.convergence).reference_case_id);
  const chosen =
    cases.find(
      (value) =>
        (value.case_id === preferredCase || value.case_id === reference) &&
        optionalRecord(value.artifacts)["x-cablesim.temperature-field"],
    ) ||
    cases.find(
      (value) =>
        optionalRecord(value.artifacts)["x-cablesim.temperature-field"],
    );
  if (!chosen) return undefined;
  const status = optionalRecord(
    optionalRecord(run.artifact_status)[text(chosen.case_id)],
  )["x-cablesim.temperature-field"];
  if (optionalRecord(status).status !== "verified")
    throw new ApiError(
      409,
      text(optionalRecord(status).reason) || "宿主尚未校验该温度场工件",
    );
  const field = record(
    optionalRecord(chosen.artifacts)["x-cablesim.temperature-field"],
    "温度场工件",
  );
  if (
    field.schema_version !== "cablesim.temperature-field/1" ||
    field.association !== "node" ||
    field.temperature_unit !== "K"
  )
    throw new ApiError(502, "温度场契约、节点关联或单位不支持");
  const mesh = record(field.mesh, "温度场网格");
  if (mesh.length_unit !== "m" || mesh.coordinates !== "section-x-z; z-up")
    throw new ApiError(502, "温度场坐标或长度单位不支持");
  const points = array(mesh.points, "节点").map((value) => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some((coordinate) => numeric(coordinate) === null)
    )
      throw new ApiError(502, "网格节点坐标不完整");
    return value as FieldPoint;
  });
  const temperatures = array(field.temperature_k, "节点温度").map((value) => {
    const number = numeric(value);
    if (number === null || number <= 0)
      throw new ApiError(502, "节点温度必须为正 K");
    return number;
  });
  if (points.length !== temperatures.length || points.length < 3)
    throw new ApiError(502, "节点与温度没有一一对应");
  const triangles = array(mesh.triangles, "网格单元").map((value) => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      new Set(value).size !== 3 ||
      value.some(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= points.length,
      )
    )
      throw new ApiError(502, "网格单元索引无效");
    return value as [number, number, number];
  });
  let minimum = Infinity,
    maximum = -Infinity;
  for (const value of temperatures) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  function sample(value: unknown, id: string): FieldSample {
    const saved = record(value, "取样");
    const point = saved.point_m,
      temperature = numeric(saved.temperature_k),
      time = numeric(saved.time_s);
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      point.some((value) => numeric(value) === null) ||
      temperature === null ||
      time === null
    )
      throw new ApiError(502, "保存取样不完整");
    return {
      id,
      entity: text(saved.entity),
      point: point as FieldPoint,
      temperature,
      time,
      method: text(saved.method),
    };
  }
  const samples = array(field.samples, "保存取样").map((value, index) =>
    sample(value, String(index)),
  );
  const hotspot = sample(field.hotspot, "hotspot");
  if (hotspot.temperature !== maximum)
    throw new ApiError(502, "热点与保存节点场的最大值不一致");
  // 来源绑定：有限元场核对同工况原始场束；IEC 解析场核对同工况 IEC 计算轨迹，不要求场束
  const source = record(field.source, "工件来源"),
    digests = record(chosen.artifact_digests, "工件摘要");
  if (!digests["x-cablesim.temperature-field"])
    throw new ApiError(409, "温度场工件缺少摘要");
  const iec = source.binding === "iec-trace";
  if (iec) {
    if (!text(source.trace_sha256) || source.bundle_sha256 || source.trace_sha256 !== digests["x-cablesim.iec60287-trace"] || !field.analytical_soil_view)
      throw new ApiError(409, "土壤温度场未绑定同工况 IEC 计算轨迹");
  } else if (source.bundle_sha256 !== digests["x-cablesim.simulation-bundle"])
    throw new ApiError(409, "温度场未绑定同次原始场束");
  const bundle = iec ? {} : record(
    optionalRecord(chosen.artifacts)["x-cablesim.simulation-bundle"],
    "原始温度场束",
  );
  const limitations = iec
    ? array(optionalRecord(field.analytical_soil_view).limitations, "适用限制").map(text).filter(Boolean)
    : [];
  let section: DomainDocument["sections"][number] | undefined;
  let geometry: SectionGeometry | undefined;
  let geometryError: string | undefined;
  const snapshot = optionalRecord(run.snapshot);
  const savedCase = (Array.isArray(snapshot.cases) ? snapshot.cases : [])
    .map(optionalRecord)
    .find((value) => value.case_id === chosen.case_id);
  const input = optionalRecord(savedCase?.input);
  if (input.schema_version === "cablesim.domain/1") {
    const document = input as unknown as DomainDocument;
    const sectionId =
      text(optionalRecord(savedCase?.parameters).section_id) ||
      text(
        optionalRecord(optionalRecord(savedCase?.parameters).domain_options)
          .section_id,
      ) ||
      text(
        optionalRecord(
          optionalRecord(savedCase?.parameters).electromagnetic_options,
        ).section_id,
      );
    section =
      document.sections.find((value) => value.id === sectionId) ||
      (document.sections.length === 1 ? document.sections[0] : undefined);
    if (section)
      try {
        geometry = sectionGeometry(document, section);
      } catch (error) {
        geometryError =
          error instanceof Error ? error.message : "保存截面无法显示轮廓";
      }
    else geometryError = "固定输入没有明确的场图截面";
  } else geometryError = "该保存工件未提供可绘制的领域截面边界";
  return {
    points,
    triangles,
    temperatures,
    samples,
    minimum,
    maximum,
    hotspot,
    case: chosen,
    field,
    bundle,
    kind: iec ? "iec" : "fem",
    limitations,
    section,
    geometry,
    geometryError,
  };
}
