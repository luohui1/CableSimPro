// What the agent is and is not allowed to do, checked by using it: its tools, what it can read, what it is told, the operations
// only a person may run, and how a conversation behaves when it is stopped, steered or reopened after a restart.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { type App, createApp } from '../host/server.ts';
import type { ProjectView, SeriesSummary } from '../shared/types.ts';
import { lastText, next, scriptedModel, steps, toolResult, toolText } from './support.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['ampacity-rating', 'cable-import-check', 'cable-revision', 'spec-and-report', 'cable-3d-model'];
const home = mkdtempSync(join(tmpdir(), 'cable-studio-agent-'));
const homes = [home];
let faux: Awaited<ReturnType<typeof scriptedModel>>['faux'];
let runtime: Awaited<ReturnType<typeof scriptedModel>>['runtime'];
let app: App;

before(async () => {
  ({ faux, runtime } = await scriptedModel());
  app = createApp({ home, runtime });
});

after(async () => {
  await app.close();
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
});

const project = async (name: string, model_id: string) => (await app.studio.invoke('project.create', { name, model_id }, { by: 'human' }) as ProjectView).meta.id;

test('the agent has the studio\'s operations and a skill reader, and is told nothing about the repository', async () => {
  faux.setResponses([fauxAssistantMessage([fauxText('你好。')])]);
  const { session } = await app.agent.send(undefined, '你好');
  await app.agent.idle(session);
  const seen = app.agent.inspect(session);
  const offered = app.studio.agentOperations().map(operation => operation.tool!);
  assert.deepEqual([...seen.tools].sort(), [...offered, 'read'].sort(), 'no built-in tool, nothing but the studio\'s operations and the skill reader');
  for (const refused of ['library.review', 'library.review.series', 'library.review.batch']) {
    assert.ok(!app.studio.agentOperations().some(operation => operation.id === refused), `${refused} is not a tool`);
  }
  for (const name of SKILLS) assert.ok(seen.prompt.includes(name), `the skill catalogue lists ${name}`);
  for (const leak of ['CableSimPro', '开发约定', 'AGENTS.md', 'CLAUDE.md', '仓库卫生', REPO.replace(/\\/g, '/')]) {
    assert.ok(!seen.prompt.includes(leak), `the prompt does not carry "${leak}"`);
  }
  assert.ok(seen.prompt.includes('数字') && seen.prompt.includes('审阅'));
});

test('the reader opens a skill and refuses every other file', async () => {
  faux.setResponses([fauxAssistantMessage([fauxText('在。')])]);
  const { session } = await app.agent.send(undefined, '先打个招呼');
  await app.agent.idle(session);
  const location = /<location>(.+?)<\/location>/.exec(app.agent.inspect(session).prompt.split('<name>ampacity-rating</name>')[1])![1];
  let skill = '';
  let refusal = '';
  let byName = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('read', { path: location })], { stopReason: 'toolUse' }),
    context => { skill = toolText(context); return fauxAssistantMessage([fauxToolCall('read', { path: join(REPO, 'AGENTS.md') })], { stopReason: 'toolUse' }); },
    context => { refusal = toolText(context); return fauxAssistantMessage([fauxToolCall('read', { path: 'cable-revision' })], { stopReason: 'toolUse' }); },
    context => { byName = toolText(context); return fauxAssistantMessage([fauxText('读完了。')]); },
  ]);
  await app.agent.send(session, '校核载流量前先读技能');
  await app.agent.idle(session);
  assert.ok(skill.includes('载流量校核与选型') && skill.includes('必须停下来问人'));
  assert.ok(refusal.includes('只能读取技能文件') && !refusal.includes('开发约定'));
  assert.ok(byName.includes('型号改版'));
  const view = await app.agent.view(session);
  assert.deepEqual(steps(view).map(step => [step.label, step.target, step.status]),
    [['读取技能', '技能「载流量校核与选型」', 'done'], ['读取技能', undefined, 'failed'], ['读取技能', '技能「型号改版」', 'done']]);
});

