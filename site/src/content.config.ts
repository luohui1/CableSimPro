import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// src/content/docs/_synced/ 由 scripts/prepare-content.mjs 按 publish.json 从仓库 docs/ 生成，不入库；
// 这些页面在 frontmatter 里用 slug 指定网址。
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
