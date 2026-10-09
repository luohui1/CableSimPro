import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, optionalRecord, record, responseData } from "@/api/client";
import { methodCatalog, projectStudy, studyIndex, type StudyDefinition } from "@/api/research";
import { inputContracts } from "@/api/input-contracts";
import { rootModule } from '@/lib/study-config';

/** 同一响应供上下文与运行读取共用；工程大输入的传输不挡住运行详情。 */
function savedStudyQuery(workspace: string, sid: string) {
  return queryOptions({
    queryKey: ['study-context', workspace, sid, 'response'],
    queryFn: async ({signal}) => {
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
export function studyContextQuery(client: QueryClient, workspace: string | undefined, sid: string) {
  return queryOptions({
    queryKey: ["study-context", workspace, sid],
    queryFn: async ({ signal }) => {
      if (!workspace) return studyIndex(signal);
      const [study, state] = await Promise.all([
        client.fetchQuery(savedStudyQuery(workspace, sid)),
        responseData(api.GET('/api/workspaces/{wid}', { params: { path: { wid: workspace } }, signal })).then(value => record(value, '工程')),
      ]);
      // 同一次请求已拿到工程，直接写入工程缓存，避免组件挂载后再请求一遍。
      client.setQueryData(workspaceQuery(workspace).queryKey, state);
      return [projectStudy(study, state, record(state.study_cable_reference || {}, '引用型号'))];
    },
  });
}

export function workspaceQuery(wid: string | undefined) {
  return queryOptions({
    queryKey: ["workspace", wid],
    queryFn: ({ signal }) => responseData(api.GET("/api/workspaces/{wid}", { params: { path: { wid: wid! } }, signal })).then(value => record(value, "工程")),
  });
}

export function studyRunsQuery(client: QueryClient, wid: string | undefined, sid: string, run: string, module = '') {
  return queryOptions({
    queryKey: ["runs", wid, sid, run || 'latest', run ? '' : module],
    queryFn: async () => {
      const detail = (rid: string) => client.fetchQuery({queryKey:['saved-run',wid,sid,rid],
        queryFn:({signal: detailSignal}) => responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', {params:{path:{wid:wid!,sid,rid}},signal:detailSignal})).then(value => record(value,'运行详情')),
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

/** 插件目录与输入契约：应用空闲时预取一次（参考 LobeChat routePreload 的空闲预加载），之后 5 分钟内各页直接命中缓存。 */
export function prefetchCatalogs(client: QueryClient) {
  // 不传 signal：离开当前页时不随旧页面一起被取消。
  void client.prefetchQuery({ queryKey: ["input-contracts"], queryFn: () => inputContracts() });
  void client.prefetchQuery({ queryKey: ["method-catalog"], queryFn: () => methodCatalog() });
}

/** 进入研究前并行预取研究、工程与运行；失败留给页面自己的错误状态处理，不在 loader 抛出。 */
export function prefetchStudy(client: QueryClient, workspace: string, sid: string, run: string) {
  prefetchCatalogs(client);
  if (!workspace) return client.prefetchQuery(studyContextQuery(client, workspace, sid));
  return Promise.all([
    client.prefetchQuery(studyContextQuery(client, workspace, sid)),
    client.prefetchQuery(studyRunsQuery(client, workspace, sid, run)),
    client.fetchQuery(savedStudyQuery(workspace, sid)).then(study => {
      // 场图是这些研究的默认画布；在等待工程输入时准备组件，
      // 不等完整运行回来后再串行下载，也不读取证明或全网格。
      if ((run || study.latest_run) && ['ampacity','thermal-field','selection'].includes(rootModule(optionalRecord(study.definition) as StudyDefinition)))
        void import('@/features/field/field-view').catch(() => { /* 画布自身保留加载失败状态。 */ });
    }).catch(() => { /* 页面保留请求失败状态。 */ }),
  ]);
}
