import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, array, optionalRecord, record, responseData } from "@/api/client";
import { projectStudy, type StudyDefinition } from "@/api/research";
import type { CatalogRow } from '@/api/catalogs';
import { moduleConfiguration, rootModule, studyEntryTab } from '@/lib/study-config';
import { moduleBehavior, moduleDefinitions } from '@/pages/study-modules';
import { femConclusionQuery } from '@/components/study-fem-conclusion';
import { inputContractQuery } from '@/api/input-contracts';
import { contractFields, seriesChart, studySweep } from '@/lib/heavy-components';

/** These existing input tables stay inside the workbench instead of a canvas alias. */
export function isSectionInputTable(module: string, tab: string) {
  return module === 'section' && ['coordinates', 'media'].includes(tab);
}

/** Match the workbench's existing redirects before choosing a saved-run view. */
export function studyRunDestination(module: string, tab: string, definition?: StudyDefinition) {
  const inputAlias = moduleBehavior.input.has(module)
    && !isSectionInputTable(module, tab)
    && (!tab || moduleDefinitions[module]?.tabs.some(item => item.id === tab));
  if (definition && (!module || inputAlias)) {
    module = rootModule(definition);
    tab = studyEntryTab(module);
  }
  const tabs = moduleDefinitions[module]?.tabs;
  tab ||= tabs?.[0]?.id || '';
  const methodTab = tabs?.find(item => item.id === 'parameters' || item.id === 'settings');
  if (methodTab?.id === tab) tab = tabs?.find(item => item.id !== methodTab.id)?.id || tab;
  return { module, tab };
}

/** Prepare only the requested scan surface while its saved data is loading. */
function prefetchStudyView(module: string, tab: string, hasSavedRun: boolean) {
  if (module !== 'sweep' || !['curve', 'points'].includes(tab)) return;
  void studySweep.preload().catch(() => { /* The visible module retains its loading/error boundary. */ });
  if (tab === 'curve' && hasSavedRun)
    void seriesChart.preload().catch(() => { /* The chart keeps its own loading/error boundary. */ });
}

