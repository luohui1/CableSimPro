import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// 构建时写出静态索引；默认的多语言模式按 Unicode 分词，可以搜索中文。
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
