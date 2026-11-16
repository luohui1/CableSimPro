// The interface check. The look lives in two places only: the theme (ui/styles/theme.css, ui/styles/app.css) and the
// controls built on it (ui/components/ui, ui/kit). Everything else composes those parts and writes no look of its own.
// Run by `npm run build`; `node scripts/ui-lint.ts --report` also lists every hit in the exempted files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ui = join(root, 'ui');

/** The theme: the only files that may write colour values and sizes. */
const THEME = ['ui/styles/theme.css', 'ui/styles/app.css'];
/** The controls: the only files that may use native buttons, fields, selects and tables, and refer to raw variables. */
const CONTROLS = ['ui/components/ui/', 'ui/kit/'];

/**
 * Screens and styles written before the theme existed, each with what it still owes. A screen rebuilt from the kit
 * deletes its line. The check fails when an entry owes more than written here (new debt), and when it owes nothing (the
 * line must go); when it owes less, lower the number. The list and the numbers only shrink.
 */
const EXEMPT: { path: string; owes: number; owner: string; until: string }[] = [
  { path: 'ui/components/product-cad.tsx', owes: 14, owner: 'studio-build', until: 'Agent 的三维模型卡改用设计部件时重写（型号工作区的三维视图也用它）；材料色要改读主题' },
  { path: 'ui/workbench/', owes: 21, owner: 'studio-build', until: '工作台载流量计算重做' },
  { path: 'ui/canvas/', owes: 17, owner: 'studio-build', until: '工作台载流量计算重做（断面绘图保留，外框换成 kit 的画布外框）' },
  { path: 'ui/results/', owes: 65, owner: 'studio-build', until: '工作台载流量计算重做' },
  { path: 'ui/styles/product.css', owes: 31, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/styles/workspace.css', owes: 63, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/icon.tsx', owes: 1, owner: 'studio-build', until: '旧页面删除（换用 kit/icon）' },
  { path: 'ui/components/button.tsx', owes: 6, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/marks.tsx', owes: 8, owner: 'studio-build', until: '旧页面删除（换用 kit 的标记）' },
  { path: 'ui/components/notice.tsx', owes: 3, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/number-field.tsx', owes: 2, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/popover.tsx', owes: 6, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/segmented.tsx', owes: 3, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/tabs.tsx', owes: 3, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/components/tooltip.tsx', owes: 3, owner: 'studio-build', until: '旧页面删除' },
  { path: 'ui/agent/', owes: 5, owner: 'studio-build', until: '对话页换用 kit 组件' },
  { path: 'ui/components/assistant-ui/', owes: 34, owner: 'studio-build', until: '对话页换用 kit 组件' },
];

interface Rule { id: string; text: string; applies: (file: string) => boolean; find: (source: string, file: string) => string[] }

const inTheme = (file: string) => THEME.includes(file);
const inControls = (file: string) => CONTROLS.some(prefix => file.startsWith(prefix));
const all = (pattern: RegExp) => (source: string) => [...source.matchAll(pattern)].map(match => match[0]);

// Tailwind's own palette and default shadows are switched off in the theme; naming them writes a look by hand (and,
// since they no longer exist, writes nothing at all).
const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTILITY = 'bg|text|border|border-[xytrblse]|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow';
const SPACING = 'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y';
const NAMED_COLOUR = 'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|silver|gold';

/** A bracket after a utility is a value unless a colon follows it (data-[x]:, group-data-[x]/name:): those are variants. */
function bracketValues(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?<![\w\]-])-?[a-z][\w-]*-\[(?:[^[\]\s]|\[[^\]\s]*\])+\]/g)) {
    const after = source.slice((match.index ?? 0) + match[0].length);
    if (after.startsWith(':') || /^\/[\w-]+:/.test(after)) continue;
    found.push(match[0] + (after.match(/^\/\d+/)?.[0] ?? ''));
  }
  for (const match of source.matchAll(/(?<![\w\]&-])\[[a-z-]+:(?:[^[\]\s]|\[[^\]\s]*\])+\]/g)) {
    const after = source.slice((match.index ?? 0) + match[0].length);
    if (after.startsWith(':') || /^\/[\w-]+:/.test(after)) continue;
    found.push(match[0]);
  }
  return found;
}

