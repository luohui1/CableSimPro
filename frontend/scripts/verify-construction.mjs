/** Original AppShell integration test, synthetic geometry, no engineering database or solver. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname,join,resolve,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium,expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.tmp'),{recursive:true});
const directory=await mkdtemp(join(root,'.tmp','construction-'));
const output=join(root,'test-results','visualization');await mkdir(output,{recursive:true});
let server,browser;
const errors=[],checks=[];
try {
 const tokens=(await readFile(join(root,'..','design','tokens.css'),'utf8')).replace(/^@import.*$/gm,'');
 await writeFile(join(directory,'index.html'),`<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><title>原应用外壳集成回归 · 合成工况</title><style>${tokens}</style><div id="root"></div><script type="module" src="./entry.tsx"></script></html>`);
 await writeFile(join(directory,'entry.tsx'),`import {StrictMode,useState}from'react';import{createRoot}from'react-dom/client';import{createRootRoute,createRoute,createRouter,createMemoryHistory,RouterProvider,Outlet}from'@tanstack/react-router';
import{AppShell}from'@/components/app-shell';import{Button}from'@/components/ui/button';import{ConstructionViewport}from'@/features/scene/construction-viewport';import{networkSurface}from'@/features/thermal-workbench/network-surface';import{readNetwork}from'@/features/thermal-workbench/data';import{makeNetwork}from'../../scripts/visualization-fixture.mjs';import '@fontsource/noto-sans-sc/400.css';import '@fontsource/noto-sans-sc/600.css';import '@/styles/theme.css';import '@/styles/research.css';
const source=networkSurface(readNetwork(makeNetwork()),'synthetic-shell-test');window.sourceModel=source;window.originalSourceJSON=JSON.stringify(source);
function App(){const[selected,setSelected]=useState(null);const[theme,setTheme]=useState('light');return <AppShell title="敷设场景 · 合成集成回归" status={<span>原应用外壳 / 非工程结果</span>} actions={<><Button disabled>保存</Button><Button disabled>预检与运行</Button></>} tabs={<span>敷设截面 / 三维</span>} checks={<p>构件尺寸为测试建议值，不代表工程设计；没有调用求解器。</p>} onUnavailable={()=>{}} theme={theme} onTheme={()=>{const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.dataset.theme=next;}}><ConstructionViewport model={source} selected={selected} onSelect={setSelected} viewKey="shell-construction" caption="原模型 · 合成回归工况"/></AppShell>}
const rootRoute=createRootRoute({component:()=> <Outlet/>});const route=createRoute({getParentRoute:()=>rootRoute,path:'/studies/$sid/$module/$tab',component:App});const router=createRouter({routeTree:rootRoute.addChildren([route]),history:createMemoryHistory({initialEntries:['/studies/test/section/three-dimensional']})});createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>);`);
 server=await createServer({configFile:false,root,plugins:[react(),tailwind()],optimizeDeps:{entries:[join(directory,'index.html')]},resolve:{alias:{'@':join(root,'src')}},server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'..')]}}});await server.listen();
 const address=server.httpServer.address();assert(address&&typeof address==='object');
 browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
 await context.addInitScript(()=>{window.bufferCreations=0;const create=WebGL2RenderingContext.prototype.createBuffer;WebGL2RenderingContext.prototype.createBuffer=function(...args){window.bufferCreations++;return create.apply(this,args);};});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${address.port}/.tmp/${basename(directory)}/index.html`);
 const ready=()=>expect(page.locator('[data-surface-state]')).toHaveAttribute('data-surface-state','ready',{timeout:20000});await ready();
 await expect(page.locator('.app-shell')).toHaveCount(1);await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();await expect(page.getByRole('complementary',{name:'模块导航'})).toBeVisible();
 for(const name of ['首页','型号','研究','库','插件','设置'])await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true})).toBeVisible();
 checks.push('actual AppShell, original navigation, original stylesheet and controls');
 await page.getByText(/^场景构件设计/).click();
 for(const kind of ['buried','backfill','duct-bank','trench','tunnel','tray']) {
   await page.getByLabel('场景构件类型',{exact:true}).selectOption(kind);await page.getByRole('button',{name:'填入建议尺寸',exact:true}).click();await page.getByRole('button',{name:'预览构件',exact:true}).click();await ready();
   await expect(page.locator('.construction-boundary')).toContainText('计算仍使用原工程');
   assert.equal(await page.locator('canvas').evaluate(c=>c.getContext('webgl2').getError()),0);checks.push(kind+' parametric geometry under original shell');
 }
 const before=await page.evaluate(()=>window.bufferCreations);
 await page.getByRole('button',{name:'展开演示',exact:true}).click();await expect(page.getByLabel('结构分解进度',{exact:true})).toHaveValue('100',{timeout:10000});
 assert.equal(await page.evaluate(()=>window.bufferCreations),before,'Assembly animation must update uniforms, not allocate meshes each frame');
 await page.getByRole('button',{name:'恢复装配',exact:true}).click();await expect(page.getByLabel('结构分解进度',{exact:true})).toHaveValue('0');checks.push('assembly animation and reset without GPU buffer rebuild');
 await page.getByLabel('构件净宽',{exact:true}).fill('0.13');await page.getByRole('button',{name:'预览构件',exact:true}).click();await expect(page.locator('.construction-error')).toContainText('容纳');await expect(page.locator('.construction-boundary')).toHaveCount(0);checks.push('invalid dimensions refuse proposal and restore engineering view');
 await page.getByRole('button',{name:'填入建议尺寸',exact:true}).click();await page.getByRole('button',{name:'预览构件',exact:true}).click();await ready();
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.getByRole('button',{name:'展开演示',exact:true})).toBeDisabled();await page.getByLabel('结构分解进度',{exact:true}).press('End');await expect(page.getByLabel('结构分解进度',{exact:true})).toHaveValue('100');checks.push('reduced motion keeps manual assembly control');
 await page.getByRole('button',{name:'恢复装配',exact:true}).click();
 await page.screenshot({path:join(output,'original-shell-construction.png'),fullPage:false});
 await page.getByRole('button',{name:'恢复原工程场景',exact:true}).click();await ready();assert(await page.evaluate(()=>JSON.stringify(window.sourceModel)===window.originalSourceJSON));
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();checks.push('restore original geometry and preserve source JSON');
 assert.deepEqual(errors,[],errors.join('\n'));
 console.log(JSON.stringify({status:'passed',checks,errors,scope:'Original AppShell components and styles; synthetic geometry; not full business-route/API acceptance'},null,2));
}catch(error){console.error(JSON.stringify({status:'failed',checks,errors},null,2));throw error;}
finally{await browser?.close();await server?.close();await rm(directory,{recursive:true,force:true});}
