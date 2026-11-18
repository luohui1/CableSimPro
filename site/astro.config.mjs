// CableSimPro 文档站点。内容来源与发布范围见 publish.json，构建前由 scripts/prepare-content.mjs 准备。
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import mermaid from 'astro-mermaid';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import starlightImageZoom from 'starlight-image-zoom';
import starlightOpenAPI, { createOpenAPISidebarGroup } from 'starlight-openapi';
import { fileURLToPath } from 'node:url';

// 公网部署时由工作流传入站点地址和子路径；内网或本机默认放在站点根目录。
const site = process.env.DOCS_SITE || undefined;
const base = process.env.DOCS_BASE || '/';
const apiGroup = createOpenAPISidebarGroup();
// 以未转义的 file 地址传给 OpenAPI 解析器：仓库路径含中文时，转义后的地址在 Windows 上无法打开。
const schemaPath = fileURLToPath(new URL('./.generated/openapi.json', import.meta.url)).replaceAll('\\', '/');
const openapiSchema = 'file://' + (schemaPath.startsWith('/') ? '' : '/') + schemaPath;

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  markdown: {
    processor: unified({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }),
  },
  integrations: [
    // astro-mermaid 必须排在 Starlight 之前；图在浏览器端用随站点打包的 mermaid 渲染，离线可用。
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'CableSimPro 文档',
      description: '电缆载流量计算、电缆设计、电缆仿真与 Agent：安装、使用、方法依据与结果解读。',
      defaultLocale: 'root',
      locales: { root: { label: '简体中文', lang: 'zh-CN' } },
      // 品牌标记由 design/brand/mark.svg 按 design/tokens.css 的明暗配色生成。
      logo: { light: './src/assets/generated/mark-light.svg', dark: './src/assets/generated/mark-dark.svg', alt: 'CableSimPro' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/luohui1/CableSimPro' }],
      customCss: ['katex/dist/katex.min.css', './src/styles/custom.css'],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      lastUpdated: false,
      credits: false,
      plugins: [
        starlightImageZoom(),
        starlightOpenAPI([
          {
            base: 'develop/api',
            schema: openapiSchema,
            sidebar: { label: '接口参考', group: apiGroup, operations: { badges: true, labels: 'path' } },
            // 只保留 curl 调用示例；按模式自动生成的请求体与响应示例体积很大，构建内存成倍增加，且字段表已完整列出
            snippets: { operation: { clients: { shell: ['curl'] } }, requestBody: false, response: false },
          },
        ]),
      ],
      sidebar: [
        { label: '快速上手', items: ['quickstart/factory', 'quickstart/research'] },
        { label: '安装与部署', items: [{ autogenerate: { directory: 'install' } }] },
        { label: '用户指南', items: [{ autogenerate: { directory: 'guide' } }] },
        {
          label: '方法与依据',
          items: [
            'methods',
            'methods/iec-60287',
            'methods/gb-50217',
            'methods/thermal-network',
            'methods/fem',
            'methods/standard-check',
            'methods/catalog',
            { label: '技术说明', collapsed: true, items: [{ autogenerate: { directory: 'methods/notes' } }] },
          ],
        },
        {
          label: '插件与开发',
          items: [
            'develop',
            'develop/plugin-manifest',
            'develop/examples',
            { label: '宿主契约', collapsed: true, items: [{ autogenerate: { directory: 'develop/host' } }] },
            apiGroup,
          ],
        },
        { label: '常见问题与术语', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: '发布说明与已知限制', items: [{ autogenerate: { directory: 'releases' } }] },
      ],
    }),
  ],
});
