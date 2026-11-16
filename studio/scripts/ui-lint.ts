// The interface check. The look lives in two places only: the theme (ui/styles/theme.css, ui/styles/app.css) and the
// controls built on it (ui/components/ui, ui/kit). Everything else composes those parts and writes no look of its own.
// Run by `npm run build`; `node scripts/ui-lint.ts --report` also lists what the exempted files still owe.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ui = join(root, 'ui');

/** The theme: the only files that may write colour values and sizes. */
const THEME = ['ui/styles/theme.css', 'ui/styles/app.css'];
/** The controls: the only files that may use native buttons, fields, selects and tables. */
const CONTROLS = ['ui/components/ui/', 'ui/kit/'];

/**
 * Screens and styles written before the theme existed. Each entry says who removes it and when; a screen rebuilt
 * from the kit deletes its line. The list only shrinks.
 */
const EXEMPT: { path: string; owner: string; until: string }[] = [
  { path: 'ui/pages/library.tsx', owner: 'studio-build', until: '工作台型号库重做' },
  { path: 'ui/pages/import.tsx', owner: 'studio-build', until: '工作台型号库重做' },
  { path: 'ui/pages/series.tsx', owner: 'studio-build', until: '工作台型号工作区重做' },
  { path: 'ui/series/', owner: 'studio-build', until: '工作台型号工作区重做' },
  { path: 'ui/components/product-', owner: 'studio-build', until: '工作台型号库重做' },
  { path: 'ui/workbench/', owner: 'studio-build', until: '工作台载流量计算重做' },
  { path: 'ui/canvas/', owner: 'studio-build', until: '工作台载流量计算重做（断面绘图保留，外框换成 kit 的画布外框）' },
  { path: 'ui/results/', owner: 'studio-build', until: '工作台载流量计算重做' },
  { path: 'ui/styles/product.css', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/styles/workspace.css', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/main.tsx', owner: 'studio-build', until: '旧页面删除（Mantine 样式表随之移除）' },
  { path: 'ui/components/button.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/icon.tsx', owner: 'studio-build', until: '旧页面删除（换用 kit/icon）' },
  { path: 'ui/components/marks.tsx', owner: 'studio-build', until: '旧页面删除（换用 kit 的标记）' },
  { path: 'ui/components/notice.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/number-field.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/popover.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/search-field.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/segmented.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/tabs.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/tooltip.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/library-header.tsx', owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/agent/', owner: 'studio-build', until: '对话页换用 kit 组件' },
  { path: 'ui/components/assistant-ui/', owner: 'studio-build', until: '对话页换用 kit 组件' },
  { path: 'ui/shell/', owner: 'studio-build', until: '外壳换用 kit 的顶栏' },
  { path: 'ui/router.tsx', owner: 'studio-build', until: '旧页面删除' },
];

interface Rule { id: string; text: string; applies: (file: string) => boolean; find: (source: string) => string[] }

const inTheme = (file: string) => THEME.includes(file);
const inControls = (file: string) => CONTROLS.some(prefix => file.startsWith(prefix));
const matches = (pattern: RegExp) => (source: string) => [...source.matchAll(pattern)].map(match => match[0]);

// Tailwind's own palette is switched off in the theme; naming it is writing a colour by hand.
const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTILITY = 'bg|text|border|border-[xytrblse]|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow';
const SPACING = 'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y';

const RULES: Rule[] = [
  {
    id: 'colour',
    text: '颜色只在主题里定义：不写色值，不用 Tailwind 自带色板',
    applies: file => !inTheme(file),
    find: source => [
      ...matches(/(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)(source),
      ...matches(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/g)(source),
      ...matches(new RegExp(`(?<![\\w-])-?(?:${COLOUR_UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`, 'g'))(source),
    ],
  },
  {
    id: 'arbitrary',
    text: '尺寸只用主题的阶梯：不写方括号任意值，不写任意属性',
    applies: file => !inTheme(file),
    find: source => [
      // A value in brackets at the end of a utility (w-[123px], text-[13px], shadow-[...]); variants such as
      // data-[state=open]: or has-[>[data-slot=x]]: select elements and are allowed (they end in a colon).
      ...matches(/(?<![\w\]-])-?[a-z][\w-]*-\[(?:[^[\]\s]|\[[^\]\s]*\])+\](?![:/\w\]-])/g)(source),
      // An arbitrary property ([mask:url(...)]).
      ...matches(/(?<![\w\]&-])\[[a-z-]+:(?:[^[\]\s]|\[[^\]\s]*\])+\](?![:/\w\]-])/g)(source),
    ],
  },
  {
    id: 'inline-style',
    text: '不写行内样式',
    applies: file => !inTheme(file) && file.endsWith('.tsx'),
    find: matches(/\bstyle=\{/g),
  },
  {
    id: 'faded-text',
    text: '文字不靠透明度变淡：次要文字用主题的次要色（对比度不低于 4.5:1）',
    applies: file => !inTheme(file),
    find: matches(/(?<![\w-])text-(?:foreground|muted-foreground|ink|ink-2|primary|secondary-foreground|accent-foreground|card-foreground|popover-foreground)\/\d+(?![\w-])/g),
  },
  {
    id: 'spacing-step',
    text: '间距是 4px 的倍数：间距类名只用整数步',
    applies: file => !inTheme(file) && !file.startsWith('ui/components/ui/'),
    find: matches(new RegExp(`(?<![\\w-])-?(?:${SPACING})-\\d+\\.5(?![\\w-])`, 'g')),
  },
  {
    id: 'native-control',
    text: '按钮、输入框、下拉、表格只在 components/ui 与 kit 里用原生元素',
    applies: file => !inControls(file) && file.endsWith('.tsx'),
    find: matches(/<(?:button|input|select|textarea|table|thead|tbody|tr|td|th)\b/g),
  },
  {
    id: 'mantine',
    text: '不再引入 Mantine',
    applies: () => true,
    find: matches(/@mantine\/[\w-]+/g),
  },
];

