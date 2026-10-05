import createClient from "openapi-fetch";
import { displayText } from '@/lib/display-names';
import type { paths } from "./generated/schema";
import { endpoints } from "./generated/endpoints";

export const api = createClient<paths>({
  baseUrl: "/",
  fetch: (request) =>
    fetch(request, { credentials: "same-origin", cache: "no-store" }),
});
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function record(
  value: unknown,
  label = "响应",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(502, `${label}格式不完整`);
  return value as Record<string, unknown>;
}
export function array(value: unknown, label = "响应"): unknown[] {
  if (!Array.isArray(value)) throw new ApiError(502, `${label}列表格式不完整`);
  return value;
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function message(error: unknown): string {
  return error instanceof Error ? displayText(error.message) : "请求失败，请重试读取。";
}
export function endpointAvailable(path: string, method: string): boolean {
  return (
    (endpoints as Record<string, readonly string[]>)[path] || []
  ).includes(method.toLowerCase());
}
export function requireEndpoint(path: string, method: string) {
  if (!endpointAvailable(path, method))
    throw new ApiError(501, `正式宿主尚未提供 ${method.toUpperCase()} ${path}`);
}
function errorMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((item) => {
        const row = optionalRecord(item);
        return `${Array.isArray(row.loc) ? row.loc.join(".") + "：" : ""}${text(row.msg)}`;
      })
      .filter(Boolean)
      .join("；");
  const row = optionalRecord(detail);
  return text(row.message) || text(row.code) || "接口未返回可用数据";
}
export async function responseData<T>(
  result: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const reply = await result;
  if (!reply.response.ok || reply.error !== undefined) {
    const detail = optionalRecord(reply.error).detail ?? reply.error;
    throw new ApiError(reply.response.status, errorMessage(detail), detail);
  }
  if (reply.data === undefined) throw new ApiError(502, "接口未返回数据");
  return reply.data;
}
