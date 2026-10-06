/**
 * 仓库内的插画与产品渲染（design/illustrations/*.webp，由生图模型生成后裁切压缩）。
 * 只按名字取地址；缺图时返回 undefined，调用处不显示图片而不是报错。
 */
const files = import.meta.glob('../../../design/illustrations/*.webp', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;
const byName = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]));

export function illustration(name: string): string | undefined {
  return byName[name];
}

/** 插件封面：按插件标识（去掉 cablesim. 前缀）取。 */
export function pluginArt(pluginId: string) {
  return illustration('plugin-' + pluginId.replace(/^cablesim\./, ''));
}
