import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { QueryObserver } from '@tanstack/react-query';
import { createServer } from 'vite';
import { notifyPlatformChanged } from '../../studio/ui/fusion/open.ts';

test('Agent 写入后的研究和型号读取与保存事实同步', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { queryClient: client } = await server.ssrLoadModule('/src/lib/query-client.ts');
  const { refreshAgentFacts, readAgentMessage } = await server.ssrLoadModule('/src/lib/agent-cache.ts');
  const { studyContextQuery, studyRunsQuery, workspaceQuery } = await server.ssrLoadModule('/src/lib/study-queries.ts');
  const { api } = await server.ssrLoadModule('/src/api/client.ts');
  const { loadWorkspace, typeEvidence } = await server.ssrLoadModule('/src/features/type/api.ts');
  const { typeSpecification } = await server.ssrLoadModule('/src/features/type/version-api.ts');

  await t.test('新运行不能与三十秒缓存中的旧条件组合，内外查询一并刷新', async t => {
    t.after(() => client.clear());
    const wid = 'agent-study-workspace', sid = 'agent-study';
    let revision = 1;
    const calls = [];
    const definition = () => ({ title: '研究缓存回归', task: 'rating', driver: { kind: 'single' },
      method: { plugin_id: 'cablesim.iec60287', capability: 'steady-rating', version: '1.0.0' },
      parameters: { surface_temperature: revision === 1 ? 298.15 : 299.15 } });
    t.mock.method(api, 'GET', async (path, options) => {
      calls.push(path);
      let data;
      if (path === '/api/workspaces/{wid}') data = { id: wid, revision, domain: { cable_types: [] } };
      else if (path === '/api/workspaces/{wid}/studies/{sid}') data = { id: sid, workspace: wid, revision,
        definition: definition(), latest_run: { id: `run-${revision}` } };
      else if (path === '/api/workspaces/{wid}/studies/{sid}/runs/{rid}') data = {
        id: options.params.path.rid, workspace: wid, study: sid, status: 'succeeded', freshness: 'current',
        snapshot: { definition: definition(), workspace_revision: revision, study_revision: revision },
      };
      else assert.fail(`未声明的 HTTP 请求：${path}`);
      return { data: structuredClone(data), response: new Response() };
    });

    const context = studyContextQuery(client, wid, sid, 'run-1');
    await client.fetchQuery(context);
    await client.fetchQuery(studyRunsQuery(client, wid, sid, 'run-1'));
    const unsubscribers = [context, workspaceQuery(wid)].map(options => new QueryObserver(client, options).subscribe(() => {}));
    t.after(() => unsubscribers.forEach(stop => stop()));
    let coldReads = 0;
    await client.fetchQuery({ queryKey: ['deliveries', wid], queryFn: () => { coldReads++; return []; } });
    client.setQueryData(['study-context', 'another-workspace', 'another-study'], [{ revision: 1 }]);

    // The sidecar commits outside this QueryClient; the saved-result link selects a different run.
    revision = 2;
    const cached = await client.fetchQuery(studyContextQuery(client, wid, sid, 'run-2'));
    const [run] = await client.fetchQuery(studyRunsQuery(client, wid, sid, 'run-2'));
    assert.equal(cached[0].definition.parameters.surface_temperature, 298.15);
    assert.equal(run.snapshot.definition.parameters.surface_temperature, 299.15);
    assert.equal(calls.filter(path => path.endsWith('/studies/{sid}')).length, 1);

    await refreshAgentFacts(client, wid);
    const [current] = client.getQueryData(context.queryKey);
    assert.equal(current.revision, 2);
    assert.equal(current.workspaceRevision, 2);
    assert.equal(current.definition.parameters.surface_temperature, 299.15);
    assert.equal(client.getQueryData(['study-context', wid, sid, 'response']).revision, 2);
    assert.equal(client.getQueryData(workspaceQuery(wid).queryKey).revision, 2);
    assert.equal(coldReads, 1, '未挂载的交付目录只失效，不发 HTTP');
    assert.equal(client.getQueryState(['deliveries', wid]).isInvalidated, true);
    assert.equal(client.getQueryState(['study-context', 'another-workspace', 'another-study']).isInvalidated, false);
  });

  await t.test('型号路由刷新结构时，已缓存的核对结果与规格书也必须同步', async t => {
    t.after(() => client.clear());
    const wid = 'agent-type-workspace', sid = 'type-check';
    let revision = 1;
    const calls = { workspace: 0, evidence: 0, specification: 0 };
    t.mock.method(globalThis, 'fetch', async input => {
      const url = String(input);
      let value;
      if (url === `/api/types/${wid}/workspace`) {
        calls.workspace++;
        value = { id: wid, revision, domain: { schema_version: 'cablesim.type-draft/1', name: '型号缓存回归',
          cable_types: [{ id: 'cable', layers: [{ id: 'insulation', thickness_m: revision === 1 ? 0.0046 : 0.0047 }] }],
          materials: [], circuits: [], sections: [], load_cases: [] } };
      } else if (url.startsWith(`/api/types/${wid}/display-runs?`)) {
        calls.evidence++;
        value = { items: [{ id: `type-run-${revision}`, study: sid, status: 'succeeded', snapshot: {
          study_id: sid, study_revision: revision, workspace_revision: revision, definition: { title: '保存核对' },
        } }], next_cursor: null };
      } else if (url === `/api/types/${wid}/specification?audience=customer&view=detail`) {
        calls.specification++;
        const digest = String(revision).repeat(64);
        value = { payload: { schema: 'cablesim.type-specification/1', workspace_id: wid, revision,
          chapters: [], checks: [], sources: [], revisions: [] }, lifecycle: { status: 'draft' },
          digest, ready: false, audience: 'customer', html: '<!doctype html><title>缓存回归</title>',
          payload_full_ref: { digest, url: `/api/types/${wid}/specification?audience=customer&view=full` } };
      } else assert.fail(`未声明的 HTTP 请求：${url}`);
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    });
    // These keys and cache policies are shared by type/routes, provider, evidence and specification.
    const workspace = { queryKey: ['type-workspace', wid, undefined, undefined],
      queryFn: ({ signal }) => loadWorkspace(wid, signal), staleTime: 0, refetchOnMount: false };
    const evidence = { queryKey: ['type-evidence', wid, 'recent', 'requirements'],
      queryFn: ({ signal }) => typeEvidence(wid, signal, true, 'requirements'), staleTime: 30000 };
    const specification = { queryKey: ['type-specification', wid, 'customer'],
      queryFn: ({ signal }) => typeSpecification(wid, signal, 'customer'), staleTime: 30000 };
    await Promise.all([workspace, evidence, specification].map(options => client.fetchQuery(options)));
    revision = 2;
    await client.prefetchQuery(workspace); // The existing route already does this with staleTime: 0.
    assert.equal(client.getQueryData(workspace.queryKey).revision, 2);
    assert.equal((await client.fetchQuery(evidence))[0].run.id, 'type-run-1');
    assert.equal((await client.fetchQuery(specification)).payload.revision, 1);

    const unsubscribers = [workspace, evidence, specification].map(options => new QueryObserver(client, options).subscribe(() => {}));
    t.after(() => unsubscribers.forEach(stop => stop()));
    await refreshAgentFacts(client, wid);
    assert.equal(client.getQueryData(workspace.queryKey).document.cable_types[0].layers[0].thickness_m, 0.0047);
    assert.equal(client.getQueryData(evidence.queryKey)[0].run.id, 'type-run-2');
    assert.equal(client.getQueryData(specification.queryKey).payload.revision, 2);
    assert.equal(calls.evidence, 2);
    assert.equal(calls.specification, 2);
  });

  await t.test('只有同源当前 iframe 的通知能触发刷新；通知不声称批准或执行成功', async t => {
    const frame = {}, origin = 'https://platform.example', sent = [];
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      parent: { postMessage: (message, target) => sent.push({ message, target }) }, location: { origin },
    } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete globalThis.window; });
    notifyPlatformChanged('changed-workspace');
    assert.equal(sent[0].target, origin);
    assert.deepEqual(sent[0].message, { source: 'cablesim-agent', type: 'changed', workspace: 'changed-workspace' });
    const event = { origin, source: frame, data: sent[0].message };
    assert.deepEqual(readAgentMessage(event, frame, origin), { type: 'changed', workspace: 'changed-workspace' });
    for (const invalid of [
      { ...event, origin: 'https://another.example' }, { ...event, source: {} },
      { ...event, data: null }, { ...event, data: { ...event.data, source: 'another-app' } },
      { ...event, data: { ...event.data, workspace: 123 } }, { ...event, data: { ...event.data, workspace: '' } },
    ]) assert.equal(readAgentMessage(invalid, frame, origin), undefined);
    assert.equal(readAgentMessage(event, null, origin), undefined);
    assert.deepEqual(readAgentMessage({ ...event, data: { source: 'cablesim-agent', type: 'open', href: 'cablesim:type/changed-workspace' } }, frame, origin),
      { type: 'open', href: 'cablesim:type/changed-workspace' });
  });
});
