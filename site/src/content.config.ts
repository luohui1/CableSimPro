import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

// src/content/docs/_synced/ 由 scripts/prepare-content.mjs 按 publish.json 从仓库 docs/ 生成，不入库；
// 这些页面在 frontmatter 里用 slug 指定网址。i18n/zh-CN.json 补充 Starlight 中文界面缺少的搜索文字。
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
