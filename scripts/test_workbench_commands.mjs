import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(join(root,'frontend/package.json')),temp=mkdtempSync(join(tmpdir(),'cablesim-commands-'));
let checks=0;const check=(name,fn)=>{fn();checks++};
try{
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--target','ES2022','--module','commonjs','--outDir',temp,join(root,'frontend/src/professional/workbenchCommands.ts')]);
 const {WORKBENCH_COMMANDS:catalog,searchCommands:search,commandBlockReason:reason,cleanCommandIds:clean}=require(join(temp,'workbenchCommands.js'));
 const state={busy:false,dirty:false,buried:true,current:true,canUndo:true};
 const get=id=>catalog.find(c=>c.id===id);
 check('only unique stable IDs',()=>assert.equal(new Set(catalog.map(c=>c.id)).size,catalog.length));
 check('all implemented commands discoverable',()=>assert.equal(search('').length,27));
 check('Chinese label search',()=>assert.equal(search('二维截面')[0].id,'section'));
 check('pinyin alias',()=>assert.equal(search('jiemian')[0].id,'section'));
 check('English alias',()=>assert.equal(search('report')[0].id,'report'));
 check('normalized fullwidth search',()=>assert.equal(search('ｒｅｐｏｒｔ')[0].id,'report'));
 check('AND search',()=>assert.equal(search('temperature sweep')[0].id,'temperature-sweep'));
 check('category filtering',()=>assert.equal(search('','参数研究').length,4));
 check('unregistered feature is absent',()=>assert.equal(search('海底').length,0));
 check('unknown command is absent',()=>assert.equal(search('not-a-command').length,0));
 for(const c of catalog){
  if('guard' in c){check(`${c.id} dirty blocked`,()=>assert.ok(reason(c,{...state,dirty:true})));check(`${c.id} busy blocked`,()=>assert.ok(reason(c,{...state,busy:true})));}
  else check(`${c.id} view navigation does not discard dirty inputs`,()=>assert.equal(reason(c,{...state,dirty:true,busy:true}),null));
 }
 check('supported solve allowed',()=>assert.equal(reason(get('run'),state),null));
 check('wrong solve domain blocked',()=>assert.ok(reason(get('run'),{...state,buried:false})));
 check('stale result cannot report',()=>assert.ok(reason(get('report'),{...state,current:false})));
 check('no history cannot undo',()=>assert.ok(reason(get('undo'),{...state,canUndo:false})));
 check('preference corruption discarded',()=>assert.deepEqual(clean({id:'run'}),[]));
 check('preferences allowlisted and deduplicated',()=>assert.deepEqual(clean(['run','unknown','run',null,'section']),['run','section']));
 check('preferences bounded',()=>assert.equal(clean(catalog.map(c=>c.id)).length,8));
 console.log(`${checks} command-catalog checks passed. This does not imply browser or solver validation.`);
}finally{rmSync(temp,{recursive:true,force:true})}
