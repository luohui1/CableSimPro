import {
  api,
  array,
  record,
  responseData,
  text,
  numeric,
  ApiError,
} from "./client";
import type { components } from "./generated/schema";
export type SaveBatch = components["schemas"]["SaveConfiguration"];
export type SubmitBatch = components["schemas"]["SubmitDataset"];
export async function batchConfiguration(
  wid: string,
  sid: string,
  module?: string,
  signal?: AbortSignal,
) {
  const value = record(
    await responseData(
      api.GET("/api/workspaces/{wid}/studies/{sid}/batch-configuration", {
        params: {
          path: { wid, sid },
          query: module === undefined ? {} : { module },
        },
        signal,
      }),
    ),
    "批量配置",
  );
  if (
    !text(value.lock_digest) ||
    numeric(value.workspace_revision) === null ||
    numeric(value.study_revision) === null
  )
    throw new ApiError(502, "批量基准缺少固定身份");
  return value;
}
export async function saveBatch(wid: string, sid: string, body: SaveBatch) {
  return record(
    await responseData(
      api.PUT("/api/workspaces/{wid}/studies/{sid}/batch-configuration", {
        params: { path: { wid, sid } },
        body,
      }),
    ),
    "保存的批量配置",
  );
}
export async function batchPreflight(
  wid: string,
  sid: string,
  body: SubmitBatch,
) {
  return record(
    await responseData(
      api.POST("/api/workspaces/{wid}/studies/{sid}/batch-preflight", {
        params: { path: { wid, sid } },
        body,
      }),
    ),
    "批量预检",
  );
}
export async function submitBatch(wid: string, sid: string, body: SubmitBatch) {
  return record(
    await responseData(
      api.POST("/api/workspaces/{wid}/studies/{sid}/datasets", {
        params: { path: { wid, sid } },
        body,
      }),
    ),
    "数据集",
  );
}
export async function batchRuns(
  wid: string,
  sid: string,
  signal?: AbortSignal,
) {
  return array(
    await responseData(
      api.GET("/api/workspaces/{wid}/studies/{sid}/datasets", {
        params: { path: { wid, sid } },
        signal,
      }),
    ),
    "数据集记录",
  ).map((value) => {
    const row = record(value, "数据集");
    return { ...row, id: text(row.id) } as Record<string, unknown> & {
      id: string;
    };
  });
}
export async function batchDataset(
  wid: string,
  sid: string,
  batch_id: string,
  offset: number,
  status: string,
  signal?: AbortSignal,
) {
  const value = record(
    await responseData(
      api.GET("/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}", {
        params: {
          path: { wid, sid, batch_id },
          query: { offset, limit: 50, status },
        },
        signal,
      }),
    ),
    "数据集",
  );
  if (value.id !== batch_id) throw new ApiError(409, "数据集不属于当前引用");
  return value;
}
export async function resumeBatch(
  wid: string,
  sid: string,
  batch_id: string,
  request_id: string,
) {
  return record(
    await responseData(
      api.POST(
        "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/resume",
        {
          params: { path: { wid, sid, batch_id } },
          body: { request_id, retry_failed: false },
        },
      ),
    ),
    "恢复的数据集",
  );
}
export async function exportBatch(wid: string, sid: string, batch_id: string) {
  const reply = await api.POST(
    "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/export",
    { params: { path: { wid, sid, batch_id } }, parseAs: "blob" },
  );
  const blob = await responseData(Promise.resolve(reply));
  if (!(blob instanceof Blob) || !blob.size)
    throw new ApiError(502, "数据集导出文件为空");
  return blob;
}
