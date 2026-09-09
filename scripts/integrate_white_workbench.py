"""One-time, hash-guarded integration of reviewed UI components. Removed on commit."""
from pathlib import Path
from hashlib import sha256
import subprocess

ROOT=Path(__file__).resolve().parent.parent
expected={
 'frontend/src/CableModelView.tsx':'e7ea40e55993fd9627047ff33ba468047cb5caabc02400c82bf0cf78e57dbf92',
 'frontend/src/EnterpriseWorkspace.tsx':'26e8ce19b0d625dbb94ff7b00d14bbffcdadb19f6a125d8a8577313ea441907d',
 'frontend/src/ScientificChart.tsx':'da713d1d3c8f74d186b756379718aa6df88158e6b0480527a87034aa6764a317',
 'frontend/src/StudioPanels.tsx':'b7d6e4c00d4e4b296cbb5c9e30aff740e720288b0dfc53880a058e7b29d3fd4a',
 'frontend/src/dual-mode/DualModeApp.tsx':'0a9d57e13c09a6950c5817e1ab90a901fc8153d6e7e68ac82653d9c20086bb4c',
 'frontend/src/engineering-visuals/EngineeringViewport.tsx':'693578e0e34146d42ff4468faa182aa43d343c5c06beaa20bd460dc6e61fb66e',
 'frontend/playwright.config.ts':'ddd9b1808ab3491d2ce16ed9cfbb9ca99ef651ba66935f858f42c991fb97cf96',
 'frontend/playwright.windows.config.ts':'68cad24f23e47d71f60048a3b0b8b5579eefe0d9a69877c51d80e2381f107488',
 'frontend/pro-e2e/dual-mode.spec.ts':'520d191514f046d8b87c931bd7875eb13035ddff06dbe24d19f650e6e178676a',
 'frontend/pro-e2e/engineering-pulse.spec.ts':'b5946c8ece3fe378d5d5b778e38b6161fc7189e2d594e46f75c806e1406936f8',
 'scripts/verify_ci_matrix.py':'ce6337e2a9ac87ea29090cde43744e3dd22a8dea5c467c519501af1acbc23a96',
}
for path,digest in expected.items():
 if sha256((ROOT/path).read_bytes()).hexdigest()!=digest:raise SystemExit('Concurrent source change; refusing overwrite: '+path)
def edit(path,old,new):
 p=ROOT/path;text=p.read_text()
 if old not in text:raise SystemExit('Missing integration anchor: '+path+' '+old[:80])
 p.write_text(text.replace(old,new))

