// 用真实产品重新生成“快速上手”的截图（WebP），一条命令完成：npm run screenshots
//
// 默认在仓库 .tmp/docs-screenshots/<随机目录> 中新建工程库：与 scripts/run_demo.py、发布门禁
// scripts/verify_release_workflows.py 相同，调用 frontend/scripts/seed-engineering-demo.py 的 seed_release 生成发布示例；
// 再按 run_demo.py 的方式启动发布应用，用 Playwright 照文档步骤逐步操作截图。
// 结束后停止服务并删除临时目录，不读写 .data/release 中的工程库。
// 前提：仓库根目录运行过一次 python scripts/run_demo.py（生成 .data/release/frontend 前端构建），
//       site/ 中执行过 npm ci 与 npx playwright install chromium。
//
// 参数：--only factory|research  只走一条主线
//       --url http://127.0.0.1:端口 --allow-writes  使用已在运行的实例；脚本会在其中新建系列、研究和运行，
//                                               只能指向可以随意改动的演示库，所以必须同时写明 --allow-writes
// 研究院主线结束后，把页面上实际显示的结果数值写入 src/quickstart-values.json，文档正文引用这份数据。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const site = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(site, '..');
const shotsRoot = path.join(site, 'src/assets/screenshots');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const only = option('--only');
const python =
  [process.env.PYTHON, path.join(repo, '.venv/Scripts/python.exe'), path.join(repo, '.venv/bin/python')].find(
    (p) => p && existsSync(p),
  ) || (process.platform === 'win32' ? 'python' : 'python3');
const viewport = { width: 1366, height: 768 };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- 隔离的产品实例
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, stdio: 'inherit', windowsHide: true, ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error(`${path.basename(command)} 退出码 ${code}`))));
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startProduct() {
  const frontend = path.join(repo, '.data/release/frontend');
  if (!existsSync(path.join(frontend, 'index.html')))
    throw Error('缺少前端发布构建。请先在仓库根目录运行 python scripts/run_demo.py --no-browser，看到 “Homepage ready” 后按 Ctrl+C，再重新运行本命令。');
  // 超算连接设置保存在仓库的 .data/hpc/ 下，不随工程库隔离；存在时不截图，避免把个人连接信息带进画面
  if (existsSync(path.join(repo, '.data/hpc/config.json')))
    throw Error('仓库 .data/hpc/config.json 中有超算连接设置。请在没有这份设置的检出中运行截图。');
  const scratch = path.join(repo, '.tmp/docs-screenshots', randomUUID());
  const home = path.join(scratch, 'home');
  await mkdir(home, { recursive: true });
  const env = {
    ...process.env,
    CABLESIM_DB: path.join(scratch, 'engineering.sqlite'),
    CABLESIM_DATASETS_DIR: path.join(scratch, 'datasets'),
    CABLESIM_REPRODUCTION_LIBRARY: path.join(scratch, 'library'),
    CABLESIM_FRONTEND_DIST: frontend,
    NODE_ENV: 'production',
    PYTHONUTF8: '1',
    // 截图里出现的操作人统一为示例账户，不带出本机登录名
    USERNAME: 'engineer',
    USER: 'engineer',
    LOGNAME: 'engineer',
    // 用户目录指到临时目录：读不到本机的 SSH 主机别名、凭据和其他个人配置
    HOME: home,
    USERPROFILE: home,
  };
  // 截图不调用任何外部模型或识别服务
  for (const key of Object.keys(env))
    if (/^(MISTRAL|OPENAI|ANTHROPIC|DEEPSEEK|DASHSCOPE|ZHIPU|MOONSHOT|CABLE_STUDIO_MODEL|CABLESIM_MODEL|CABLESIM_LLM|CABLESIM_DATASHEET|CABLESIM_AGENT|CABLESIM_HPC|FUSION_)/.test(key))
      delete env[key];
  console.log(`临时工程库：${scratch}\n用发布种子生成示例数据（约 5–10 分钟）……`);
  const seed = [
    'import importlib.util, sys',
    'from pathlib import Path',
    "spec = importlib.util.spec_from_file_location('docs_seed', 'frontend/scripts/seed-engineering-demo.py')",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'module.seed_release(Path(sys.argv[1]))',
  ].join('\n');
  const discard = () => rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  try {
    await run(python, ['-c', seed, env.CABLESIM_DB], { env });
  } catch (error) {
    await discard();
    throw error;
  }
  const port = await freePort();
  let log = '';
  const server = spawn(
    python,
    ['-m', 'uvicorn', 'scripts.run_demo:create_release_app', '--factory', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    server.kill();
    await new Promise((resolve) => (server.exitCode !== null ? resolve() : server.once('exit', resolve)));
    await discard();
  };
  // 没等到就绪也要停掉服务、删掉临时库，不留下占着端口的进程
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) throw Error('产品服务启动失败：\n' + log.slice(-3000));
      try {
        if ((await fetch(url + '/api/health')).ok) break;
      } catch {}
      if (attempt > 480) throw Error('产品服务 120 秒内没有就绪：\n' + log.slice(-3000));
      await wait(250);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, scratch, stop };
}

