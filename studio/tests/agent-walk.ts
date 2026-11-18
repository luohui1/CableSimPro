// Hands-on walk of Agent mode with a scripted model, in the page like a person: click a starting task, review the proposal, read
// the result card, ask about a series and a file, drop in a table, go to the workbench from a card and come back.
// Every step is screenshotted and checked for overlapping or cut-off text.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxText, fauxToolCall, type JsonValue, type TranscriptContext } from '@earendil-works/pi-ai';
import type { Browser } from 'playwright';
import type { ProjectMeta, Proposal, SeriesDeclaration, SeriesSummary, SpecificationReport } from '../shared/types.ts';
import type { App } from '../host/server.ts';
import { toolResult } from './support.ts';
import type { scriptedModel } from './support.ts';

/** The project the agent made earlier in this conversation, from the result it was given for create_project. */
const created = (context: TranscriptContext): string => {
  const result = context.messages.find(message => message.role === 'toolResult' && message.toolName === 'create_project') as { content: { text: string }[] };
  return JSON.parse(result.content[0].text).project;
};

export async function walkAgent(browser: Browser, base: string, app: App, faux: Awaited<ReturnType<typeof scriptedModel>>['faux'], out: string,
  probe: () => string[], problems: string[]) {
  const library = await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[];
  // The series to ask about: one the library walk imported, or a bundled one whose check is computed here.
  const series = library.find(item => item.states.draft && item.states.draft > 0 && item.name.includes('YJV22')) ?? library.find(item => item.name.includes('YJV22'));
  if (!series) throw new Error('the library has no YJV22 series to ask about');
  await app.studio.invoke('library.compute', { series: series.id, kinds: ['check'] }, { by: 'agent' });
  const view = await app.studio.invoke('library.series.get', { series: series.id }, { by: 'human' }) as { specs: { id: string; version: number }[] };
  const spec = view.specs[0];
  const sample = await app.studio.invoke('library.import.sample', {}, { by: 'human' }) as {
    upload: string; declarations: { sheet: string; series: SeriesDeclaration }[];
  };

  // WALK_WIDTHS=1920 walks one size only, for chasing a failure.
  const sizes = ([[1366, 768], [1920, 1080]] as const).filter(([width]) => (process.env.WALK_WIDTHS ?? '1366,1920').split(',').includes(String(width)));
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    const expectedReadFailures = new Set<string>();
    page.on('pageerror', error => problems.push(`${width} agent page error: ${error.message}`));
    page.on('console', message => {
      const injected = expectedReadFailures.has(message.location().url) && /Failed to load resource.*503/.test(message.text());
      if (message.type() === 'error' && !injected) problems.push(`${width} agent console error: ${message.text()}`);
    });
    const initialProjectName = `走查 ${width} · ${'CableReview'.repeat(5)} · 直埋校核`;
    const check = async (label: string) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(out, `${width}-agent-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} agent ${label}: ${issue}`);
      // The conversation never scrolls sideways: a control placed outside the column can make it (it did, on the empty page, at 1280 and wider).
      const sideways = await page.locator('.fade-top').first().evaluate(el => el.scrollWidth - el.clientWidth).catch(() => 0);
      if (sideways > 0) problems.push(`${width} agent ${label}: the conversation scrolls sideways by ${sideways}px`);
    };
    const readWholeProposal = async (changes: Proposal['changes']) => {
      const card = page.locator('[data-card="proposal"][data-phase="pending"]').first();
      if (changes.length > 4) {
        assert.equal(await card.locator('dt').count(), 4, 'a long proposal starts with four rows');
        await card.getByRole('button', { name: /^查看其余 \d+ 项$/ }).click();
        await card.getByRole('button', { name: '收起其余字段', exact: true }).waitFor();
      }
      const rows = card.locator('dl > div');
      assert.equal(await rows.count(), changes.length, 'expanding exposes every host change');
      for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        const row = rows.nth(index);
        assert.equal(await row.locator('dt').textContent(), change.label, 'the full field label stays readable');
        const values = await row.locator('dd').textContent();
        assert.ok(values?.includes(change.after), `the full new value is visible for ${change.label}`);
        if (change.before !== '—') {
          assert.ok(values?.includes(change.before), `the full old value is visible for ${change.label}`);
          await row.getByText('改前', { exact: true }).waitFor();
          await row.getByText('改后', { exact: true }).waitFor();
        }
      }
    };

    try {
      // 1. Nothing said yet: the starting tasks. The mode switch is where it always is.
      await page.goto(`${base}/`);
      await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).waitFor();
      await check('empty');
      if (!(await page.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected') === 'true')) problems.push(`${width} agent: the mode switch does not show Agent`);

      // 2. A rating: the agent proposes a new project, the person accepts, the result comes as a card.
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('list_library', {})], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('create_project', { name: initialProjectName, model_id: 'huayuan.yjv22-15kv-240' })], { stopReason: 'toolUse' }),
        (context: TranscriptContext) => fauxAssistantMessage([fauxToolCall('run_rating', { project: toolResult(context).project })], { stopReason: 'toolUse' }),
        (context: TranscriptContext) => fauxAssistantMessage([fauxToolCall('open_in_workbench', { target: 'run', project: created(context), run: toolResult(context).run })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('已按模板默认条件算出这款型号的允许电流。\n先到温限的是这根三芯电缆。\n默认的埋深、土壤热阻率和负荷请你确认。')]),
      ]);
      await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).click();
      await page.waitForURL('**/chat/**');
      await page.getByText('待你审阅').first().waitFor();
      const createdSession = new URL(page.url()).pathname.split('/').at(-1)!;
      await readWholeProposal((await app.agent.view(createdSession)).waiting[0].changes);
      await check('proposal-expanded');
      const collapseProposal = page.getByRole('button', { name: '收起其余字段', exact: true });
      if (await collapseProposal.isVisible()) await collapseProposal.click();
      await check('proposal');
      await page.getByRole('button', { name: '接受', exact: true }).click();
      await page.getByText('允许电流', { exact: true }).waitFor();
      // The card has its own button to the workbench; the agent opening the same record afterwards must not add a second one.
      await page.getByRole('button', { name: '在工作台打开', exact: true }).first().waitFor();
      await page.getByText('默认的埋深、土壤热阻率和负荷请你确认。').waitFor();
      if (await page.getByRole('button', { name: /在工作台打开 · 运行记录/ }).count()) problems.push(`${width} agent: a result card with its own button to the workbench is followed by a second button to the same place`);
      await check('rating');
      const chat = page.url();

      // 3. From the card to the workbench and back to the conversation.
      await page.getByRole('button', { name: '在工作台打开' }).first().click();
      await page.waitForURL('**/p/**');
      await page.getByRole('button', { name: '出计算书' }).waitFor();
      await check('opened-in-workbench');
      if (!(await page.getByRole('tab', { name: '工作台' }).getAttribute('aria-selected') === 'true')) problems.push(`${width} agent: the mode switch does not show the workbench after a card opened it`);
      await page.getByRole('tab', { name: 'Agent' }).click();
      await page.waitForURL(chat);

      // Read-only HTTP failures are injected explicitly; the recovered list and messages are the real saved conversation.
      const listUrl = `${base}/api/chat/sessions`;
      const detailUrl = `${listUrl}/${createdSession}`;
      const failRead = { status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'WALK_READ_FAILURE', message: '走查临时读取失败，请重试。' } }) };
      expectedReadFailures.add(listUrl);
      await page.route(listUrl, route => route.fulfill(failRead));
      await page.reload();
      await page.getByText('历史对话读取失败', { exact: true }).waitFor();
      assert.equal(await page.getByText('还没有对话。交办第一件事后，它会出现在这里。', { exact: true }).count(), 0, 'a failed read is not an empty list');
      await check('history-list-error');
      await page.unroute(listUrl);
      await page.getByRole('button', { name: '重试读取历史', exact: true }).click();
      await page.getByRole('navigation', { name: '对话', exact: true }).locator('button[aria-current="page"]').waitFor();
      await page.getByText('历史对话读取失败', { exact: true }).waitFor({ state: 'hidden' });
      expectedReadFailures.delete(listUrl);

      expectedReadFailures.add(detailUrl);
      await page.route(detailUrl, route => route.fulfill(failRead));
      await page.reload();
      await page.getByText('这段对话暂时无法读取', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('给 Agent 的消息').count(), 0, 'history must be recovered before continuing it');
      assert.equal(await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).count(), 0, 'a failed history read is not a new conversation');
      await check('history-thread-error');
      // A synthetic second scroll container detects document-wide turn lookup without altering the real conversation.
      await page.evaluate(() => {
        const other = document.createElement('div');
        other.id = 'agent-scroll-sentinel';
        other.setAttribute('aria-hidden', 'true');
        Object.assign(other.style, { position: 'fixed', left: '-1000px', top: '0', width: '20px', height: '20px', overflow: 'auto' });
        const space = document.createElement('div');
        space.style.height = '400px';
        const turn = document.createElement('div');
        turn.setAttribute('data-turn-start', '');
        turn.style.height = '20px';
        other.append(space, turn);
        document.body.append(other);
      });
      const outerPosition = await page.evaluate(() => [window.scrollX, window.scrollY]);
      await page.unroute(detailUrl);
      await page.getByRole('button', { name: '重新读取对话', exact: true }).click();
      await page.getByText('默认的埋深、土壤热阻率和负荷请你确认。').waitFor();
      await page.getByLabel('给 Agent 的消息').waitFor();
      await check('history-recovered');
      assert.equal(await page.locator('#agent-scroll-sentinel').evaluate(node => node.scrollTop), 0, 'opening history does not scroll a different thread');
      assert.deepEqual(await page.evaluate(() => [window.scrollX, window.scrollY]), outerPosition, 'opening history does not scroll the outer document');
      await page.locator('#agent-scroll-sentinel').evaluate(node => node.remove());
      expectedReadFailures.delete(detailUrl);

      // 4. A series and a file: the check as a card, the specification as a file with its preview.
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('list_check_failures', { series: series.id })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxToolCall('export_specification', { spec: spec.id, version: spec.version })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('核对结果和规格书都在上面的卡片里。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^导出一份规格书/ }).click();
      await page.getByRole('button', { name: '预览' }).waitFor({ timeout: 60_000 });
      await check('check-and-file');
      await page.getByRole('button', { name: '预览' }).click();
      await page.getByRole('dialog').waitFor();
      await check('file-preview');
      // The preview holds a PDF in a frame, which keeps the keyboard; the dialog is closed with its button.
      await page.getByRole('button', { name: '关闭' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const reports = await app.studio.invoke('library.documents', { spec: spec.id }, { by: 'human' }) as SpecificationReport[];
      if (!reports.length) problems.push(`${width} agent: the specification the card shows was not saved`);

      // 5. A structure table dropped into the composer travels with the message, and the agent reads it by the identifier.
      faux.setResponses([
        (context: TranscriptContext) => fauxAssistantMessage([fauxToolCall('inspect_table', { upload: /upload (u-[0-9a-f]{8})/.exec(JSON.stringify(context.messages))![1] })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('读到了这张表。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^导入公开结构表示例并核对/ }).waitFor();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '附上结构表' }).click()]);
      await chooser.setFiles({ name: '走查结构表.csv', mimeType: 'text/csv', buffer: Buffer.from('标称截面,导体直径\n240,18.4\n') });
      await page.getByText('走查结构表.csv').first().waitFor();
      await check('attachment');
      await page.getByLabel('给 Agent 的消息').fill('读一下这张表');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await page.getByText('读到了这张表。').waitFor();
      await check('attachment-sent');

      // 6. A change that was accepted for a project the engineer changed in the meantime is not made, and the card does not say it was.
      const mine = (await app.studio.invoke('project.list', {}, { by: 'human' }) as ProjectMeta[]).find(item => item.name === initialProjectName)!;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('rename_project', { project: mine.id, name: `走查 ${width} · ${'AgentReview'.repeat(5)} · 复核前后值` })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('没有改成：工程在审阅期间被改动过，请重新提出。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).click();
      await page.getByText('待你审阅').first().waitFor();
      await readWholeProposal((await app.agent.view(new URL(page.url()).pathname.split('/').at(-1)!)).waiting[0].changes);
      await check('proposal-before-after');
      await app.studio.invoke('project.rename', { project: mine.id, name: `走查 工程师改名 ${width}` }, { by: 'human' });
      await page.getByRole('button', { name: '接受', exact: true }).click();
      await page.getByText('已接受，但没有执行').waitFor();
      await check('accepted-not-made');
      if (await page.locator('[data-card="proposal"][data-phase="accepted"]').count()) problems.push(`${width} agent: the card says the change was made when it was not`);
      if (app.studio.store.meta(mine.id).name !== `走查 工程师改名 ${width}`) problems.push(`${width} agent: the agent's change was made over the engineer's`);

      // 7. The solid the CAD plugin builds comes as a card with the workbench's own viewer, in both of its views.
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('build_geometry', { spec: spec.id, version: spec.version })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('三维结构已生成：分层剖开和完整实体两种看法都在卡片里。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^建一个电缆三维结构模型/ }).click();
      await page.getByRole('button', { name: '完整实体' }).waitFor({ timeout: 120_000 });
      await page.waitForTimeout(2500);
      const viewer = await page.locator('.cad-viewport').first().boundingBox();
      if (!viewer || viewer.width < 400 || viewer.height < 200) problems.push(`${width} agent: the 3D viewer on the card is ${viewer ? `${viewer.width}×${viewer.height}` : 'missing'}`);
      await check('model-3d-cutaway');
      await page.getByRole('button', { name: '完整实体' }).click();
      await check('model-3d-solid');

      // The host builds this import preview from its actual public sample. The deliberately long declared source is test input,
      // shown beside the measured upload source; it is rejected, so no unreviewed provenance is saved to the product library.
      const declaration = sample.declarations[0];
      const declaredSource = `界面走查提供的长来源说明（待工程师核对）\nhttps://example.invalid/${'source-segment/'.repeat(16)}`;
      const rejection = `暂不导入：请先核对完整资料来源。${'保留原始页码和上传文件信息，等待资料负责人确认。'.repeat(5)}`;
      // Tool arguments cross a JSON boundary just as a model request does; optional undefined properties are omitted there.
      const importSeries: JsonValue = JSON.parse(JSON.stringify({ ...declaration.series, name: `走查来源展开 ${width}`,
        source: { title: declaredSource, location: '完整来源应保留换行和长链接' } }));
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('import_series', { upload: sample.upload, sheet: declaration.sheet,
          series: importSeries })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('已按你的意见暂不导入。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^导入公开结构表示例并核对/ }).click();
      await page.getByText('待你审阅').first().waitFor();
      const importProposal = (await app.agent.view(new URL(page.url()).pathname.split('/').at(-1)!)).waiting[0];
      assert.ok(importProposal.changes.some(change => change.label === '来源' && change.after.includes(declaredSource) && change.after.includes('上传文件')));
      await readWholeProposal(importProposal.changes);
      await check('proposal-complete-source');
      await page.getByRole('button', { name: '拒绝', exact: true }).click();
      await page.getByLabel('拒绝的原因', { exact: true }).fill(rejection);
      await page.getByRole('button', { name: '确认拒绝', exact: true }).click();
      await page.getByText('已按你的意见暂不导入。').waitFor();
      const rejected = page.locator('[data-card="proposal"][data-phase="rejected"]');
      await rejected.getByRole('button', { name: /已拒绝/ }).click();
      assert.ok((await rejected.textContent())?.includes(rejection), 'the full rejection reason is readable after expansion');
      assert.equal((await app.studio.invoke('library.series', {}, { by: 'human' }) as SeriesSummary[]).filter(item => item.name === `走查来源展开 ${width}`).length, 0, 'the rejected proposal did not import a series');
      await check('proposal-rejection-reason');
    } catch (error) {
      // Where the page was when a step did not find what it waited for.
      await page.screenshot({ path: join(out, `${width}-agent-FAILED.png`) }).catch(() => undefined);
      throw error;
    }
    await page.close();
  }
}
