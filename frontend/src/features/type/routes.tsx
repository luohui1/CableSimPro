import { useEffect } from 'react';
import { createRoute, Outlet, useNavigate, useParams, useSearch, type AnyRootRoute } from '@tanstack/react-router';
import { lazyWorkbenchRoute } from '@/lib/lazy-workbench-route';
import { TypeNavigationContext, type TypeLocation } from './navigation';
import { typeModules } from './module-definitions';
import { queryClient } from '@/lib/query-client';
import { loadWorkspace, typeEvidence, moduleMethods, runArtifact, typeRequirements } from './api';
import { typeComparison, typeSpecification } from './version-api';
import {preloadTypeModule} from './module-loader';
import { isRatingDefinition, typeStudies } from './rating-api';
import { inputContractQuery } from '@/api/input-contracts';
const TypeListPage = lazyWorkbenchRoute(() => import('./list-page'), 'TypeListPage');
const TypeProvider = lazyWorkbenchRoute(() => import('./provider'), 'TypeProvider');
const TypeWorkspace = lazyWorkbenchRoute(() => import('./workspace'), 'TypeWorkspace');

export function typeSearch(value: Record<string, unknown>) { return { theme: value.theme === 'dark' ? 'dark' as const : 'light' as const,
  create: value.create === '1' || value.create === 1 || value.create === true ? true : undefined,
  revision: Number.isInteger(Number(value.revision)) && Number(value.revision) >= 1 ? Number(value.revision) : undefined,
  run: typeof value.run === 'string' && value.run ? value.run : undefined, layer: typeof value.layer === 'string' && value.layer.length <= 200 ? value.layer : undefined,
  field: typeof value.field === 'string' && value.field.startsWith('/') && value.field.length <= 800 ? value.field : undefined }; }