// ---------------------------------------------------------------- 截图工具
function recorder(page, flow, staging) {
  const names = new Set();
  // target 可以是页面上的某个区域（Playwright locator），也可以是已渲染好的 PNG（如下载文件的首页）
  return async function capture(name, target) {
    if (names.has(name)) throw Error(`截图重名：${flow}/${name}`);
    names.add(name);
    let png = target;
    if (!Buffer.isBuffer(target)) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      png = target ? await target.screenshot() : await page.screenshot();
    }
    await sharp(png).webp({ quality: 80, effort: 6 }).toFile(path.join(staging, `${name}.webp`));
    console.log(`  ✓ ${flow}/${name}.webp`);
  };
}

// 用后端已依赖的 PyMuPDF 把下载到的 PDF 渲染成 PNG，展示真实交付文件的样子：
// 给了关键词时取第一个包含它的页面，否则取首页
async function pdfPage(file, keyword = '') {
  if ((await readFile(file)).subarray(0, 5).toString() !== '%PDF-') throw Error(`${path.basename(file)} 不是 PDF`);
  const png = file.replace(/\.pdf$/, '-page.png');
  const script = [
    'import fitz,sys',
    'd=fitz.open(sys.argv[1]); k=sys.argv[3]',
    'p=next((p for p in d if k and k in p.get_text()), d[0])',
    'p.get_pixmap(dpi=110).save(sys.argv[2])',
  ].join('\n');
  await run(python, ['-c', script, file, png, keyword]);
  return readFile(png);
}

async function choose(scope, page, label, optionName) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: typeof optionName === 'string' }).first().click();
}

const settle = (page) => page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

