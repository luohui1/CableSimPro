// What the agent is and is not allowed to do, checked by using it: its tools, what it can read, what it is told, the operations
// only a person may run, and how a conversation behaves when it is stopped, steered or reopened after a restart.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { loadProjectContextFiles } from '@earendil-works/pi-coding-agent';
import { scrubPaths } from '../host/agent-tools.ts';
import { type App, createApp } from '../host/server.ts';
import type { ProjectView, SeriesSummary, SpecView, StudioEvent } from '../shared/types.ts';
import { lastText, next, scriptedModel, steps, toolResult, toolText } from './support.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['ampacity-rating', 'cable-import-check', 'cable-revision', 'spec-and-report', 'cable-3d-model'];
const home = mkdtempSync(join(tmpdir(), 'cable-studio-agent-'));
const homes = [home];
let faux: Awaited<ReturnType<typeof scriptedModel>>['faux'];
let runtime: Awaited<ReturnType<typeof scriptedModel>>['runtime'];
let app: App;
/** The series the import test brings in; later tests work on it. */
let imported = '';

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
  let sent = '';
  faux.setResponses([context => { sent = JSON.stringify(context); return fauxAssistantMessage([fauxText('你好。')]); }]);
  const { session } = await app.agent.send(undefined, '你好');
  await app.agent.idle(session);
  const seen = app.agent.inspect(session);
  const offered = app.studio.agentOperations().map(operation => operation.tool!);
  assert.deepEqual([...seen.tools].sort(), [...offered, 'read'].sort(), 'no built-in tool, nothing but the studio\'s operations and the skill reader');
  for (const refused of ['library.review', 'library.review.series', 'library.review.batch']) {
    assert.ok(!app.studio.agentOperations().some(operation => operation.id === refused), `${refused} is not a tool`);
  }
  for (const name of SKILLS) assert.ok(seen.prompt.includes(name), `the skill catalogue lists ${name}`);
  for (const leak of ['开发约定', 'AGENTS.md', 'CLAUDE.md', '仓库卫生']) {
    assert.ok(!seen.prompt.includes(leak), `the prompt does not carry "${leak}"`);
  }
  assert.ok(seen.prompt.includes('数字') && seen.prompt.includes('审阅'));

  // What the model is actually sent, not what the session layer says it holds: the skills by name, and no path of this machine in any spelling.
  // (The repository's name is checked here and not on the session layer's text: where the repository is checked out may carry it.)
  for (const leak of ['CableSimPro', '开发约定', 'AGENTS.md', 'CLAUDE.md', '仓库卫生']) {
    assert.ok(!sent.includes(leak), `the request does not carry "${leak}"`);
  }
  assert.ok(!sent.includes('<cwd>'), 'the working folder is left out');
  for (const name of SKILLS) assert.ok(sent.includes(`<name>${name}</name>`), `the request lists ${name}`);
  const spellings = (path: string) => {
    const backslashes = path.replace(/\//g, '\\');
    return [path.replace(/\\/g, '/'), backslashes, backslashes.replace(/\\/g, '\\\\')];
  };
  for (const path of [home, REPO, join(REPO, 'studio', 'skills')]) {
    for (const form of spellings(path)) assert.ok(!sent.includes(form), `the request does not carry ${form}`);
  }
  assert.ok(sent.includes('Call the read tool with the skill name.'));
  // Control: the session layer does hold where the skills are, so a request without it is the rewrite's doing and this check can fail.
  assert.ok(spellings(join(REPO, 'studio', 'skills')).some(form => JSON.stringify(seen.prompt).includes(form)), 'the control: pi itself lists where the skills are');
});

