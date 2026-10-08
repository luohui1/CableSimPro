import { array, optionalRecord, record, text } from '@/api/client';
import { savedThermal } from './saved-thermal';
import type { DomainDocument } from '../drawing/types';
import type { CadThermal } from './types';

/** Adapt the host's verified ephemeral artifact; never claim a preview is a saved run. */
export function previewThermal(response: Record<string, unknown>, document: DomainDocument, sectionId: string): CadThermal {
  if (response.preview !== true || response.persisted !== false || response.engineering_approval !== false) throw Error('回调未返回未保存、未批准的试算结果。');
  if (response.status !== 'succeeded') {
    const error = array(response.cases).map(optionalRecord).map(c => optionalRecord(c.error)).find(e => e.message);
    throw Error(text(error?.message) || '试算失败或超出插件适用范围；草稿保留，请检查输入。');
  }
  const cases = array(response.cases).map(optionalRecord);
  if (cases.length !== 1 || cases[0].case_id !== 'preview' || cases[0].status !== 'succeeded') throw Error('试算工况身份不完整。');
  if (!/^[a-f0-9]{64}$/.test(text(response.input_digest)) || !text(response.execution_id)) throw Error('试算缺少输入摘要或执行来源。');
  const status = optionalRecord(optionalRecord(response.artifact_status).preview)['x-cablesim.temperature-field'];
  if (optionalRecord(status).status !== 'verified') throw Error(text(optionalRecord(status).reason) || '试算没有通过宿主校验的土壤温度场；未着色。');
  const method = record(response.method, '试算方法');
  if (!text(method.plugin_id) || !text(method.version) || !text(method.release_digest)) throw Error('试算方法版本或封签来源缺失。');
  const wrapper = { id: response.execution_id, kind: 'preview', integrity: 'verified', status: response.status, output: { cases }, artifact_status: response.artifact_status,
    snapshot: { definition: { method }, workspace_state: { domain: document }, cases: [{ case_id: 'preview', input: document, parameters: { section_id: sectionId } }] } };
  const thermal = savedThermal(wrapper, document, sectionId, 'preview');
  if (!thermal?.triangles.length || !thermal.conductors.length) throw Error('试算未覆盖土壤场或导体温度；未以保存值替代。');
  return { ...thermal, provisional: true, runLabel: '未保存试算', notice: '未保存 · 未批准', source: `试算输入 ${response.input_digest} · ${thermal.source}` };
}