/** Selection cards share one cache; the selected capability owns its full schema. */
export function methodCardsQuery() {
  return queryOptions({queryKey:['method-catalog','summary'], staleTime:30000,
    queryFn:async ({signal}) => {
      const value=await responseData(api.GET('/api/methods',{params:{query:{view:'summary'}},signal}));
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
        const destination = studyRunDestination(module, tab, optionalRecord(study.definition) as StudyDefinition);
        prefetchStudyView(destination.module, destination.tab, !!run || !!study.latest_run);
        void client.prefetchQuery(studyRunsQuery(client, wid, sid, run, destination.module, destination.tab));
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

/** Saved bytes are immutable; their currentness against edited inputs is not. */
export async function invalidateSavedStudyResults(client: QueryClient, wid: string | undefined) {
  if (!wid) return;
  await Promise.all(['saved-run', 'saved-field-view', 'fem-conclusion', 'study-compare-runs'].map(key =>
    client.invalidateQueries({queryKey:[key,wid],refetchType:'none'})));
}

export function studyRunsQuery(client: QueryClient, wid: string | undefined, sid: string, run: string, module = '', tab = '') {
  const evidence = ['detail', 'validation', 'sources', 'inputs', 'parameters'].includes(tab) || module === 'method-compare';
  return queryOptions({
    queryKey: ["runs", wid, sid, run || 'latest', run ? '' : module, evidence ? 'evidence' : 'detail'],
    queryFn: async () => {
      const study = wid ? await client.fetchQuery(savedStudyQuery(wid, sid)) : undefined;
      const definition = optionalRecord(study?.definition) as StudyDefinition;
      // The field viewer owns the authenticated display receipt. Keep the
      // full/evidence detail on its explicit tabs, rather than downloading the
      // same large display twice on entry. The saved input remains in this view.
      const field = !evidence && !!wid && ['', 'thermal-field'].includes(module)
        && rootModule(definition) === 'thermal-field';
      const detail = async (rid: string) => {
        if (field) {
          const value = await client.fetchQuery(savedFieldViewQuery(wid!, rid));
          if (value.study !== sid) throw new ApiError(404, '保存运行不属于本研究');
          return value;
        }
        return client.fetchQuery({queryKey:['saved-run',wid,sid,rid,evidence ? 'evidence' : 'detail'],
        queryFn:async({signal: detailSignal}) => {
          if (!evidence) return record(await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', {params:{path:{wid:wid!,sid,rid}},signal:detailSignal})), '运行详情');
          const response = await fetch(`/api/workspaces/${encodeURIComponent(wid!)}/studies/${encodeURIComponent(sid)}/runs/${encodeURIComponent(rid)}?view=evidence`, {signal:detailSignal});
          const value = await response.json();
          if (!response.ok) throw new ApiError(response.status, String(optionalRecord(value.detail).message || value.detail || '保存依据读取失败'));
          return record(value,'运行依据');
        },
        staleTime: query => ['accepted','queued','running','validating'].includes(String(query.state.data?.status)) ? 0 : 30000});
      };
      if (run) return [await detail(run)];
      if (!wid) return [];
      // Only the requested module's current saved run. History belongs to the drawer.
      const configured = !!definition.modules?.[module];
      const latest = optionalRecord(study?.latest_module_run_ids);
      const id = configured ? latest[module]
        : !module || module === rootModule(definition) ? (latest[''] || optionalRecord(study?.latest_run).id)
          : optionalRecord(study?.latest_run).id;
      return id ? [await detail(String(id))] : [];
    },
  });
}

/** One display cache for route prefetch, saved-run selection and canvas fallback. */
export function savedFieldViewQuery(wid: string, rid: string) {
  return queryOptions<Record<string,unknown>>({queryKey:['saved-field-view',wid,rid], retry:false,
    staleTime: query => ['accepted','queued','running','validating'].includes(String(query.state.data?.status)) ? 0 : 30000,
    queryFn:async({signal}) => {
      const response = await fetch(`/api/hpc/workspaces/${encodeURIComponent(wid)}/fields/${encodeURIComponent(rid)}/view`, {signal});
      const value = await response.json();
      if (!response.ok) throw new ApiError(response.status, String(optionalRecord(value.detail).message || value.detail || '保存场读取失败'));
      return record(value, '保存场');
    }});
}

/** 空闲时预取轻量目录；输入契约由需要表单的组件按选定能力读取。 */
export function prefetchCatalogs(client: QueryClient) {
  // 不传 signal：离开当前页时不随旧页面一起被取消。
  void client.prefetchQuery(methodCardsQuery());
}

/** Current inputs use the saved configuration's full pin, never an installed replacement. */
function prefetchCurrentInputs(client: QueryClient, definition: StudyDefinition, module: string, methodVisible: boolean, inspector?: string) {
  if (module === 'report') return;
  if (methodVisible && moduleDefinitions[module]?.tabs.some(item => item.id === 'parameters' || item.id === 'settings')) {
    const configuration = moduleConfiguration(definition, module);
    if (configuration) void client.prefetchQuery(inputContractQuery(configuration.method));
    return;
  }
  if (inspector === 'agent' || !definition.method) return;
  // Match StudyCrossingInputs: the ordinary input inspector exposes the root
  // method's crossings, not a guessed configuration for the selected module.
  const method = definition.method;
  const crossings = optionalRecord(definition.parameters).crossing_heat_sources;
  if (Array.isArray(crossings) && crossings.length) {
    void client.prefetchQuery(inputContractQuery(method));
    return;
  }
  void client.fetchQuery(methodCardsQuery()).then(catalog => {
    const plugin = catalog.find(row => optionalRecord(row.method).plugin_id === method.plugin_id);
    const capability = (Array.isArray(plugin?.capabilities) ? plugin.capabilities : []).map(optionalRecord).find(row => row.id === method.capability);
    if (Array.isArray(capability?.parameter_fields) && capability.parameter_fields.includes('crossing_heat_sources'))
      void client.prefetchQuery(inputContractQuery(method));
  }).catch(() => { /* The visible input inspector retains its normal read state. */ });
}

/** 进入研究前并行预取研究、工程与运行；失败留给页面自己的错误状态处理，不在 loader 抛出。 */
export function prefetchStudy(client: QueryClient, workspace: string, sid: string, run: string, module = '', tab = '', inspector?: string) {
  const methodTab = moduleDefinitions[module]?.tabs.find(item => item.id === 'parameters' || item.id === 'settings');
  const methodVisible = inspector === 'method' || !!methodTab && methodTab.id === tab;
  // The requested form should download alongside data, rather than introducing
  // a new Suspense wait after the saved evidence and exact contract arrive.
  if (methodVisible) void contractFields.preload().catch(() => {});
  ({module, tab} = studyRunDestination(module, tab));
  prefetchStudyView(module, tab, !!run);
  // The ordinary entry first discovers ownership and then redirects to a tab.
  // Download its existing workbench in parallel, rather than start that second
  // chunk chain only after the provider has committed the verified context.
  // The route keeps its own component loading/error handling.
  void import('@/pages/study-workspace').catch(() => {});
  prefetchCatalogs(client);
  // Explicit saved runs retain their snapshot-selected contract in the form;
  // prefetching the current study's pin here could read a different release.
  if (!run) void client.fetchQuery(savedStudyQuery(workspace || undefined, sid)).then(study => {
    const definition = optionalRecord(study.definition) as StudyDefinition;
    const destination = studyRunDestination(module, tab, definition);
    prefetchStudyView(destination.module, destination.tab, !!study.latest_run);
    prefetchCurrentInputs(client, definition, destination.module, methodVisible, inspector);
  }).catch(() => { /* The provider owns failed saved-study reads. */ });
  // The explicit route selects this saved field. Both entry and hover prefetch
  // use that destination, while the host verifies ownership and capability.
  if (workspace && run && module === 'thermal-field' && tab === 'results') {
    void client.prefetchQuery(femConclusionQuery(workspace,run));
    // This route explicitly selects a saved field. Its host endpoint verifies
    // ownership and source bytes; do not serialize it behind study metadata.
    void client.prefetchQuery(savedFieldViewQuery(workspace,run));
  }
  if (!workspace) {
    // The provider already owns the complete loading/error state. Blocking the
    // route on ownership discovery also invokes its minimum pending duration,
    // delaying the same cached workspace after its verified data has arrived.
    void client.prefetchQuery(studyContextQuery(client, workspace, sid, run, module, tab));
    return;
  }
  // The mounted provider owns loading/error states on both entry paths. Do not
  // make an explicit-workspace navigation wait for the router's minimum pending
  // duration after these same verified query results have already arrived.
  void Promise.all([
    client.prefetchQuery(studyContextQuery(client, workspace, sid, run, module, tab)),
    client.fetchQuery(savedStudyQuery(workspace, sid)).then(study => {
      // Input aliases need the actual study kind before their result destination
      // is known. The run query already waited for this same metadata; resolve
      // it here so the alias and mounted destination share one projection/key.
      const destination = studyRunDestination(module, tab, optionalRecord(study.definition) as StudyDefinition);
      prefetchStudyView(destination.module, destination.tab, !!run || !!study.latest_run);
      void client.prefetchQuery(studyRunsQuery(client, workspace, sid, run, destination.module, destination.tab));
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