test('convention files in the folders above the studio\'s home never reach the model', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'cable-studio-context-'));
  homes.push(parent);
  const marker = '约定标记零九四七';
  for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(parent, name), `# 约定\n${marker}\n`);
  const own = join(parent, 'home');
  mkdirSync(own);
  const nested = createApp({ home: own, runtime });
  try {
    let sent = '';
    faux.setResponses([context => { sent = JSON.stringify(context); return fauxAssistantMessage([fauxText('好。')]); }]);
    const { session } = await nested.agent.send(undefined, '你好');
    await nested.agent.idle(session);
    assert.ok(sent.includes('<name>ampacity-rating</name>'), 'this is the request the model really got');
    assert.ok(!sent.includes(marker) && !nested.agent.inspect(session).prompt.includes(marker), 'the files above the home are not in what the model is given');
    // Control: the session layer's own discovery does find them from where the agent works, so their absence above is not for lack of looking.
    const found = loadProjectContextFiles({ cwd: join(own, 'agent', 'workspace'), agentDir: join(own, 'agent', 'pi') });
    assert.ok(found.some(file => file.content.includes(marker)), 'the control: discovery finds the marker');
  } finally {
    await nested.close();
  }
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

  // The same, where it can fail: given a tool name the approval would be offered like any other tool, and only the human-only mark keeps it out.
  const approval = app.studio.operations.get('library.review')!;
  approval.tool = 'approve_spec_for_real';
  try {
    assert.ok(!app.studio.agentOperations().some(operation => operation.tool === approval.tool), 'with a tool name and the mark, it is still not offered');
    let told = '';
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(approval.tool, { spec: 'x', version: 1, action: 'approve' })], { stopReason: 'toolUse' }),
      context => { told = toolText(context); return fauxAssistantMessage([fauxText('不行。')]); },
    ]);
    const again = await app.agent.send(undefined, '再试一次审核');
    await app.agent.idle(again.session);
    assert.ok(!app.agent.inspect(again.session).tools.includes(approval.tool), 'the tool is not on the model\'s list');
    assert.ok(/not found|没有工具|Tool/i.test(told), told);
    // Control: take the mark away and the very same operation is offered, so the checks above were looking at the mark.
    delete approval.human_only;
    assert.ok(app.studio.agentOperations().some(operation => operation.tool === approval.tool), 'the control: without the mark it would be offered');
  } finally {
    approval.human_only = true;
    delete approval.tool;
  }
  assert.ok(!app.studio.agentOperations().some(operation => operation.id === 'library.review'), 'the mark is back');
});

test('the agent imports the public sample, checks it against the standard and lists what fails; the import waits for review', { timeout: 180_000 }, async () => {
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
  // What a person decides on: the rows of the card are the declaration, not only the name and the count.
  const labels = proposal.changes.map(change => change.label);
  for (const label of ['芯数与电压', '执行标准', '厂家与资料性质', '列对应', '来源']) assert.ok(labels.includes(label), `the card lists ${label}: ${labels.join('、')}`);
  assert.ok(proposal.changes.find(change => change.label === '列对应')!.after.includes(' ← '), 'every column says which header it was read from');
  assert.equal((await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).length, before_, 'nothing is imported while the review waits');

  app.agent.decide(proposal.id, true);
  await app.agent.idle(session);
  const view = await app.agent.view(session);
  assert.deepEqual(steps(view).map(step => [step.tool, step.status]), [['load_public_sample', 'done'], ['preview_import', 'done'], ['import_series', 'done'],
    ['compute_series', 'done'], ['list_check_failures', 'done']]);
  assert.deepEqual(steps(view).at(-1)!.card, { kind: 'check', series, href: `/library/${series}` });
  imported = series;
  const created = (await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).find(item => item.id === series)!;
  assert.equal(created.specs, ready);
  assert.equal(counts.passed + counts.failed + counts.missing + counts.uncovered > 0, true, 'every spec has a check result');
  const listed = await app.studio.invoke('library.check.failures', { series }, { by: 'human' }) as { checked: number; specs: number };
  assert.equal(listed.checked, listed.specs, 'the check ran for every spec of the series');
  assert.equal(lastText(view), '已导入并核对。');
});

test('an import the library would refuse is refused before a person is asked to approve it', { timeout: 60_000 }, async () => {
  // The previous test imported the public sample's first sheet; the same sheet again is a series with the same name.
  let told = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('load_public_sample', {})], { stopReason: 'toolUse' }),
    context => { const sample = toolResult(context); return fauxAssistantMessage([fauxToolCall('import_series', { upload: sample.upload, sheet: sample.sheets[0].sheet })], { stopReason: 'toolUse' }); },
    context => { told = toolText(context); return fauxAssistantMessage([fauxText('这个系列已经在库里，不重复导入。')]); },
  ]);
  const { session } = await app.agent.send(undefined, '再导入一次公开结构表示例');
  await app.agent.idle(session);
  const view = await app.agent.view(session);
  assert.equal(view.waiting.length, 0, 'nobody was asked');
  assert.deepEqual(steps(view).map(step => step.status), ['done', 'failed']);
  assert.ok(told.includes('已有名为'), told);
});

