import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, array, optionalRecord, record, responseData } from "@/api/client";
import { projectStudy, type StudyDefinition } from "@/api/research";
import type { CatalogRow } from '@/api/catalogs';
import { rootModule } from '@/lib/study-config';
import { femConclusionQuery } from '@/components/study-fem-conclusion';

/** Selection cards share one cache; the selected capability owns its full schema. */
export function methodCardsQuery() {
  return queryOptions({queryKey:['method-catalog','summary'], staleTime:30000,
    queryFn:async ({signal}) => {
      const response=await fetch('/api/methods?view=summary',{signal});
      const value=await response.json();
      if(!response.ok)throw new ApiError(response.status,String(optionalRecord(value.detail).message || value.detail || '方法清单读取失败'));
      return array(value,'方法清单').map(row=>record(row)) as CatalogRow[];
    }});
}

/** 同一响应供上下文与运行读取共用；工程大输入的传输不挡住运行详情。 */
function savedStudyQuery(workspace: string | undefined, sid: string) {
  return queryOptions({
    queryKey: ['study-context', workspace, sid, 'response'],
    queryFn: async ({signal}) => {
      if (!workspace) {
        const response = await fetch(`/api/studies/${encodeURIComponent(sid)}`, {signal});
        const value = await response.json();
        if (!response.ok) throw new ApiError(response.status, String(optionalRecord(value.detail).message || value.detail || '研究读取失败'));
        return record(value, '研究');
      }
      const value = await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}', {params:{path:{wid:workspace,sid}},signal})).catch(async error => {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        const rows = await responseData(api.GET('/api/workspaces/{wid}/studies', {params:{path:{wid:workspace}},signal}));
        const found = Array.isArray(rows) ? rows.find(row => optionalRecord(row).id === sid) : undefined;
        if (!found) throw error;
        return found;
      });
      return record(value, '研究');
    },
    staleTime: 30000,
  });
}

/**
 * 研究工作区的查询定义。组件与路由 loader 共用同一份 key 和请求，
 * 这样悬停预取、进入路由前预取和组件内读取命中同一份缓存（参考 TanStack Router basic-react-query 示例）。
 */
export function studyContextQuery(client: QueryClient, workspace: string | undefined, sid: string, run = '', module = '', tab = '') {
  return queryOptions({
    queryKey: ["study-context", workspace, sid],
    queryFn: async () => {
      if (!workspace) {
        const study = await client.fetchQuery(savedStudyQuery(undefined, sid));
        const wid = String(study.workspace);
        client.setQueryData(savedStudyQuery(wid, sid).queryKey, study);
        const analysis=rootModule(optionalRecord(study.definition) as StudyDefinition);
        // Ordinary /studies/:id links discover ownership here. Start the same
        // verified conclusion as explicit-workspace links before the redirect;
        // otherwise it waits for a second route load after the field is ready.
        if(analysis==='thermal-field') {
          const rid=run || String(optionalRecord(study.latest_run).id || '');
          if(rid)void client.prefetchQuery(femConclusionQuery(wid,rid));
        }
        if ((run || study.latest_run) && ['ampacity','thermal-field','selection'].includes(analysis))
          void import('@/features/field/field-view').catch(()=>{});
        // 归属已核验即可读选中运行，不等工程模型的大响应完成。
        void client.prefetchQuery(studyRunsQuery(client, wid, sid, run,
          module || rootModule(optionalRecord(study.definition) as StudyDefinition), tab));
        const state = await client.fetchQuery(workspaceQuery(wid));
        const projected=[projectStudy(study,state,optionalRecord(study.model_reference))];
        client.setQueryData(['study-context',wid,sid],projected);
        return projected;
      }
      const [study, state] = await Promise.all([
        client.fetchQuery(savedStudyQuery(workspace, sid)),
        client.fetchQuery(workspaceQuery(workspace)),
      ]);
      // 同一次请求已拿到工程，直接写入工程缓存，避免组件挂载后再请求一遍。
      client.setQueryData(workspaceQuery(workspace).queryKey, state);
      return [projectStudy(study, state, record(state.study_cable_reference || {}, '引用型号'))];
    },
    staleTime:30000,
  });
}

export function workspaceQuery(wid: string | undefined) {
  return queryOptions({
    queryKey: ["workspace", wid],
    queryFn: ({ signal }) => responseData(api.GET("/api/workspaces/{wid}", { params: { path: { wid: wid! } }, signal })).then(value => record(value, "工程")),
  });
}

