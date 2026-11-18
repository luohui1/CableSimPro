// Inspect the actual accepted T4 PDF, including the full frozen source model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function formalFileCount(repo: string, database: string, workspace: string): number {
  const output = execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
    "import sqlite3,sys; db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); exists=db.execute(\"SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_external_files'\").fetchone(); print(db.execute('SELECT COUNT(*) FROM agent_external_files WHERE workspace=?',(sys.argv[2],)).fetchone()[0] if exists else 0); db.close()",
    database, workspace], { cwd: repo, encoding: 'utf8' });
  return Number(output.trim());
}

export async function assertFormalPdf(response: Response, kind: 'calculation' | 'specification',
  metadata: { organization: string; number: string; revision: string }) {
  assert.ok(response.ok, 'the accepted formal PDF must be downloadable');
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/pdf');
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(createHash('sha256').update(pdf).digest('hex'), response.headers.get('x-artifact-sha256'));
  const inspection = JSON.parse(execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
    "import fitz,json,sys; pdf=fitz.open(stream=sys.stdin.buffer.read(),filetype='pdf'); print(json.dumps({'pages':[page.get_text() for page in pdf],'model':json.loads(pdf.embfile_get('formal-model.json'))},ensure_ascii=False))"],
  { input: pdf, encoding: 'utf8', timeout: 30_000, maxBuffer: 16_777_216 }));
  const model = inspection.model;
  assert.equal(model.kind, kind);
  for (const key of ['organization', 'number', 'revision'] as const) assert.equal(model.metadata[key], metadata[key]);
  assert.equal(model.model_digest, response.headers.get('x-delivery-model-sha256'));
  assert.equal(model.source_digest, response.headers.get('x-delivery-source-sha256'));
  const pages = inspection.pages as string[];
  const text = pages.join('\n').replaceAll(/\s/g, '');
  for (const label of ['编制与审核签栏', '设计', '校核', '审核', '批准', '追溯记录', metadata.organization, metadata.number])
    assert.ok(text.includes(label.replaceAll(/\s/g, '')), 'formal PDF contains ' + label);
  assert.ok(pages.length >= 3 && pages.slice(2).some(page => page.includes('追溯记录')),
    'the trace is rendered on its own later page, not merely claimed in a file card');
  assert.equal(model.signatures.length, 4);
  assert.ok(model.signatures.every((signature: any) => !signature.name && !signature.date),
    'accepting these test exports must not invent a design/check/review/approval signature');
  return { model, pages, pdf };
}