test('a revision the library would refuse is refused before a person is asked; one that can be made shows old and new values', { timeout: 60_000 }, async () => {
  const table = await app.studio.invoke('library.series.get', { series: imported }, { by: 'human' }) as { specs: { id: string }[] };
  const spec = await app.studio.invoke('library.spec.get', { spec: table.specs[0].id }, { by: 'human' }) as SpecView;
  const field = spec.structure.find(item => item.origin === 'table' && item.key !== 'area')!;
  const bumped = Math.round((field.value + 0.1) * 1000) / 1000;
  const attempts: Record<string, string | number | Record<string, string | number>>[] = [
    { spec: spec.spec.id, values: { [field.key]: field.value }, note: '没有改' },
    { spec: spec.spec.id, version: 99, values: { [field.key]: bumped }, note: '版本不对' },
    { spec: spec.spec.id, values: { area: 5 }, note: '改截面' },
    { spec: 'huayuan.yjv22-15kv-240', values: { [field.key]: bumped }, note: '随软件的结构' },
    { spec: spec.spec.id, values: { [field.key]: bumped }, note: '  ' },
    { spec: spec.spec.id, values: { [field.key]: bumped }, note: '核对图纸后更正' },
  ];
  const answers: string[] = [];
  const call = (input: (typeof attempts)[number]) => fauxAssistantMessage([fauxToolCall('revise_spec', input)], { stopReason: 'toolUse' });
  faux.setResponses([
    call(attempts[0]),
    ...attempts.slice(1).map(input => (context: TranscriptContext) => { answers.push(toolText(context)); return call(input); }),
    context => { answers.push(toolText(context)); return fauxAssistantMessage([fauxText('改好了。')]); },
  ]);
  const asked: string[] = [];
  const listen = (event: StudioEvent) => { if (event.type === 'proposal' && event.proposal.status === 'pending') asked.push(event.proposal.title); };
  app.studio.events.on('event', listen);
  try {
    const proposed = next(app, 'proposal', event => event.proposal.status === 'pending');
    const { session } = await app.agent.send(undefined, '把第一个规格的结构尺寸改一下');
    const proposal = (await proposed).proposal;
    assert.deepEqual(proposal.changes.map(change => [change.label, change.before, change.after]),
      [[field.label, `${field.value} ${field.unit}`, `${bumped} ${field.unit}`], ['修改原因', '—', '核对图纸后更正']]);
    assert.equal((await app.studio.invoke('library.spec.get', { spec: spec.spec.id }, { by: 'human' }) as SpecView).version.number, 1, 'nothing is revised while the card waits');
    app.agent.decide(proposal.id, true);
    await app.agent.idle(session);
    const expected = ['没有可修改的', '规格已产生新版本', '只能修改原表已有的结构尺寸', '随软件提供的结构没有结构表', '请填写修改原因'];
    expected.forEach((text, index) => assert.ok(answers[index].includes(text), `refusal ${index}: ${answers[index]}`));
    assert.deepEqual(asked, [`修改结构 · ${spec.spec.name}`], 'only the revision that can be made was put in front of a person');
    assert.deepEqual(steps(await app.agent.view(session)).map(step => step.status), ['failed', 'failed', 'failed', 'failed', 'failed', 'done']);
    const revised = await app.studio.invoke('library.spec.get', { spec: spec.spec.id }, { by: 'human' }) as SpecView;
    assert.equal(revised.version.number, 2, 'the accepted revision is the new version');
    assert.equal(revised.structure.find(item => item.key === field.key)!.value, bumped);
    assert.equal(revised.versions.length, 2, 'the first version is kept');
  } finally {
    app.studio.events.off('event', listen);
  }
});

test('a stop that comes while the change is still being described leaves nobody to ask and nothing behind', { timeout: 60_000 }, async () => {
  const id = await project('停在审阅之前', 'system.cu-xlpe-al-400');
  const real = app.studio.reviewFor.bind(app.studio);
  let release!: () => void;
  let entered!: () => void;
  const inside = new Promise<void>(done => { entered = done; });
  const held = new Promise<void>(done => { release = done; });
  app.studio.reviewFor = async (operation, params) => { entered(); await held; return real(operation, params); };
  const asked: string[] = [];
  const listen = (event: StudioEvent) => { if (event.type === 'proposal') asked.push(event.proposal.status); };
  app.studio.events.on('event', listen);
  try {
    faux.setResponses([fauxAssistantMessage([fauxToolCall('rename_project', { project: id, name: '不该出现' })], { stopReason: 'toolUse' })]);
    const { session } = await app.agent.send(undefined, '改名');
    await inside;
    const stopped = app.agent.stop(session);
    release();
    await stopped;
    await app.agent.idle(session);
    const view = await app.agent.view(session);
    assert.equal(view.running, false);
    assert.equal(view.waiting.length, 0, 'no card is left asking');
    assert.deepEqual(asked, [], 'no card was ever put up');
    assert.equal(app.studio.store.meta(id).name, '停在审阅之前');
    assert.ok(['failed', 'interrupted'].includes(steps(view)[0].status), steps(view)[0].status);
  } finally {
    app.studio.events.off('event', listen);
    app.studio.reviewFor = real;
  }
});