edit('frontend/src/engineering-visuals/EngineeringViewport.tsx',"import {CrossSection,HeatField,LineChart} from '../Visuals';","import {CrossSection,HeatField,LineChart} from '../Visuals';\nimport LayerDiagram from '../professional/LayerDiagram';")
edit('frontend/src/engineering-visuals/EngineeringViewport.tsx','<div className="viewport-pane" hidden={view!==\'model\'}><CableModelView cable={s.w.scenario.cable}/></div>','<div className="viewport-pane wb-model-overview" hidden={view!==\'model\'}><div className="wb-model-primary"><CableModelView cable={s.w.scenario.cable} surface="#ffffff"/></div><LayerDiagram cable={s.w.scenario.cable}/></div>')
edit('frontend/src/CableModelView.tsx','CableModelView({cable}:{cable:Cable})',"CableModelView({cable,surface='#f4f7fb'}:{cable:Cable;surface?:string})")
edit('frontend/src/CableModelView.tsx',"renderer.setClearColor('#f4f7fb')",'renderer.setClearColor(surface)')
edit('frontend/src/ScientificChart.tsx','EngineeringChart({series,xLabel,yLabel,label,threshold}:{series:Series[];xLabel:string;yLabel:string;label:string;threshold?:number})','EngineeringChart({series,xLabel,yLabel,label,threshold,height=340}:{series:Series[];xLabel:string;yLabel:string;label:string;threshold?:number;height?:number})')
edit('frontend/src/ScientificChart.tsx','height:340','height')
edit('frontend/src/StudioPanels.tsx','export function Inspector(){','export function Inspector(){return <InspectorContent/>}\nexport function GroupedInspector(){return <InspectorContent grouped/>}\nfunction InspectorContent({grouped=false}:{grouped?:boolean}={}){')
edit('frontend/src/StudioPanels.tsx','{group.map(f=><Property key={f.path} field={f}/>)}<div className="inspector-note">',"{grouped?Object.entries(group.reduce<Record<string,typeof group>>((groups,f)=>{const title=selected==='installation'?(f.path.includes('temperature')||f.path.includes('rho')?'环境参数':'敷设参数'):selected==='materials'?(f.path.includes('rho')?'热物性参数':'电气与屏蔽'):selected==='study'?'运行与限制':f.path.includes('insulation')||f.path.includes('jacket')?'绝缘与护套':'导体与电压';(groups[title]??=[]).push(f);return groups},{})).map(([title,items])=><section className=\"wb-property-group\" key={title}><h3>{title}</h3>{items!.map(f=><Property key={f.path} field={f}/>)}</section>):group.map(f=><Property key={f.path} field={f}/>)}<div className=\"inspector-note\">")
edit('frontend/src/dual-mode/DualModeApp.tsx',"import './light-studio.css';","import './light-studio.css';\nimport {WorkbenchBanner,WorkbenchContext} from '../professional/WorkbenchChrome';\nimport '../design-system/tokens.css';\nimport '../professional/white-workbench.css';")
edit('frontend/src/dual-mode/DualModeApp.tsx',"dual-app light-studio ${route.mode?'is-project':'is-home'}","dual-app light-studio ${route.mode==='workbench'?'white-workbench':''} ${route.mode?'is-project':'is-home'}")
edit('frontend/src/dual-mode/DualModeApp.tsx','{route.mode&&<nav className="mode-switch"',"{route.mode==='workbench'&&<WorkbenchBanner/>}\n   {route.mode&&<nav className=\"mode-switch\"")
edit('frontend/src/dual-mode/DualModeApp.tsx','<EngineeringPulse mode={route.mode} openWorkbench={openWorkbench} openAgent={openAgent}/>',"(route.mode==='workbench'?<WorkbenchContext><EngineeringPulse mode={route.mode} openWorkbench={openWorkbench} openAgent={openAgent}/></WorkbenchContext>:<EngineeringPulse mode={route.mode} openWorkbench={openWorkbench} openAgent={openAgent}/>)")
path='frontend/src/EnterpriseWorkspace.tsx'
edit(path,"import './enterprise.css';","import './enterprise.css';\nimport {WorkbenchNavigation,WorkbenchMetrics,WorkbenchEvidence,WorkbenchAnalysis} from './professional/WorkbenchChrome';\nimport {Button} from './design-system/primitives';")
edit(path,'import {Inspector,ResultsPanel}','import {Inspector,GroupedInspector,ResultsPanel}')
edit(path,'if(s.current||s.currentSweep)setResultsOpen(true)','if((!embedded&&s.current)||s.currentSweep)setResultsOpen(true)')
edit(path,' <div className="enterprise-projectbar">',' {!embedded&&<div className="enterprise-projectbar">')
edit(path,'</div></div>\n {(s.error||error)','</div></div>}\n {((!embedded&&s.error)||error)')
edit(path,'<span>{s.error||error}</span>','<span>{(!embedded&&s.error)||error}</span>')
p=ROOT/path;text=p.read_text();start=text.index('{embedded&&<nav className="embedded-global-nav"');end=text.index('</aside>',start);legacy=text[start:end]
replacement="{embedded?<WorkbenchNavigation area={area} view={view} blocked={blocked} onProjects={()=>void openProjects()} onNavigate={key=>{if(key.startsWith('engineering:'))navigate(key.split(':')[1] as View);else{setArea(key as Area);setNavOpen(false)}}}/>:<>"+legacy+'</>}'
p.write_text(text[:start]+replacement+text[end:])
edit(path,'<header className="enterprise-section-heading"><div><span className="eyebrow">工程设计 /',"<header className=\"enterprise-section-heading\"><div><span className=\"eyebrow\">{embedded?'专业工作台':'工程设计'} /")
edit(path,'<div className="enterprise-page-actions">{view===',"<div className=\"enterprise-page-actions\">{embedded&&<><Button disabled={blocked||!w.can_undo} aria-label=\"撤销工程修改\" onClick={()=>void s.history('undo')}><Undo2 size={16}/></Button><Button disabled={blocked} onClick={()=>{setForkName(w.scenario.name+' · 方案副本');setForkOpen(true)}}><Copy size={15}/>另存方案</Button><Button disabled={s.busy||!s.current} onClick={()=>void s.report()}><FileText size={15}/>导出计算书</Button></>}{view===")
edit(path,' <div className="enterprise-task-options">'," <div className=\"wb-model-utilities\">{embedded&&<button className=\"enterprise-mobile-menu\" aria-label=\"显示工程目录\" onClick={()=>setNavOpen(!navOpen)}><Menu size={18}/>工程目录</button>}{embedded&&<><code data-testid=\"revision\">rev.{w.revision}</code><span>当前输入已保存</span><button onClick={()=>openTask()}><MessageSquare size={15}/>{s.proposal?.ready?'审查变更':'设计任务'}</button></>}<details className=\"wb-secondary-actions\" open={!embedded||undefined}><summary>型号、选型与资料</summary><div className=\"enterprise-task-options\">")
edit(path,'从资料核对参数</span><ArrowRight size={13}/></button></div>','从资料核对参数</span><ArrowRight size={13}/></button></div></details></div>')
edit(path,'<div className="enterprise-model-summary">','{!embedded&&<div className="enterprise-model-summary">')
edit(path,'</b> °C</span></div>','</b> °C</span></div>}')
edit(path,'{s.current&&<div className="enterprise-result-summary">','{embedded?<WorkbenchMetrics/>:s.current&&<div className="enterprise-result-summary">')
edit(path,'<Inspector/><section className="enterprise-evidence-check"><h3>输入依据检查</h3>','{embedded?<GroupedInspector/>:<Inspector/>}<details className="enterprise-evidence-check" open={!embedded||undefined}><summary>输入依据检查</summary>')
edit(path,'核对资料来源 <ArrowRight size={13}/></button></section></aside>','核对资料来源 <ArrowRight size={13}/></button></details></aside>')
edit(path,'<InlineResults open={resultsOpen} onOpenChange={setResultsOpen}/></section>',"{embedded&&<WorkbenchAnalysis/>}<InlineResults open={resultsOpen} onOpenChange={setResultsOpen}/>{embedded&&<WorkbenchEvidence onMethods={()=>setArea('methods')} onDocuments={()=>setArea('documents')}/>}</section>")
for file in ['frontend/playwright.config.ts','frontend/playwright.windows.config.ts']:
 edit(file,"'sweep-study.spec.ts'","'sweep-study.spec.ts','white-workbench.spec.ts'")
