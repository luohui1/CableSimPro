type ObjectValue = Record<string, unknown>;
export type SavedTypeRunDestination = {
  module: 'standard-check' | 'electrical' | 'short-circuit' | 'rating-table' | 'structure';
  tab: 'results' | 'quantities';
};
export type SavedRunIdentity = { workspaceId: string; studyId: string; runId: string };

const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/**
 * Resolve an exact saved run, never a current study or installed method. The
 * caller retains its loading/pending branch until the selected run is ready.
 * A null result is an ordinary research run; invalid/unsupported saved type
 * evidence throws so it cannot fall through to an unrelated ampacity view.
 */
export function savedTypeRunDestination(run: unknown, expected: SavedRunIdentity, allowWorkspaceAlias = false): SavedTypeRunDestination | null {
  const { workspaceId, studyId, runId } = expected;
  if (![workspaceId, studyId, runId].every(nonempty) || !object(run)
    || run.id !== runId || run.workspace !== workspaceId || run.study !== studyId)
    throw new Error('保存运行与地址中的工程、研究或运行身份不一致。');
  if (run.integrity !== 'verified')
    throw new Error('保存运行尚未通过完整性校验，不能确定其结果入口。');
  const snapshot = run.snapshot;
  if (!object(snapshot) || (snapshot.workspace_id !== workspaceId
    && !(allowWorkspaceAlias && !Object.hasOwn(snapshot, 'workspace_id') && snapshot.workspace === workspaceId)) || snapshot.study_id !== studyId
    || snapshot.workspace !== undefined && snapshot.workspace !== workspaceId
    || snapshot.study !== undefined && snapshot.study !== studyId
    || !revision(snapshot.workspace_revision) || !revision(snapshot.study_revision))
    throw new Error('保存运行的输入快照缺少一致的工程、研究或修订身份。');
  const definition = snapshot.definition;
  if (!object(definition) || !object(definition.method))
    throw new Error('保存运行未记录完整的方法配置，不能以当前配置替代。');
  const pin = definition.method;
  if (!nonempty(pin.plugin_id) || !nonempty(pin.capability) || !nonempty(pin.version) || !digest(pin.release_digest))
    throw new Error('保存运行缺少精确的方法发行或能力，不能以当前方法替代。');
  const driver = object(definition.driver) ? definition.driver : {};
  const cases = Array.isArray(driver.cases) ? driver.cases : [];
  const ratingCase = (value: unknown) => object(value) && object(value.metadata) && value.metadata.kind === 'type-rating-table';
  const rating = driver.kind === 'batch' && cases.length > 0 && cases.every(ratingCase);
  const typeCandidate = ['cablesim.standard-check', 'cablesim.type-electrical', 'cablesim.cable-geometry'].includes(pin.plugin_id)
    || cases.some(ratingCase);
  const state = snapshot.workspace_state;
  if (!object(state)) {
    // The field endpoint deliberately omits unrelated workspace state for an
    // independent research input. Accept only its exact bound archive receipt;
    // an arbitrary missing state or a projected type archive is not research.
    const ref = run.evidence_ref;
    const archive = `/api/workspaces/${encodeURIComponent(workspaceId)}/studies/${encodeURIComponent(studyId)}/runs/${encodeURIComponent(runId)}?view=full`;
    if (state === undefined && snapshot.workspace_state_ref === undefined && run.snapshot_view === 'field-display'
      && definition.input_source === 'study' && !typeCandidate && object(ref) && ref.url === archive
      && digest(run.input_digest) && digest(run.output_digest)
      && ref.input_sha256 === run.input_digest && ref.output_sha256 === run.output_digest) return null;
    throw new Error('保存运行缺少原工程状态，不能按当前工程猜测结果入口。');
  }
  if (state.type_origin_reference != null && !object(state.type_origin_reference)
    || state.type_creation != null && !object(state.type_creation))
    throw new Error('保存运行的型号来源身份不完整，不能确定结果入口。');
  const typeOrigin = object(state.type_origin_reference) || object(state.type_creation);
  const studyReference = state.study_cable_reference !== undefined && state.study_cable_reference !== null;
  if (!typeOrigin) return null;
  if (studyReference || !object(state.domain) || !Array.isArray(state.domain.cable_types) || state.domain.cable_types.length !== 1)
    throw new Error('保存运行的型号与研究身份矛盾，或缺少独立的单型号输入。');

  if (rating && pin.plugin_id === 'cablesim.iec60287' && pin.capability === 'steady-rating')
    return { module: 'rating-table', tab: 'results' };
  if (driver.kind === 'single') {
    if (pin.plugin_id === 'cablesim.standard-check' && pin.capability === 'dimensions')
      return { module: 'standard-check', tab: 'results' };
    if (pin.plugin_id === 'cablesim.type-electrical' && (pin.capability === 'electrical' || pin.capability === 'short-circuit'))
      return { module: pin.capability, tab: 'results' };
    if (pin.plugin_id === 'cablesim.cable-geometry' && pin.capability === 'concentric-model')
      return { module: 'structure', tab: 'quantities' };
  }
  throw new Error('此保存型号运行的方法尚无对应的只读结果入口；未以当前配置或载流量结果替代。');
}
