import { ApiError, optionalRecord, record, text } from '@/api/client';
import type { HpcProfile } from './solver-location';

export type HpcConnection = {
  ssh_alias: string | null;
  partition: string | null;
  remote_workdir: string | null;
  environment: { kind: 'python' | 'conda'; path: string } | null;
  budget_core_hours: number | null;
  total_budget_core_hours: number | null;
};
export type HpcConfiguration = HpcProfile & {
  editable: boolean; revision: string; undo_token: string | null;
  ssh_aliases: string[]; configuration: HpcConnection | null;
};
export type HpcUpdate = HpcConnection & { expected_revision: string };
export type ConnectionCheck = {
  reachable: boolean; partition_exists: boolean | null;
  directory_writable: boolean | null; environment_available: boolean | null;
  status: string; message: string;
};
export type HpcReceipt = HpcProfile & { revision: string; undo_token?: string | null };

async function request<T>(suffix: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/hpc/profile' + suffix, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) {
    const detail = optionalRecord(value).detail;
    throw new ApiError(response.status, typeof detail === 'string' ? detail : text(optionalRecord(detail).message) || '超算配置操作未完成，请重试。', detail);
  }
  return record(value, '超算配置') as T;
}
export const hpcConfiguration = (signal?: AbortSignal) => request<HpcConfiguration>('/configuration', 'GET', undefined, signal);
export const saveHpcConfiguration = (body: HpcUpdate) => request<HpcReceipt>('', 'PUT', body);
export const undoHpcConfiguration = (body: { undo_token: string; expected_revision: string }) => request<HpcReceipt>('/undo', 'POST', body);
export const checkHpcConnection = () => request<ConnectionCheck>('/check', 'POST');
