import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Backend } from '../fusion/backend.ts';
import { savedRatingTable } from '../fusion/rating-table.ts';

function fixture() {
  const resource = { kind: 'rating_table', workspace_id: 'type', study_id: 'study', run_id: 'run',
    integrity: 'verified', input_digest: 'saved-input', output_digest: 'saved-output', title: '保存的双工况表',
    method: { plugin_id: 'cablesim.iec60287', version: '1.2.0', capability: 'steady-rating' } };
  const result = { run: { id: 'run', workspace: 'type', study: 'study', integrity: 'verified',
    input_digest: 'saved-input', output_digest: 'saved-output', freshness: 'historical' }, rows: [
    { case_id: 'good', name: '明确的设计工况', value_a: 512.3456789 as number | null, status: '已计算', reason: null as string | null,
      condition: { depth_m: 0.8, soil_rho_k_m_w: 1.2, ambient_temperature_c: 25, rating_basis_name: '单回路能力' } },
    { case_id: 'missing', name: '缺数据工况', value_a: null as number | null, status: '待补数据', reason: '缺少已确认的导体电阻' as string | null,
      condition: { depth_m: 0.8, soil_rho_k_m_w: 1.2, ambient_temperature_c: 30, rating_basis_name: '单回路能力' } },
  ] };
  class SavedBackend extends Backend {
    read = async <T>(path: string): Promise<T> => {
      if (path === '/api/design/workspaces/type/rating-table-runs/run?view=rows') return result as T;
      if (path === '/api/methods?view=summary') return [{ method: { plugin_id: 'cablesim.iec60287', version: '9.9.9' }, name: 'IEC 60287 载流量' }] as T;
      throw new Error('Unexpected saved projection read: ' + path);
    };
  }
  const backend = new SavedBackend('http://127.0.0.1:9', 'unused');
  return { resource, result, show: () => savedRatingTable(backend, resource) };
}

test('the table retains saved row precision, historical method version and missing-data reasons', async () => {
  const { show } = fixture();
  const shown = await show();
  assert.equal(shown?.card.kind, 'saved_rating_table');
  if (shown?.card.kind !== 'saved_rating_table') return;
  assert.equal(shown.card.href, 'cablesim:type_rating/type?run=run');
  assert.equal(shown.card.view.method, 'IEC 60287 载流量 1.2.0');
  assert.equal(shown.card.view.freshness, 'historical');
  assert.equal(shown.card.view.total, 2);
  assert.equal(shown.card.view.rows[0].value_a, 512.3456789);
  assert.equal(shown.card.view.rows[1].value_a, null);
  assert.equal(shown.card.view.rows[1].reason, '缺少已确认的导体电阻');
});

for (const key of ['id', 'workspace', 'study', 'input_digest', 'output_digest', 'integrity'] as const) {
  test(`a table never borrows rows from a mismatched saved ${key}`, async () => {
    const f = fixture();
    f.result.run[key] = 'different';
    const shown = await f.show();
    assert.equal(shown?.card.kind, 'open');
    assert.match(shown!.notes.join(''), /不一致/);
  });
}

test('a numeric value with a refusal status cannot turn a failed row into a calculated result', async () => {
  const f = fixture();
  f.result.rows[1].value_a = 999;
  const shown = await f.show();
  assert.equal(shown?.card.kind, 'open');
  assert.match(shown!.notes.join(''), /未把缺项行当成成功/);
});

test('duplicate case identities cannot merge two different rows into one trustworthy result', async () => {
  const f = fixture();
  f.result.rows[1].case_id = 'good';
  const shown = await f.show();
  assert.equal(shown?.card.kind, 'open');
});
