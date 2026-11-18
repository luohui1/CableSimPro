import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ChatStep, StepStatus } from '../shared/types.ts';

test('the fusion timeline leaves full failure diagnostics in the existing refusal card', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.fusion.config.ts', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { toStep } = await server.ssrLoadModule('/ui/fusion/steps.tsx');
  const { StepTrace } = await server.ssrLoadModule('/ui/kit/chat/steps.tsx');
  const { StepCards } = await server.ssrLoadModule('/ui/fusion/cards.tsx');
  const refusal = '老平台尚未接入厂家 Excel/CSV 结构表的预览与批量入库接口。原始文件未写入型号库，请等待接口接入后重试。';
  const missing = '已接受，但平台未完成执行：20 °C 直流电阻（R20）未填写。请在本研究模型的电缆输入中补齐数值、口径与来源后重新提出运行。';
  const step = (reason: string, status: StepStatus = 'failed'): ChatStep => ({
    type: 'step', id: 'failed-step', tool: 'structure_import_inspect', label: '检查结构表导入能力', status,
    target: '厂家结构表', reason, duration_ms: 600,
  });
  await t.test('a failed read keeps its state and label while the full original reason renders once', () => {
    const saved = step(refusal);
    const trace = toStep(saved);
    assert.equal(trace.state, 'failed');
    assert.equal(trace.label, saved.label);
    assert.equal(trace.target, saved.target);
    assert.equal(trace.seconds, 0.6);
    assert.equal(trace.reason, undefined);
    assert.equal(saved.reason, refusal, 'projection must not alter the original reason given to the card');
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(StepTrace, { steps: [trace], defaultOpen: true }), createElement(StepCards, { step: saved })));
    assert.equal(html.split(refusal).length - 1, 1);
    assert.match(html, /data-step="failed"/);
    assert.ok(html.includes(saved.label + '没有完成'));
  });
  await t.test('accepted proposals that fail retain their full reason for ProposalBlock', () => {
    for (const status of ['failed', 'rejected', 'interrupted'] as const) {
      const saved: ChatStep = { ...step(missing, status), proposal: {
        id: 'proposal', session_id: 'session', step_id: 'failed-step', project_id: 'workspace', operation: 'propose_study_run',
        title: '运行研究', changes: [], status: 'accepted',
      } };
      assert.equal(toStep(saved).reason, undefined);
      assert.equal(toStep(saved).state, status);
      assert.equal(saved.reason, missing);
      assert.equal(saved.proposal?.status, 'accepted');
    }
  });
  await t.test('a stopped step without a separate refusal card keeps its diagnostic in the trace', () => {
    const saved = step('任务被停止，未执行后续操作。', 'interrupted');
    assert.equal(toStep(saved).reason, saved.reason);
    const pending: ChatStep = { ...step(missing), proposal: {
      id: 'proposal', session_id: 'session', step_id: 'failed-step', project_id: 'workspace', operation: 'propose_study_run',
      title: '运行研究', changes: [], status: 'pending',
    } };
    assert.equal(toStep(pending).reason, missing, 'keep the reason when ProposalBlock does not show a failure card');
  });
});
