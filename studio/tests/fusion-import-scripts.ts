// A real manufacturer workbook and the model's four approved steps. File bytes are user input; every saved identity and result
// comes back from the ordinary platform. The same script drives Node integration and the actual browser conversation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { plainText, splitAttachments } from '../host/chat-view.ts';
import { scriptedModel, toolText } from './support.ts';
import type { FlowState } from './fusion-scripts.ts';

type Faux = Awaited<ReturnType<typeof scriptedModel>>['faux'];
type Reply = (context: TranscriptContext) => ReturnType<typeof fauxAssistantMessage>;
export interface ImportFlowState extends FlowState {
  attachment?: Record<string, any>;
  upload?: Record<string, any>;
  preview?: Record<string, any>;
  imported?: Record<string, any>;
  checked?: Record<string, any>;
}

export function manufacturerWorkbook(repo: string): { filename: string; content_base64: string; buffer: Buffer } {
  const buffer = execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
    "from backend.kernel.public_catalogues import sample_bytes; import sys; sys.stdout.buffer.write(sample_bytes('people-mv'))"],
  { cwd: repo, env: { ...process.env, PYTHONPATH: repo, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 1_048_576 });
  assert.ok(buffer.length > 0 && buffer.length <= 1_048_576, 'use the real bounded source workbook');
  return { filename: '人民电器公开结构表.xlsx', content_base64: buffer.toString('base64'), buffer };
}

/** Observe the isolated platform's actual tables while the next write is still pending. No private or developer database is used. */
export function importInventory(repo: string, database: string): Record<string, number> {
  const output = execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
    "import json,sqlite3,sys; db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); names=('type_table_uploads','type_table_previews','type_series','type_series_specs','domain_cable_models','study_runs'); print(json.dumps({name:db.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in names})); db.close()",
    database], { cwd: repo, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  return JSON.parse(output);
}

const call = (name: string, args: Record<string, any>) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
const text = (value: string) => fauxAssistantMessage([fauxText(value)]);
const data = (context: TranscriptContext): Record<string, any> => {
  assert.equal(context.messages.at(-1)?.role, 'toolResult');
  assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, false, toolText(context));
  return JSON.parse(toolText(context)).data ?? {};
};
const receipt = (context: TranscriptContext): Record<string, any> => {
  const value = data(context).receipt;
  assert.ok(value && value.status !== 'failed' && !value.error, 'the next step needs a saved successful receipt');
  return value;
};
function advance(faux: Faux, state: ImportFlowState, next: Reply, tool: string, args: Record<string, unknown>) {
  faux.setResponses([context => {
    try { return next(context); }
    catch (error) {
      state.failure = error instanceof Error ? error.message : String(error);
      return text('导入流程未完成，请核对保存的拒绝原因；没有生成替代结果。');
    }
  }]);
  return call(tool, args);
}

