import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { walkthrough } from './verify-workbench-support.mjs';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const fixtureSource = String.raw`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentConversationProvider, AgentConversationMessages } from '@/features/agent/conversation-runtime';
import { AgentThread } from '@/features/agent/thread-viewport';
import { PromptBar } from '@/features/agent/prompt-bar';
import { ProposalCard, TurnView } from '@/features/agent/conversation';
import { Button } from '@/components/ui/button';
const markdown = '# Markdown 格式样本\n\n这段文字只检查组件排版，**不是工程计算结果**。\n\n'
  + '| 项目 | 说明 | 单位 |\n| --- | --- | --- |\n| 转义分隔符 | A\\|B | Ω/km |\n| 长内容 | '+ '完整显示'.repeat(16) + ' | K·m/W |\n\n'
  + '1. 第一项\n   - 嵌套说明\n2. 第二项\n\n'
  + '~~~text\n'+ '不可拆断的代码字符串_'.repeat(45) + '\n~~~\n\n'
  + '<script>window.__agentInjected = true</script>\n\n'
  + '[安全链接](https://example.com)\n\n'
  + Array.from({length: 18}, (_, index) => '## 段落 '+ (index + 1) + '\n\n长回答应允许向上查看。追加内容不得把正在阅读的用户拉回底部。').join('\n\n');
const initial = { id:'component-fixture', question:'组件交互验收：长回答与人工审核', answer:markdown, running:true, started:new Date().toISOString(), evidenceOnly:false,
  steps:[{id:'read-receipt',tool:'workspace_read',title:'读取记录',status:'ok',summary:'静态组件夹具，不代表真实工程结果',ms:12}], notices:[],proposals:['component-proposal'],previews:[],runs:[],refs:[] };
const originalProposal = {id:'component-proposal',title:'组件审核样本',status:'pending',base_revision:2,
  changes:Array.from({length:9},(_,index)=>({path:'/description/'+index,label:'说明字段 '+(index+1),before:'修改前文字',after:'修改后完整说明 '+index})),checks:['这里只验证界面人工操作，不写入工程。']};
function Fixture() {
  const [turn,setTurn]=useState(initial), [proposal,setProposal]=useState(originalProposal), [draft,setDraft]=useState(''), [running,setRunning]=useState(true), [sent,setSent]=useState('');
  const proposals=new Map([[proposal.id,proposal]]);
  return <main className="agent-fixture"><h1>Agent 组件交互验收</h1><p>静态回执夹具；不连接模型、不产生工程结果、不代替真实流程验收。</p>
    <div className="agent-fixture-controls"><Button onClick={()=>setTurn(current=>({...current,answer:current.answer+'\n\n追加接收内容：保持阅读位置。'}))}>追加接收内容</Button>
    <Button onClick={()=>{setRunning(false);setTurn(current=>({...current,running:false}));}}>结束接收夹具</Button><output aria-label="夹具发送回执">{sent}</output></div>
    <AgentConversationProvider turns={[turn]} loading={false} sending={running} canSend onStop={()=>{setRunning(false);setTurn(current=>({...current,running:false,interrupted:true}));}}
      onSend={async text=>{setSent(text);setDraft('');}}>
      <div className="agent-fixture-conversation"><AgentThread><AgentConversationMessages renderTurn={item=><TurnView showQuestion={false} turn={item} kinds={new Map([['workspace_read','read']])} proposals={proposals} label={value=>value}
        review={item=><ProposalCard proposal={item} onDecide={(_id,decision)=>setProposal(current=>({...current,status:decision==='approve'?'approved':'rejected'}))} />}/>} /></AgentThread></div>
      <PromptBar value={draft} onChange={setDraft} busy={running} canSend placeholder="组件草稿" commands={[{key:'sample',name:'检查样本',description:'仅填入草稿',text:'检查样本：'}]} />
    </AgentConversationProvider>
  </main>;
}
createRoot(document.getElementById('fixture')).render(<Fixture />);
`;
let fixture;
async function componentBundle() {
  if (fixture) return fixture;
  await fs.mkdir(path.join(frontend, '.tmp'), { recursive: true });
  const scratch = await fs.mkdtemp(path.join(frontend, '.tmp', 'agent-components-'));
  try {
    const entry = path.join(scratch, 'entry.tsx');
    await fs.writeFile(entry, fixtureSource);
    const result = await build({ configFile: false, root: frontend, logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { alias: { '@': path.join(frontend, 'src'), 'lucide-react': path.join(frontend, 'src/icons/lucide-shim.tsx') } },
      build: { write: false, minify: false, lib: { entry, name: 'AgentComponentAcceptance', formats: ['iife'] }, rolldownOptions: { output: { inlineDynamicImports: true }, onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); } } },
    });
    const output = Array.isArray(result) ? result.flatMap(item => item.output) : result.output;
    fixture = { script: output.find(item => item.type === 'chunk' && item.isEntry).code,
      css: output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n') };
    return fixture;
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

await walkthrough('agent', async ({ page, expect, base, api, step, check, size, report }) => {
  report.scope = '真实隔离后端与生产前端；额外组件夹具单独标明，不冒充真实模型验收。';
  const status = await api('/api/agent/status');
  const sessions = await api('/api/agent/sessions');
  const workspaces = await api('/api/workspaces');
  const typeIndex = await api('/api/design/type-workspaces');
  const typeIds = new Set(typeIndex.map(row => row.id));
  const workspace = workspaces.find(row => !typeIds.has(row.id));
  check('隔离种子存在可用工程', !!workspace, { workspaces: workspaces.length, types: typeIndex.length });
  await step('01-real-agent-start-and-model-status', async () => {
    await page.goto(base + '/agent?theme=light&workspace=' + encodeURIComponent(workspace.id));
    await expect(page.getByRole('heading', { name: '要 Agent 做什么？', exact: true })).toBeVisible();
    await expect(page.locator('.agent-context-bar')).toContainText(workspace.name);
    await expect(page.locator('.agent-start-grid .button')).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: '给 Agent 的任务', exact: true })).toBeEditable();
    if (!status.configured) {
      await expect(page.getByRole('button', { name: '去设置', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
      (report.uncovered ||= []).push({ ...size, label: '真实模型多步任务', reason: '隔离服务未配置模型；没有填写虚构密钥或替换接口结果。' });
    }
  });
  await step('02-real-draft-commands-and-keyboard', async () => {
    const writes = report.writes.length;
    const input = page.getByRole('textbox', { name: '给 Agent 的任务', exact: true });
    const suggestion = page.locator('.agent-start-grid .button').first();
    const suggested = await suggestion.innerText();
    await suggestion.focus(); await suggestion.press('Enter');
    await expect(input).toHaveValue(suggested);
    await page.getByRole('button', { name: '选择常用任务', exact: true }).click();
    const search = page.getByRole('combobox', { name: '搜索常用任务', exact: true });
    await expect(search).toBeFocused();
    await search.fill('结论汇总'); await search.press('ArrowDown'); await search.press('Enter');
    await expect(input).toBeFocused(); await expect(input).toHaveValue(/汇总/);
    await input.fill('第一行'); await input.press('Shift+Enter'); await input.type('第二行');
    await expect(input).toHaveValue('第一行\n第二行');
    if (!status.configured) { await input.press('Enter'); await expect(input).toHaveValue('第一行\n第二行'); }
    check('只选建议或编辑草稿不产生任何写请求', report.writes.length === writes, report.writes.slice(writes));
    await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('不存在的任务检索词');
    await expect(page.getByText('没有匹配的任务。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  });
  await step('03-real-history-or-explicit-empty-state', async () => {
    if (!sessions.length) {
      await expect(page.locator('.agent-tasks')).toContainText('还没有任务');
      (report.uncovered ||= []).push({ ...size, label: '真实已保存对话、提案与回答', reason: '当前隔离种子没有保存会话；不伪造审计记录。' });
      return;
    }
    const saved = sessions[0], record = await api('/api/agent/sessions/' + encodeURIComponent(saved.id));
    await page.locator('.agent-task').filter({ hasText: saved.title || '未命名任务' }).first().click();
    await expect(page).toHaveURL(new RegExp('task=' + saved.id));
    const questions = record.events.filter(event => event.type === 'chat.message' && event.data.role === 'user');
    await expect(page.locator('.agent-question')).toHaveCount(questions.length);
    check('真实历史用户消息与审计记录一致', JSON.stringify(await page.locator('.agent-question').allTextContents()) === JSON.stringify(questions.map(item => item.data.content)), saved.id);
  });
  if (typeIndex.length) await step('04-real-type-context-and-workbench-link', async () => {
    await page.goto(base + '/agent?theme=light&workspace=' + encodeURIComponent(typeIndex[0].id));
    await expect(page.locator('.agent-context-bar')).toContainText(typeIndex[0].name);
    await expect(page.locator('.agent-start-grid')).toContainText('规格书');
    await page.getByRole('button', { name: '在工作台打开', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/types/' + typeIndex[0].id + '/'));
  });

  // This extra surface mounts the actual production components with clearly labelled static receipts.
  // Only this HTML document is intercepted; no /api/ request or model response is replaced.
  await page.goto(base + '/agent?theme=light&workspace=' + encodeURIComponent(workspace.id));
  await expect(page.locator('.agent-start-grid .button').first()).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => node.href));
  const bundle = await componentBundle();
  const fixtureUrl = base + '/__agent-component-fixture__';
  await page.route(fixtureUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8">'
    + stylesheets.map(href => '<link rel="stylesheet" href="' + href + '">').join('') + '</head><body><div id="fixture"></div></body></html>' }));
  try {
    await page.goto(fixtureUrl);
    await page.addStyleTag({ content: bundle.css + '\n.agent-fixture{display:flex;flex-direction:column;gap:var(--space-2);height:100vh;padding:var(--space-4);box-sizing:border-box;font:var(--text-body) var(--font-ui);color:var(--text);background:var(--panel)}.agent-fixture>h1,.agent-fixture>p{margin:0}.agent-fixture-controls{display:flex;flex-wrap:wrap;gap:var(--space-2)}.agent-fixture-conversation{display:flex;min-height:0;flex:1}.agent-fixture .prompt-bar{flex:none}.agent-fixture h1{font-size:var(--text-heading)}' });
    await page.addScriptTag({ content: bundle.script });
    await step('05-component-fixture-markdown-and-review', async () => {
      await expect(page.getByRole('heading', { name: 'Agent 组件交互验收', exact: true })).toBeVisible();
      await expect(page.locator('.agent-answer table td').filter({ hasText: 'A|B' })).toHaveCount(1);
      await expect(page.locator('.agent-answer pre code')).toHaveCount(1);
      check('Markdown原始HTML不会执行', await page.evaluate(() => window.__agentInjected === undefined), '真实react-markdown skipHtml；无HTML插件');
      check('长代码和表格不撑宽页面', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('button', { name: '展开完整审核', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '审核字段改动', exact: true });
      await expect(dialog).toBeVisible(); await expect(dialog.locator('.agent-diff-hunk')).toHaveCount(9);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: '展开完整审核', exact: true })).toBeFocused();
      await expect(page.locator('.agent-review-card')).toHaveClass(/is-pending/);
    });
    await step('06-component-fixture-stream-scroll-and-draft', async () => {
      const viewport = page.getByLabel('任务对话记录', { exact: true });
      await viewport.focus(); await viewport.press('Control+Home');
      await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(50);
      const top = await viewport.evaluate(node => node.scrollTop);
      await page.getByRole('button', { name: '追加接收内容', exact: true }).click();
      await expect(page.locator('.agent-answer')).toContainText('追加接收内容：保持阅读位置。');
      check('用户上翻时接收新内容不抢滚动位置', Math.abs(await viewport.evaluate(node => node.scrollTop) - top) < 10);
      await page.getByRole('button', { name: '回到最新', exact: true }).click();
      await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(80);
      const input = page.getByRole('textbox', { name: '给 Agent 的任务', exact: true });
      await input.fill('处理中也能保存下一条草稿'); await expect(input).toBeEditable();
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '停止接收', exact: true }).click();
      await expect(page.locator('.agent-review-card')).toHaveClass(/is-pending/);
      await expect(input).toHaveValue('处理中也能保存下一条草稿');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.getByLabel('夹具发送回执', { exact: true })).toHaveText('处理中也能保存下一条草稿');
      await expect(input).toHaveValue('');
    });
    (report.componentFixtures ||= []).push({ ...size, scope: '独立HTML夹具挂载真实生产组件；仅UI状态回调，不生成或修改工程证据。', checks: 'Markdown、完整审核、焦点恢复、流式滚动、停止保留提案、可编辑草稿、assistant-ui发送' });
  } finally { await page.unroute(fixtureUrl); }
});
