import { api, record, responseData, requireEndpoint, ApiError } from "./client";

// These optional adapters share the generated DeliveryRequest/path parameters with the kernel API.
// The generated endpoint catalogue blocks them before any request until the formal host exposes them.
export async function createCurrentDelivery(
  wid: string,
  rid: string,
  requestId: string,
) {
  const path = "/api/workspaces/{wid}/deliveries/current";
  requireEndpoint(path, "post");
  return record(
    await responseData(
      api.POST(path, {
        params: { path: { wid } },
        body: { run_ids: [rid], request_id: requestId },
      }),
    ),
    "计算书",
  );
}
export async function delivery(wid: string, did: string) {
  return record(
    await responseData(
      api.GET("/api/workspaces/{wid}/deliveries/{did}", {
        params: { path: { wid, did } },
      }),
    ),
    "计算书",
  );
}
export async function deliveryFile(wid: string, did: string, digest: string) {
  const path = "/api/workspaces/{wid}/deliveries/{did}/file";
  requireEndpoint(path, "get");
  const reply = await api.GET(path, {
    params: { path: { wid, did } },
    parseAs: "blob",
  });
  const blob = await responseData(Promise.resolve(reply));
  if (reply.response.headers.get("X-Artifact-SHA256") !== digest)
    throw new ApiError(409, "下载工件与计算书摘要不一致，拒绝导出");
  if (!(blob instanceof Blob) || !blob.size)
    throw new ApiError(502, "计算书文件为空");
  return blob;
}