export function installStructureImport(faux: Faux, input: { workspace: string; seriesName: string }): ImportFlowState {
  const state: ImportFlowState = { done: false };
  let attachmentId = '';
  const finish: Reply = context => {
    const saved = data(context);
    assert.ok(saved && state.typeId, 'the imported type can be read in its own adopted scope');
    const completed = state.checked!.items.filter((item: any) => item.status === 'succeeded' || item.status === 'completed').length;
    state.done = true;
    return text(`已将原表保存为 ${state.imported!.created} 个型号草稿，并对这批规格运行标准核对；${completed} 项运行完成。\n原表来源、列映射和固定预览摘要随记录保留。缺项、未覆盖项目与不符合项见核对记录；没有审核或发布型号。`);
  };
  const afterCheck: Reply = context => {
    state.checked = receipt(context);
    assert.equal(state.checked.kind, 'structure_check');
    assert.equal(state.checked.items.length, 11, 'the model must receive all eleven check summaries, not a silently truncated item list');
    assert.ok(state.checked.items.every((item: any) => item.workspace_id && item.run_id && item.input_digest && item.output_digest),
      'every reported completed check must name its actual ordinary saved run');
    return advance(faux, state, finish, 'type_read', { type_id: state.typeId, view: 'input', limit: 20 });
  };
  const afterImport: Reply = context => {
    state.imported = receipt(context);
    assert.equal(state.imported.kind, 'structure_import');
    assert.equal(state.imported.created, 11);
    assert.equal(state.imported.state, 'draft');
    assert.equal(state.imported.preview_digest, state.preview!.preview_digest);
    assert.equal(state.imported.specs.length, 11, 'the next check proposal must reference all eleven actually imported specifications');
    state.typeId = state.imported.specs[0].workspace_id;
    return advance(faux, state, afterCheck, 'propose_structure_check', { workspace_id: input.workspace,
      series_id: state.imported.series_id, spec_ids: state.imported.specs.map((spec: any) => spec.id) });
  };
  const afterReadPreview: Reply = context => {
    assert.equal(data(context).page.value, 11, 'the saved preview count must be read back');
    return advance(faux, state, afterImport, 'propose_structure_import', { workspace_id: input.workspace,
      preview_id: state.preview!.preview_id, preview_digest: state.preview!.preview_digest, skip_errors: false });
  };
  const afterPreview: Reply = context => {
    state.preview = receipt(context);
    assert.equal(state.preview.kind, 'structure_preview');
    assert.equal(state.preview.valid_count, 11);
    assert.equal(state.preview.error_count, 0);
    assert.equal(state.preview.incomplete_count, 0);
    assert.equal(state.preview.sha256, state.upload!.sha256);
    assert.equal(state.preview.row_count, 11, 'the model receives the row count; complete rows belong to the review/result card');
    return advance(faux, state, afterReadPreview, 'structure_import_read', { workspace_id: input.workspace,
      kind: 'preview', id: state.preview.preview_id, view: '/valid_count', limit: 20 });
  };
  const afterDeclaration: Reply = context => {
    const saved = data(context);
    assert.equal(saved.resource.kind, 'upload');
    assert.equal(saved.resource.upload_id, state.upload!.upload_id);
    assert.equal(saved.resource.sha256, state.upload!.sha256, 'read the declaration from the same accepted original workbook');
    assert.match(saved.source.response_digest, /^[0-9a-f]{64}$/);
    const declaration = saved.page.value;
    assert.equal(declaration?.table, 'three-core');
    assert.ok(declaration.mapping && declaration.series, 'read the complete actual declaration before preparing the preview');
    const { table: _table, ...request } = structuredClone(declaration);
    request.series.name = input.seriesName;
    return advance(faux, state, afterPreview, 'propose_structure_preview', { workspace_id: input.workspace,
      upload_id: state.upload!.upload_id, sha256: state.upload!.sha256, request });
  };
  const afterUpload: Reply = context => {
    state.upload = receipt(context);
    assert.equal(state.upload.kind, 'structure_upload');
    assert.equal(state.upload.sha256, state.attachment!.sha256);
    const declaration = state.upload.declarations?.find((item: any) => item.table === 'three-core');
    assert.ok(declaration, 'only the actual source digest can provide this sample declaration');
    assert.equal(declaration.next_read?.tool, 'structure_import_read');
    const args = declaration.next_read.arguments;
    assert.equal(args.workspace_id, input.workspace);
    assert.equal(args.kind, 'upload');
    assert.equal(args.id, state.upload.upload_id);
    assert.match(args.view, /^\/declarations\/\d+$/);
    return advance(faux, state, afterDeclaration, declaration.next_read.tool, args);
  };
  const afterAttachment: Reply = context => {
    state.attachment = data(context).page.value;
    assert.match(state.attachment!.sha256, /^[0-9a-f]{64}$/);
    return advance(faux, state, afterUpload, 'propose_structure_upload', { workspace_id: input.workspace,
      attachment_id: attachmentId, expected_sha256: state.attachment!.sha256 });
  };
  faux.setResponses([context => {
    const user = context.messages.findLast(message => message.role === 'user');
    assert.ok(user, 'there is a real user message');
    const attachments = splitAttachments(plainText(user as any)).attachments;
    assert.equal(attachments.length, 1, 'use the actual user attachment, never a filename as file content');
    attachmentId = attachments[0].upload;
    return advance(faux, state, () => advance(faux, state, context => {
      assert.equal(data(context).available, true);
      return advance(faux, state, afterAttachment, 'structure_import_read', { workspace_id: input.workspace,
        kind: 'attachment', id: attachmentId, limit: 20 });
    }, 'structure_import_inspect', { filename: attachments[0].file }), 'read', { path: 'cable-import-check' });
  }]);
  return state;
}

/** An erroneous model cannot turn a bare filename or invented identity into an uploaded source. */
export function installMissingStructureSource(faux: Faux, workspace: string): ImportFlowState {
  const state: ImportFlowState = { done: false };
  faux.setResponses([() => advance(faux, state, context => {
    const last = context.messages.at(-1) as { isError?: boolean };
    assert.equal(last.isError, true);
    assert.match(toolText(context), /附件|原件|会话/);
    state.done = true;
    state.refused = true;
    return text('只有文件名，没有这段对话实际附上的结构表，不能导入或核对。\n请使用输入框的“附上结构表”选择原始 CSV 或 XLSX；拿到原件后再逐步提出保存、预览、入库和核对提案。');
  }, 'propose_structure_upload', { workspace_id: workspace, attachment_id: randomUUID(), expected_sha256: '0'.repeat(64) })]);
  return state;
}
