import {ScrollRegion} from '../design-system/WorkspacePage';
import {useEffect,useMemo,useState} from 'react';
import {useLegacyTable,getCoreRowModel,type LegacyColumnDef} from '@tanstack/react-table/legacy';
import {flexRender} from '@tanstack/react-table';
import {ArrowLeft,ArrowRight,Check,Download,FileText,FolderOpen,GitBranch,Plus,RefreshCw,Upload} from 'lucide-react';
import {useStudio} from '../StudioState';
import {Modal} from '../EngineeringPanels';
import {download} from '../utils';
import {Button,Badge,type Tone} from '../design-system/primitives';
import {CollectionWorkspace,CollectionSearch,CollectionEmpty,DetailHeading} from '../design-system/CollectionWorkspace';
import AssetPreview,{AssetGlyph} from './AssetPreview';
import {assetKinds,statusLabels,actionLabels,assetRequest,type AssetKind,type AssetStatus,type AssetAction,type AssetCatalog,type AssetDetail,type AssetRow,type AssetRelease} from './types';
import './asset-library.css';
const statusTones:Record<AssetStatus,Tone>={draft:'neutral',reviewed:'info',published:'success',deprecated:'warning'};
const eventLabels:Record<string,string>={created:'创建草稿',edited:'编辑定义',...actionLabels};
type Editor={kind:'capture';workspaceId:string;workspaceRevision:number}|{kind:'import'}|{kind:'edit';record:AssetDetail}|{kind:'derive';record:AssetDetail}|{kind:'transition';record:AssetDetail;action:AssetAction};
const PAGE_SIZE=30;
function AssetStatusBadge({status}:{status:AssetStatus}){return <Badge tone={statusTones[status]}>{statusLabels[status]}</Badge>}