/** Comments say things; they do not style anything. */
const withoutComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
  .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (_, lead: string) => lead);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

const report = process.argv.includes('--report');
const failures: string[] = [];
const owed = new Map<string, number>();
for (const path of files(ui)) {
  const file = relative(root, path).split(sep).join('/');
  const exempt = EXEMPT.find(entry => file.startsWith(entry.path));
  const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');
  for (const rule of RULES) {
    if (!rule.applies(file)) continue;
    lines.forEach((line, index) => {
      for (const hit of rule.find(line)) {
        if (exempt) {
          owed.set(file, (owed.get(file) ?? 0) + 1);
          if (report) console.log(`  （豁免）${file}:${index + 1}  ${rule.id}  ${hit}`);
        } else {
          failures.push(`${file}:${index + 1}  ${rule.text}：${hit}`);
        }
      }
    });
  }
}

const unused = EXEMPT.filter(entry => !files(ui).some(path => relative(root, path).split(sep).join('/').startsWith(entry.path)));
for (const entry of unused) failures.push(`豁免清单里的 ${entry.path} 已不存在，删掉这一行`);

if (report) {
  console.log(`\n豁免文件仍欠 ${[...owed.values()].reduce((a, b) => a + b, 0)} 处，分布在 ${owed.size} 个文件。`);
}
if (failures.length) {
  console.error(`界面检查没有通过（${failures.length} 处）：\n${failures.map(line => `  ${line}`).join('\n')}`);
  console.error('\n规则见 studio/DESIGN.md。颜色、尺寸、阴影只在主题里定义；页面只拼 kit 与 components/ui 的组件。');
  process.exit(1);
}
console.log(`界面检查通过（豁免 ${EXEMPT.length} 项，见 scripts/ui-lint.ts）。`);
