import { api, record, responseData } from "./client";
export async function compareRuns(wid: string, run_ids: string[]) {
  return record(
    await responseData(
      api.POST("/api/workspaces/{wid}/study-comparisons", {
        params: { path: { wid } },
        body: { run_ids },
      }),
    ),
    "运行对比",
  );
}
