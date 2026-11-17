import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createServer } from 'vite';

test('研究路由的共享工程请求跨过 StrictMode 重挂，保留成功与错误结果', async t => {
  // Load the actual query definitions, including the same aliases and TSX imports
  // as the browser. Only the HTTP transport is controlled by this lifecycle test.
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    logLevel: 'error',
  });
  t.after(() => server.close());
  const { studyContextQuery, workspaceQuery } = await server.ssrLoadModule('/src/lib/study-queries.ts');
  const { api } = await server.ssrLoadModule('/src/api/client.ts');

  for (const status of [200, 503]) {
    await t.test(`工程响应 ${status}`, async t => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30000 } } });
      const waiting = Promise.withResolvers();
      const workspace = { id: 'workspace-test', revision: 7, domain: { cable_types: [] } };
      const study = { id: 'study-test', workspace: workspace.id, revision: 3, definition: {
        title: '查询生命周期测试', task: 'rating', driver: { kind: 'single' },
        method: { plugin_id: 'cablesim.iec60287', capability: 'steady-rating', version: '1.0.0' },
      } };
      let workspaceRequests = 0;
      let aborted = 0;
      t.mock.method(api, 'GET', async (path, options) => {
        assert.equal(options.params.path.wid, workspace.id);
        if (path === '/api/workspaces/{wid}/studies/{sid}') {
          assert.equal(options.params.path.sid, study.id);
          return { data: study, response: new Response() };
        }
        assert.equal(path, '/api/workspaces/{wid}');
        workspaceRequests += 1;
        options.signal?.addEventListener('abort', () => {
          aborted += 1;
          waiting.reject(new DOMException('组件已卸载', 'AbortError'));
        }, { once: true });
        await waiting.promise;
        return status === 200
          ? { data: workspace, response: new Response() }
          : { error: { detail: '工程暂时不可读' }, response: new Response(null, { status }) };
      });

      // The route loader starts the composed query before StudyProvider mounts.
      // Its workspace observer is disabled until the study context has resolved.
      const context = studyContextQuery(client, workspace.id, study.id);
      const prefetch = client.prefetchQuery(context);
      const studyObserver = new QueryObserver(client, context);
      const workspaceObserver = new QueryObserver(client, { ...workspaceQuery(workspace.id), enabled: false });
      const unsubscribeStudy = studyObserver.subscribe(() => {});
      const unsubscribeWorkspace = workspaceObserver.subscribe(() => {});
      unsubscribeStudy();
      unsubscribeWorkspace();
      const remountedStudy = studyObserver.subscribe(() => {});
      const remountedWorkspace = workspaceObserver.subscribe(() => {});
      t.after(() => { remountedStudy(); remountedWorkspace(); client.clear(); });

      waiting.resolve();
      await prefetch;
      assert.equal(workspaceRequests, 1, '路由与组件应复用同一个工程请求');
      assert.equal(aborted, 0, '共享请求不能被临时组件观察者卸载取消');
      const result = client.getQueryState(context.queryKey);
      assert.equal(result.fetchStatus, 'idle', '页面不能停在正在读取研究工作区');
      if (status === 200) {
        assert.equal(result.status, 'success');
        assert.equal(result.data[0].id, study.id);
        assert.equal(result.data[0].workspaceRevision, workspace.revision);
        assert.deepEqual(client.getQueryData(workspaceQuery(workspace.id).queryKey), workspace);
      } else {
        assert.equal(result.status, 'error');
        assert.equal(result.error.status, status);
        assert.equal(result.error.message, '工程暂时不可读');
      }
    });
  }
});
