/** Reuse the reproducible, pinned OCCT build; keep generated assets in ignored node_modules. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../../..');
const source = path.join(repository, '.data/occt-toolchain/viewer');
const target = path.join(directory, 'node_modules/.cache/cablesim-occt');
export async function validateRuntime(sourceDirectory, nativeDirectory = path.join(directory, 'native')) {
  const record = await readFile(path.join(sourceDirectory, 'build.json'));
  const metadata = JSON.parse(record.toString('utf8'));
  const pins = JSON.parse(await readFile(path.join(nativeDirectory, 'runtime.lock.json'), 'utf8'));
  if (Object.entries(pins).some(([key, value]) => metadata[key] !== value)) {
    throw new Error('OCCT 构建版本不符合锁定版；请运行 frontend/src/features/cad/native/build.py。');
  }
  for (const name of ['CMakeLists.txt', 'viewer.cpp', 'build.py', 'runtime.lock.json', 'prepare.py', 'downloads.lock.json']) {
    const bytes = await readFile(path.join(nativeDirectory, name));
    if (createHash('sha256').update(bytes).digest('hex') !== metadata.sources?.[name]) throw new Error(`OCCT 源码摘要不符：${name}；请重新构建。`);
  }
  const files = new Map([['build.json', record]]);
  for (const name of ['occt-viewer.js', 'occt-viewer.wasm', 'LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
    const bytes = await readFile(path.join(sourceDirectory, name));
    if (createHash('sha256').update(bytes).digest('hex') !== metadata.assets?.[name]) throw new Error(`OCCT 资产摘要不符：${name}`);
    files.set(name, bytes);
  }
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await validateRuntime(source);
  if (!process.argv.includes('--check-only')) {
    await mkdir(target, { recursive: true });
    for (const [name, bytes] of files) await writeFile(path.join(target, name), bytes);
  }
  console.log(`OCCT：已核对版本、原生源码、JS/WASM 和许可摘要，准备本地资产 ${target}`);
}
