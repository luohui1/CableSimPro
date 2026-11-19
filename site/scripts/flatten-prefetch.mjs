// 静态导出后处理：Next 把页面预取数据写成嵌套目录（__next.docs/$oc$slug/__PAGE__.txt），
// 浏览器请求的却是用点连接的文件名（__next.docs.$oc$slug.__PAGE__.txt）。
// 普通静态服务器不会做这层改写，这里把每个嵌套文件再按请求的名字复制一份，避免站内跳转时出现 404。
// 用法：node scripts/flatten-prefetch.mjs（由 npm run build 在 next build 之后调用）
import { copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../out', import.meta.url));

async function nested(dir, prefix) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await nested(full, `${prefix}.${entry.name}`)));
    else files.push({ full, name: `${prefix}.${entry.name}` });
  }
  return files;
}

let copied = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('__next.')) {
      for (const file of await nested(full, entry.name)) {
        await copyFile(file.full, path.join(dir, file.name));
        copied++;
      }
    } else await walk(full);
  }
}

await walk(out);
console.log(`预取数据已按请求文件名补齐：${copied} 个文件。`);