// ---------------------------------------------------------------- 电缆厂：导入 → 核对 → 载流量表 → 规格书
async function factory(page, capture, base, scratch) {
  // “电缆型号库 · 结构表导入与系列”页面目前没有侧栏入口，按文档直接打开它的地址
  await page.goto(`${base}/resources/cables/structure-import?theme=light`);
  await page.getByRole('button', { name: '选择结构表文件', exact: true }).waitFor();
  await settle(page);
  await capture('import-start');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载人民电缆示例结构表', exact: true }).click();
  const sample = path.join(scratch, 'people-mv-sample.xlsx');
  await (await download).saveAs(sample);
  await page.getByLabel('结构表文件', { exact: true }).setInputFiles(sample);
  await page.getByRole('heading', { name: '选择工作表', exact: true }).waitFor();
  await choose(page, page, '工作表', /YJV22/);
  await capture('import-sheet');

  await page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }).click();
  await page.getByRole('heading', { name: '确认列映射', exact: true }).waitFor();
  await capture('import-mapping');

  await page.getByRole('button', { name: '填写系列声明', exact: true }).click();
  const declaration = page.getByRole('form', { name: '系列声明' });
  await declaration.getByLabel('系列名称', { exact: true }).fill('人民电器 YJV22-8.7/15 kV 三芯（快速上手）');
  await capture('import-declaration');

  const preview = page.waitForResponse(
    (r) => r.url().endsWith('/api/type-library/imports/preview') && r.request().method() === 'POST',
    { timeout: 180000 },
  );
  await page.getByRole('button', { name: '逐行校验并预览', exact: true }).click();
  if (!(await preview).ok()) throw Error('入库预览失败');
  await page.getByRole('heading', { name: '核对入库预览', exact: true }).waitFor();
  await capture('import-preview');

  const rows = page.getByRole('table', { name: '逐行入库预览', exact: true });
  await rows.getByRole('button').first().click();
  await page.getByRole('table', { name: '逐项来源', exact: true }).waitFor();
  await capture('import-sources');
  await page.keyboard.press('Escape');

  await page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true }).check();
  const commit = page.waitForResponse(
    (r) => r.url().endsWith('/api/type-library/imports/commit') && r.request().method() === 'POST',
    { timeout: 180000 },
  );
  await page.getByRole('button', { name: /^确认入库 \d+ 个规格$/ }).click();
  if (!(await commit).ok()) throw Error('入库失败');
  await page.getByRole('heading', { name: /^已保存 \d+ 个规格草稿$/ }).waitFor();
  await capture('import-saved');

  await page.getByRole('button', { name: '打开系列，核对与计算', exact: true }).click();
  const specs = page.getByRole('table', { name: '系列规格', exact: true });
  await specs.waitFor();
  await settle(page);
  await capture('series');

  const batch = async (button, dialogName, fill) => {
    await page.getByRole('checkbox', { name: '选择全部规格', exact: true }).check();
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    await dialog.waitFor();
    if (fill) await fill(dialog);
    await dialog.getByRole('checkbox', { name: '确认所选规格与版本', exact: true }).check();
    const response = page.waitForResponse((r) => /\/series\/[^/]+\/batch/.test(r.url()) && r.request().method() === 'POST', {
      timeout: 600000,
    });
    await dialog.getByRole('button', { name: /^确认执行 \d+ 个规格$/ }).click();
    if (!(await response).ok()) throw Error(`${button}失败`);
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '本次批量操作结果', exact: true }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  };

  await batch('批量核对', '批量标准核对');
  await capture('check-results');

  await batch('批量计算', '批量计算', async (dialog) => {
    for (const [label, value] of [
      ['工况名称', '公开样本直埋条件'],
      ['中心埋深 m', '0.7'],
      ['土壤热阻率 K·m/W', '1.0'],
      ['环境温度 °C', '25'],
      ['交流频率 Hz', '50'],
      ['集肤效应系数 kₛ 1', '1'],
      ['邻近效应系数 kₚ 1', '1'],
      ['护套初始温度 °C', '70'],
      ['电流收敛容差 A', '0.00000001'],
      ['最大迭代次数 次', '300'],
      ['工况来源', '人民电器集团公开样本的直埋使用条件：土壤温度 25 °C，土壤热阻率 1.0 K·m/W，50 Hz；原表未列埋深，按中心埋深 0.7 m、金属套两端接地计算。'],
      ['方法参数来源', 'IEC 60287 公开样本对照设置：kₛ=1、kₚ=1，土壤热阻按精确式，护套涡流损耗明确忽略；迭代初值 70 °C、电流容差 1×10⁻⁸ A、最多 300 次。'],
    ])
      await dialog.getByLabel(label, { exact: true }).fill(value);
    await choose(dialog, page, '金属套接地', '两端接地');
    await choose(dialog, page, '护套涡流损耗', '明确忽略（须核对适用条件）');
    await choose(dialog, page, '土壤热阻公式', '精确式');
    await dialog.getByRole('heading', { name: '统一计算工况', exact: true }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await capture('rating-dialog');
  });
  await capture('rating-results');

  // 打开其中一个规格的型号设计，查看载流量表与规格书
  const row = specs.getByRole('row').filter({ hasText: '3×240' }).first();
  await row.getByRole('link', { name: '打开型号设计' }).first().click();
  await page.waitForURL(/\/types\//);
  await page.getByRole('button', { name: /^载流量表/ }).first().click();
  await page.getByText('允许电流', { exact: false }).first().waitFor({ timeout: 60000 });
  await settle(page);
  await capture('type-rating-table');

  await page.locator('button[data-command-id="specification"]:visible').first().click();
  await page.getByRole('tab', { name: '审核与发布', exact: true }).waitFor();
  await page.getByRole('button', { name: '生成规格书', exact: true }).click();
  await page.getByRole('alert').first().waitFor({ timeout: 300000 });
  await settle(page);
  await capture('spec-missing');
  await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
  await settle(page);
  await capture('spec-review');

  // 资料完整的示例型号：生成并下载规格书
  await page.goto(`${base}/types?theme=light`);
  await page.getByRole('button', { name: 'YJV22-8.7/15 3×300', exact: true }).click();
  await page.waitForURL(/\/types\//);
  await page.locator('button[data-command-id="specification"]:visible').first().click();
  await page.getByRole('tab', { name: '预览', exact: true }).waitFor();
  const pdf = page.waitForEvent('download', { timeout: 600000 });
  await page.getByRole('button', { name: '生成规格书', exact: true }).click();
  const file = path.join(scratch, 'specification.pdf');
  await (await pdf).saveAs(file);
  await capture('spec-pdf', await pdfPage(file, '允许电流'));
}

// ---------------------------------------------------------------- 研究院：新建工程 → 直埋研究 → 改条件对比 → 计算书
async function research(page, capture, base, scratch) {
  await page.goto(`${base}/?theme=light`);
  await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建研究', exact: true });
  await dialog.waitFor();
  await choose(dialog, page, '研究任务', '额定载流量');
  await dialog.getByLabel('研究名称', { exact: true }).fill('直埋载流量');
  await choose(dialog, page, '引用型号版本', 'YJQ02-64/110 kV · 1×800（典型结构演示） · 1.0.1');
  await choose(dialog, page, '计算方法', /^IEC 60287 载流量/);
  await capture('create-study');

  await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
  await page.waitForURL(/\/studies\//, { timeout: 180000 });
  await page.getByRole('button', { name: '预检并运行', exact: true }).waitFor();
  await settle(page);
  await capture('study');

  const runOnce = async () => {
    await page.getByRole('button', { name: '预检并运行', exact: true }).click();
    const preflight = page.getByRole('dialog', { name: '运行前预检', exact: true });
    await preflight.waitFor();
    // 预检结果读完后“确认并运行”才可用；等它可用再截图，画面里不留加载中的状态
    const ready = await preflight.getByRole('button', { name: '确认并运行', exact: true }).elementHandle();
    await page.waitForFunction((button) => !button.disabled, ready, { timeout: 120000 });
    return preflight;
  };
  const confirm = async (preflight, previous) => {
    await preflight.getByRole('button', { name: '确认并运行', exact: true }).click();
    await page
      .getByText(/^允许电流 [\d.]+ A/)
      .filter({ hasNotText: previous ?? '\u0000' })
      .first()
      .waitFor({ timeout: 300000 });
    await settle(page);
    return page.getByText(/^允许电流 [\d.]+ A/).first().innerText();
  };

  // 文档正文引用的数值取自页面上实际显示的结论，不手写
  const reading = (text) => {
    const match = text.match(/允许电流 ([\d.]+) A.*?运行 ([\d.]+) A 时最热导体 ([\d.]+) °C.*?距 ([\d.]+) °C 温限 ([\d.]+) K/s);
    if (!match) throw Error(`结论文字的格式变了，读不出数值：${text}`);
    const [, ampacity, load, hottest, limit, margin] = match;
    return { ampacity_a: ampacity, load_a: load, hottest_conductor_c: hottest, limit_c: limit, margin_k: margin };
  };
  let preflight = await runOnce();
  await capture('preflight');
  const first = await confirm(preflight);
  await capture('result-base');

  const soil = page.getByRole('textbox', { name: '介质热阻率', exact: true });
  await soil.fill('1.5');
  await soil.press('Tab');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('button', { name: '已保存', exact: true }).waitFor();
  preflight = await runOnce();
  const second = await confirm(preflight, first.match(/允许电流 [\d.]+ A/)[0]);
  await capture('result-changed');
  const values = { base: reading(first), changed: reading(second) };

  await page.getByRole('button', { name: '运行记录', exact: true }).click();
  const boxes = page.getByRole('checkbox', { name: /^对比 第 \d+ 次运行/ });
  await boxes.nth(1).waitFor();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: '对比所选运行', exact: true }).click();
  await page.getByText('保存运行对比', { exact: true }).waitFor();
  await page.getByRole('button', { name: '展开工况 1', exact: true }).click();
  await page.getByRole('table', { name: '输入差异（SI）', exact: true }).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await settle(page);
  await capture('compare');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '生成计算书', exact: true }).first().click();
  const downloadButton = page.getByRole('button', { name: '下载 PDF', exact: true });
  await downloadButton.waitFor({ timeout: 300000 });
  await page.getByRole('tab', { name: '来源', exact: true }).click();
  await settle(page);
  await page.waitForTimeout(1500);
  await capture('report-sources');
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  const pdf = page.waitForEvent('download');
  await downloadButton.click();
  const file = path.join(scratch, 'calculation.pdf');
  await (await pdf).saveAs(file);
  await capture('report-pdf', await pdfPage(file));
  return values;
}

