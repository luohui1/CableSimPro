import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(join(root,'frontend/package.json')),temp=mkdtempSync(join(tmpdir(),'csp-pc-layout-'));
try{
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--target','ES2022','--module','commonjs','--outDir',temp,join(root,'frontend/src/professional/analysisLayout.ts')]);
 const {resolveAnalysisMode:layout}=require(join(temp,'analysisLayout.js'));
 for(const [requested,h,w,expected] of [['summary',768,1366,'summary'],['split',768,1366,'full'],['split',899,1600,'full'],['split',1000,1099,'full'],['split',1000,1600,'split'],['full',1000,1600,'full'],['split',900,1100,'split']])assert.equal(layout(requested,h,w),expected);
 const source=readFileSync(join(root,'frontend/src/dual-mode/DualModeApp.tsx'),'utf8');
 for(const obsolete of ['reference-workbench.css','progressive-workbench.css','industrial-surfaces.css','workbench-layout.css'])assert.equal(source.includes(`import '../professional/${obsolete}'`),false);
 const tokens=JSON.parse(readFileSync(join(root,'frontend/src/design-system/tokens.json'),'utf8')).tokens;
 for(const [k,v] of [['pc-command-height','60px'],['pc-rail-width','64px'],['pc-result-height','76px'],['pc-inspector-width','312px']])assert.equal(tokens[k],v);
 console.log('15 PC layout policy checks passed; browser geometry is validated separately.');
}finally{rmSync(temp,{recursive:true,force:true})}
