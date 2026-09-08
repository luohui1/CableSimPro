import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild');
const compiled=await build({entryPoints:[path.join(root,'scripts/visuals/geometry.test.ts')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',nodePaths:[path.join(root,'frontend/node_modules')],logLevel:'error'});
const run=new Function('require',compiled.outputFiles[0].text);run(require);
