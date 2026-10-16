/** Synthetic display-contract fixtures ONLY. Never imported by the production application. */
export const SHA = 'a'.repeat(64), BUNDLE = 'b'.repeat(64);
export function makeNetwork() {
  const radii = [8, 8.8, 14, 14.8, 15.5, 17];
  const names = ['导体', '导体屏蔽', 'XLPE 绝缘', '绝缘屏蔽', '金属屏蔽（等效层）', '外护套'];
  const state = current => ({ current_a: current, total_losses_w_m: [24, 26, 25], radial_profiles: ['A', 'B', 'C'].map((phase, i) => ({ phase, points: radii.map((radius_mm, j) => ({ radius_mm, layer: names[j], temperature_c: [62, 61, 52, 51, 50, 42][j] + i * 2 })) })) });
  return { model_version: 'MV-THERMAL-0.1.0', input_sha256: SHA,
    input: { cable: { max_temperature_c: 90 }, installation: { ambient_temperature_c: 20 } },
    geometry: { layers: radii.map((radius_mm, i) => ({ name: names[i], radius_mm })), positions_m: [[-.08, .8], [0, .8], [.08, .8]] },
    thermal: { layer_resistances_k_m_w: [.02, .25, .02, .001, .04], soil_matrix_k_m_w: [[.7, .24, .16], [.24, .7, .24], [.16, .24, .7]] },
    operating: state(320), rating: state(430), warnings: ['合成界面测试数据，不是物理求解或工程结果。'] };
}
export function makeHistory() {
  return { schema_version: 'cablesim.temperature-history/1', temperature_unit: 'K', time_unit: 's', source: { bundle_sha256: BUNDLE }, curves: [
    { entity: 'phase:A', time_s: [0, 25, 125, 500], maximum_temperature_k: [293.15, 310.15, 325.15, 320.15], limit_status: 'not_reached' },
    { entity: 'phase:B', time_s: [0, 70, 500], maximum_temperature_k: [293.15, 305.15, 314.15], limit_status: 'not_reached' },
  ] };
}
export function makeField() {
  return { schema_version: 'cablesim.temperature-field/1', association: 'node', temperature_unit: 'K', source: { bundle_sha256: BUNDLE },
    mesh: { length_unit: 'm', coordinates: 'section-x-z; z-up', points: [[-.2, -.95], [.2, -.95], [.2, -.6], [-.2, -.6], [0, -.8]], triangles: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] }, temperature_k: [293.15, 295.15, 298.15, 293.15, 328.15] };
}
export function makeRun() {
  const artifacts = { 'x-cablesim.thermal-network-rating': makeNetwork(), 'x-cablesim.temperature-history': makeHistory(), 'x-cablesim.temperature-field': makeField() };
  const makeCase = case_id => ({ case_id, status: 'succeeded', artifacts: structuredClone(artifacts), artifact_digests: { ...Object.fromEntries(Object.keys(artifacts).map(key => [key, SHA])), 'x-cablesim.simulation-bundle': BUNDLE } });
  return { id: 'synthetic-visual-test', integrity: 'verified', freshness: 'current', output: { cases: [makeCase('display-a'), makeCase('display-b')] }, artifact_status: Object.fromEntries(['display-a', 'display-b'].map(id => [id, Object.fromEntries(Object.keys(artifacts).map(key => [key, { status: 'verified' }]))])) };
}