function Navigation({ children, location }: { children: React.ReactNode; location: TypeLocation }) {
  const navigate = useNavigate();
  useEffect(() => { document.documentElement.dataset.theme = location.theme; }, [location.theme]);
  const go = (path: string) => { const target = new URL(path, window.location.origin); void navigate({ to: target.pathname, search: typeSearch(Object.fromEntries(target.searchParams)) }); };
  return <TypeNavigationContext.Provider value={{ location, navigate: go, onTheme: () => {
    const next = location.theme === 'light' ? 'dark' : 'light'; const url = new URL(window.location.href); url.searchParams.set('theme', next); go(url.pathname + url.search);
  } }}>{children}</TypeNavigationContext.Provider>;
}
/** The public router owner adds these children to the existing root. No second production shell. */
export function createTypeRoutes(root: AnyRootRoute) {
  const list = createRoute({ getParentRoute: () => root, path: '/types', validateSearch: typeSearch, component: function TypeIndexRoute() {
    const search = useSearch({ strict: false });
    const location = { module: 'list', tab: '', ...typeSearch(search as Record<string, unknown>) };
    return <Navigation location={location}><TypeListPage /></Navigation>;
  } });
  const parent = createRoute({ getParentRoute: () => root, path: '/types/$wid', validateSearch: typeSearch, beforeLoad: ({ params, search, location }) => {
    // Start the selected saved input together with both route bundles, rather
    // than waiting for the provider bundle before issuing the first read.
    const workspace = queryClient.fetchQuery({ queryKey: ['type-workspace', params.wid, search.revision, search.run],
      queryFn: ({ signal }) => loadWorkspace(params.wid, signal, search.revision, search.run), staleTime: 0 });
    void workspace.catch(()=>{ /* The provider retains its loading/error state. */ });
    const module=location.pathname.split('/')[3]||'structure';
    const tab=location.pathname.split('/')[4]||typeModules.find(item=>item.id===module)?.tabs[0][0]||'section';
    if(module!=='structure')void preloadTypeModule(module);
    void TypeProvider.preload?.();
    void TypeWorkspace.preload?.();
    if(module==='comparison')void queryClient.prefetchQuery({queryKey:['type-comparison',params.wid],
      queryFn:({signal})=>typeComparison(params.wid,signal),staleTime:30000});
    if(module!=='structure'||tab==='quantities'||!!search.run||search.revision!==undefined) {
      // Start the actual module and its saved evidence alongside the workspace,
      // instead of downloading them only after the shell has mounted.
      const history=!!search.run||search.revision!==undefined||queryClient.getQueryData(['type-evidence-history',params.wid])===true;
      const evidence = queryClient.fetchQuery({queryKey:['type-evidence',params.wid,history?'history':'recent',module],
        queryFn:({signal})=>typeEvidence(params.wid,AbortSignal.any([signal,AbortSignal.timeout(20000)]),!history,module),retry:false,staleTime:30000});
      // The requirement directory depends on the selected immutable run, not
      // on React mounting its table. Begin that read as soon as evidence arrives.
      void evidence.then(items=>{
        if(module!=='requirements')return;
        const selected=search.run ? items.find(item=>item.run.id===search.run) : items.find(item=>
          ['succeeded','partial'].includes(String(item.run.status))&&
          (search.revision===undefined||(item.run.snapshot as Record<string,unknown>).workspace_revision===search.revision)&&
          runArtifact(item.run,'cablesim.standard-check/1'));
        if(selected)void queryClient.prefetchQuery({queryKey:['type-requirements',params.wid,selected.run.id],
          queryFn:({signal})=>typeRequirements(params.wid,String(selected.run.id),signal)});
      }).catch(()=>{ /* The module presents the query error and its retry action. */ });
      void queryClient.prefetchQuery({queryKey:['type-method-catalog'],queryFn:({signal})=>moduleMethods(signal)});
      if(module==='specification')void queryClient.prefetchQuery({queryKey:['type-specification',params.wid,'customer'],
        queryFn:({signal})=>typeSpecification(params.wid,signal,'customer'),staleTime:30000});
    }
    if(!search.run&&search.revision===undefined&&['electrical','short-circuit','rating-table'].includes(module)) {
      void workspace.then(saved=>{
        if((saved.raw.type_lifecycle as Record<string,unknown>|undefined)?.status==='published')return;
        const studies = queryClient.fetchQuery({queryKey:['type-studies',params.wid],queryFn:({signal})=>typeStudies(params.wid,signal),staleTime:15000});
        void studies.catch(()=>{ /* The editable page reports the study read failure. */ });
        if(tab==='parameters'&&module==='rating-table') {
          // Match TypeRatingTable's current saved study, never an installed or
          // historical replacement. Its pinned contract can load while the
          // independent saved-result evidence is still being verified.
          void studies.then(items=>{
            const selected=items.filter(item=>isRatingDefinition(item.definition)).sort((a,b)=>b.created.localeCompare(a.created))[0];
            if(selected)void queryClient.prefetchQuery(inputContractQuery(selected.definition.method));
          }).catch(()=>{ /* The method form keeps its contract/error state. */ });
        }
        if(tab==='parameters'&&module!=='rating-table') {
          // Resolve the same installed capability as the editable method page.
          // Historical pages continue to select their saved method from evidence.
          void import('./run-control').then(({methodForArtifact})=>queryClient.fetchQuery({queryKey:['type-method',module],
            queryFn:({signal})=>methodForArtifact('x-cablesim.type-'+module,signal),staleTime:30000}))
            .then(method=>queryClient.prefetchQuery(inputContractQuery(method)))
            .catch(()=>{ /* The method page presents its normal retry state. */ });
        }
      }).catch(()=>{ /* The provider reports failed workspace reads. */ });
    }
  }, component: function TypeWorkspaceRoute() {
    const params = useParams({ strict: false }) as Record<string, string | undefined>;
    const search = typeSearch(useSearch({ strict: false }) as Record<string, unknown>);
    const module = params.module || 'structure';
    const location = { wid: params.wid, module, tab: params.tab || typeModules.find(item => item.id === module)?.tabs[0][0] || 'section', ...search };
    document.documentElement.dataset.theme = location.theme;
    return <Navigation location={location}><TypeProvider key={params.wid + '/' + String(search.revision) + '/' + String(search.run)} wid={params.wid!}><Outlet /></TypeProvider></Navigation>;
  } });
  const content = createRoute({ getParentRoute: () => parent, path: '$module/$tab', component: () => <TypeWorkspace /> });
  const moduleEntry = createRoute({ getParentRoute: () => parent, path: '$module', component: () => <TypeWorkspace /> });
  const entry = createRoute({ getParentRoute: () => parent, path: '/', component: () => <TypeWorkspace /> });
  return [list, parent.addChildren([content, moduleEntry, entry])] as const;
}