test('a change that was accepted is not made on a project that moved on while the card waited', { timeout: 60_000 }, async () => {
  const id = await project('改名冲突', 'system.cu-xlpe-al-400');
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('rename_project', { project: id, name: '代理起的名字' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('没有改成。')]),
  ]);
  const proposed = next(app, 'proposal', event => event.proposal.status === 'pending');
  const { session } = await app.agent.send(undefined, '改个名');
  const proposal = (await proposed).proposal;
  // The engineer sets the name themselves while the card waits.
  await app.studio.invoke('project.rename', { project: id, name: '工程师自己改的名字' }, { by: 'human' });
  app.agent.decide(proposal.id, true);
  await app.agent.idle(session);
  assert.equal(app.studio.store.meta(id).name, '工程师自己改的名字', 'the agent\'s change was not made over the engineer\'s');
  const [step] = steps(await app.agent.view(session));
  assert.equal(step.status, 'failed');
  assert.ok(step.reason?.includes('审阅期间'), step.reason);
  assert.equal(step.proposal?.status, 'accepted', 'the card still says what the engineer decided; the step says what came of it');
});

test('a change that changes nothing is not put in front of a person', { timeout: 60_000 }, async () => {
  const id = await project('空改动', 'system.cu-xlpe-al-400');
  const current = app.studio.store.parts(id).conditions;
  let told = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('set_conditions', { project: id, soil_thermal_resistivity: current.soil_thermal_resistivity })], { stopReason: 'toolUse' }),
    context => { told = toolText(context); return fauxAssistantMessage([fauxText('已经是这个值。')]); },
  ]);
  const { session } = await app.agent.send(undefined, '把土壤热阻率设成现在这个值');
  await app.agent.idle(session);
  const view = await app.agent.view(session);
  assert.equal(view.waiting.length, 0, 'nobody was asked');
  assert.deepEqual(steps(view).map(step => step.status), ['failed']);
  assert.ok(told.includes('没有任何变化'), told);
});

test('a rating is told to the model with cables by name, not by the calculation\'s own identifiers', { timeout: 120_000 }, async () => {
  const id = await project('结果用名称', 'huayuan.yjv22-15kv-240');
  let told = '';
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('run_rating', { project: id })], { stopReason: 'toolUse' }),
    context => { told = toolText(context); return fauxAssistantMessage([fauxText('算完了。')]); },
  ]);
  const { session } = await app.agent.send(undefined, '算一下这个工程的载流量');
  await app.agent.idle(session);
  const result = JSON.parse(told);
  assert.ok(result.ampacity_a > 0, told);
  assert.equal(result.limiting_cable, '三芯电缆');
  assert.equal(result.operating[0].cable, '三芯电缆');
  assert.equal(result.circuits[0].limiting_cable, '三芯电缆');
  assert.ok(!/cable\/|circuit\//.test(told), 'nothing the model could copy into an answer as an identifier');
});

test('the model is never told a path of this machine, in a result or in an error', { timeout: 60_000 }, async () => {
  assert.equal(scrubPaths('读 C:\\Users\\guo\\x.xlsx 和 D:/work/a.json 以及 /home/ci/work/b 都失败，比例 8.7/15 kV'), '读 〈本机路径〉 和 〈本机路径〉 以及 〈本机路径〉 都失败，比例 8.7/15 kV');
  assert.equal(scrubPaths(JSON.stringify({ file: 'C:\\Users\\guo\\out.pdf' })), '{"file":"〈本机路径〉"}');
  assert.equal(scrubPaths('https://example.com/a/b 与 8.7/15 kV'), 'https://example.com/a/b 与 8.7/15 kV');

  // Through the tools themselves: a result that carries a path and an error that carries one.
  const operation = app.studio.operations.get('project.list')!;
  const { execute, brief } = operation;
  operation.brief = undefined;
  operation.execute = async () => ({ saved: 'C:\\Users\\guo\\.data\\studio\\p.json', also: '/home/ci/work/q.json' });
  let result = '';
  let failure = '';
  try {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('list_projects', {})], { stopReason: 'toolUse' }),
      context => {
        result = toolText(context);
        operation.execute = async () => { throw new Error('读取失败：C:\\Users\\guo\\.data\\studio\\p.json'); };
        return fauxAssistantMessage([fauxToolCall('list_projects', {})], { stopReason: 'toolUse' });
      },
      context => { failure = toolText(context); return fauxAssistantMessage([fauxText('两次都没读到。')]); },
    ]);
    const { session } = await app.agent.send(undefined, '列出工程');
    await app.agent.idle(session);
  } finally {
    operation.execute = execute;
    operation.brief = brief;
  }
  assert.ok(result.includes('〈本机路径〉') && !result.includes('guo') && !result.includes('/home/ci'), result);
  assert.ok(failure.includes('〈本机路径〉') && !failure.includes('guo'), failure);
});

test('stopping the agent while a change waits settles it at once and leaves the inputs alone', { timeout: 60_000 }, async () => {
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

test('a message sent while the agent waits for a decision reaches it after the decision', { timeout: 60_000 }, async () => {
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

test('a conversation survives a restart: it is listed, its unfinished step is shown as cut off, and it can go on', { timeout: 120_000 }, async () => {
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