/** 工程页和页内浏览器共用本工程研究读取；不遍历其他工程或运行历史。 */
export function projectStudiesQuery(wid: string) {
  return queryOptions({
    queryKey: ['study-index', wid, 'cards'],
    queryFn: async ({signal}) => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wid)}/studies?view=summary`, {signal});
      const value = await response.json();
      if (!response.ok) throw new ApiError(response.status, String(optionalRecord(value.detail).message || value.detail || '本工程研究读取失败'));
      return array(value, '本工程研究').map(value =>
        projectStudy(value, {id:wid}, optionalRecord(optionalRecord(value).model_reference)));
    },
  });
}

export function studyRunsQuery(client: QueryClient, wid: string | undefined, sid: string, run: string, module = '', tab = '') {
  const evidence = ['detail', 'validation', 'sources', 'inputs', 'parameters'].includes(tab) || module === 'method-compare';
  return queryOptions({
    queryKey: ["runs", wid, sid, run || 'latest', run ? '' : module, evidence ? 'evidence' : 'detail'],
    queryFn: async () => {
      const detail = (rid: string) => client.fetchQuery({queryKey:['saved-run',wid,sid,rid,evidence ? 'evidence' : 'detail'],
        queryFn:async({signal: detailSignal}) => {
          if (!evidence) return record(await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', {params:{path:{wid:wid!,sid,rid}},signal:detailSignal})), '运行详情');
          const response = await fetch(`/api/workspaces/${encodeURIComponent(wid!)}/studies/${encodeURIComponent(sid)}/runs/${encodeURIComponent(rid)}?view=evidence`, {signal:detailSignal});
          const value = await response.json();
          if (!response.ok) throw new ApiError(response.status, String(optionalRecord(value.detail).message || value.detail || '保存依据读取失败'));
          return record(value,'运行依据');
        },
        staleTime: query => ['accepted','queued','running','validating'].includes(String(query.state.data?.status)) ? 0 : 30000});
      if (run) return [await detail(run)];
      if (!wid) return [];
      const study = await client.fetchQuery(savedStudyQuery(wid, sid));
      const definition = optionalRecord(study.definition) as StudyDefinition;
      // Only the requested module's current saved run. History belongs to the drawer.
      const configured = !!definition.modules?.[module];
      const latest = optionalRecord(study.latest_module_run_ids);
      const id = configured ? latest[module]
        : !module || module === rootModule(definition) ? (latest[''] || optionalRecord(study.latest_run).id)
          : optionalRecord(study.latest_run).id;
      return id ? [await detail(String(id))] : [];
    },
  });
}

/** 空闲时预取轻量目录；输入契约由需要表单的组件按选定能力读取。 */
export function prefetchCatalogs(client: QueryClient) {
  // 不传 signal：离开当前页时不随旧页面一起被取消。
  void client.prefetchQuery(methodCardsQuery());
}

/** 进入研究前并行预取研究、工程与运行；失败留给页面自己的错误状态处理，不在 loader 抛出。 */
export function prefetchStudy(client: QueryClient, workspace: string, sid: string, run: string) {
  // The ordinary entry first discovers ownership and then redirects to a tab.
  // Download its existing workbench in parallel, rather than start that second
  // chunk chain only after the provider has committed the verified context.
  // The route keeps its own component loading/error handling.
  void import('@/pages/study-workspace').catch(() => {});
  prefetchCatalogs(client);
  // On a full navigation the explicit destination is already in the address.
  // Its conclusion may start before even the study-card read; the endpoint
  // verifies ownership and capability. Hover prefetch on other pages keeps the
  // metadata-gated path below and never guesses a method from a run ID.
  if (workspace && run && typeof window!=='undefined'
      && window.location.pathname===`/studies/${sid}/thermal-field/results`)
    void client.prefetchQuery(femConclusionQuery(workspace,run));
  if (!workspace) {
    // The provider already owns the complete loading/error state. Blocking the
    // route on ownership discovery also invokes its minimum pending duration,
    // delaying the same cached workspace after its verified data has arrived.
    void client.prefetchQuery(studyContextQuery(client, workspace, sid, run));
    return;
  }
  // The mounted provider owns loading/error states on both entry paths. Do not
  // make an explicit-workspace navigation wait for the router's minimum pending
  // duration after these same verified query results have already arrived.
  void Promise.all([
    client.prefetchQuery(studyContextQuery(client, workspace, sid)),
    client.prefetchQuery(studyRunsQuery(client, workspace, sid, run)),
    client.fetchQuery(savedStudyQuery(workspace, sid)).then(study => {
      // Start the saved FEM conclusion once study ownership/type is known,
      // so it does not become a second request chain after the display finishes.
      // The mounted conclusion uses this exact key; the host still verifies it.
      if (rootModule(optionalRecord(study.definition) as StudyDefinition)==='thermal-field') {
        const rid=run || String(optionalRecord(study.latest_run).id || '');
        if (rid) void client.prefetchQuery(femConclusionQuery(workspace,rid));
      }
      // 场图是这些研究的默认画布；在等待工程输入时准备组件，
      // 不等完整运行回来后再串行下载，也不读取证明或全网格。
      if ((run || study.latest_run) && ['ampacity','thermal-field','selection'].includes(rootModule(optionalRecord(study.definition) as StudyDefinition)))
        void import('@/features/field/field-view').catch(() => { /* 画布自身保留加载失败状态。 */ });
    }).catch(() => { /* 页面保留请求失败状态。 */ }),
  ]);
}
