import { api, array, record, responseData, text, ApiError } from "./client";
import type { components } from "./generated/schema";
export type CatalogRow = Record<string, unknown> & { id: string };
export type CatalogPage = Record<string, unknown> & { items: CatalogRow[] };
export async function assetCatalog(
  filters: {
    q: string;
    kind?: components["schemas"]["AssetRelease"]["kind"];
    status?: "draft" | "reviewed" | "published" | "deprecated";
    offset: number;
  },
  signal?: AbortSignal,
) {
  const value = record(
    await responseData(
      api.GET("/api/foundation/assets", {
        params: { query: { ...filters, limit: 50 } },
        signal,
      }),
    ),
    "资源库",
  );
  const items = array(value.items, "资源").map((value) => {
    const row = record(value, "资源");
    if (!text(row.id)) throw new ApiError(502, "资源缺少身份");
    return { ...row, id: text(row.id) };
  });
  return { ...value, items } as CatalogPage;
}
export async function assetDetail(rid: string, signal?: AbortSignal) {
  return record(
    await responseData(
      api.GET("/api/foundation/assets/{rid}", {
        params: { path: { rid } },
        signal,
      }),
    ),
    "资源详情",
  );
}
export async function importAsset(
  release: components["schemas"]["AssetRelease"],
) {
  return record(
    await responseData(
      api.POST("/api/foundation/assets/import", {
        body: { schema_version: "csp-asset/0.1", release },
      }),
    ),
    "导入的资源草稿",
  );
}
export async function reproductions(snapshot: string, signal?: AbortSignal) {
  const value = record(
    await responseData(
      api.GET("/api/foundation/reproductions", {
        params: { query: { ...(snapshot ? { snapshot } : {}) } },
        signal,
      }),
    ),
    "复现目录",
  );
  return {
    ...value,
    items: array(value.items, "复现目标").map((value) => {
      const row = record(value, "复现目标");
      if (!text(row.id)) throw new ApiError(502, "复现目标缺少身份");
      return { ...row, id: text(row.id) };
    }),
  } as CatalogPage;
}
export async function reproductionDetail(
  target_id: string,
  snapshot: string,
  signal?: AbortSignal,
) {
  const value = record(
    await responseData(
      api.GET("/api/foundation/reproductions/{target_id}", {
        params: {
          path: { target_id },
          query: { ...(snapshot ? { snapshot } : {}) },
        },
        signal,
      }),
    ),
    "复现详情",
  );
  if (value.id !== target_id) throw new ApiError(409, "复现记录身份不一致");
  return value;
}
