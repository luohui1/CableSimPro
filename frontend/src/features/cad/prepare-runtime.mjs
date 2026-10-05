/** Reuse the reproducible, pinned OCCT build; keep generated assets in ignored node_modules. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const source = path.join(repository, 'design/node_modules/.cache/cablesim-occt');
const target = path.join(directory, 'node_modules/.cache/cablesim-occt');
const metadata = JSON.parse(await readFile(path.join(source, 'build.json'), 'utf8'));
if (metadata.occt !== '7.9.0' || metadata.emscripten !== '3.1.73'
    || metadata.commit !== '858dd02fed80c8ca68cf1d70a6e03ecf97f849ca') {
  throw new Error('OCCT 构建版本不符合现有锁定版；请先使用 design/workbench/build-occt.py 构建。');
}
for (const name of ['occt-viewer.js', 'occt-viewer.wasm']) {
  const bytes = await readFile(path.join(source, name));
  if (createHash('sha256').update(bytes).digest('hex') !== metadata.assets[name]) {
    throw new Error(`OCCT 资产摘要不符：${name}`);
  }
}
await mkdir(target, { recursive: true });
for (const name of ['occt-viewer.js', 'occt-viewer.wasm', 'build.json', 'LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
  await copyFile(path.join(source, name), path.join(target, name));
}
console.log(`OCCT 7.9.0 / Emscripten 3.1.73：已核对摘要并准备本地前端资产 ${target}`);
