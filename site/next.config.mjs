// CableSimPro 文档站点（Fumadocs + Next.js 静态导出）。构建产物在 out/，可直接放到任意静态服务器离线使用。
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();
// 公网部署时由工作流传入子路径；内网或本机默认放在站点根目录。
const base = (process.env.DOCS_BASE || '/').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  trailingSlash: true,
  basePath: base || undefined,
  // 浏览器里的搜索要自己拼出索引文件地址，把子路径也带给客户端
  env: { NEXT_PUBLIC_DOCS_BASE: base },
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default withMDX(config);
