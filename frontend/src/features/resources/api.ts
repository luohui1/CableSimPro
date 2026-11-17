import { api, ApiError, array, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { assetCatalog } from '@/api/catalogs';
import type { components } from '@/api/generated/schema';
import { actionStates, type Asset, type AssetAction, type AssetRelease } from './definitions';

const timeout = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
export function readAsset(value: unknown): Asset {
  const row = record(value, '资源版本'), release = optionalRecord(row.release);
  if (!text(row.id) || !Number.isInteger(row.revision) || !/^[a-f0-9]{64}$/.test(text(row.content_sha256)) ||
      release.asset_id !== row.asset_id || release.version !== row.version || release.kind !== row.kind || !Array.isArray(release.sources))
    throw new ApiError(502, '资源版本缺少固定身份或完整定义，请重新读取。');
  return { ...row, release, issues: array(row.issues, '资源依赖检查').map(optionalRecord), events: array(row.events, '资源历史').map(optionalRecord) } as Asset;
}
export async function getAsset(id: string, signal?: AbortSignal) {
  const asset = readAsset(await responseData(api.GET('/api/foundation/assets/{rid}', { params: { path: { rid: id } }, signal: timeout(signal) })));
  if (asset.id !== id) throw new ApiError(502, '读取的资源身份与所选版本不一致。');
  return asset;
}
export async function saveAsset(release: AssetRelease, previous?: Asset) {
  const request = previous
    ? api.PUT('/api/foundation/assets/{rid}', { params: { path: { rid: previous.id } }, body: { expected_revision: previous.revision, release }, signal: timeout() })
    : api.POST('/api/foundation/assets/import', { body: { schema_version: 'csp-asset/0.1', release }, signal: timeout() });
  const asset = readAsset(await responseData(request));
  if (asset.asset_id !== release.asset_id || asset.version !== release.version || asset.kind !== release.kind || previous && asset.id !== previous.id)
    throw new ApiError(502, '保存响应的资源身份不一致，请核实原请求。');
  return asset;
}
export type TransitionRequest = components['schemas']['TransitionAsset'];
export async function transitionAsset(id: string, body: TransitionRequest) {
  const asset = readAsset(await responseData(api.POST('/api/foundation/assets/{rid}/transition', { params: { path: { rid: id } }, body, signal: timeout() })));
  if (asset.id !== id || asset.content_sha256 !== body.content_sha256 || asset.status !== actionStates[body.action].to || asset.revision !== body.expected_revision + 1)
    throw new ApiError(502, '操作响应的版本或状态不一致，请读取真实历史核实。');
  return asset;
}
export async function deriveAsset(asset: Asset, version: string) {
  const derived = readAsset(await responseData(api.POST('/api/foundation/assets/{rid}/derive', {
    params: { path: { rid: asset.id } }, body: { expected_revision: asset.revision, content_sha256: asset.content_sha256, new_version: version }, signal: timeout(),
  })));
  if (derived.asset_id !== asset.asset_id || derived.version !== version || derived.id === asset.id || derived.status !== 'draft')
    throw new ApiError(502, '派生响应与目标版本不一致，请核实原版本号。');
  return derived;
}
export async function findAssetVersion(assetId: string, version: string) {
  let offset = 0;
  do {
    const page = await assetCatalog({ q: assetId, offset }, timeout());
    const found = page.items.find(row => row.asset_id === assetId && row.version === version);
    if (found) return getAsset(found.id);
    offset += page.items.length;
    if (!page.items.length || offset >= (numeric(page.total) || 0)) return null;
  } while (true);
}
export const uncertainWrite = (problem: unknown) => !(problem instanceof ApiError) || problem.status >= 500;
export function transitionConfirmed(asset: Asset, request: TransitionRequest, action: AssetAction) {
  return asset.events.some(event => event.revision === request.expected_revision + 1 && event.action === action &&
    event.content_sha256 === request.content_sha256 && event.note === request.note.trim());
}
export function downloadAssetDefinitions(assets: Asset[]) {
  // One file avoids browser multi-download blocking. Each entry retains its own immutable version and digest.
  const body = {
    schema_version: 'cablesim.resource-export/1', items: assets.map(asset => ({ id: asset.id, asset_id: asset.asset_id,
      version: asset.version, revision: asset.revision,
      content_sha256: asset.content_sha256, status: asset.status, definition: { schema_version: 'csp-asset/0.1', release: asset.release } })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = assets.length === 1 ? `资源-${assets[0].version}.json` : `资源目录-${assets.length}项.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
