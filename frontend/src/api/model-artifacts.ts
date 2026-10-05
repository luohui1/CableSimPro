import { api, array, record, optionalRecord, text, responseData, ApiError } from './client';
import type { components } from './generated/schema';

export type MethodModel = {
  id: string; name: string; version: string; family: string; availability: string;
  method: components['schemas']['Method']; parameters: Record<string, unknown>;
  input: components['schemas']['DomainDocument']; domain: Record<string, unknown>;
  validation: Record<string, unknown>; dataset: Record<string, unknown>; raw: Record<string, unknown>;
};
export async function modelArtifacts(signal?: AbortSignal): Promise<MethodModel[]> {
  const values = array(await responseData(api.GET('/api/model-artifacts', { signal })), '训练模型');
  return values.map(value => {
    const row = record(value, '模型版本'); const method = record(row.runtime_method || row.method, '模型方法');
    if (!/^[0-9a-f]{64}$/.test(text(row.model_sha256)) || !text(method.plugin_id) || !text(method.capability))
      throw new ApiError(502, '模型目录缺少准确版本身份');
    return { id: text(row.model_sha256), name: text(row.name), version: text(row.model_version),
      family: text(row.family), availability: text(row.availability), method: method as components['schemas']['Method'],
      parameters: record(row.parameters, '模型输入配置'), input: record(row.domain_template, '研究结构') as components['schemas']['DomainDocument'],
      domain: optionalRecord(row.domain), validation: optionalRecord(row.validation), dataset: optionalRecord(row.dataset), raw: row };
  });
}