test('review, approval and issue are refused for the agent before anything else is looked at', async () => {
  for (const id of ['library.review', 'library.review.series', 'library.review.batch']) {
    await assert.rejects(app.studio.invoke(id, { nonsense: true }, { by: 'agent' }), { code: 'REVIEW_FORBIDDEN', status: 403 });
    await assert.rejects(app.studio.invoke(id, {}, { by: 'human' }), { code: 'INPUT_INVALID' }, 'a person is held to the parameters, not turned away');
  }
  // The model tries anyway, by the operation's own name and by one it makes up; neither is a tool.
  const answers: string[] = [];
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('library.review', { spec: 'x', version: 1, action: 'approve' })], { stopReason: 'toolUse' }),
    context => { answers.push(toolText(context)); return fauxAssistantMessage([fauxToolCall('approve_spec', { spec: 'x' })], { stopReason: 'toolUse' }); },
    context => { answers.push(toolText(context)); return fauxAssistantMessage([fauxText('审核只能由人来做。')]); },
  ]);
  const { session } = await app.agent.send(undefined, '把这个规格审核通过并发布');
  await app.agent.idle(session);
  assert.equal(answers.length, 2);
  assert.ok(answers.every(text => /not found|没有工具|Tool/i.test(text)), answers.join(' | '));
  assert.deepEqual(steps(await app.agent.view(session)).map(step => step.status), ['failed', 'failed']);
});

test('the agent imports the public sample, checks it against the standard and lists what fails; the import waits for review', async () => {
  const before_ = (await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).length;
  let upload = '';
  let sheet = '';
  let ready = 0;
  let series = '';
  let counts: Record<string, number> = {};
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('load_public_sample', {})], { stopReason: 'toolUse' }),
    context => {
      const sample = toolResult(context);
      upload = sample.upload;
      sheet = sample.sheets[0].sheet;
      return fauxAssistantMessage([fauxToolCall('preview_import', { upload, sheet })], { stopReason: 'toolUse' });
    },
    context => { ready = toolResult(context).ready; return fauxAssistantMessage([fauxToolCall('import_series', { upload, sheet })], { stopReason: 'toolUse' }); },
    context => { series = toolResult(context).series; return fauxAssistantMessage([fauxToolCall('compute_series', { series, kinds: ['check'] })], { stopReason: 'toolUse' }); },
    context => {
      assert.equal(toolResult(context).state, 'done', 'the agent is told about a finished batch, not one that has only started');
      return fauxAssistantMessage([fauxToolCall('list_check_failures', { series })], { stopReason: 'toolUse' });
    },
    context => { counts = toolResult(context).counts; return fauxAssistantMessage([fauxText('已导入并核对。')]); },
  ]);
  const proposed = next(app, 'proposal', event => event.proposal.status === 'pending');
  const { session } = await app.agent.send(undefined, '导入公开结构表示例，算参数并按国标核对，列出不通过项');
  const proposal = (await proposed).proposal;

  assert.equal(proposal.operation, 'library.import.commit');
  assert.deepEqual(proposal.changes.slice(0, 2).map(change => [change.label, change.before]), [['新系列', '—'], ['规格数', '—']]);
  assert.equal(proposal.changes[1].after, `${ready} 个`);
  assert.equal((await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).length, before_, 'nothing is imported while the review waits');

  app.agent.decide(proposal.id, true);
  await app.agent.idle(session);
  const view = await app.agent.view(session);
  assert.deepEqual(steps(view).map(step => [step.tool, step.status]), [['load_public_sample', 'done'], ['preview_import', 'done'], ['import_series', 'done'],
    ['compute_series', 'done'], ['list_check_failures', 'done']]);
  assert.deepEqual(steps(view).at(-1)!.card, { kind: 'check', series, href: `/library/${series}` });
  const imported = (await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).find(item => item.id === series)!;
  assert.equal(imported.specs, ready);
  assert.equal(counts.passed + counts.failed + counts.missing + counts.uncovered > 0, true, 'every spec has a check result');
  const listed = await app.studio.invoke('library.check.failures', { series }, { by: 'human' }) as { checked: number; specs: number };
  assert.equal(listed.checked, listed.specs, 'the check ran for every spec of the series');
  assert.equal(lastText(view), '已导入并核对。');
});

