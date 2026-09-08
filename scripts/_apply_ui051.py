"""One-time source publication; exact edits verified against authored file hashes."""
from pathlib import Path
import hashlib
root=Path.cwd()
def edit(name,a,b):
 p=root/name;s=p.read_text();assert a in s,name+' '+a[:100];p.write_text(s.replace(a,b))
edit('frontend/src/StudioState.tsx','current:Result|null;','current:Result|null;currentSweep:Sweep|null;')
edit('frontend/src/StudioState.tsx','export function StudioProvider({children}:{children:ReactNode}) {','export function StudioProvider({children,stayInWorkspace=false}:{children:ReactNode;stayInWorkspace?:boolean}) {')
edit('frontend/src/StudioState.tsx','const [status,setStatus]','const [outputRevision,setOutputRevision]=useState<number|null>(null);\n const [status,setStatus]')
edit('frontend/src/StudioState.tsx','async function task(fn:',"const currentSweep=output?.sweep&&w&&outputRevision===w.revision&&!Object.keys(inputDrafts).length?output.sweep:null;\n async function task(fn:")
edit('frontend/src/StudioState.tsx','remember(r.workspace);setOutput(r.output);','remember(r.workspace);setOutputRevision(r.workspace.revision);setOutput(r.output);')
edit('frontend/src/StudioState.tsx','notice,output,current,proposal','notice,output,current,currentSweep,proposal')
edit('frontend/src/StudioState.tsx',"'analysis.buried'));setTab('results')","'analysis.buried'));if(!stayInWorkspace)setTab('results')")
edit('frontend/src/StudioState.tsx',"if(action==='approve')setTab('results');else add('assistant','已拒绝提案，工程未改变。')","if(action==='approve'){if(!stayInWorkspace)setTab('results')}else add('assistant','已拒绝提案，工程未改变。')")
edit('frontend/src/StudioState.tsx','setOutput({...r.output,events:r.events,run_id:id});','setOutputRevision(null);setOutput({...r.output,events:r.events,run_id:id});')
edit('frontend/src/StudioPanels.tsx',"import {useEffect,useMemo,useState} from 'react';","import {useEffect,useMemo,useRef,useState} from 'react';")
edit('frontend/src/StudioPanels.tsx','export function AgentPanel(){const {w,busy,status,notes,proposal,plan,review,output}=useStudio();',"export function AgentPanel({docked=false,expanded=true,onExpand}:{docked?:boolean;expanded?:boolean;onExpand?:()=>void}={}){const {w,busy,status,notes,proposal,plan,review,output,inputDrafts}=useStudio();const composing=useRef(false);")
edit('frontend/src/StudioPanels.tsx',"const send=()=>{if(text.trim()){void plan(text.trim(),mode,consent);setText('')}};","const send=()=>{if(busy||!text.trim()||Object.keys(inputDrafts).length||(mode==='openai'&&(!consent||!status.cloud_configured)))return;onExpand?.();void plan(text.trim(),mode,consent);setText('')};")
edit('frontend/src/StudioPanels.tsx','<div className="agent-scroll">',"<div className=\"agent-scroll\" id={docked?'engineering-conversation':undefined} hidden={docked&&!expanded}>")
edit('frontend/src/StudioPanels.tsx','<textarea aria-label="工程任务" placeholder="描述任务，或选择上方示例…"',"<textarea aria-label=\"工程任务\" placeholder={docked?'描述需要修改的参数、计算工况或选型要求…':'描述任务，或选择上方示例…'} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}}")
edit('frontend/src/StudioPanels.tsx',"if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}","if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();send()}")
edit('frontend/src/StudioPanels.tsx',"disabled={busy||!text.trim()||(mode==='openai'&&!consent)}","disabled={busy||!text.trim()||Object.keys(inputDrafts).length>0||(mode==='openai'&&(!consent||!status.cloud_configured))}")
edit('frontend/src/StudioPanels.tsx','export function ResultsPanel(){const {w,tab,setTab,current,output,report,busy,showRun}=useStudio();',"export function ResultsPanel({embedded=false}:{embedded?:boolean}={}){const {w,tab,setTab,current,currentSweep,output,report,busy,showRun}=useStudio();const [localTab,setLocalTab]=useState('results');const activeTab=embedded?localTab:tab;const chooseTab=embedded?setLocalTab:setTab;")
edit('frontend/src/StudioPanels.tsx',"const view=['history','sources','curve','details','runs'].includes(tab)?tab:'results';","const view=['history','sources','curve','details','runs','heat'].includes(activeTab)?activeTab:'results';")
edit('frontend/src/StudioPanels.tsx',"{[['results','结果表'],['curve','特性曲线'],['details','计算明细'],['runs','运行记录'],['sources','资料来源'],['history','审计日志']].map","{(embedded?[['results','结果表'],['curve','特性曲线'],['heat','土壤温度'],['details','计算明细']]:[['results','结果表'],['curve','特性曲线'],['details','计算明细'],['runs','运行记录'],['sources','资料来源'],['history','审计日志']]).map")
# Only the result component owns chooseTab; preserve unrelated view selectors.
p=root/'frontend/src/StudioPanels.tsx';s=p.read_text();a,b=s.split('export function ResultsPanel',1);b=b.replace('onClick={()=>setTab(id)}>{label}','onClick={()=>chooseTab(id)}>{label}');p.write_text(a+'export function ResultsPanel'+b)
edit('frontend/src/StudioPanels.tsx',":view==='curve'?<div className=\"curve-grid\">",":view==='heat'?(current?<HeatField result={current}/>:<p className=\"eng-note\">当前输入尚无有效土壤温度结果；此视图为半空间解析温度，不是有限元。</p>):view==='curve'?<div className=\"curve-grid\">")
edit('frontend/src/StudioPanels.tsx','{output?.sweep&&<LineChart data={output.sweep.points','{currentSweep&&<LineChart data={currentSweep.points')
edit('frontend/src/StudioPanels.tsx','xLabel={output.sweep.parameter}','xLabel={currentSweep.parameter}')
edit('frontend/src/StudioPanels.tsx','!current&&!output?.sweep','!current&&!currentSweep')
edit('frontend/src/Studio.tsx','agent:AgentPanel,results:ResultsPanel','agent:()=> <AgentPanel/>,results:()=> <ResultsPanel/>')
edit('frontend/src/EngineeringWorkspace.tsx',"import {AgentPanel,Inspector,ResultsPanel} from './StudioPanels';","import {Inspector,ResultsPanel} from './StudioPanels';\nimport {AssistantDock,InlineResults} from './WorkspaceInteraction';")
edit('frontend/src/EngineeringWorkspace.tsx',"import './engineering-workspace.css';","import './engineering-workspace.css';\nimport './workspace-interaction.css';")
edit('frontend/src/EngineeringWorkspace.tsx',"const canRun=['installation','results'].includes(active)&&domain!=='vertical_air';","const canRun=['model','installation','results'].includes(active)&&(!domain||domain==='buried');")
edit('frontend/src/EngineeringWorkspace.tsx',"const [section,setSection]=useState('cable');","const [section,setSection]=useState('cable');\n const [showResults,setShowResults]=useState(false);\n useEffect(()=>{if(s.output?.run_id)setShowResults(true)},[s.output?.run_id]);\n useEffect(()=>{setAssistant(false);setShowResults(false)},[w?.id]);")
edit('frontend/src/EngineeringWorkspace.tsx','const handler=(e:KeyboardEvent)=>{const el=e.target as HTMLElement;',"const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector<HTMLTextAreaElement>('.task-dock textarea')?.focus();return}const el=e.target as HTMLElement;")
edit('frontend/src/EngineeringWorkspace.tsx',"return <div className={`eng-app ${assistant?'assistant-visible':''}`}>",'return <div className="eng-app">')
edit('frontend/src/EngineeringWorkspace.tsx','onClick={()=>setAssistant(!assistant)}><MessageSquare',"onClick={()=>{setAssistant(!assistant);document.querySelector<HTMLTextAreaElement>('.task-dock textarea')?.focus()}}><MessageSquare")
edit('frontend/src/EngineeringWorkspace.tsx','<div className="eng-page-content">',"<div className={`eng-page-content ${['model','installation'].includes(active)?'same-workspace':''}`}><div className=\"workspace-view\">")
edit('frontend/src/EngineeringWorkspace.tsx','</div>{showProperties&&',"</div>{['model','installation'].includes(active)&&<InlineResults open={showResults} onOpenChange={setShowResults}/>}</div>{showProperties&&")
edit('frontend/src/EngineeringWorkspace.tsx',' {assistant&&<aside className="eng-assistant" aria-label="工程助手面板"><header><span><MessageSquare size={16}/>工程助手</span><button aria-label="关闭工程助手" onClick={()=>setAssistant(false)}><X size={17}/></button></header><AgentPanel/></aside>}\n </div><footer',' </div><AssistantDock key={w.id} expanded={assistant} onExpandedChange={setAssistant} pageTitle={info.name}/><footer')
edit('frontend/src/EngineeringWorkspace.tsx','<StudioProvider><Workspace/></StudioProvider>','<StudioProvider stayInWorkspace><Workspace/></StudioProvider>')
edit('frontend/src/EngineeringWorkspace.tsx','研究版 0.5 ·','研究版 0.5.1 ·')
edit('backend/main.py',"version='0.5.0'","version='0.5.1'")
edit('scripts/package_demo.py',"'version': '0.5.0'","'version': '0.5.1'")
edit('scripts/package_demo.py',"'test-results', '.venv'","'test-results', 'test-results-windows', 'playwright-report-windows', '.venv'")
edit('frontend/pro-e2e/v05.spec.ts','.eng-assistant .','.task-dock .')
edit('frontend/pro-e2e/v05.spec.ts',"family:css('input[type=number]').fontFamily","numeric:css('input[type=number]').fontVariantNumeric,weight:css('input[type=number]').fontWeight")
edit('frontend/pro-e2e/v05.spec.ts',"expect(typography.family).toContain('Mono');","expect(typography.numeric).toContain('tabular-nums');expect(Number(typography.weight)).toBeGreaterThanOrEqual(500);")
edit('frontend/playwright.config.ts',"'v05.spec.ts']","'v05.spec.ts','same-workspace.spec.ts']")
edit('frontend/playwright.config.ts',"'v05-mobile.spec.ts']","'v05-mobile.spec.ts','same-workspace-mobile.spec.ts']")
p=root/'README.md';p.write_text('> **v0.5.1 界面修正**：工程任务输入移到画布下方；建模与敷设计算结果同屏展开，不再强制跳转结果页。运行边界不变。详见 [同屏交互与 Windows 验收](docs/SAME_WORKSPACE_V051.md)。\n\n'+p.read_text())
expected={
 'README.md':'67e3dd7e397e4181dcedc136bd3956629c45df6de7149d3d62eea8903b25c349',
 'backend/main.py':'25019e28606ebc0ded3cbbc1b352b63e55196f7e896415931d2ff054928f4ba9',
 'frontend/playwright.config.ts':'b31988f8032d99af66519c647414869f01bf69a7cb7206e13972e8ae89c6c930',
 'frontend/pro-e2e/v05.spec.ts':'aa08923cce1a4e822255a7ec82842244814682c09345f6c840ef305d2fe10d8d',
 'frontend/src/EngineeringWorkspace.tsx':'e640a9f5127b35dc1e16f414c3b7e2aedd16f013ae87ccef4261108ba74e4c05',
 'frontend/src/Studio.tsx':'eb2df25d627072b8b6e909347a295aa22dc977754472db1c1edef5332a8bce1f',
 'frontend/src/StudioPanels.tsx':'cec7177aefb9da4feb26b8bb5efa42d8e2f7a46d7c27ce09c47c5cbdb36d77e1',
 'frontend/src/StudioState.tsx':'ed0a8d5413e9491bb1a5710e97a308e38e58ff20ff123f66a986d8a141c571e8',
 'scripts/package_demo.py':'981e7cd14d9cb661287a2278a6065c2d45d1ec74dac4d32678589094e6f281c5'}
for name,h in expected.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h,name
print('Verified authored source edits:',len(expected))
