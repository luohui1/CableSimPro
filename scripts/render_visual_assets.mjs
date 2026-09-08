/** Render original engineering plates; no AI screenshot or remote asset downloads. */
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
const built=await build({entryPoints:[path.join(root,'scripts/visuals/scene.ts')],bundle:true,write:false,format:'iife',jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],logLevel:'error'});
const browser=await chromium.launch({executablePath:process.env.CABLESIM_TEST_CHROMIUM,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const out=path.join(root,'frontend/public/engineering');await mkdir(out,{recursive:true});
 for(const kind of ['cable','installation','documents']){
  const page=await browser.newPage({viewport:{width:1200,height:760},deviceScaleFactor:1});
  page.on('pageerror',e=>{throw e});
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({content:`window.assetKind=${JSON.stringify(kind)};`+built.outputFiles[0].text});
  await page.waitForFunction(()=>window.assetReady===true);
  await page.screenshot({path:path.join(out,kind+'.png'),animations:'disabled'});await page.close();console.log('Rendered',kind);
 }
 await writeFile(path.join(out,'manifest.json'),JSON.stringify({version:1,origin:'Original CableSimPro procedural Three.js scenes',source:'scripts/visuals/scene.ts',scope:'Illustrations only. Not manufacturer geometry, FEM mesh or simulation results.',images:['cable.png','installation.png','documents.png']},null,2));
}finally{await browser.close()}