test('stopping the agent while a change waits settles it at once and leaves the inputs alone', async () => {
  const id = await project('停止测试', 'system.cu-xlpe-al-400');
  faux.setResponses([fauxAssistantMessage([fauxToolCall('rename_project', { project: id, name: '不该出现的名字' })], { stopReason: 'toolUse' })]);
  const proposed = next(app, 'proposal', event => event.proposal.status === 'pending');
  const { session } = await app.agent.send(undefined, '把工程改个名');
  const proposal = (await proposed).proposal;
  assert.deepEqual(proposal.changes.map(change => [change.label, change.before, change.after]), [['工程名称', '停止测试', '不该出现的名字']]);

  const started = Date.now();
  await app.agent.stop(session);
  await app.agent.idle(session);
  assert.ok(Date.now() - started < 5000, 'a stop does not wait for a person');
  const view = await app.agent.view(session);
  assert.equal(view.running, false);
  assert.equal(view.waiting.length, 0);
  assert.equal(app.studio.store.meta(id).name, '停止测试');
  assert.ok(['rejected', 'interrupted'].includes(steps(view)[0].status), steps(view)[0].status);
});

test('a message sent while the agent waits for a decision reaches it after the decision', async () => {
  const id = await project('插话测试', 'system.cu-xlpe-al-400');
  let heard = false;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('rename_project', { project: id, name: '插话后的名字' })], { stopReason: 'toolUse' }),
    context => { heard = JSON.stringify(context.messages).includes('顺便说一句：别动埋深'); return fauxAssistantMessage([fauxText('明白，不动埋深。')]); },
  ]);
  const proposed = next(app, 'proposal', event => event.proposal.status === 'pending');
  const { session } = await app.agent.send(undefined, '改个名');
  const proposal = (await proposed).proposal;
  const reply = await app.agent.send(session, '顺便说一句：别动埋深');
  assert.equal(reply.accepted, 'steered');
  assert.equal((await app.agent.view(session)).items.at(-1)!.queued, true, 'the page shows it waiting');
  app.agent.decide(proposal.id, true);
  await app.agent.idle(session);
  assert.ok(heard);
  assert.equal(app.studio.store.meta(id).name, '插话后的名字');
  const view = await app.agent.view(session);
  assert.ok(view.items.every(item => !item.queued));
  assert.ok(view.items.some(item => item.role === 'user' && item.parts[0].type === 'text' && item.parts[0].text === '顺便说一句：别动埋深'));
});

test('a conversation survives a restart: it is listed, its unfinished step is shown as cut off, and it can go on', async () => {
  const own = mkdtempSync(join(tmpdir(), 'cable-studio-restart-'));
  homes.push(own);
  const first = createApp({ home: own, runtime });
  const id = (await first.studio.invoke('project.create', { name: '重启测试', model_id: 'system.cu-xlpe-al-400' }, { by: 'human' }) as ProjectView).meta.id;
  faux.setResponses([fauxAssistantMessage([fauxToolCall('rename_project', { project: id, name: '重启后不该出现' })], { stopReason: 'toolUse' })]);
  const proposed = next(first, 'proposal', event => event.proposal.status === 'pending');
  const { session } = await first.agent.send(undefined, '改名后我要关机');
  await proposed;
  // What a crash leaves behind: the conversation's folder as it is while the change is still waiting.
  const snapshot = mkdtempSync(join(tmpdir(), 'cable-studio-snapshot-'));
  homes.push(snapshot);
  cpSync(join(own, 'agent'), snapshot, { recursive: true });
  await first.close();
  rmSync(join(own, 'agent'), { recursive: true, force: true });
  cpSync(snapshot, join(own, 'agent'), { recursive: true });

  const second = createApp({ home: own, runtime });
  try {
    const row = (await second.agent.list()).find(item => item.id === session)!;
    assert.equal(row.title, '改名后我要关机');
    const view = await second.agent.view(session);
    assert.equal(view.running, false);
    assert.deepEqual(steps(view).map(step => step.status), ['interrupted']);
    assert.equal(second.studio.store.meta(id).name, '重启测试');
    faux.setResponses([fauxAssistantMessage([fauxText('我接着上次的事说。')])]);
    await second.agent.send(session, '接着说');
    await second.agent.idle(session);
    assert.equal(lastText(await second.agent.view(session)), '我接着上次的事说。');
  } finally {
    await second.close();
  }
});
