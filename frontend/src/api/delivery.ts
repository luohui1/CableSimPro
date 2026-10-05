import { api, record, responseData, requireEndpoint, ApiError } from "./client";
import type { components } from "./generated/schema";
export type DeliverySummary = components["schemas"]["DeliverySummary"];
export type ReportAudience = "customer" | "internal";
// The sandboxed preview delegates downloads to the toolbar. Stored/exported HTML stays untouched.
export function deliveryPreview(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const link of document.querySelectorAll("a[data-report-pdf]")) link.remove();
  return document.documentElement.outerHTML;
}
export function deliveryPdf(book: Record<string, unknown>, audience: ReportAudience): Blob {
  if (typeof book.html !== "string") throw new ApiError(502, "交付缺少保存的正文");
  const document = new DOMParser().parseFromString(book.html, "text/html");
  const links = document.querySelectorAll(`a[data-report-pdf="${audience}"]`);
  if (links.length !== 1) throw new ApiError(422, `此存档未提供${audience === "customer" ? "客户版" : "内部版"} PDF，可下载 HTML 存档`);
  const href = links[0].getAttribute("href") || "";
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(href);
  if (!match) throw new ApiError(409, "PDF 链接不是交付内保存的 PDF，拒绝下载");
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(match[1]), char => char.charCodeAt(0)); }
  catch { throw new ApiError(409, "保存的 PDF 编码无效"); }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new ApiError(409, "保存工件不是有效 PDF 文件");
  return new Blob([bytes], { type: "application/pdf" });
}
export async function deliveries(wid: string, signal?: AbortSignal): Promise<DeliverySummary[]> {
  return responseData(api.GET("/api/workspaces/{wid}/deliveries", { params: { path: { wid } }, signal }));
}

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
