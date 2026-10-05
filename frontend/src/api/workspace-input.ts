import { api, record, responseData, numeric, ApiError } from "./client";
import type { DomainDocument } from "@/lib/domain-fields";
import type { components } from "./generated/schema";

export async function saveDomain(
  wid: string,
  revision: number,
  document: DomainDocument,
) {
  const body: components["schemas"]["SaveDomain"] = {
    expected_revision: revision,
    document,
  };
  return record(
    await responseData(
      api.PUT("/api/workspaces/{wid}/domain", {
        params: { path: { wid } },
        body,
      }),
    ),
    "保存领域输入",
  );
}
export async function undoDomain(
  wid: string,
  workspace: Record<string, unknown>,
  direction:"undo"|"redo"="undo",
) {
  const revision = numeric(workspace.revision);
  if (revision === null) throw new ApiError(502, "工程修订未提供");
  if (workspace[direction==="undo"?"can_undo":"can_redo"] !== true)
    throw new ApiError(409, direction==="undo"?"没有可撤销的已保存工程版本":"没有可重做的已保存工程版本");
  return record(
    await responseData(
      api.POST("/api/workspaces/{wid}/history/{direction}", {
        params: { path: { wid, direction } },
        body: { expected_revision: revision },
      }),
    ),
    "撤销工程输入",
  );
}