edit('scripts/verify_ci_matrix.py','Two real-backend sweep-study cases added to each existing desktop project.','Five white-workbench real-backend cases added to each desktop project; legacy coverage retained.')
edit('scripts/verify_ci_matrix.py',"'chromium': 79, 'webkit': 79","'chromium': 84, 'webkit': 84")
edit('scripts/verify_ci_matrix.py',': 52',': 57')
edit('frontend/pro-e2e/engineering-pulse.spec.ts',"const pulse=page.getByTestId('engineering-pulse');\n await expect(pulse).toBeVisible();","const pulse=page.getByTestId('engineering-pulse');\n const disclosure=page.locator('.wb-context-disclosure');\n if(await disclosure.count())await disclosure.locator('summary').click();\n await expect(pulse).toBeVisible();")
edit('frontend/pro-e2e/dual-mode.spec.ts',"page.locator('.enterprise-result-summary>div').first().locator('b').innerText()","page.getByTestId('workbench-metrics').locator('.wb-metric').first().locator('strong').innerText()")
# Restore the ongoing review workflow to read-only after this one-time integration.
workflow=ROOT/'.github/workflows/white-workbench-review.yml'
s=workflow.read_text();start=s.index('      - name: Integrate reviewed components');end=s.index('      - run: npx playwright install',start)
s=s[:start]+s[end:];s=s.replace('contents: write','contents: read').replace('persist-credentials: true','persist-credentials: false')
workflow.write_text(s)
subprocess.run(['node','scripts/build_design_tokens.mjs'],cwd=ROOT,check=True)
Path(__file__).unlink()
print('Hash-guarded workbench integration complete. Existing physics, storage and approval code unchanged.')
