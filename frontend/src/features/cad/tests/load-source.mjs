import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const repository = path.resolve(frontend, '..');
export async function loadSources(paths) {
  const scratch = path.join(repository, '.tmp/frontend', `canvas-unit-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  for (const relative of paths) {
    const source = await fs.readFile(path.join(frontend, relative), 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } });
    const destination = path.join(scratch, relative.replace(/\.ts$/, '.mjs'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, result.outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
  }
  return {
    import: relative => import(pathToFileURL(path.join(scratch, relative.replace(/\.ts$/, '.mjs'))).href),
    close: async () => {
      const root = path.join(repository, '.tmp/frontend');
      if (!path.resolve(scratch).startsWith(root + path.sep)) throw new Error('拒绝删除测试临时目录之外的路径。');
      await fs.rm(scratch, { recursive: true, force: true });
    },
  };
}