const RULES: Rule[] = [
  {
    id: 'colour',
    text: '颜色只在主题里定义：不写色值，不用 Tailwind 自带色板，不用变量绕开主题',
    applies: file => !inTheme(file),
    find: source => [
      ...all(/(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)(source),
      ...all(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/g)(source),
      ...all(/\bcolor\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz)/g)(source),
      ...all(new RegExp(`(?<![\\w-])-?(?:${COLOUR_UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`, 'g'))(source),
      ...all(new RegExp(`(?<![\\w-])(?:fill|stroke|stopColor|color|background)=["'](?:${NAMED_COLOUR})["']`, 'g'))(source),
      ...all(new RegExp(`(?<![\\w-])-?(?:${COLOUR_UTILITY})-\\(--[\\w-]+\\)`, 'g'))(source),
    ],
  },
  {
    id: 'arbitrary',
    text: '尺寸只用主题的阶梯：不写方括号任意值、任意属性，页面不直接引用变量',
    applies: file => !inTheme(file),
    find: (source, file) => [
      ...bracketValues(source),
      // A raw variable as a value (h-(--x)) belongs inside the controls, which wire library variables; not in a page.
      ...(inControls(file) ? [] : all(new RegExp(`(?<![\\w-])-?(?!(?:${COLOUR_UTILITY})-\\()[a-z][\\w-]*-\\(--[\\w-]+\\)`, 'g'))(source)),
    ],
  },
  {
    id: 'inline-style',
    text: '不写行内样式',
    applies: file => !inTheme(file) && file.endsWith('.tsx'),
    find: all(/(?<![\w-])style=[{"']/g),
  },
  {
    id: 'faded-text',
    text: '文字不靠透明度变淡：次要文字用主题的次要色（对比度不低于 4.5:1）',
    applies: file => !inTheme(file),
    find: all(/(?<![\w-])text-[a-z][\w-]*\/\d+(?![\w-])/g),
  },
  {
    id: 'shadow',
    text: '阴影只用主题的三种（shadow-composer、shadow-menu、shadow-modal）',
    applies: file => !inTheme(file),
    find: all(/(?<![\w-])(?:shadow-(?:2xs|xs|sm|md|lg|xl|2xl)|drop-shadow(?:-[\w-]+)?|inset-shadow-(?:2xs|xs|sm))(?![\w-])/g),
  },
  {
    id: 'spacing-step',
    text: '间距是 4px 的倍数：间距类名只用整数步',
    applies: file => !inTheme(file) && !file.startsWith('ui/components/ui/'),
    find: all(new RegExp(`(?<![\\w-])-?(?:${SPACING})-\\d+\\.\\d+(?![\\w-])`, 'g')),
  },
  {
    id: 'native-control',
    text: '按钮、输入框、下拉、表格只在 components/ui 与 kit 里用原生元素（也不用 role="button" 自造按钮）',
    applies: file => !inControls(file) && file.endsWith('.tsx'),
    find: all(/<(?:button|input|select|option|textarea|table|thead|tbody|tfoot|tr|td|th|summary)\b|role=["'{]+button/g),
  },
  {
    id: 'mantine',
    text: '不再引入 Mantine',
    applies: () => true,
    find: all(/@mantine\/[\w-]+/g),
  },
];

/** Comments say things; they do not style anything. Strings are kept whole: a glob or a URL in a string is not a comment. */
function withoutComments(source: string, css: boolean): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; index += 2; continue; }
      if (char === quote || (char === '\n' && quote !== '`')) quote = null;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
      continue;
    }
    // A line comment starts at the beginning of a line or after a space or punctuation (not in https://).
    if (!css && char === '/' && next === '/' && (index === 0 || /[\s;{}(),]/.test(source[index - 1]))) {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    out += char;
    index += 1;
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

const report = process.argv.includes('--report');
const failures: string[] = [];
const notes: string[] = [];
const owed = new Map<string, number>(EXEMPT.map(entry => [entry.path, 0]));
for (const path of files(ui)) {
  const file = relative(root, path).split(sep).join('/');
  const exempt = EXEMPT.find(entry => file.startsWith(entry.path));
  const lines = withoutComments(readFileSync(path, 'utf8'), file.endsWith('.css')).split('\n');
  for (const rule of RULES) {
    if (!rule.applies(file)) continue;
    lines.forEach((line, index) => {
      for (const hit of rule.find(line, file)) {
        if (exempt) {
          owed.set(exempt.path, (owed.get(exempt.path) ?? 0) + 1);
          if (report) console.log(`  （豁免）${file}:${index + 1}  ${rule.id}  ${hit}`);
        } else {
          failures.push(`${file}:${index + 1}  ${rule.text}：${hit}`);
        }
      }
    });
  }
}

for (const entry of EXEMPT) {
  const count = owed.get(entry.path) ?? 0;
  if (!existsSync(join(root, entry.path)) && !files(ui).some(path => relative(root, path).split(sep).join('/').startsWith(entry.path))) {
    failures.push(`豁免清单里的 ${entry.path} 已不存在，删掉这一行`);
  } else if (count === 0) {
    failures.push(`豁免清单里的 ${entry.path} 已经不欠了，删掉这一行（以后它和新代码一样受检查）`);
  } else if (count > entry.owes) {
    failures.push(`豁免清单里的 ${entry.path} 欠账从 ${entry.owes} 处增加到 ${count} 处：新写的部分要用 kit 和主题`);
  } else if (count < entry.owes) {
    notes.push(`豁免清单里的 ${entry.path} 欠账减到 ${count} 处，把 owes 改成 ${count}`);
  }
}

if (report) console.log(`\n豁免项共欠 ${[...owed.values()].reduce((a, b) => a + b, 0)} 处：\n${EXEMPT.map(entry => `  ${entry.path}  ${owed.get(entry.path)}`).join('\n')}`);
for (const note of notes) console.log(note);
if (failures.length) {
  console.error(`界面检查没有通过（${failures.length} 处）：\n${failures.map(line => `  ${line}`).join('\n')}`);
  console.error('\n规则见 studio/DESIGN.md。颜色、尺寸、阴影只在主题里定义；页面只拼 kit 与 components/ui 的组件。');
  process.exit(1);
}
console.log(`界面检查通过（豁免 ${EXEMPT.length} 项，见 scripts/ui-lint.ts）。`);
