import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateRuntime } from '../prepare-runtime.mjs';

test('pinned native sources, runtime bytes and redistributed licenses must all match',async()=>{
  const root=fileURLToPath(new URL('../../../../../',import.meta.url));
  const scratch=path.join(root,'.tmp/frontend','cad-runtime-'+randomUUID());
  const native=path.join(scratch,'native'),assets=path.join(scratch,'assets');
  await fs.mkdir(native,{recursive:true});await fs.mkdir(assets);
  const pins={occt:'7.9.0',commit:'858dd02fed80c8ca68cf1d70a6e03ecf97f849ca',emscripten:'3.1.73',cmake:'3.31.6',ninja:'1.12.1'};
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const record={...pins,sources:{},assets:{}};
  try{
    for(const name of ['CMakeLists.txt','viewer.cpp','build.py','runtime.lock.json','prepare.py','downloads.lock.json']){
      const bytes=Buffer.from(name==='runtime.lock.json'?JSON.stringify(pins):'source '+name);
      await fs.writeFile(path.join(native,name),bytes);record.sources[name]=hash(bytes);
    }
    for(const name of ['occt-viewer.js','occt-viewer.wasm','LICENSE_LGPL_21.txt','OCCT_LGPL_EXCEPTION.txt']){
      const bytes=Buffer.from('asset '+name);await fs.writeFile(path.join(assets,name),bytes);record.assets[name]=hash(bytes);
    }
    const write=()=>fs.writeFile(path.join(assets,'build.json'),JSON.stringify(record));await write();
    const valid=await validateRuntime(assets,native);assert.equal(valid.size,5);
    await fs.writeFile(path.join(assets,'occt-viewer.wasm'),'corrupt');await assert.rejects(validateRuntime(assets,native),/资产摘要不符/);
    await fs.writeFile(path.join(assets,'occt-viewer.wasm'),valid.get('occt-viewer.wasm'));
    await fs.writeFile(path.join(native,'viewer.cpp'),'changed');await assert.rejects(validateRuntime(assets,native),/源码摘要不符/);
    await fs.writeFile(path.join(native,'viewer.cpp'),'source viewer.cpp');
    await fs.writeFile(path.join(assets,'OCCT_LGPL_EXCEPTION.txt'),'changed');await assert.rejects(validateRuntime(assets,native),/资产摘要不符/);
    await fs.writeFile(path.join(assets,'OCCT_LGPL_EXCEPTION.txt'),valid.get('OCCT_LGPL_EXCEPTION.txt'));
    record.emscripten='unlocked';await write();await assert.rejects(validateRuntime(assets,native),/构建版本/);
  }finally{
    assert.ok(path.resolve(scratch).startsWith(path.resolve(root,'.tmp/frontend')+path.sep));
    await fs.rm(scratch,{recursive:true,force:true});
  }
});
