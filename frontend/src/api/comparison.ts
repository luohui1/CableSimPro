import { api, ApiError, record, responseData } from "./client";
export async function compareRuns(wid: string, run_ids: string[], signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(60000);
  try {
    return record(
    await responseData(
      api.POST("/api/workspaces/{wid}/study-comparisons", {
        params: { path: { wid } },
        body: { run_ids },
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      }),
    ),
    "运行对比",
    );
  } catch (error) {
    if (deadline.aborted && !signal?.aborted) throw new ApiError(504, '保存运行对比超时，请重新读取。原有运行保持不变。');
    throw error;
  }
}
