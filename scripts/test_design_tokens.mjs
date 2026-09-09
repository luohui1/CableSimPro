import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.execPath,[resolve(root,'scripts/build_design_tokens.mjs'),'--check']);
const {tokens:t}=JSON.parse(readFileSync(resolve(root,'frontend/src/design-system/tokens.json'),'utf8'));
const luminance=hex=>hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(x+.05)/(y+.05)};
assert.equal(t['color-canvas'],'#ffffff');
for(const ink of ['ink','body','muted'])for(const bg of ['canvas','subtle','selected'])assert.ok(contrast(t['color-'+ink],t['color-'+bg])>=4.5,`${ink}/${bg} contrast`);
for(const tone of ['success','warning','danger','info'])assert.ok(contrast(t['color-'+tone],t['color-'+tone+'-bg'])>=4.5,`${tone} contrast`);
assert.ok(contrast('#ffffff',t['color-primary'])>=4.5);
const dir=resolve(root,'frontend/public/engineering/white-workbench');
const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
for(const a of manifest.assets){assert.equal(a.purpose,'decorative-only');assert.equal(createHash('sha256').update(readFileSync(resolve(dir,a.file))).digest('hex'),a.sha256)}
console.log('Design tokens: generated CSS matches source; 14 text color pairs pass 4.5:1; local image checksum verified. Not a full WCAG audit.');
