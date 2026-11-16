// Hands-on walk of Agent mode with a scripted model, in the page like a person: click a starting task, review the proposal, read
// the result card, ask about a series and a file, drop in a table, go to the workbench from a card and come back.
// Every step is screenshotted and checked for overlapping or cut-off text.
import { join } from 'node:path';
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { Browser } from 'playwright';
import type { ProjectMeta, SeriesSummary, SpecificationReport } from '../shared/types.ts';
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

  // WALK_WIDTHS=1920 walks one size only, for chasing a failure.
  const sizes = ([[1366, 768], [1920, 1080]] as const).filter(([width]) => (process.env.WALK_WIDTHS ?? '1366,1920').split(',').includes(String(width)));
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => problems.push(`${width} agent page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`${width} agent console error: ${message.text()}`); });
    const check = async (label: string) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(out, `${width}-agent-${label}.png`) });
      for (const issue of await page.evaluate(probe)) problems.push(`${width} agent ${label}: ${issue}`);
      // The conversation never scrolls sideways: a control placed outside the column can make it (it did, on the empty page, at 1280 and wider).
      const sideways = await page.locator('.fade-top').first().evaluate(el => el.scrollWidth - el.clientWidth).catch(() => 0);
      if (sideways > 0) problems.push(`${width} agent ${label}: the conversation scrolls sideways by ${sideways}px`);
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
        fauxAssistantMessage([fauxToolCall('create_project', { name: `走查 直埋校核 ${width}`, model_id: 'huayuan.yjv22-15kv-240' })], { stopReason: 'toolUse' }),
        (context: TranscriptContext) => fauxAssistantMessage([fauxToolCall('run_rating', { project: toolResult(context).project })], { stopReason: 'toolUse' }),
        (context: TranscriptContext) => fauxAssistantMessage([fauxToolCall('open_in_workbench', { target: 'run', project: created(context), run: toolResult(context).run })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('已按模板默认条件算出这款型号的允许电流。\n先到温限的是这根三芯电缆。\n默认的埋深、土壤热阻率和负荷请你确认。')]),
      ]);
      await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).click();
      await page.waitForURL('**/chat/**');
      await page.getByText('待你审阅').first().waitFor();
      await check('proposal');
      await page.getByRole('button', { name: '接受', exact: true }).click();
      await page.getByText('允许电流', { exact: true }).waitFor();
      await page.getByRole('button', { name: /在工作台打开 · 运行记录/ }).waitFor();
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
      const mine = (await app.studio.invoke('project.list', {}, { by: 'human' }) as ProjectMeta[]).find(item => item.name === `走查 直埋校核 ${width}`)!;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall('rename_project', { project: mine.id, name: `走查 代理改名 ${width}` })], { stopReason: 'toolUse' }),
        fauxAssistantMessage([fauxText('没有改成：工程在审阅期间被改动过，请重新提出。')]),
      ]);
      await page.getByRole('button', { name: '新对话' }).first().click();
      await page.getByRole('button', { name: /^算一款型号的直埋载流量/ }).click();
      await page.getByText('待你审阅').first().waitFor();
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
    } catch (error) {
      // Where the page was when a step did not find what it waited for.
      await page.screenshot({ path: join(out, `${width}-agent-FAILED.png`) }).catch(() => undefined);
      throw error;
    }
    await page.close();
  }
}
