import ElectrothermalInput,{type ElectricalArguments,type SavedElectricalInput} from './ElectrothermalInput';
import PluginResult,{type PluginExecution} from './PluginResult';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Box,Check,ChevronRight,Download,Search,ShieldCheck} from 'lucide-react';
import './plugin-center.css';

type Pin={plugin_id:string;version:string;release_sha256:string;permissions:string[]};
type Manifest={plugin_id:string;version:string;name:string;publisher:string;category:string;distribution:string;
 permissions:string[];dependencies:{plugin_id:string;version:string}[];requirements:{distribution:string;version:string}[];
 upstream_license:string;adapter_license:string;scope:{description:string;limitations:string[];validation:string;evidence:string[]};
 commands:{id:string;title:string;effect:string}[]};
type Entry={manifest:Manifest;release_sha256:string;installed:boolean;installable:boolean;integrity_ok:boolean|null;
 status:string;runtime:{metadata_ready:boolean;missing:string[]}};
type Catalog={state_revision:number;items:Entry[];catalog_sha256:string};
type Plan={plugin_id:string;version:string;state_revision:number;plan_sha256:string;plugins:Pin[];license_review_required:boolean;runtime_requirements:string[]};
type Lock={lock:{project_revision:number;lock_revision:number;plugins:Pin[]};lock_sha256:string};
type Job={id:string;command:string;status:string;output:null|{artifacts:{path:string}[];result:unknown}};
type Project={id:string;name:string;revision:number};
const labels:Record<string,string>={all:'全部能力',design:'电缆设计',mesh:'几何与网格',analysis:'计算与有限元',data:'数据交换',visualization:'结果可视化',report:'报告交付',validation:'独立验证'};
const permissionLabels:Record<string,string>={'project.read':'读取工程快照','project.propose':'生成待审批变更','study.run':'执行研究任务','artifact.read':'读取本项目工件','artifact.write':'创建新工件'};
async function request<T>(path:string,body?:unknown):Promise<T>{
 const r=await fetch(path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:data.detail?.message??`请求失败 HTTP ${r.status}`);return data;
}
function save(name:string,body:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export default function PluginCenter({context,onBack,onBusyChange}:{context?:Project&{blocked:boolean};onBack?:()=>void;onBusyChange?:(busy:boolean)=>void}={}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[projects,setProjects]=useState<Project[]>([]),[project,setProject]=useState(context?.id??'');
 const [category,setCategory]=useState('all'),[query,setQuery]=useState(''),[selected,setSelected]=useState('cablesim.thermal2d');
 const [plan,setPlan]=useState<Plan|null>(null),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [lock,setLock]=useState<Lock|null>(null),[jobs,setJobs]=useState<Job[]>([]),[source,setSource]=useState('');
 const [heat,setHeat]=useState(''),[surface,setSurface]=useState(''),[metalK,setMetalK]=useState(''),[conductorK,setConductorK]=useState('');
 const [electrical,setElectrical]=useState<ElectricalArguments|null>(null),[electricalSnapshot,setElectricalSnapshot]=useState<SavedElectricalInput|null>(null);
 const [domainScale,setDomainScale]=useState('8');
 const [result,setResult]=useState<PluginExecution|null>(null);
 useEffect(()=>{setResult(null)},[electrical]);
 useEffect(()=>{let live=true;setElectricalSnapshot(null);if(project)void request<SavedElectricalInput>(`/api/workspaces/${project}`).then(w=>{if(live)setElectricalSnapshot(w)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[project,context?.revision]);
 const liveContext=useRef(context);liveContext.current=context;
 useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange]);
 useEffect(()=>{if(context)setProject(context.id);setResult(null)},[context?.id,context?.revision,context?.blocked]);
 useEffect(()=>{setResult(null)},[heat,surface,metalK,conductorK,source,domainScale]);
 useEffect(()=>{let live=true;Promise.all([request<Catalog>('/api/plugins/catalog'),request<Project[]>('/api/workspaces')]).then(([c,p])=>{if(live){setCatalog(c);setProjects(p)}}).catch(e=>{if(live)setError(String(e.message))});return()=>{live=false}},[]);
 useEffect(()=>{setPlan(null);setConsent(false);setSource('');setResult(null)},[selected]);
 useEffect(()=>{let live=true;setLock(null);setJobs([]);setSource('');setPlan(null);setResult(null);if(project)Promise.all([request<Lock>(`/api/plugins/workspaces/${project}/lock`),request<{items:Job[]}>(`/api/plugins/workspaces/${project}/jobs`)]).then(([l,j])=>{if(live){setLock(l);setJobs(j.items)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[project,context?.revision]);
 async function act(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}}
 async function refresh(){setCatalog(await request<Catalog>('/api/plugins/catalog'));if(project){setLock(await request<Lock>(`/api/plugins/workspaces/${project}/lock`));setJobs((await request<{items:Job[]}>(`/api/plugins/workspaces/${project}/jobs`)).items)}}
 const item=catalog?.items.find(i=>i.manifest.plugin_id===selected),m=item?.manifest;
 const filtered=catalog?.items.filter(i=>(category==='all'||i.manifest.category===category)&&`${i.manifest.name} ${i.manifest.plugin_id} ${i.manifest.scope.description}`.toLowerCase().includes(query.toLowerCase()))??[];
 const projectPin=lock?.lock.plugins.find(p=>p.plugin_id===selected);
 const enabled=!!projectPin&&projectPin.release_sha256===item?.release_sha256;
 const command=m?.commands[0];
 const needsSource=!!command&&['meshio.to-vtu','skfem.radial-thermal','pyvista.field-summary'].includes(command.id);
 const producer=command?.id==='pyvista.field-summary'?'skfem.radial-thermal':'gmsh.cable-section';
 const sources=jobs.filter(j=>j.command===producer&&j.status==='succeeded');
 const thermal=command?.id==='skfem.radial-thermal',buried=command?.id==='skfem.buried-reference',electrothermal=command?.id==='skfem.electrothermal-reference';
 const numbersValid=(buried?[heat,metalK,conductorK]:[heat,surface,metalK,conductorK]).every(x=>x.trim()!==''&&Number.isFinite(Number(x)))&&Number(heat)>=(buried?0:Number.MIN_VALUE)&&Number(heat)<=1000&&(buried||(Number(surface)>=-20&&Number(surface)<=110))&&Number(metalK)>1&&Number(metalK)<=500&&Number(conductorK)>1&&Number(conductorK)<=500;
 function status(e:Entry){return e.status==='roadmap'?'规划中':e.status==='host-builtin'?'内建能力':e.status==='integrity-error'?'完整性异常':e.installed?(e.runtime.metadata_ready?'已安装 · 待运行验证':'已安装 · 缺运行环境'):'可登记安装'}
 async function execute(){if(!m||!command||!lock||context?.blocked)return;setResult(null);const revision=lock.lock.project_revision,projectId=project;const arguments_:Record<string,unknown>={};
  if(command.id==='cadquery.cable-step')arguments_.preview_length_m=.25;
  if(command.id==='gmsh.cable-section')arguments_.resolution=16;
  if(needsSource)arguments_.source_job_id=source;
  if(thermal)Object.assign(arguments_,{heat_w_m:Number(heat),surface_temperature_c:Number(surface),conductor_k_w_m_k:Number(conductorK),metal_screen_k_w_m_k:Number(metalK)});
  if(electrothermal){if(!electrical||electricalSnapshot?.revision!==revision)return;Object.assign(arguments_,electrical)}
  if(buried)Object.assign(arguments_,{conductor_powers_w_m:[Number(heat),Number(heat),Number(heat)],conductor_k_w_m_k:Number(conductorK),metal_screen_k_w_m_k:Number(metalK),domain_scale:Number(domainScale),resolution:16});
  const r=await request<PluginExecution>(`/api/plugins/workspaces/${project}/invoke`,{plugin_id:m.plugin_id,command:command.id,request_id:crypto.randomUUID(),expected_revision:lock.lock.project_revision,lock_sha256:lock.lock_sha256,arguments:arguments_,confirmed:true});if(!liveContext.current||(liveContext.current.id===projectId&&liveContext.current.revision===revision&&!liveContext.current.blocked))setResult(r);await refresh();
 }
 return <main className="plugin-center">
  <header className="plugin-top"><a href="/" aria-label={onBack?"返回当前工程":"返回工程首页"} onClick={onBack?e=>{e.preventDefault();if(!busy)onBack()}:undefined}><ArrowLeft size={17}/>{onBack?"返回当前工程":"CableSimPro"}</a><span>插件中心 <small>PREVIEW</small></span><button disabled={busy} onClick={()=>void act(refresh)}>刷新目录</button></header>
  <div className="plugin-layout"><aside className="plugin-categories"><h2>工程能力</h2><nav aria-label="插件分类">{Object.entries(labels).map(([key,label])=><button disabled={busy} aria-current={category===key?'page':undefined} key={key} onClick={()=>setCategory(key)}>{label}</button>)}</nav><p>本机精选目录<br/>无自动下载与代码执行</p><a href="/api/plugins/spec" target="_blank" rel="noreferrer">查看插件契约 ↗</a></aside>
  <section className="plugin-discovery" aria-label="插件目录"><div className="plugin-heading"><div><h1>把工程能力接入项目</h1><p>按需安装，按项目启用。能力范围与验证证据分开查看。</p></div><span className="plugin-local">本机目录</span></div>
   <label className="plugin-search"><Search size={18}/><input aria-label="搜索插件" placeholder="搜索设计、网格、有限元或报告" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div className="plugin-project"><label htmlFor="plugin-project">当前项目</label><select id="plugin-project" value={project} disabled={busy||!!context} onChange={e=>setProject(e.target.value)}><option value="">只浏览目录，不创建工程</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>{lock&&<button onClick={()=>save('project-plugin-lock.json',lock)}><Download size={15}/>导出插件锁</button>}</div>
   {context?.blocked&&<p className="plugin-error" role="status">当前工程有未提交参数或正在操作，插件运行和项目启停已暂停。</p>}
   {error&&<div className="plugin-error" role="alert">{error}</div>}
   {!catalog&&<p role="status">正在读取本机插件目录…</p>}
   <div className="plugin-list">{filtered.map(e=><button key={e.manifest.plugin_id} className={`plugin-row ${selected===e.manifest.plugin_id?'selected':''}`} aria-pressed={selected===e.manifest.plugin_id} data-testid={e.manifest.plugin_id} disabled={busy} onClick={()=>setSelected(e.manifest.plugin_id)}><span className="plugin-symbol"><Box size={22}/></span><span className="plugin-name"><strong>{e.manifest.name}</strong><small>{e.manifest.plugin_id} · {e.manifest.version}</small></span><span className="plugin-row-status">{status(e)}</span><ChevronRight size={16}/></button>)}</div>
   {catalog&&filtered.length===0&&<p>没有匹配的插件。</p>}
  </section>
  {item&&m&&<aside className="plugin-detail" aria-label="插件详情"><div className="plugin-detail-heading"><span>{labels[m.category]}</span><h2>{m.name}</h2><p>{m.publisher}</p><small>{m.version} · API 1</small></div>
   <p className="plugin-description">{m.scope.description}</p>
   <div className="plugin-trust"><ShieldCheck size={18}/><span>文件完整性：{item.integrity_ok===null?'无发行包':item.integrity_ok?'与目录一致':'不一致'}<br/>工程验证：{m.scope.validation==='unverified'?'尚未形成发布级验证证据':m.scope.validation}</span></div>
   {projectPin&&!enabled&&<p className="plugin-error">项目锁定 v{projectPin.version}，与当前发行版不同。先按依赖顺序显式停用旧版本，再核对新版本；不会自动迁移。</p>}
   <section><h3>适用边界</h3>{m.scope.limitations.map(x=><p key={x}>{x}</p>)}</section>
   <section><h3>请求权限</h3><div className="plugin-permissions">{m.permissions.map(p=><span key={p}>{permissionLabels[p]}</span>)}</div>{!m.permissions.length&&<p>实现前不授予执行权限。</p>}</section>
   <details><summary>依赖、许可证与版本摘要</summary><p>适配器：{m.adapter_license}</p><p>上游：{m.upstream_license||'不适用'}</p>{m.dependencies.map(d=><p key={d.plugin_id}>{d.plugin_id} @ {d.version}</p>)}<code>{item.release_sha256}</code><p>文件哈希不等于发布者签名，也不等于数值验证。</p></details>
   {m.distribution==='roadmap'?<div className="plugin-unavailable">尚未实现。仅登记接入方向，不提供虚假安装按钮。</div>:m.distribution==='core'?<p className="plugin-unavailable">内建能力已注册；原有工作台和人工审查流程保持不变。</p>:<div className="plugin-actions">
    {!item.installed?<button className="plugin-primary" disabled={busy||!item.installable} onClick={()=>void act(async()=>{setPlan(await request<Plan>('/api/plugins/install-plan',{plugin_id:m.plugin_id,version:m.version}));setConsent(false)})}>审查安装</button>:<><button disabled={busy||context?.blocked||!project||!lock} onClick={()=>void act(async()=>{if(!lock)return;setLock(await request<Lock>(`/api/plugins/workspaces/${project}/enable`,{plugin_id:m.plugin_id,expected_revision:lock.lock.project_revision,lock_revision:lock.lock.lock_revision,enabled:!projectPin,approved:true}));setSource('')})}>{projectPin?(enabled?'从项目停用':'停用项目锁定的旧版本'):'为当前项目启用'}</button><button disabled={busy} onClick={()=>void act(async()=>{if(!catalog)return;setCatalog(await request<Catalog>('/api/plugins/uninstall',{plugin_id:m.plugin_id,state_revision:catalog.state_revision,approved:true}))})}>卸载登记</button></>}
   </div>}
   {plan&&<section className="plugin-plan" aria-label="安装审查"><h3>确认依赖与权限</h3>{plan.plugins.map(p=><p key={p.plugin_id}><b>{p.plugin_id}</b> @ {p.version}<br/>{p.permissions.map(x=>permissionLabels[x]).join('、')}</p>)}<p>本次只登记随源码提供的适配器，不下载上游包，不修改工程。</p>{plan.license_review_required&&<p>包含许可审查项：进程分离不免除上游许可证义务。</p>}<label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我已核对以上权限、依赖和许可限制</label><button className="plugin-primary" disabled={busy||!consent} onClick={()=>void act(async()=>{await request('/api/plugins/install',{plugin_id:plan.plugin_id,version:plan.version,plan_sha256:plan.plan_sha256,state_revision:plan.state_revision,approved:true,license_acknowledged:consent,grants:Object.fromEntries(plan.plugins.map(p=>[p.plugin_id,p.permissions]))});setPlan(null);await refresh()})}><Check size={16}/>确认登记安装</button></section>}
   {m.distribution==='bundled-adapter'&&<section><h3>运行环境</h3>{item.runtime.missing.length?<><p>尚不能运行。请在独立测试环境准备以下准确版本，勿覆盖生产环境：</p><code>{item.runtime.missing.join('\n')}</code></>:<p>包版本已匹配；原生导入与实际执行仍须通过任务验证。</p>}</section>}
   {m.distribution==='bundled-adapter'&&<details className="plugin-run"><summary>适配器验证台</summary><p>{electrothermal?'同一工程上的损耗—温度反馈与温度限值电流研究；不修改设计或替换宿主结果。':buried?'读取当前工程的三相布置、埋深、材料热阻率与环境温度。网格包含三根六层电缆和均匀土壤，不从运行电流推算发热。':'读取当前项目已保存快照。生成独立工件，不覆盖当前载流量结果。CAD 默认展示段长 0.25 m；网格为本体六层。'}</p>
    {electrothermal&&<ElectrothermalInput snapshot={electricalSnapshot} busy={busy} onChange={setElectrical}/>}
    {needsSource&&<label>来源任务<select aria-label="来源任务" disabled={busy} value={source} onChange={e=>setSource(e.target.value)}><option value="">选择本项目对应工件</option>{sources.map(j=><option key={j.id} value={j.id}>{j.command} · {j.id.slice(0,8)}</option>)}</select></label>}
    {(thermal||buried)&&<div className="plugin-form">{[[buried?'每相导体发热功率 W/m':'导体发热功率 W/m',heat,setHeat],...(!buried?[['缆表温度 °C',surface,setSurface]]:[]),['导体热导率 W/(m·K)',conductorK,setConductorK],['金属屏蔽热导率 W/(m·K)',metalK,setMetalK]].map(([label,value,setter])=><label key={label as string}>{label as string}<input disabled={busy} type="number" step="any" value={value as string} onChange={e=>(setter as (s:string)=>void)(e.target.value)} required/></label>)}</div>}
    {buried&&<><label>土壤计算域尺度<select aria-label="土壤计算域尺度" disabled={busy} value={domainScale} onChange={e=>setDomainScale(e.target.value)}>{['4','8','16'].map(v=><option value={v} key={v}>{v} 倍布置尺度</option>)}</select></label><p>界面设置三相等发热；API 可分别给定三相功率。地表、侧面和底部固定环境温度；扩大计算域检查截断影响，不把单次结果标为网格无关。</p></>}

    <button className="plugin-primary" disabled={busy||context?.blocked||!enabled||!item.runtime.metadata_ready||!project||(needsSource&&!source)||((thermal||buried)&&!numbersValid)||(electrothermal&&(!electrical||electricalSnapshot?.revision!==lock?.lock.project_revision))} onClick={()=>void act(execute)}>{busy?'正在执行…':`执行：${command?.title}`}</button>
    {result!=null&&!context?.blocked&&result.project_revision===lock?.lock.project_revision&&<PluginResult project={project} result={result}/>}
   </details>}
   {project&&jobs.length>0&&<details><summary>项目插件工件（{jobs.length}）</summary>{jobs.map(j=><div className="plugin-job" key={j.id}><b>{j.command}</b><small>{j.status} · {j.id.slice(0,8)}</small>{j.output?.artifacts?.map(a=><a key={a.path} href={`/api/plugins/workspaces/${project}/jobs/${j.id}/artifacts/${encodeURIComponent(a.path)}`} download>{a.path}</a>)}</div>)}</details>}
   <p className="plugin-security-note">精选本地适配器 · 非第三方沙箱<br/>未开放远程插件上传、公共发布或自动更新。</p>
  </aside>}
  </div>
 </main>;
}
