// 构建站点：准备内容 → astro build → 内部信息检查（npm run build）。
// 打包器、图像处理和 libuv 的线程池默认按 CPU 核数创建，在多核机器上会多占 1 GB 以上的提交内存；
// 这里限制线程数和 Node 堆大小（已设置的环境变量优先），构建时间基本不变。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const env = { RAYON_NUM_THREADS: '4', UV_THREADPOOL_SIZE: '4', VIPS_CONCURRENCY: '2', ...process.env };

function step(args) {
  const result = spawnSync(process.execPath, args, { cwd: site, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

step(['scripts/prepare-content.mjs', ...process.argv.slice(2)]);
step(['--max-old-space-size=1536', 'node_modules/astro/bin/astro.mjs', 'build']);
step(['scripts/check-internal.mjs']);
