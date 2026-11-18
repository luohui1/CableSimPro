import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { waitForPageReady } from './page-readiness.mjs';

export async function createRegularityAudit({ page, context, root }) {
  const phase = process.env.REGULARITY_PASS || 'after';
  if (!/^[a-z-]+$/.test(phase)) throw Error('规整巡检输出名只能使用小写字母和连字符');
  const out = path.join(root, '.data/fix-round/shared-shell/regularity', phase);
  await fs.mkdir(out, { recursive: true });
  const report = { generated: new Date().toISOString(), complete: false, pages: [], findings: [], typography: {}, controls: {}, tokens: {}, exclusions: {}, appearanceChecks: [], source: '发布库隔离副本；真实页面、实际计算样式；与可见文字巡检共用遍历与只读守卫' };
  report.policySha256 = createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
  report.sourceDatabase = process.env.E2E_DATABASE_SOURCE || path.join(root, '.data/release/engineering.sqlite');
  report.frontendSnapshot = process.env.E2E_FRONTEND_DIST || '当前前端构建';
  const keys = new Set(), shots = new Map();
  const screenshotKey = (route, size) => `${route}|${size.width}x${size.height}`;
  async function capture(surface, size) {
    const key = screenshotKey(surface.route, size);
    if (shots.has(key)) return;
    await waitForPageReady(page);
    await page.evaluate(() => document.fonts.ready);
    const filename = 'page-' + createHash('sha256').update(key).digest('hex').slice(0, 12) + '.png';
    await page.screenshot({ path: path.join(out, filename) });
    shots.set(key, filename);
  }
  async function record(surface, size, layer) {
    if (layer === 'technical') { report.exclusions.technicalSurfaces = (report.exclusions.technicalSurfaces || 0) + 1; return; }
    const result = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const token = name => Number.parseFloat(rootStyle.getPropertyValue(name));
      const spaces = [0, ...[1, 2, 3, 4, 6, 8, 12].map(n => token('--space-' + n))];
      const fonts = { page: token('--text-heading'), section: token('--text-subheading'), body: token('--text-body'), tablehead: token('--text-note'), auxiliary: token('--text-note'), group: token('--text-note'), value: token('--text-value'), stripSentence: token('--text-body'), stripValue: token('--text-heading'), stripUnit: token('--text-note'), stripLabel: token('--text-note') };
      const weights = [token('--weight-normal'), token('--weight-strong')];
      if ([...spaces, ...Object.values(fonts), ...weights].some(value => !Number.isFinite(value))) throw Error('设计 tokens 未加载；不能将缺失样式当作检查通过');
      const issues = [], profiles = [], controls = [], excluded = {};
      const cssPath = e => {
        const parts = [];
        for (let n = 0; e && e !== document.body && n < 7; n++, e = e.parentElement) {
          if (e.id) { parts.unshift('#' + CSS.escape(e.id)); break; }
          const siblings = [...(e.parentElement?.children || [])].filter(s => s.tagName === e.tagName);
          parts.unshift(e.tagName.toLowerCase() + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(e) + 1})` : ''));
        }
        return parts.join(' > ');
      };
      const visible = e => {
        if (!e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return false;
        const closed = e.closest('details:not([open])');
        if (closed && !closed.querySelector(':scope > summary')?.contains(e)) return false;
        const r = e.getBoundingClientRect();
        let l = Math.max(0, r.left), t = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
        for (let p = e.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p), b = p.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) { l = Math.max(l, b.left); right = Math.min(right, b.right); }
          if (/(hidden|clip|auto|scroll)/.test(s.overflowY)) { t = Math.max(t, b.top); bottom = Math.min(bottom, b.bottom); }
        }
        return right - l > 1 && bottom - t > 1;
      };
      const add = (e, category, actual, expected, extra = {}) => {
        const r = e.getBoundingClientRect();
        const sharedField = e.matches('[data-slot="field-content"],[data-slot="input-group-addon"]') || !!e.closest('.information-notice');
        issues.push({ selector: cssPath(e), text: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || '').trim().slice(0, 180), category, actual, expected, rect: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) }, classes: typeof e.className === 'string' ? e.className : '', ownerHint: sharedField || e.closest('.workbench-sidebar,.topbar,.relation-panel,.object-chip,.series-chart,.comparison-dots,[data-slot="dialog-content"]') ? '前端公共' : e.closest('.agent-page,.agent-panel') ? '前端公共' : e.closest('.type-page,.drawing-panel') ? '三维' : e.closest('[data-field-page],.field-results,.hpc-job-list') ? '仿真' : e.closest('.basis-page,.standards-browser') ? '标准' : undefined, ...extra });
      };
      const approx = (a, b) => Math.abs(a - b) <= 0.15;
      const directText = e => [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const roleFor = e => {
        if (e.closest('[data-conclusion-strip]')) {
          const part = e.closest('[data-conclusion-part]')?.dataset.conclusionPart;
          return { sentence: 'stripSentence', value: 'stripValue', unit: 'stripUnit', label: 'stripLabel' }[part] || null;
        }
        if (e.matches('.plugin-description,.capability-description')) return 'body';
        if (e.matches('.series-chart text,.comparison-dots text')) return 'auxiliary';
        if (e.matches('.home-page h1,.home-welcome h1,.conclusion-metrics dd,[data-typography="value"]')) return 'value';
        if (e.matches('.sidebar-group-label,.tree-caption,.explorer-section h3,.property-panel h3,.relation-panel h3,.group-row strong,.group-row b,.plugin-list h2,.parameter-group > h4,.inspector-conditions .input-section h2')) return 'group';
        if (e.matches('h1,.settings-head h2,.agent-start h2,.conclusion-copy h2,.page-title,[data-typography="heading"]')) return 'page';
        if (e.matches('h2,h3,[data-typography="subheading"]')) return 'section';
        if (e.matches('th')) return 'tablehead';
        if ([...e.classList].some(name => /(?:^|-)(?:note|help|hint|source|caption|description)$/.test(name))) return 'auxiliary';
        if (e.matches('small,.unit,.field-error,.field-help,.text-field > label,.select-field > label,.conclusion-metrics dt,.agent-card-meta,p.type-meta,[data-slot="field-label"],[data-typography="note"]') || e.closest('.muted,.status-mark,.property-row,.settings-help,.agent-thread-note,.agent-review-empty,.agent-review-checks,.agent-notice,.agent-evidence-tag,.agent-next-step')) return 'auxiliary';
        if (e.closest('button,a,[role="tab"],summary,label,nav')) return null;
        if (e.matches('p,td,dd,li,[data-typography="body"]')) return 'body';
        if (directText(e)) return 'unclassified';
        return null;
      };
      for (const e of document.querySelectorAll('body *')) {
        if (!visible(e)) continue;
        if (e.closest('canvas,iframe,pre,code,[data-slot="tooltip-content"]') || e.closest('svg') && !e.closest('.series-chart,.comparison-dots')) { const reason = e.closest('svg,canvas') ? 'engineeringGraphics' : 'traceOrTooltip'; excluded[reason] = (excluded[reason] || 0) + 1; continue; }
        const s = getComputedStyle(e), role = roleFor(e);
        if (role && (directText(e) || e.matches('h1,h2,h3,.conclusion-metrics dd'))) {
          const font = Number.parseFloat(s.fontSize), weight = Number(s.fontWeight);
          const emphasis = e.matches('b,strong') || role !== 'auxiliary' && !!e.closest('strong,b');
          const strongRoles = ['page', 'section', 'group', 'value', 'stripSentence', 'stripValue'];
          const expectedWeight = strongRoles.includes(role) || emphasis ? 600 : 400;
          profiles.push({ role, font, weight, emphasis, selector: cssPath(e) });
          const validFont = role === 'unclassified' ? Object.values(fonts).some(f => approx(f, font)) : approx(font, fonts[role]);
          if (!validFont || !weights.includes(weight)) add(e, '字号层级', `${role}: ${font}px / ${weight}`, `${role === 'unclassified' ? Object.values(fonts).join(' / ') : fonts[role]}px / ${strongRoles.includes(role) ? 600 : '400 或 600（强调）'}`, { role });
          if (role !== 'unclassified' && weight !== expectedWeight) add(e, '字号字重', `${role}: ${weight}`, `${expectedWeight}${emphasis ? '（强调 / 当前项）' : ''}`, { role });
        }
        // Zero/normal/auto is structural, not an off-token visual gap. The selected-tab
        // underline distance is explicitly 6px in §5 and is recorded separately.
        for (const property of ['marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft','rowGap','columnGap']) {
          const cssProperty = property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
          if (e.computedStyleMap?.().get(cssProperty)?.toString() === 'auto') { excluded.autoLayoutMargin = (excluded.autoLayoutMargin || 0) + 1; continue; }
          const value = Number.parseFloat(s[property]);
          if (!Number.isFinite(value) || spaces.some(v => approx(v, value))) continue;
          if (e.matches('.tabs-trigger') && property === 'paddingBottom' && approx(value, 6)) { excluded.tabUnderlineDistance = (excluded.tabUnderlineDistance || 0) + 1; continue; }
          add(e, '非 token 间距', `${property}: ${s[property]}`, spaces.join(' / ') + 'px', { property });
        }
        if (e.matches('.button,.sidebar-mode > button,.inspector-switch > button,.prompt-bar-icon,.prompt-bar-send,.agent-hold,[data-slot="toggle-group-item"],input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]),select,.select-trigger,[data-slot="select-trigger"],[data-slot="input"]')) {
          const shell = e.matches('input') ? e.closest('.number-input,.home-search') : null;
          const height = (shell || e).getBoundingClientRect().height;
          const compact = !e.matches('.agent-hold') && (e.matches('.button-compact,.button-icon,.prompt-bar-icon,.prompt-bar-send,.sidebar-mode > button,.inspector-switch > button,[data-slot="toggle-group-item"][data-size="sm"]') || !!e.closest('table,.command-bar,.toolbar,[role="toolbar"],.search-field,.study-inspector,.property-panel,.cad-tools,.cad-field-tools,.heat-detail-bar,.type-result-toolbar'));
          const expected = shell?.matches('.home-search') ? 48 : compact ? token('--control-compact') : token('--control-standard');
          controls.push({ selector: cssPath(e), measuredOn: shell ? cssPath(shell) : cssPath(e), level: expected === 48 ? 'home-search' : compact ? 'compact' : 'standard', height });
          if (!approx(height, expected)) add(shell || e, '控件高度', `${height.toFixed(2)}px`, `${expected}px`, { level: compact ? 'compact' : 'standard' });
        } else if (e.matches('button')) {
          controls.push({ selector: cssPath(e), level: 'unclassified', height: e.getBoundingClientRect().height, reason: '原生导航 / 行内动作 / 卡片；未声明标准控件层级，保留实际尺寸供复核' });
        }
        if (e.matches('td,th,.numeric,[data-numeric="true"]') && !e.closest('.group-row')) {
          const text = (e.innerText || e.textContent || '').trim();
          const header = e.closest('table')?.querySelector('thead tr')?.children[e.cellIndex];
          const number = /^[+−-]?\d[\d\s]*(?:[.,]\d+)?(?:[eE][+−-]?\d+)?(?:\s*[\p{L}°%²³/·−-]+)?$/u;
          const column = e.matches('td,th') ? [...e.closest('table').querySelectorAll('tbody tr:not(.group-row)')].map(row => row.cells[e.cellIndex]?.innerText.trim()).filter(Boolean) : [];
          const numericColumn = column.some(value => number.test(value)) && column.every(value => number.test(value) || value === '—') && !/名称|型号|编号|任务|运行|研究|工程|日期|版本|依据|方法|条款|状态/.test(header?.innerText || '');
          const declared = e.matches('.numeric,[data-numeric="true"]') || header?.matches('.numeric') || numericColumn || header && /电流|温度|厚度|余量|截面积|数量|核时|损耗|质量|重量/.test(header.innerText) && number.test(text);
          if (declared && !e.matches('.unit')) {
            if (s.textAlign !== 'right' && s.textAlign !== 'end') add(e, '数值对齐', s.textAlign, 'right');
            if (!s.fontVariantNumeric.includes('tabular-nums')) add(e, '数字字形', s.fontVariantNumeric, 'tabular-nums');
          }
        }
        if (e.matches('.topbar h1,.tree-name,.tree-row > span,.module-item > span,.object-chip-name,.project-explorer > header strong,.explorer-item b,.explorer-item > span,.object-link,.relation-name,.sidebar-item-label,[data-object-name]')) {
          const bounds = e.getBoundingClientRect();
          const visibleTextRects = range => [...range.getClientRects()].filter(r => r.height > 1 && (!/hidden|clip/.test(s.overflow) || r.top < bounds.bottom - 1 && r.bottom > bounds.top + 1));
          const lines = [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).flatMap(n => { const r = document.createRange(); r.selectNodeContents(n); return visibleTextRects(r).map(b => Math.round(b.y * 2) / 2); });
          const count = new Set(lines).size;
          if (count > 2) add(e, '名称换行', `${count} 行`, '最多两行；或省略并提供全名悬停');
          if (/(break-all)/.test(s.wordBreak) && count > 1 && !e.title && !e.closest('[title]')) add(e, '词中硬断', s.wordBreak, '正常换行；省略时可悬停全名');
          for (const node of [...e.childNodes].filter(n => n.nodeType === Node.TEXT_NODE)) for (const match of node.textContent.matchAll(/[A-Za-z]{4,}/g)) {
            const word = document.createRange(); word.setStart(node, match.index); word.setEnd(node, match.index + match[0].length);
            if (visibleTextRects(word).length > 1) add(e, '词中硬断', match[0] + ' 被拆成多行', '在单词边界换行；或省略并提供全名', { fullNameOnHover: !!(e.title || e.closest('[title]')) });
          }
          if ((e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && /hidden|clip/.test(s.overflow) && !e.title && !e.closest('[title]')) add(e, '截断无全名', `${e.scrollWidth}×${e.scrollHeight} / ${e.clientWidth}×${e.clientHeight}`, '截断名称提供 title 或 tooltip');
        }
      }
      const primary = [...document.querySelectorAll('.button-primary,.button-run,.agent-hold:not(:disabled),.prompt-bar-send[data-armed]')].filter(visible);
      if (primary.length > 1) primary.forEach(e => add(e, '多个主操作', `同屏 ${primary.length} 个`, '每屏最多一个主操作'));
      for (const strip of document.querySelectorAll('[data-conclusion-strip]')) if (visible(strip)) {
        const metrics = strip.querySelectorAll('.conclusion-strip-metrics > div').length;
        if (metrics && (metrics < 2 || metrics > 4)) add(strip, '结论条关键数', `${metrics} 项`, '2–4 项；未提供关键数时不制造数值');
      }
      for (const row of document.querySelectorAll('table tbody tr')) if (visible(row) && !row.matches('.group-row')) {
        const multiline = [...row.cells].some(cell => {
          const ys = [], walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) {
            const range = document.createRange(); range.selectNodeContents(walker.currentNode);
            for (const rect of range.getClientRects()) if (rect.height > 1) ys.push(rect.top);
          }
          const threshold = Number.parseFloat(getComputedStyle(cell).fontSize) * 0.75;
          return ys.length && Math.max(...ys) - Math.min(...ys) > threshold;
        });
        if (multiline) { excluded.wrappedTableRows = (excluded.wrappedTableRows || 0) + 1; continue; }
        const expected = row.closest('.density-standard') ? 44 : 40;
        const actual = row.getBoundingClientRect().height;
        if (!approx(actual, expected)) add(row, '表格行高', actual.toFixed(2) + 'px', expected + 'px；含多行内容的行另计');
      }
      for (const parent of document.querySelectorAll('dl,.settings-card,.property-group,.inspector-group')) {
        const layout = getComputedStyle(parent);
        if (layout.display === 'flex' && layout.flexDirection.startsWith('row') || layout.display === 'grid' && layout.gridTemplateColumns.trim().split(/\s+/).length > 1) { excluded.multicolumnLabelGroups = (excluded.multicolumnLabelGroups || 0) + 1; continue; }
        const labels = [...parent.querySelectorAll(':scope > dt,:scope > div > dt,:scope > .settings-row .settings-row-label,:scope > .property-row > label,:scope > .inspector-row > label')].filter(visible);
        if (labels.length < 2) continue;
        const positions = labels.map(e => e.getBoundingClientRect().left);
        if (Math.max(...positions) - Math.min(...positions) > 2) labels.forEach(e => add(e, '标签列对齐', `${e.getBoundingClientRect().left.toFixed(1)}px`, `同组左边一致（±2px）；本组 ${positions.map(n => n.toFixed(1)).join(', ')}`));
      }
      return { issues, profiles, controls, excluded, tokens: { spaces, fonts, weights } };
    });
    report.tokens = result.tokens;
    const pageKey = surface.route + '|' + size.width;
    const priorProfile = report.typography[pageKey] || [];
    report.typography[pageKey] = [...new Map([...priorProfile, ...result.profiles].map(p => [p.role + '|' + p.font + '|' + p.weight + '|' + p.emphasis, { role: p.role, font: p.font, weight: p.weight, emphasis: p.emphasis }])).values()];
    report.controls[pageKey] = [...new Map([...(report.controls[pageKey] || []), ...result.controls].map(control => [control.selector, control])).values()];
    for (const [key, count] of Object.entries(result.excluded)) report.exclusions[key] = (report.exclusions[key] || 0) + count;
    const newIssues = result.issues.filter(hit => !keys.has([surface.route, size.width, hit.selector, hit.category, hit.actual].join('|')));
    let evidence;
    if (newIssues.length) {
      evidence = 'position-' + createHash('sha256').update(pageKey + newIssues.map(h => h.selector + h.category + h.actual).join('|')).digest('hex').slice(0, 12) + '.png';
      await page.screenshot({ path: path.join(out, evidence) });
    }
    for (const hit of newIssues) {
      const key = [surface.route, size.width, hit.selector, hit.category, hit.actual].join('|');
      if (keys.has(key)) continue;
      keys.add(key);
      report.findings.push({ page: surface.route, label: surface.label, ...size, ...hit, owner: hit.ownerHint || surface.owner, screenshot: evidence, position: { ...hit.rect } });
    }
    return result;
  }
  async function save(traversal) {
    report.complete = traversal.complete;
    report.uncovered = traversal.uncovered;
    report.errors = traversal.errors;
    report.blockedWrites = traversal.blockedWrites;
    report.pages = traversal.pages.map(p => ({ ...p, screenshot: shots.get(screenshotKey(p.route, p)) }));
    const byOwner = {}, byCategory = {}, patterns = new Map();
    for (const h of report.findings) { byOwner[h.owner] = (byOwner[h.owner] || 0) + 1; byCategory[h.category] = (byCategory[h.category] || 0) + 1; }
    for (const h of report.findings) {
      const component = h.classes || h.selector.split(' > ').at(-1).replace(/:nth-of-type\(\d+\)/g, '');
      const key = [h.owner, h.category, h.actual, h.expected, component].join('|');
      if (!patterns.has(key)) patterns.set(key, { owner: h.owner, category: h.category, actual: h.actual, expected: h.expected, component, count: 0, example: h });
      patterns.get(key).count++;
    }
    report.counts = { findings: report.findings.length, byOwner, byCategory };
    report.patterns = [...patterns.values()].sort((a,b) => b.count - a.count);
    await fs.writeFile(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
    const cell = value => String(value ?? '').replaceAll('|','\\|').replaceAll('\n',' ');
    await fs.writeFile(path.join(out, 'patterns.md'), '# 按组件归并的问题\n\n完整实例与视口位置见 findings.md；同一组件跨页面重复出现只在此归为一项，不改变原始计数。\n\n| 线程 | 问题 | 组件 | 实际 | 应为 | 实例数 | 示例 |\n|---|---|---|---|---|---|---|\n' + report.patterns.map(p => `| ${p.owner} | ${p.category} | ${cell(p.component)} | ${cell(p.actual)} | ${cell(p.expected)} | ${p.count} | ${cell(p.example.label)} · [定位](${p.example.screenshot}) |`).join('\n') + '\n');
    const rows = report.findings.map(h => `| ${cell(h.label)} (${h.width}) | ${h.owner} | ${h.category} | ${cell(h.text)} | ${cell(h.actual)} | ${cell(h.expected)} | ${cell(h.selector)} · x${Math.round(h.rect.x)} y${Math.round(h.rect.y)} | [页面](${h.screenshot}) |`);
    await fs.writeFile(path.join(out, 'findings.md'), `# 全站规整巡检

完成：${report.complete}；页面视口：${report.pages.length}；问题：${report.findings.length}。

来自实际 DOM / computed style。标题 20、区块标题 16、正文 14、表头及说明 13、关键数值 28；分组标题 13 / 600。已知组件按语义角色检查，强调与当前项另计；普通文字 400，强调 600。未标注角色的行内文字只检查是否使用合法字号 / 字重，列在 typography 的 unclassified 中，不能声称其语义已核定。图纸 SVG / Canvas、折叠追溯、悬停不作为普通界面字号；主动进入技术页签单独计数。

控件测量可见完整外框（数值框含单位、首页搜索含容器）：工具栏 / 属性栏 / 表格 32、表单 / 主要审批 36、首页搜索 48。原生导航箭头、文字详情入口与卡片不当作标准按钮；尚无角色的控件需人工核实。表格单行 40 / 44，实际多行内容另计。标签列只比较同一纵向行组，不跨并排指标 / 多列网格。spacing 检查 margin / padding / gap；0 / normal / auto 属结构布局，§5 明定页签下划线距离 6px 单列允许，其余非 token 值均记录。上述排除计数与逐页字号 / 控件实际值保留在 audit.json。

| 页面 | 线程 | 问题 | 元素文字 | 实际 | 应为 | 元素 / 视口位置 | 截图 |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## 未覆盖

${traversal.uncovered.map(u => '- ' + cell(u.label || u.page) + '：' + cell(u.reason)).join('\n') || '无'}
`);
  }
  async function overview() {
    const gallery = await context.newPage();
    try {
      const surfaces = report.pages.filter(p => p.width === 1366 && p.screenshot);
      const groups = new Map();
      for (const p of surfaces) { const key = p.owner || '前端公共'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
      const index = [];
      for (const [owner, surfaces] of groups) for (let offset = 0; offset < surfaces.length; offset += 24) {
        const part = surfaces.slice(offset, offset + 24), tiles = [];
        for (const p of part) { const bytes = await fs.readFile(path.join(out, p.screenshot)); tiles.push(`<figure><img src="data:image/png;base64,${bytes.toString('base64')}"><figcaption>${p.label.replaceAll('&','&amp;').replaceAll('<','&lt;')}</figcaption></figure>`); }
        await gallery.setViewportSize({ width: 1440, height: 1080 });
        await gallery.setContent(`<html lang="zh"><style>body{margin:24px;font:14px sans-serif;background:#f4f4f4;color:#0d0d0d}h1{font-size:20px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0;background:white}img{width:100%;display:block}figcaption{padding:8px;overflow-wrap:anywhere}</style><h1>${owner} · 1366 浅色 · ${offset + 1}–${offset + part.length}</h1><main>${tiles.join('')}</main></html>`);
        await gallery.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
        const name = `overview-${createHash('sha256').update(owner).digest('hex').slice(0,6)}-${Math.floor(offset / 24) + 1}.png`;
        await gallery.screenshot({ path: path.join(out, name), fullPage: true });
        index.push(`- ${owner} ${offset + 1}–${offset + part.length}：[总览](${name})`);
      }
      await fs.writeFile(path.join(out, 'overview.md'), '# 逐页截图总览\n\n每个页面 / 页签一张 1366 浅色缩略图，按线程分组；截图为实际页面首屏。滚动后发现的问题另记录实际视口位置，不能用首屏图当作该位置截图。\n\n' + index.join('\n') + '\n');
    } finally { await gallery.close(); }
  }
  return { capture, record, save, overview, report, out };
}
