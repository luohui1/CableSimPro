import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const literalColor = /(?:#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color)\s*\()/i;
const paletteClass = /(?:^|[\s:'"`])(?:bg|text|border|outline|ring|fill|stroke|shadow|decoration|placeholder|accent|caret)-(?:white|black|(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?)(?=[/\s:'"`]|$)/;
const typeClass = /(?:^|[\s:'"`])text-(?:xs|sm|base|lg|xl|\d+xl)(?=[/\s:'"`]|$)/;
const radiusClass = /(?:^|[\s:'"`])rounded(?:-(?:none|xs|sm|md|lg|xl|\d+xl|full))?(?=[\s:'"`]|$)/;
const arbitraryClass = /(?:bg|text|border|rounded|outline|ring|fill|stroke)-\[(?!var\(--|--)[^\]]+\]/;

export function inspectStyles(source, filename) {
  const failures = [];
  const report = (offset, message) => failures.push({ file: filename, line: source.slice(0, offset).split('\n').length, message });
  if (/\.(?:tsx?|jsx?)$/.test(filename)) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('motion/') && filename.replaceAll('\\', '/') !== 'src/components/motion.tsx') report(node.getStart(ast), '组件只通过公共动效封装使用 Motion。');
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'style') report(node.getStart(ast), '禁止内联 style；改用公共组件类与令牌。');
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText(ast).replaceAll(/['"]/g, '') === 'style') report(node.getStart(ast), '禁止通过对象展开传入 style。');
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'style') report(node.getStart(ast), '禁止直接写 DOM 内联 style。');
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setAttribute' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'style') report(node.getStart(ast), '禁止用 setAttribute 写入内联 style。');
      if (ts.isStringLiteralLike(node) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(node.kind)) {
        const value = node.text;
        if (literalColor.test(value)) report(node.getStart(ast), '禁止字面颜色。');
        if ([paletteClass, typeClass, radiusClass, arbitraryClass].some(rule => rule.test(value))) report(node.getStart(ast), '禁止 Tailwind 默认色阶、字号、圆角及非令牌任意值。');
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  if (filename.endsWith('.css')) {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    for (const match of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)[;}]?/g)) {
      const [, property, value] = match;
      if (literalColor.test(value)) report(match.index, '禁止字面颜色，唯一色值来源是 design/tokens.css。');
      if (/^(?:color|background(?:-color)?|(?:border|outline)(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|accent-color|caret-color)$/.test(property) && /\b(?:white|black|red|blue|green|grey|gray|orange|purple|teal|yellow|pink|navy|maroon)\b/i.test(value)) report(match.index, '禁止命名色。');
      if (/^(?:font-size|border(?:-(?:top-left|top-right|bottom-left|bottom-right))?-radius)$/.test(property) && !/^(?:var\(--|calc\(var\(--|inherit$|unset$)/.test(value.trim())) report(match.index, '字号和圆角必须引用令牌。');
      if (property === 'font' && /\d(?:px|rem|em|pt)/.test(value)) report(match.index, '禁止 font 简写中的字面字号。');
    }
  }
  return failures;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && ['node_modules', 'dist', '.cache'].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : /\.(?:tsx?|jsx?|css)$/.test(entry.name) ? [target] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = walk(path.join(root, 'src')).flatMap(file => inspectStyles(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  failures.forEach(f => console.error(`${f.file}:${f.line} ${f.message}`));
  if (failures.length) process.exitCode = 1;
  else console.log('前端样式规则通过：无字面颜色、字号、圆角或内联 style。');
}
