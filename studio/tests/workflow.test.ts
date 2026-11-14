// Real use of the host: the engineer's flow over HTTP, and the agent doing the same
// things through the same operations with a scripted model.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { type App, createApp } from '../host/server.ts';
import type { Proposal, ProjectView, RunRecord, StudioEvent, Task } from '../shared/types.ts';

const home = mkdtempSync(join(tmpdir(), 'cable-studio-'));
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
let offline: App;
let staffed: App;
let base: string;

before(async () => {
  offline = createApp({ home, runtime: null });
  staffed = createApp({ home, runtime: { models, model: faux.getModel(), provider: 'scripted', thinking: 'off' } });
  await new Promise<void>(done => offline.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(offline.server.address() as AddressInfo).port}`;
});

after(async () => {
  await offline.close();
  await staffed.close();
  rmSync(home, { recursive: true, force: true });
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as T };
}

const op = async <T>(id: string, params: unknown) => {
  const reply = await post<T & { error?: { code: string; message: string; path?: string } }>(`/api/ops/${id}`, params);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return reply.body as T;
};

function next<E extends StudioEvent['type']>(app: App, type: E, match: (event: Extract<StudioEvent, { type: E }>) => boolean) {
  return new Promise<Extract<StudioEvent, { type: E }>>(done => {
    const listen = (event: StudioEvent) => {
      if (event.type === type && match(event as Extract<StudioEvent, { type: E }>)) {
        app.studio.events.off('event', listen);
        done(event as Extract<StudioEvent, { type: E }>);
      }
    };
    app.studio.events.on('event', listen);
  });
}

test('an engineer checks a 110 kV circuit, changes the laying and exports the sheet', async () => {
  const created = await op<ProjectView>('project.create', { name: '城南 110 kV 出线', model_id: 'system.yjq02-110kv-800' });
  const project = created.meta.id;
  assert.equal(created.preview?.tier.tier, 'deliverable');
  assert.equal(created.preview?.layout.kind, 'trefoil');
  assert.equal(created.runs.length, 0);

  await op('conditions.set', { project, soil_thermal_resistivity: 1.2, current_a: 600 });
  const first = await op<RunRecord>('run.rate', { project });
  assert.equal(first.status, 'succeeded');
  assert.equal(first.sequence, 1);
  assert.equal(first.by, 'human');
  // The host stores what the core computed: the same scene asked of the core gives the same number.
  const direct = await offline.studio.core.call<RunRecord>('study.rate', { scene: offline.studio.scene(created.meta.name, first.inputs) });
  assert.equal(first.summary!.ampacity!.value_a, direct.summary!.ampacity!.value_a);
  assert.ok(first.summary!.ampacity!.value_a > 600 && first.summary!.operating!.within_limit);
  assert.equal(first.method_card!.tier.label, '可交付');

  // Changing the laying makes the earlier record history, not the current answer.
  const flat = await op<{ view: ProjectView; changes: { label: string; before: string; after: string }[] }>('installation.set', { project, layout: 'flat' });
  assert.deepEqual(flat.changes.map(change => [change.label, change.before, change.after]), [['敷设方式', '直埋 · 品字形', '直埋 · 水平']]);
  assert.equal(flat.view.preview!.layout.spacing, .15, 'the template spacing is resolved and shown, not hidden');
  assert.notEqual(flat.view.inputs_sha256, first.inputs_sha256);
  const second = await op<RunRecord>('run.rate', { project });
  assert.ok(second.summary!.ampacity!.value_a < first.summary!.ampacity!.value_a, 'spaced flat formation with both-ends bonding carries less');
  assert.equal(second.summary!.ampacity!.limiting_cable, 'cable/c1-b');
  const saved = await (await fetch(`${base}/api/projects/${project}/runs/${first.id}`)).json() as RunRecord;
  assert.deepEqual(saved.summary, first.summary, 'a saved record is not touched by later runs');

  const exported = await op<{ path: string; url: string }>('report.export', { project, run: second.id });
  const sheet = readFileSync(exported.path, 'utf-8');
  assert.ok(sheet.includes(`允许电流 ${second.summary!.ampacity!.value_a.toFixed(1)} A`));
  assert.ok(sheet.includes('可交付') && sheet.includes('CIGRE TB 880') && sheet.includes(second.request_sha256));
  assert.equal((await fetch(base + exported.url)).headers.get('content-type'), 'text/html; charset=utf-8');

  // An input the method cannot take is refused with the field to fix; nothing is computed.
  const negative = await post<{ error: { code: string; path?: string } }>('/api/ops/installation.set', { project, depth_m: -1 });
  assert.equal(negative.status, 422);
  const ducts = await op<{ view: ProjectView }>('installation.set', { project, layout: 'ducts' });
  assert.equal(ducts.view.issue?.path, '/installation/duct/inner_diameter_m');
  const refused = await post<{ error: { code: string; path?: string } }>('/api/ops/run.rate', { project });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.path, '/installation/duct/inner_diameter_m');
  assert.equal((await (await fetch(`${base}/api/projects/${project}`)).json() as ProjectView).runs.length, 2);

  // Without a model the workbench works and the agent says so.
  const status = await (await fetch(`${base}/api/status`)).json() as { agent: { configured: boolean; hint: string } };
  assert.equal(status.agent.configured, false);
  const instruct = await post<{ error: { code: string } }>(`/api/projects/${project}/agent/instruct`, { instruction: '按 400 A 选型' });
  assert.equal(instruct.status, 409);
  assert.equal(instruct.body.error.code, 'MODEL_NOT_CONFIGURED');
});

test('the agent selects for 300 A through the same operations and its change waits for review', async () => {
  const { studio, agent } = staffed;
  const view = await studio.invoke('project.create', { name: '配电室进线', model_id: 'huayuan.yjv22-15kv-35' }, { by: 'human' }) as ProjectView;
  const project = view.meta.id;
  const toolResult = (context: TranscriptContext) => {
    const last = context.messages.at(-1)!;
    assert.equal(last.role, 'toolResult');
    return JSON.parse((last as { content: { text: string }[] }).content[0].text);
  };
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('get_project', {})], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('run_selection', { target_current_a: 300 })], { stopReason: 'toolUse' }),
    context => fauxAssistantMessage([fauxToolCall('set_cable', { model_id: toolResult(context).chosen })], { stopReason: 'toolUse' }),
    context => fauxAssistantMessage([fauxText(`已选定并换用，${toolResult(context).applied[0]}。`)]),
  ]);
  const proposed = next(staffed, 'proposal', event => event.proposal.status === 'pending');
  const task = agent.instruct(project, '按 300 A 选型');
  const proposal: Proposal = (await proposed).proposal;

  // While the change waits, nothing has been written.
  assert.equal(studio.store.parts(project).cable.id, 'huayuan.yjv22-15kv-35');
  assert.deepEqual(proposal.changes.map(change => [change.label, change.before]), [['型号', '华远 YJV22-8.7/15 kV 3×35']]);
  assert.equal(proposal.preview?.tier.tier, 'reference');
  const selection = studio.store.run(project, studio.store.runs(project)[0].id);
  assert.equal(selection.kind, 'selection');
  assert.equal(selection.by, 'agent');
  assert.equal(selection.task_id, task.id);
  const chosen = selection.selection!.candidates.find(row => row.model_id === selection.selection!.chosen)!;
  assert.ok(chosen.ampacity_a! >= 300 && proposal.changes[0].after === chosen.name);

  agent.decide(proposal.id, true);
  await agent.idle(project);
  const done: Task = agent.tasks(project)[0];
  assert.equal(done.status, 'done');
  assert.deepEqual(done.steps.map(step => [step.tool, step.status]), [['get_project', 'done'], ['run_selection', 'done'], ['set_cable', 'done']]);
  assert.equal(done.steps[1].run_id, selection.id);
  assert.equal(studio.store.parts(project).cable.id, chosen.model_id);
  assert.ok(done.reply!.includes(chosen.name));
});

test('a sweep needs no review, and a rejected change leaves the inputs as they were', async () => {
  const { studio, agent } = staffed;
  const view = await studio.invoke('project.create', { name: '土壤敏感性', model_id: 'system.cu-xlpe-al-400' }, { by: 'human' }) as ProjectView;
  const project = view.meta.id;
  let told = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('run_sweep', { variable: 'soil_thermal_resistivity', values: [1, 1.2, 1.4, 1.6, 1.8, 2] })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('set_conditions', { soil_thermal_resistivity: 2 })], { stopReason: 'toolUse' }),
    context => {
      const last = context.messages.at(-1) as { isError: boolean; content: { text: string }[] };
      told = last.content[0].text;
      assert.equal(last.isError, true);
      return fauxAssistantMessage([fauxText('扫描已完成；改土壤热阻率的提议被拒绝，输入保持不变。')]);
    },
  ]);
  const proposed = next(staffed, 'proposal', event => event.proposal.status === 'pending');
  agent.instruct(project, '土壤热阻率从 1.0 扫到 2.0，然后按最不利值校核');
  const proposal = (await proposed).proposal;
  const sweep = studio.store.run(project, studio.store.runs(project)[0].id);
  assert.equal(sweep.kind, 'sweep');
  const ratings = sweep.sweep!.points.map(point => point.ampacity_a!);
  assert.equal(ratings.length, 6);
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
  assert.deepEqual(proposal.changes, [{ part: 'conditions', field: 'soil_thermal_resistivity', label: '土壤热阻率', before: '1 K·m/W', after: '2 K·m/W' }]);

  agent.decide(proposal.id, false, '先不改，按现场实测值算');
  await agent.idle(project);
  assert.equal(studio.store.parts(project).conditions.soil_thermal_resistivity, 1);
  assert.ok(told.includes('拒绝') && told.includes('先不改，按现场实测值算'));
  const done = agent.tasks(project)[0];
  assert.deepEqual(done.steps.map(step => step.status), ['done', 'rejected']);
  assert.equal(done.status, 'done');
  assert.ok(existsSync(join(home, 'projects', project, 'runs', sweep.id, 'record.json')));
});

test('a draft answers right after a change and becomes a record only when it is kept', async () => {
  const project = (await op<ProjectView>('project.create', { name: '草算 110 kV 出线', model_id: 'system.yjq02-110kv-800' })).meta.id;
  const first = await op<RunRecord>('draft.rate', { project });
  assert.equal(first.id, 'draft');
  assert.equal(first.summary?.status, 'succeeded');
  assert.equal((await op<ProjectView>('project.get', { project })).runs.length, 0, 'a draft is not a run record');

  await op('installation.set', { project, depth_m: 1.5 });
  const deeper = await op<RunRecord>('draft.rate', { project });
  assert.equal(deeper.inputs.installation.depth_m, 1.5);
  assert.ok(deeper.summary!.ampacity!.value_a < first.summary!.ampacity!.value_a, 'the same cable buried deeper carries less');

  const kept = await op<RunRecord>('draft.keep', { project });
  assert.equal(kept.sequence, 1);
  assert.equal(kept.summary!.ampacity!.value_a, deeper.summary!.ampacity!.value_a, 'keeping writes the draft itself, not a new computation');
  assert.ok(existsSync(join(home, 'projects', project, 'runs', kept.id, 'record.json')));

  const again = await post<{ error: { code: string } }>('/api/ops/draft.keep', { project });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'DRAFT_MISSING');
});
