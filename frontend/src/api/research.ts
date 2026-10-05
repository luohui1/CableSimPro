import { displayName } from '@/lib/display-names';
import {
  api,
  array,
  record,
  optionalRecord,
  text,
  numeric,
  responseData,
  ApiError,
} from "./client";
import type { components } from "./generated/schema";

// These are UI projections, not handwritten HTTP response models. Raw replies are unknown because the host has not declared their schemas.
export type StudyDefinition = Omit<
  components["schemas"]["CreateStudy"],
  "expected_revision"
>;
export type StudyRow = {
  id: string;
  workspace: string;
  title: string;
  task: string;
  model: string;
  method: string;
  updated: string;
  revision: number;
  definition: StudyDefinition;
  raw: Record<string, unknown>;
};
export async function workspaces(signal?: AbortSignal) {
  return array(
    await responseData(api.GET("/api/workspaces", { signal })),
    "工程",
  ).map((value) => record(value, "工程"));
}
export async function studyIndex(signal?: AbortSignal): Promise<StudyRow[]> {
  const items = await workspaces(signal);
  const results = await Promise.all(
    items.map(async (workspace) => {
      const wid = text(workspace.id);
      if (!wid) throw new ApiError(502, "工程响应缺少身份");
      const studies = array(
        await responseData(
          api.GET("/api/workspaces/{wid}/studies", {
            params: { path: { wid } },
            signal,
          }),
        ),
        "研究",
      );
      if (!studies.length) return [];
      const state = record(
        await responseData(
          api.GET("/api/workspaces/{wid}", {
            params: { path: { wid } },
            signal,
          }),
        ),
        "工程快照",
      );
      const reference = optionalRecord(state.study_cable_reference);
      return studies.map((value) => projectStudy(value, state, reference));
    }),
  );
  return results.flat().sort((a, b) => b.updated.localeCompare(a.updated));
}
export function projectStudy(
  value: unknown,
  workspace: Record<string, unknown>,
  reference: Record<string, unknown> = {},
): StudyRow {
  const raw = record(value, "研究");
  const def = record(raw.definition, "研究定义");
  const method = record(def.method, "方法");
  const driver = record(def.driver, "任务");
  const id = text(raw.id),
    wid = text(raw.workspace),
    revision = numeric(raw.revision);
  if (
    !id ||
    !wid ||
    !text(def.title) ||
    revision === null ||
    !text(method.plugin_id) ||
    !text(method.capability)
  )
    throw new ApiError(502, "研究响应缺少名称、版本或方法身份");
  const definition = def as StudyDefinition;
  return {
    id,
    workspace: wid,
    revision,
    title: text(def.title),
    task:
      (
        {
          "transient-temperature": "暂态温升",
          "sheath-losses": "护套损耗",
          "electrothermal-steady": "电热耦合",
        } as Record<string, string>
      )[text(method.capability)] || (text(driver.kind) === "selection"
        ? "客户问询选型"
        : text(def.task) === "operating"
          ? "运行温度"
          : text(driver.kind) === "sweep"
            ? "参数扫描"
            : text(driver.kind) === "batch"
              ? "批量仿真"
              : optionalRecord(def.method_input).schema_version === "cablesim.simulation-problem/1" ? "仿真复现" : "额定载流量"),
    model:
      text(reference.name) ||
      text(
        optionalRecord(
          (
            optionalRecord(workspace.domain).cable_types as
              unknown[] | undefined
          )?.[0],
        ).label,
      ) ||
      "—",
    method: `${displayName(text(method.plugin_id))} ${text(method.version)}`,
    updated: text(workspace.updated_at) || text(raw.created),
    definition,
    raw,
  };
}
export async function modelVersions(signal?: AbortSignal) {
  return array(
    await responseData(api.GET("/api/design/study-cable-models", { signal })),
    "型号版本",
  ).map((value) => record(value, "型号版本"));
}
export async function methodCatalog(signal?: AbortSignal) {
  return array(
    await responseData(api.GET("/api/methods", { signal })),
    "方法",
  ).map((value) => record(value, "方法"));
}
export async function typeIndex(signal?: AbortSignal) {
  return array(
    await responseData(api.GET("/api/design/type-workspaces", { signal })),
    "型号",
  ).map((value) => record(value, "型号"));
}
export async function studyRuns(
  wid: string,
  sid: string,
  signal?: AbortSignal,
) {
  const items: Record<string, unknown>[] = [];
  let after = 0;
  for (let page = 0; page < 20; page++) {
    const data = record(
      await responseData(
        api.GET("/api/workspaces/{wid}/studies/{sid}/runs", {
          params: { path: { wid, sid }, query: { after, limit: 100 } },
          signal,
        }),
      ),
      "运行",
    );
    items.push(
      ...array(data.items, "运行").map((value) => record(value, "运行")),
    );
    const cursor = numeric(data.next_cursor);
    if (cursor === null) return items;
    if (cursor <= after) throw new ApiError(502, "运行分页游标无效");
    after = cursor;
  }
  throw new ApiError(502, "运行记录过多，请缩小查询范围");
}
export async function saveStudy(
  study: StudyRow,
  workspaceRevision: number,
  title: string,
  definition: StudyDefinition = study.definition,
) {
  const body: components["schemas"]["UpdateStudy"] = {
    ...definition,
    title,
    expected_revision: workspaceRevision,
    expected_study_revision: study.revision,
  };
  return responseData(
    api.PUT("/api/workspaces/{wid}/studies/{sid}", {
      params: { path: { wid: study.workspace, sid: study.id } },
      body,
    }),
  );
}
