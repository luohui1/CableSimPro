import {
  api,
  array,
  record,
  responseData,
  requireEndpoint,
  ApiError,
} from "./client";
import type { components } from "./generated/schema";
export type InputContract = components["schemas"]["InputContract"];
type ContractSelector = Pick<components["schemas"]["Method"], "plugin_id" | "capability"> &
  Partial<Pick<components["schemas"]["Method"], "version" | "release_digest">>;
export async function inputContracts(
  signal?: AbortSignal,
  selector?: ContractSelector,
): Promise<InputContract[]> {
  const path = "/api/input-contracts";
  requireEndpoint(path, "get");
  return array(
    await responseData(api.GET(path, { signal, params: { query: selector } })),
    "方法输入契约",
  ).map((value) => record(value, "输入契约") as unknown as InputContract);
}
/** Read one installed capability, optionally pinned to a complete saved method identity. */
export function capabilityInputContracts(selector: ContractSelector, signal?: AbortSignal) {
  return inputContracts(signal, selector);
}
/** Shared cache keys keep method versions separate; prefix invalidation remains compatible. */
export function inputContractQuery(method: components["schemas"]["Method"]) {
  return {
    queryKey: ["input-contracts", method.plugin_id, method.capability, method.version, method.release_digest],
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      exactContract(await capabilityInputContracts(method, signal), method),
  };
}
export function exactContract(
  values: InputContract[],
  method: components["schemas"]["Method"],
) {
  const found = values.find(
    (value) =>
      value.method.plugin_id === method.plugin_id &&
      value.method.capability === method.capability &&
      value.method.version === method.version &&
      value.method.release_digest === method.release_digest,
  );
  if (!found)
    throw new ApiError(
      409,
      "当前方法版本没有匹配的输入契约，请明确选择已安装版本。",
    );
  return found;
}
