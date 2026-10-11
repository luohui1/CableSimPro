import { useQuery } from '@tanstack/react-query';
import { ApiError, record } from '@/api/client';
import type { HpcProfile } from './solver-location';

async function readProfile(signal?: AbortSignal): Promise<HpcProfile> {
  // 此只读接口尚无生成类型；校验安全投影，错误不得转成未配置。
  const response = await fetch('/api/hpc/profile', { signal, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status, '超算配置读取失败');
  const data = record(await response.json(), '超算配置');
  if (typeof data.configured !== 'boolean' || !['configured', 'not_configured', 'invalid'].includes(String(data.status))
    || !Array.isArray(data.remote_plugins) || !data.remote_plugins.every(id => typeof id === 'string')
    || !data.remote_capabilities || typeof data.remote_capabilities !== 'object' || Array.isArray(data.remote_capabilities)
    || !Object.values(data.remote_capabilities).every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string')))
    throw new ApiError(502, '超算配置响应不完整，请重新读取');
  return data as HpcProfile;
}
export const useHpcProfile = (enabled = true) => useQuery({ queryKey: ['hpc-profile'], queryFn: ({ signal }) => readProfile(signal), enabled, retry: false });