export default function AssetLibrary({active,onBack}:{active:boolean;onBack:()=>void}){
 const s=useStudio();
 const [kind,setKind]=useState<AssetKind|''>(''),[status,setStatus]=useState<AssetStatus|''>(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0);
 const [epoch,setEpoch]=useState(0),[catalog,setCatalog]=useState<AssetCatalog|null>(null),[selected,setSelected]=useState('');
 const [detail,setDetail]=useState<AssetDetail|null>(null),[tab,setTab]=useState<'definition'|'dependencies'|'history'>('definition');
 const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState('');
 const [editor,setEditor]=useState<Editor|null>(null),[name,setName]=useState(''),[text,setText]=useState(''),[note,setNote]=useState(''),[ack,setAck]=useState(false),[version,setVersion]=useState('');
 const [saving,setSaving]=useState(false),[editorError,setEditorError]=useState('');
 const inputBlocked=s.busy||Object.keys(s.inputDrafts).length>0;
 useEffect(()=>{
  if(!active)return;
  const controller=new AbortController();let live=true;setLoading(true);setError('');
  const params=new URLSearchParams({q:query,limit:String(PAGE_SIZE),offset:String(offset)});
  if(kind)params.set('kind',kind);if(status)params.set('status',status);
  const timer=window.setTimeout(()=>{void assetRequest<AssetCatalog>(`/api/foundation/assets?${params}`,{signal:controller.signal}).then(data=>{if(live)setCatalog(data)}).catch(e=>{if(live&&!controller.signal.aborted)setError(e.message)}).finally(()=>{if(live)setLoading(false)})},180);
  return()=>{live=false;window.clearTimeout(timer);controller.abort()};
 },[active,kind,status,query,offset,epoch]);
 useEffect(()=>{
  if(!active||!selected){setDetail(null);return}
  const controller=new AbortController();let live=true;setDetailLoading(true);setDetailError('');setDetail(null);
  void assetRequest<AssetDetail>(`/api/foundation/assets/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(data=>{if(live)setDetail(data)}).catch(e=>{if(live&&!controller.signal.aborted)setDetailError(e.message)}).finally(()=>{if(live)setDetailLoading(false)});
  return()=>{live=false;controller.abort()};
 },[active,selected,epoch]);
 const record=detail?.id===selected&&!detailLoading?detail:null;
 function choose(id:string){setSelected(id);setTab('definition')}
 function filter(nextKind:AssetKind|''){setKind(nextKind);setOffset(0);setSelected('')}
 function edit(next:Editor){setEditor(next);setEditorError('');setNote('');setAck(false);setVersion('');
  setName(s.w?.scenario.cable.name+' · 结构');setText(next.kind==='edit'?JSON.stringify(next.record.release,null,2):'');}
 function capture(){if(!s.w||inputBlocked)return;edit({kind:'capture',workspaceId:s.w.id,workspaceRevision:s.w.revision})}
 async function readImport(file?:File){if(!file)return;if(file.size>256*1024){setEditorError('JSON 定义不得超过 256 KiB。');return}setText(await file.text());setEditorError('')}
 async function save(){
  if(!editor||saving)return;setSaving(true);setEditorError('');
  try{
   let result:AssetDetail;
   if(editor.kind==='capture'){
    if(inputBlocked||s.w?.id!==editor.workspaceId||s.w?.revision!==editor.workspaceRevision)throw new Error('工程输入已变化，请关闭后重新捕获当前版本。');
    result=await assetRequest(`/api/foundation/workspaces/${encodeURIComponent(editor.workspaceId)}/assets/capture`,{method:'POST',body:JSON.stringify({expected_revision:editor.workspaceRevision,name:name.trim()})});
   }else if(editor.kind==='import'){
    if(new TextEncoder().encode(text).length>256*1024)throw new Error('JSON 定义不得超过 256 KiB。');
    let parsed:unknown;try{parsed=JSON.parse(text)}catch{throw new Error('JSON 格式无效；请使用导出的资产定义或有效的 csp-asset/0.1 文件。')}
    result=await assetRequest('/api/foundation/assets/import',{method:'POST',body:JSON.stringify(parsed)});
   }else{
    const r=editor.record;const base=`/api/foundation/assets/${encodeURIComponent(r.id)}`;
    if(editor.kind==='edit'){
     let release:AssetRelease;try{release=JSON.parse(text)}catch{throw new Error('JSON 格式无效。')}
     result=await assetRequest(base,{method:'PUT',body:JSON.stringify({expected_revision:r.revision,release})});
    }else if(editor.kind==='derive'){
     result=await assetRequest(base+'/derive',{method:'POST',body:JSON.stringify({expected_revision:r.revision,content_sha256:r.content_sha256,new_version:version})});
    }else{
     result=await assetRequest(base+'/transition',{method:'POST',body:JSON.stringify({expected_revision:r.revision,content_sha256:r.content_sha256,action:editor.action,note,acknowledge_sources:ack})});
    }
   }
   setEditor(null);setKind(result.kind);setStatus('');setQuery('');setOffset(0);choose(result.id);setEpoch(x=>x+1);
  }catch(e){setEditorError(e instanceof Error?e.message:'资产操作未完成。')}finally{setSaving(false)}
 }
 const columns=useMemo<LegacyColumnDef<AssetRow>[]>(()=>[
  {id:'name',header:'资产 / 标识',cell:({row})=><button className="asset-row-name" onClick={()=>choose(row.original.id)} aria-label={`查看资产 ${row.original.name}`}><span className="asset-type-icon"><AssetGlyph kind={row.original.kind}/></span><span><b>{row.original.name}</b><small>{row.original.asset_id}</small></span></button>},
  {accessorKey:'version',header:'版本',cell:i=><code>{String(i.getValue())}</code>},
  {accessorKey:'status',header:'状态',cell:i=><AssetStatusBadge status={i.getValue() as AssetStatus}/>},
 ],[]);
 const data=catalog?.items??[];
 const table=useLegacyTable({data,columns,getCoreRowModel:getCoreRowModel()});
 const totalKinds=Object.values(catalog?.counts??{}).reduce((sum,n)=>sum+(n??0),0);
 const title=editor?.kind==='capture'?'保存结构草稿':editor?.kind==='import'?'导入资产定义':editor?.kind==='edit'?'编辑资产草稿':editor?.kind==='derive'?'派生新版本':editor?.kind==='transition'?actionLabels[editor.action]:'';
 return <>
  <CollectionWorkspace title="工程资产库" subtitle="版本化定义 · 精确引用 · 人工核对" onBack={onBack} actions={<><Button onClick={()=>edit({kind:'import'})}><Upload size={15}/>导入 JSON</Button><Button variant="primary" disabled={inputBlocked} onClick={capture} title={inputBlocked?'先提交或撤销工程输入':'将当前结构保存为草稿，不改变工程'}><Plus size={16}/>保存当前结构</Button></>} filters={<>
   <CollectionSearch label="搜索工程资产" value={query} onChange={v=>{setQuery(v);setOffset(0)}}/>
   <select aria-label="资产状态筛选" value={status} onChange={e=>{setStatus(e.target.value as AssetStatus|'');setOffset(0)}}><option value="">全部状态</option>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   <Button variant="quiet" aria-label="刷新资产库" onClick={()=>setEpoch(x=>x+1)} disabled={loading}><RefreshCw size={16}/></Button><span className="asset-local-label">本机资料库 · 非认证数据</span>
  </>}>
   <div className={`asset-browser ${selected?'has-selection':''}`}>
    <nav className="asset-taxonomy" aria-label="资产分类"><h2>分类</h2><button aria-pressed={kind===''} onClick={()=>filter('')}><FolderOpen size={17}/><span>全部资产</span><small>{totalKinds}</small></button>{Object.entries(assetKinds).map(([k,label])=><button key={k} aria-pressed={kind===k} onClick={()=>filter(k as AssetKind)}><AssetGlyph kind={k as AssetKind} size={17}/><span>{label}</span><small>{catalog?.counts[k as AssetKind]??0}</small></button>)}<p>素材不是模型。物性、几何配方与来源一并版本化。</p></nav>
    <section className="asset-list-pane" aria-label="资产列表" aria-busy={loading}>
     <header><h2>{kind?assetKinds[kind]:'全部资产'}</h2><span>{loading?'正在读取…':`${catalog?.total??0} 个版本`}</span></header>
     {error?<div role="alert" className="asset-error">{error}<Button onClick={()=>setEpoch(x=>x+1)}>重新加载</Button></div>:!catalog||loading&&!data.length?<p role="status" className="asset-loading">正在读取资产库…</p>:!data.length?<CollectionEmpty icon={<FolderOpen size={28}/>} title={query||status||kind?'没有匹配的资产':'从一份结构定义开始'} action={!query&&!status&&!kind&&<Button disabled={inputBlocked} onClick={capture}>保存当前结构草稿<ArrowRight size={15}/></Button>}>{query||status||kind?'调整筛选，或导入该类别的资产定义。':'捕获当前电缆结构，或导入已整理的 JSON 定义。不会自动填入厂家产品或虚构材料。'}</CollectionEmpty>:<div className="asset-table-scroll"><table className="asset-table"><thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th scope="col" key={h.id}>{flexRender(h.column.columnDef.header,h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(row=><tr key={row.id} data-selected={row.original.id===selected}>{row.getVisibleCells().map(cell=><td key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}</tr>)}</tbody></table></div>}
     <footer><span>定义与运行结果分开保存</span><div><Button variant="quiet" aria-label="上一页资产" disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))}><ArrowLeft size={15}/></Button><span>{Math.floor(offset/PAGE_SIZE)+1} / {Math.max(1,Math.ceil((catalog?.total??0)/PAGE_SIZE))}</span><Button variant="quiet" aria-label="下一页资产" disabled={loading||offset+PAGE_SIZE>=(catalog?.total??0)} onClick={()=>setOffset(offset+PAGE_SIZE)}><ArrowRight size={15}/></Button></div></footer>
    </section>
    {selected&&<aside className="asset-detail-pane" aria-label="资产详情" aria-busy={detailLoading}>
     {detailError?<div role="alert" className="asset-error">{detailError}</div>:!record?<p role="status" className="asset-loading">读取定义与核对记录…</p>:<>
      <DetailHeading title={record.name} meta={<><AssetStatusBadge status={record.status}/><code className="asset-version">v{record.version}</code></>} onClose={()=>setSelected('')}/>
      <nav className="asset-detail-tabs" aria-label="资产详情视图">{([['definition','定义'],['dependencies','来源与依赖'],['history','变更记录']] as const).map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
      <ScrollRegion label="资产详情内容" className="asset-detail-scroll">
       {tab==='definition'&&<><AssetPreview release={record.release}/><dl className="asset-meta"><dt>分类</dt><dd>{assetKinds[record.kind]}</dd><dt>修订</dt><dd>r{record.revision}</dd><dt>参数</dt><dd>{record.release.parameters.length} 项</dd><dt>几何配方</dt><dd>{record.release.geometry_recipe?`${record.release.geometry_recipe.layers.length} 层 · 单芯同心`:'未提供'}</dd></dl>
        <h3>参数摘要</h3><div className="asset-parameters">{record.release.parameters.map(p=><div key={p.name}><span>{({conductor_area:'导体面积',conductor_limit:'导体限温'} as Record<string,string>)[p.name]??p.name}</span><b>{p.quantity.value.toLocaleString('en-US',{maximumSignificantDigits:8})}<small>{p.quantity.unit}</small></b></div>)}</div><p className="asset-scope-note">结构草稿不是完整计算模型。材料、敷设和适用范围须在研究阶段单独核对。</p></>}
       {tab==='dependencies'&&<><h3>来源记录</h3>{record.release.sources.map((source,i)=><div className="asset-source" key={i}><b>{source.kind==='project_input'?'工程输入快照':source.kind}</b><span>{source.reviewed?'来源声明：已核对':'原始来源：未外部审核'}</span><code>{source.reference}</code></div>)}<h3>精确版本依赖</h3>{record.release.dependencies.length?record.release.dependencies.map(d=><div className="asset-source" key={d.asset_id+d.version}><b>{d.asset_id}@{d.version}</b><code>{d.content_sha256}</code></div>):<p>未声明依赖。不会自动连接相似名称的材料。</p>}<h3>内容摘要</h3><code className="asset-digest">{record.content_sha256}</code></>}
       {tab==='history'&&<ol className="asset-events">{record.events.map(event=><li key={event.revision}><span className="asset-event-dot"/><div><b>{eventLabels[event.action]??event.action}<small>r{event.revision}</small></b><p>{event.note}</p><time dateTime={event.created}>{new Date(event.created).toLocaleString()}</time></div></li>)}</ol>}
       {record.issues.length>0&&<div className="asset-preflight-issues" role="status"><b>发布前需处理</b>{record.issues.map((issue,i)=><p key={i}>{issue.message}</p>)}</div>}
      </ScrollRegion>
      <footer className="asset-detail-actions">
       <div><Button aria-label="导出资产定义" onClick={()=>download(`${record.asset_id.replace(/[^A-Za-z0-9_.-]/g,'_')}-${record.version}.json`,JSON.stringify({schema_version:'csp-asset/0.1',release:record.release},null,2),'application/json')}><Download size={15}/>导出</Button>
        {record.status==='draft'&&<Button onClick={()=>edit({kind:'edit',record})}>编辑定义</Button>}
        {['published','deprecated'].includes(record.status)&&<Button onClick={()=>edit({kind:'derive',record})}><GitBranch size={15}/>派生版本</Button>}
       </div>
       <div>{record.status==='draft'&&<Button variant="primary" disabled={!!record.issues.length} onClick={()=>edit({kind:'transition',record,action:'review'})}><Check size={15}/>记录核对</Button>}{record.status==='reviewed'&&<><Button onClick={()=>edit({kind:'transition',record,action:'return_to_draft'})}>退回草稿</Button><Button variant="primary" disabled={!!record.issues.length} onClick={()=>edit({kind:'transition',record,action:'publish'})}>发布此版本</Button></>}{record.status==='published'&&<Button onClick={()=>edit({kind:'transition',record,action:'deprecate'})}>弃用</Button>}</div>
       <p>仅管理本机资产；不会改动当前工况。</p>
      </footer>
     </>}
    </aside>}
   </div>
  </CollectionWorkspace>
  <Modal open={!!editor&&active} onOpenChange={open=>{if(!open&&!saving)setEditor(null)}} title={title} description="操作只作用于本机资产库。已发布内容不可覆盖，不自动应用到当前工程。" className="asset-editor white-components">
   <form onSubmit={e=>{e.preventDefault();void save()}}>
    {editor?.kind==='capture'&&<><label>资产名称<input aria-label="资产名称" value={name} maxLength={128} required onChange={e=>setName(e.target.value)}/></label><p>来源：rev.{editor.workspaceRevision}。保存六层结构配方与参数摘要，不复制求解结果、材料模型或敷设条件。</p></>}
    {editor?.kind==='import'&&<><label className="asset-file-pick">选择 JSON 文件<input type="file" aria-label="选择资产 JSON 文件" accept=".json,application/json" onChange={e=>void readImport(e.target.files?.[0])}/></label><label>资产包 JSON<textarea aria-label="资产包 JSON" value={text} required spellCheck={false} onChange={e=>setText(e.target.value)} placeholder='需要 schema_version: "csp-asset/0.1" 和 release。'/></label><p>只接收 JSON 定义，不执行脚本、压缩包或 CAD 文件。所有导入版本均从草稿开始。</p></>}
    {editor?.kind==='edit'&&<><label>资产定义 JSON<textarea aria-label="资产定义 JSON" value={text} required spellCheck={false} onChange={e=>setText(e.target.value)}/></label><p>修改会生成新修订。标识、版本和分类固定；几何与量纲由服务端校验。</p></>}
    {editor?.kind==='derive'&&<><label>新版本号<input aria-label="新资产版本号" value={version} required maxLength={64} placeholder="例如 1.0.1" onChange={e=>setVersion(e.target.value)}/></label><p>从 v{editor.record.version} 复制定义为新草稿。旧版本及引用摘要保持不变。</p></>}
    {editor?.kind==='transition'&&<><p className="asset-transition-target"><b>{editor.record.name}</b><span>v{editor.record.version} · r{editor.record.revision}</span></p>{editor.action==='review'&&<label className="asset-review-checkbox"><input aria-label="确认已核对资产定义与来源" type="checkbox" checked={ack} required onChange={e=>setAck(e.target.checked)}/><span>我已核对定义与来源；本机记录不代表独立审核、标准认证或厂家认可。</span></label>}<label>操作说明<textarea aria-label="资产操作说明" value={note} required minLength={4} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>{editor.action==='publish'&&<p>发布将冻结当前内容。后续更改须派生新版本；已有工程不会自动升级。</p>}{editor.action==='deprecate'&&<p>弃用后阻止新增依赖发布；历史版本仍保留，不删除旧记录。</p>}</>}
    {editorError&&<p className="asset-error" role="alert">{editorError}</p>}
    <footer><Button disabled={saving} onClick={()=>setEditor(null)}>取消</Button><Button type="submit" variant="primary" disabled={saving||(editor?.kind==='capture'&&inputBlocked)}>{saving?'正在保存…':editor?.kind==='transition'?actionLabels[editor.action]:editor?.kind==='derive'?'创建新版本草稿':'保存草稿'}</Button></footer>
   </form>
  </Modal>
 </>;
}