// ---------------------------------------------------------------- 主流程
const flows = { factory, research };
const selected = only ? [only] : Object.keys(flows);
if (selected.some((name) => !flows[name])) throw Error(`--only 只能是 ${Object.keys(flows).join(' 或 ')}`);

if (option('--url') && !process.argv.includes('--allow-writes'))
  throw Error('--url 会在目标实例里新建系列、研究和运行。确认它是可以随意改动的演示库后，加上 --allow-writes 再运行。');
const product = option('--url')
  ? { url: option('--url').replace(/\/$/, ''), scratch: path.join(repo, '.tmp/docs-screenshots', randomUUID()), stop: async () => {} }
  : await startProduct();
await mkdir(product.scratch, { recursive: true });
const browser = await chromium.launch();
let failed = false;
try {
  for (const name of selected) {
    console.log(`主线：${name}`);
    const staging = path.join(product.scratch, `shots-${name}`);
    await mkdir(staging, { recursive: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    let values;
    try {
      values = await flows[name](page, recorder(page, name, staging), product.url, product.scratch);
    } catch (error) {
      failed = true;
      const scene = path.join(repo, '.tmp/docs-screenshots', `failure-${name}.png`);
      await page.screenshot({ path: scene }).catch(() => {});
      console.error(`主线 ${name} 失败（现场截图 ${scene}）：${error.message}`);
      continue;
    } finally {
      await context.close();
    }
    // 整条主线成功后才替换已有截图，失败时保留上一版
    const target = path.join(shotsRoot, name);
    await rm(target, { recursive: true, force: true });
    await mkdir(shotsRoot, { recursive: true });
    await rename(staging, target);
    if (values) {
      const file = path.join(site, 'src/quickstart-values.json');
      const data = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
      data[name] = values;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
    }
    console.log(`主线 ${name} 完成：${(await readdir(target)).length} 张截图`);
  }
} finally {
  await browser.close();
  await product.stop();
  if (option('--url')) await rm(product.scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
