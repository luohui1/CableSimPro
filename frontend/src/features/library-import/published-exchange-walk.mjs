import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from '@playwright/test';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';
import { multipartEvidence, observeExchangeUploads, safeRequestHeaders, saveRawResponse } from './resource-exchange-walk.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = path.resolve(process.env.PUBLISHED_EXCHANGE_EVIDENCE || path.join(root, '.tmp/library-import-walk/published'));
const python = process.env.PYTHON || 'python';
const expect = baseExpect.configure({ timeout: 30000 });
const cases = [1366, 1920].flatMap(width => ['json', 'xlsx'].map(format => ({
  id: `${width}-${format}`, format, viewport: { width, height: width === 1366 ? 768 : 1080 },
})));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (filename, value) => fs.writeFile(filename, JSON.stringify(value, null, 2) + '\n');
const read = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
async function fileEvidence(filename) { const bytes = await fs.readFile(filename); return { file: filename, bytes: bytes.length, sha256: digest(bytes) }; }
function pythonJSON(script, args = []) {
  return JSON.parse(execFileSync(python, ['-c', script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000 }));
}
async function closed(url) {
  const address = new URL(url); assert.equal(address.hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address.hostname, port: Number(address.port) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`先前服务仍在监听：${url}`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`无法确定先前服务是否关闭：${url}`)); });
    socket.once('error', error => error.code === 'ECONNREFUSED'
      ? resolve({ url, status: 'ECONNREFUSED', observed_at: new Date().toISOString() }) : reject(error));
  });
}

// Compare canonical Python JSON bytes, including signed records containing 1.0.
// JavaScript equality alone would silently equate a re-encoded 1 with 1.0.
function bundleEvidence(filename, manifestFile, sourceFile) {
  return pythonJSON([
    'import json,sys',
    'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file,encoded',
    'from backend.kernel.workspace import fingerprint',
    'from backend.foundation.contracts import AssetRelease,content_hash',
    'p=Path(sys.argv[1]); b=parse_file(p.name,p.read_bytes()); m=json.loads(Path(sys.argv[2]).read_bytes())',
    'assert len(b["projects"])==1',
    'project=b["projects"][0]; inputs=project["inputs"]; binding=inputs["study_cable_reference"]; proof=binding["source_snapshot"]',
    'assert proof["schema"]==m["proof_schema"]=="cablesim.exchange-published-cable-source/1"',
    'assert proof["run_evidence"]==m["run_evidence"]=="external_declared_run"',
    'assert binding["state"]=="draft" and binding["id"].startswith("exchange-model:")',
    'assert proof["origin"]["asset"]==m["old_publication"]["asset_id"]',
    'assert proof["origin"]["family"]==m["old_publication"]["asset_reference"]["id"]',
    'assert proof["origin"]["version"]==m["old_publication"]["asset_reference"]["version"]',
    'assert proof["asset_sha256"]==m["asset_sha256"]!=m["new_publication"]["asset_reference"]["content_sha256"]',
    'assert content_hash(AssetRelease.model_validate(proof["asset_release"]))==proof["asset_sha256"]',
    'assert fingerprint(proof["specification"])==proof["specification_sha256"]==m["specification_sha256"]',
    'assert encoded(proof["source_runs"])==encoded(m["source_runs"])',
    'key=lambda item:(item["release"]["asset_id"],item["release"]["version"],item["content_sha256"])',
    'deps={key(i):i for i in proof["dependencies"]}; assets={key(i):i for i in b["assets"]}',
    'assert len(deps)==len(proof["dependencies"])==len(assets)==len(b["assets"])',
    'assert set(deps)==set(assets)=={(i["asset_id"],i["version"],i["content_sha256"]) for i in m["dependencies"]}',
    'assert all(encoded(deps[k]["release"])==encoded(assets[k]["release"]) for k in deps)',
    'if len(sys.argv)>3:',
    ' s=json.loads(Path(sys.argv[3]).read_bytes())',
    ' assert project["origin_id"]==s["id"]==m["project_id"]',
    ' assert project["origin_revision"]==s["revision"]==m["project_revision"]',
    ' assert encoded(proof["binding"])==encoded(s["study_cable_reference"])',
    ' assert all(encoded(value)==encoded(s[k]) for k,value in inputs.items() if k!="study_cable_reference")',
    'print(json.dumps({"bundle_sha256":b["sha256"],"project_id":project["origin_id"],"project_name":inputs["domain"]["name"],',
    ' "input_sha256":project["input_sha256"],"proof_bytes":len(encoded(proof)),"bundle_bytes":len(encoded(b)),',
    ' "version":proof["origin"]["version"],"family":proof["origin"]["family"],"asset_sha256":proof["asset_sha256"],',
    ' "specification_sha256":proof["specification_sha256"],"dependency_count":len(deps),"source_run_count":len(proof["source_runs"]),',
    ' "dependencies":[{"origin_id":i["origin_id"],"asset_id":i["release"]["asset_id"],"version":i["release"]["version"],"content_sha256":i["content_sha256"]} for i in b["assets"]]}))',
  ].join('\n'), [filename, manifestFile, ...(sourceFile ? [sourceFile] : [])]);
}
function compareSaved(originalFile, projectFile, assetFiles) {
  return pythonJSON([
    'import json,sys',
    'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file,encoded',
    'from backend.foundation.contracts import AssetRelease,content_hash',
    'p=Path(sys.argv[1]); b=parse_file(p.name,p.read_bytes()); saved=json.loads(Path(sys.argv[2]).read_bytes())',
    'original=b["projects"][0]',
    'assert all(encoded(saved[k])==encoded(v) for k,v in original["inputs"].items())',
    'assert saved["exchange_origin"]["approval_inherited"] is False and saved["runs"]==[]',
    'assert saved["exchange_origin"]["input_sha256"]==original["input_sha256"]',
    'assert saved["exchange_origin"]["workspace"]==original["origin_id"] and saved["exchange_origin"]["revision"]==original["origin_revision"]',
    'assert saved["exchange_origin"]["bundle_sha256"]==b["sha256"]',
    'assert saved["study_cable_reference"]["state"]=="draft"',
    'expected={(i["release"]["asset_id"],i["release"]["version"]):i for i in b["assets"]}; actual={}',
    'for filename in json.loads(sys.argv[3]):',
    ' item=json.loads(Path(filename).read_bytes()); key=(item["asset_id"],item["version"])',
    ' assert key not in actual; actual[key]=item',
    ' assert item["status"]=="draft" and item["reviewed_sha256"] is None',
    ' assert encoded(item["release"])==encoded(expected[key]["release"])',
    ' assert content_hash(AssetRelease.model_validate(item["release"]))==item["content_sha256"]==expected[key]["content_sha256"]',
    'assert set(actual)==set(expected)',
    'print(json.dumps({"full_input_and_proof_canonical_bytes_equal":True,"exact_dependency_closure":True,"drafts_only":True,"dependency_count":len(actual)}))',
  ].join('\n'), [originalFile, projectFile, JSON.stringify(assetFiles)]);
}
function compareDownloads(original, exported) {
  return pythonJSON([
    'import sys,json', 'from pathlib import Path',
    'from backend.kernel.resource_exchange import parse_file,encoded',
    'a,b=[parse_file(Path(p).name,Path(p).read_bytes()) for p in sys.argv[1:]]',
    'assert encoded(a["projects"][0]["inputs"])==encoded(b["projects"][0]["inputs"])',
    'key=lambda i:(i["release"]["asset_id"],i["release"]["version"],i["content_sha256"])',
    'left={key(i):i for i in a["assets"]}; right={key(i):i for i in b["assets"]}; assert set(left)==set(right)',
    'assert all(encoded(left[k]["release"])==encoded(right[k]["release"]) for k in left)',
    'print(json.dumps({"full_proof_and_locks_equal":True,"exact_dependency_closure_equal":True,"reexport_canonical_bytes_equal":True}))',
  ].join('\n'), [original, exported]);
}

async function run(command, args, environment, logfile) {
  const stream = createWriteStream(logfile, { flags: 'wx' });
  const started = new Date().toISOString();
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const output of [child.stdout, child.stderr]) output.on('data', bytes => { stream.write(bytes); process.stdout.write(bytes); });
  const [exit_code, signal] = await once(child, 'close');
  await new Promise(resolve => stream.end(resolve));
  return { command, args, pid: child.pid, started, completed: new Date().toISOString(), exit_code, signal, log: await fileEvidence(logfile) };
}
async function orchestrate() {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out, { recursive: false }); // A rerun may not reuse earlier evidence.
  const report = { producer: null, manifest: null, phases: [], completed_cases: [], failures: [] };
  const save = () => write(path.join(out, 'report.json'), report);
  try {
    report.producer = await run(python, ['-m', 'pytest', '-n', '0', 'tests/test_published_project_exchange.py', '--junitxml=' + path.join(out, 'producer.xml')],
      { CABLESIM_PUBLISHED_EXCHANGE_EVIDENCE: path.join(out, 'source') }, path.join(out, 'producer.log'));
    await save(); assert.equal(report.producer.exit_code, 0, '真实源数据生产与后端门禁必须成功，不能复用旧库');
    const manifestFile = path.join(out, 'source/manifest.json'), manifest = await read(manifestFile);
    assert.equal(manifest.schema, 'cablesim.published-exchange-browser-source/1'); assert.equal(manifest.source_host_closed, true);
    const source = await fileEvidence(manifest.database);
    assert.equal(source.sha256, manifest.snapshot.sha256); assert.equal(source.bytes, manifest.snapshot.size_bytes);
    report.manifest = { ...await fileEvidence(manifestFile), source_database: source };
    async function phase(name, phaseName, database, task) {
      const directory = path.join(out, name); await fs.mkdir(directory, { recursive: true });
      const taskFile = path.join(directory, 'task.json'); if (task) await write(taskFile, task);
      const receipt = await run(process.execPath, [path.join(root, 'frontend/scripts/isolated-e2e.mjs'), 'library-exchange-walk.mjs'], {
        E2E_DATABASE_SOURCE: database, PUBLISHED_EXCHANGE_PHASE: phaseName, PUBLISHED_EXCHANGE_PHASE_OUT: directory,
        PUBLISHED_EXCHANGE_MANIFEST: manifestFile, ...(task ? { PUBLISHED_EXCHANGE_TASK: taskFile } : {}),
      }, path.join(directory, 'process.log'));
      const result = await read(path.join(directory, 'report.json')).catch(() => null);
      const lifecycle = { name, phase: phaseName, ...receipt, service: result?.service, closed: [], status: 'checking' };
      report.phases.push(lifecycle); await save();
      try {
        if (result?.service) {
          const log = await fs.readFile(receipt.log.file, 'utf8');
          const identity = /隔离服务：后端 PID (\d+) \/ (\d+)；预览 PID (\d+) \/ (\d+)/.exec(log);
          assert.ok(identity, '必须保存runner实际启动的两个进程身份');
          assert.equal(identity[2], new URL(result.service.backend_url).port);
          assert.equal(identity[4], new URL(result.service.frontend_url).port);
          lifecycle.processes = { backend_pid: Number(identity[1]), frontend_pid: Number(identity[3]) };
          await save();
          for (const url of [result.service.backend_url, result.service.frontend_url]) {
            try { lifecycle.closed.push(await closed(url)); }
            catch (error) {
              lifecycle.closed.push({ url, status: 'failed', observed_at: new Date().toISOString(), message: String(error), stack: error.stack });
              throw error;
            } finally { await save(); }
          }
          assert.ok(log.includes('本任务服务与子进程退出、端口关闭已核对。'));
        }
        assert.equal(receipt.exit_code, 0, `${name}未通过；原始日志与浏览器证据已保留`); assert.ok(result);
        lifecycle.status = 'passed'; await save();
        return { result, lifecycle };
      } catch (error) {
        lifecycle.status = 'failed'; lifecycle.failure = { message: String(error), stack: error.stack };
        await save(); throw error;
      }
    }
    const sourcePhase = await phase('source-browser', 'source', manifest.database);
    assert.deepEqual(sourcePhase.result.downloads.map(item => item.id), cases.map(item => item.id));
    assert.equal((await fileEvidence(manifest.database)).sha256, source.sha256, '来源仅被只读备份，原库字节不变');
    for (const item of sourcePhase.result.downloads) {
      const directory = path.join(out, item.id); await fs.mkdir(directory);
      const empty = path.join(directory, 'empty.sqlite');
      pythonJSON('import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.close(); print(json.dumps({"new_empty_database":True}))', [empty]);
      const task = { ...item, stopped_services: [sourcePhase.result.service] };
      const imported = await phase(item.id + '/import', 'import', empty, task);
      assert.equal((await fileEvidence(imported.result.checkpoint.file)).sha256, imported.result.checkpoint.sha256);
      const reopened = await phase(item.id + '/restart', 'restart', imported.result.checkpoint.file, {
        ...task, target: imported.result.target, checkpoint: imported.result.checkpoint,
        stopped_services: [...task.stopped_services, imported.result.service],
      });
      assert.equal(reopened.result.reexport.reexport_canonical_bytes_equal, true);
      report.completed_cases.push({ id: item.id, source_download: item.download, target: imported.result.target, checkpoint: imported.result.checkpoint, reexport: reopened.result.reexport });
      await save();
    }
    assert.equal(report.completed_cases.length, 4);
  } catch (error) { report.failures.push({ message: String(error), stack: error.stack }); throw error; }
  finally { await save(); }
}

export async function runPublishedExchangePhase() {
  assert.equal(process.env.E2E_ISOLATED, '1');
  const phase = process.env.PUBLISHED_EXCHANGE_PHASE, directory = process.env.PUBLISHED_EXCHANGE_PHASE_OUT;
  assert.ok(['source', 'import', 'restart'].includes(phase)); assert.ok(directory);
  const base = process.env.FRONTEND_URL, backend = process.env.BACKEND_URL;
  for (const url of [base, backend]) assert.equal(new URL(url).hostname, '127.0.0.1');
  const manifestFile = process.env.PUBLISHED_EXCHANGE_MANIFEST, manifest = await read(manifestFile);
  const task = phase === 'source' ? null : await read(process.env.PUBLISHED_EXCHANGE_TASK);
  const report = { phase, service: { backend_url: backend, frontend_url: base, database: process.env.CABLESIM_DB },
    requests: [], http: [], console: [], errors: [], failures: [], layout_failures: [], screenshots: [], downloads: [], closed_before_start: [] };
  const save = () => write(path.join(directory, 'report.json'), report);
  let browser;
  try {
    for (const service of task?.stopped_services ?? []) for (const url of [service.backend_url, service.frontend_url]) {
      assert.ok(![base, backend].some(current => new URL(current).port === new URL(url).port), '来源、原目标与重启目标必须使用不同端口');
      report.closed_before_start.push(await closed(url));
    }
    await save();
    const executablePath = process.env.BROWSER_EXECUTABLE || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const item of phase === 'source' ? cases : [task]) {
      const caseDir = path.join(directory, item.id); await fs.mkdir(caseDir);
      const context = await browser.newContext({ viewport: item.viewport, acceptDownloads: true, locale: 'zh-CN' });
      const page = await context.newPage(), observer = await observeExchangeUploads(page);
      const requests = new WeakMap(), pending = new Set(), bodies = new Set(), readCounts = new Map(); let sequence = 0, shot = 0;
      const identity = request => {
        if (!requests.has(request)) {
          const record = { case: item.id, id: ++sequence, method: request.method(), url: request.url(), started: new Date().toISOString(), request_headers: safeRequestHeaders(request) };
          requests.set(request, record); report.requests.push(record);
        }
        return requests.get(request);
      };
      page.on('request', request => { identity(request); pending.add(request); });
      page.on('requestfinished', request => { identity(request).finished = new Date().toISOString(); pending.delete(request); });
      page.on('requestfailed', request => {
        const record = identity(request); record.failed = { at: new Date().toISOString(), error: request.failure() };
        pending.delete(request); report.errors.push({ case: item.id, kind: 'request', request_id: record.id, url: request.url(), error: request.failure() });
      });
      page.on('console', entry => {
        const record = { case: item.id, type: entry.type(), text: entry.text(), location: entry.location() }; report.console.push(record);
        if (entry.type() === 'error') report.errors.push({ kind: 'console', ...record });
      });
      page.on('pageerror', error => report.errors.push({ case: item.id, kind: 'page', message: error.message }));
      page.on('response', response => {
        const record = identity(response.request()); record.status = response.status(); record.headers_received = new Date().toISOString();
        if (response.status() >= 400) report.errors.push({ case: item.id, kind: 'network', request_id: record.id, url: response.url(), status: response.status() });
        if (!new URL(response.url()).pathname.startsWith('/api/')) return;
        const work = (async () => {
          const error = await response.finished(); record.body_finished = { at: new Date().toISOString(), error: error ? String(error) : null };
          if (error) throw error;
          record.raw_response = await saveRawResponse(response, path.join(caseDir, `http-${record.id}.bin`));
        })().catch(error => { record.body_error = String(error); report.errors.push({ case: item.id, kind: 'response-body', request_id: record.id, message: String(error) }); });
        bodies.add(work); void work.finally(() => bodies.delete(work));
      });
      async function capture(label, inspect = true) {
        await page.evaluate(() => document.fonts.ready);
        const filename = path.join(caseDir, `${String(++shot).padStart(2, '0')}-${label}.png`);
        await page.screenshot({ path: filename }); await fs.writeFile(filename.replace('.png', '.txt'), await page.locator('body').innerText());
        report.screenshots.push(filename);
        if (inspect) try { await assertLayout(page, `${phase} ${item.id} ${label}`); }
        catch (error) { report.layout_failures.push({ screenshot: filename, message: String(error) }); }
        await save();
      }
      async function get(endpoint, label) {
        const response = await page.request.get(base + endpoint, { timeout: 180000 });
        try {
          const count = (readCounts.get(label) || 0) + 1; readCounts.set(label, count);
          const filename = path.join(caseDir, label + (count === 1 ? '' : '-' + count) + '-raw.json');
          const raw = await saveRawResponse(response, filename); report.http.push({ case: item.id, method: 'GET', endpoint, status: response.status(), ...raw });
          assert.equal(response.status(), 200, await response.text()); return { value: await response.json(), file: filename };
        } finally { await response.dispose(); }
      }
      async function select(label, value) {
        const field = page.getByRole('combobox', { name: label, exact: true }); await field.click();
        await page.getByRole('option', { name: value, exact: true }).click(); await expect(field).toHaveText(value);
      }
      async function enter(operation) {
        await page.goto(base + '/resources/cables/structure-import');
        await page.getByRole('tab', { name: '数据交换', exact: true }).click();
        await select('交换内容', '材料、环境与工程'); await select('交换操作', operation);
      }
      async function download(projectId, projectName, name) {
        await enter('导出本机数据'); await select('导出内容类别', '工程输入');
        await page.getByRole('textbox', { name: '按名称查找交换内容', exact: true }).fill(projectName);
        const row = page.locator(`[id="row-可导出的工程输入-${projectId}"]`); await expect(row).toContainText(projectName); await row.getByRole('checkbox').check();
        await expect(page.getByRole('table', { name: '已选择的交换内容', exact: true }).getByRole('row')).toHaveCount(2);
        await select('交换文件格式', item.format === 'json' ? 'JSON 交换文件' : 'Excel 交换文件');
        await capture(name + '只勾选明确工程');
        const [exported, response] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }),
          page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/export' && value.request().method() === 'POST', { timeout: 180000 }),
          Promise.resolve().then(() => page.getByRole('button', { name: '导出已选资料与工程', exact: true }).click())]);
        assert.equal(response.status(), 200, await response.text());
        assert.deepEqual(response.request().postDataJSON(), { asset_ids: [], workspace_ids: [projectId], format: item.format });
        const filename = path.join(caseDir, name + '.' + item.format); await exported.saveAs(filename); assert.equal(await exported.failure(), null);
        const saved = await fileEvidence(filename); assert.equal(saved.sha256, response.headers()['x-content-sha256']);
        assert.equal(saved.sha256, digest(await response.body())); assert.equal(await response.finished(), null);
        const bundle = bundleEvidence(filename, manifestFile, phase === 'source' ? path.join(caseDir, 'source-project-raw.json') : undefined);
        assert.equal(bundle.bundle_sha256, response.headers()['x-bundle-sha256']);
        await write(path.join(caseDir, name + '-download.json'), { request_id: identity(response.request()).id, request: response.request().postDataJSON(), download: saved, bundle });
        await expect(page.getByRole('status').filter({ hasText: '已下载 cablesim-data.' })).toBeVisible();
        await page.getByRole('status').filter({ hasText: '已下载 cablesim-data.' }).scrollIntoViewIfNeeded(); await capture(name + '浏览器下载完成');
        return { download: saved, bundle };
      }
      async function publishedSummary(projectName, expected, label) {
        const section = page.getByRole('region', { name: `${projectName}的已发布型号来源`, exact: true });
        await expect(section).toContainText('固定发行版本 ' + expected.version);
        await expect(section).toContainText(`完整证明 ${expected.proof_bytes.toLocaleString('zh-CN')} 字节`);
        await expect(section).toContainText(`准确依赖 ${expected.dependency_count} 个`);
        await expect(section).toContainText(`来源运行记录 ${expected.source_run_count} 条`);
        await expect(section).toContainText('本次交换不创建本机运行记录；来源运行仅按外部声明保存'); await expect(section).toContainText('目标型号绑定为草稿');
        const details = section.locator('details');
        if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
        await expect(details).toHaveJSProperty('open', true);
        await section.scrollIntoViewIfNeeded();
        for (const text of [`发行内容 SHA-256：${expected.asset_sha256}`, `冻结规格书 SHA-256：${expected.specification_sha256}`]) {
          const digest = details.getByText(text, { exact: true });
          await expect(digest).toBeVisible(); await expect(digest).toBeInViewport({ ratio: 1 });
        }
        await capture(label);
      }
      async function readTarget(target) {
        const project = await get(`/api/workspaces/${target.project_id}`, 'target-project');
        assert.equal(project.value.revision, 1); assert.deepEqual(project.value.runs, []);
        assert.deepEqual((await get(`/api/workspaces/${target.project_id}/studies`, 'target-studies')).value, []);
        assert.deepEqual((await get('/api/types/library', 'target-published-types')).value.items, []);
        const paths = [];
        for (const [index, asset] of target.assets.entries()) paths.push((await get(`/api/foundation/assets/${asset.id}`, `target-dependency-${index + 1}`)).file);
        const verified = compareSaved(item.download.file, project.file, paths);
        const counts = pythonJSON([
          'import json,sys', 'from contextlib import closing', 'from backend.kernel.database_ops import readonly',
          'with closing(readonly(sys.argv[1])) as db:',
          ' counts={name:db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in ("workspaces","engineering_assets","studies","study_runs","type_submissions","engineering_type_releases")}',
          'assert counts["workspaces"]==1 and counts["engineering_assets"]==int(sys.argv[2])',
          'assert all(counts[k]==0 for k in ("studies","study_runs","type_submissions","engineering_type_releases")); print(json.dumps(counts))',
        ].join('\n'), [process.env.CABLESIM_DB, String(item.bundle.dependency_count)]);
        await write(path.join(caseDir, `exact-readback-${readCounts.get('target-project')}.json`), { ...verified, read_only_database_counts: counts });
        return project;
      }
      try {
        if (phase === 'source') {
          const source = await get(`/api/workspaces/${manifest.project_id}`, 'source-project');
          assert.equal(source.value.revision, manifest.project_revision);
          assert.equal(source.value.study_cable_reference.content_sha256, manifest.asset_sha256);
          const old = await get(`/api/foundation/assets/${manifest.old_publication.asset_id}`, 'source-pinned-release');
          const latest = await get(`/api/foundation/assets/${manifest.new_publication.asset_id}`, 'source-later-release');
          assert.equal(old.value.content_sha256, manifest.asset_sha256); assert.notEqual(latest.value.content_sha256, old.value.content_sha256);
          const downloaded = await download(manifest.project_id, source.value.domain.name, 'source-ui');
          const after = await get(`/api/workspaces/${manifest.project_id}`, 'source-after');
          assert.deepEqual(after.value, source.value, 'UI导出不能改写真实来源工程或固定版本');
          report.downloads.push({ ...item, ...downloaded, project_name: source.value.domain.name });
        } else {
          const actual = await fileEvidence(item.download.file); assert.deepEqual(actual, item.download, '只能消费对应源浏览器真实下载的完整字节');
          if (phase === 'import') {
            assert.deepEqual((await get('/api/workspaces', 'empty-projects')).value, []);
            assert.equal((await get('/api/foundation/assets?limit=100', 'empty-assets')).value.total, 0);
            assert.deepEqual((await get('/api/types/library', 'empty-published-types')).value.items, []);
            await enter('导入交换文件'); await capture('全新目标选择文件');
            const previewAction = await observer.begin('/api/library/exchange/preview', 'published-preview');
            const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/preview' && value.request().method() === 'POST', { timeout: 180000 }),
              Promise.resolve().then(() => page.getByLabel('资料与工程交换文件', { exact: true }).setInputFiles(item.download.file))]);
            assert.equal(response.status(), 200, await response.text());
            const preview = await response.json(), observation = await observer.finish(previewAction, response);
            const upload = await multipartEvidence(response, item.download.file, observation); assert.deepEqual(upload.form, {});
            assert.equal(preview.sha256, item.bundle.bundle_sha256); assert.equal(preview.approval_inherited, false);
            assert.equal(preview.projects.length, 1); assert.equal(preview.assets.length, item.bundle.dependency_count);
            assert.ok(preview.assets.every(asset => asset.action === 'create_draft'));
            const published = preview.projects[0].published_model;
            for (const key of ['version', 'family', 'asset_sha256', 'specification_sha256', 'proof_bytes', 'dependency_count', 'source_run_count']) assert.equal(published[key], item.bundle[key]);
            assert.equal(published.run_evidence, 'external_declared_run'); assert.equal(published.approval_inherited, false);
            await write(path.join(caseDir, 'preview-upload.json'), { ...upload, response: preview, raw_response: await saveRawResponse(response, path.join(caseDir, 'preview-raw.json')) });
            await publishedSummary(item.project_name, item.bundle, '预览固定旧版与外部来源双摘要');
            assert.deepEqual((await get('/api/workspaces', 'preview-still-empty')).value, []);
            assert.equal((await get('/api/foundation/assets?limit=100', 'preview-assets-empty')).value.total, 0);
            const confirm = page.getByRole('button', { name: '确认导入资料与工程', exact: true }); await expect(confirm).toBeDisabled();
            await page.getByRole('checkbox', { name: '确认资料与工程交换范围', exact: true }).check(); await capture('人工确认来源但不继承审批');
            const importAction = await observer.begin('/api/library/exchange/import', 'published-import');
            const [imported] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/import' && value.request().method() === 'POST', { timeout: 180000 }), Promise.resolve().then(() => confirm.click())]);
            assert.equal(imported.status(), 201, await imported.text());
            const receipt = await imported.json(), importedUpload = await multipartEvidence(imported, item.download.file, await observer.finish(importAction, imported));
            assert.equal(importedUpload.request_headers['x-cablesim-actor'], 'human');
            assert.deepEqual(Object.keys(importedUpload.form).sort(), ['confirmed', 'request_id', 'reviewed_sha256']);
            assert.equal(importedUpload.form.confirmed, 'true'); assert.equal(importedUpload.form.reviewed_sha256, preview.sha256);
            assert.equal(receipt.request_id, importedUpload.form.request_id); assert.equal(receipt.sha256, preview.sha256); assert.equal(receipt.approval_inherited, false);
            assert.equal(receipt.projects.length, 1); assert.equal(receipt.assets.length, item.bundle.dependency_count);
            assert.equal(receipt.projects[0].origin_id, item.bundle.project_id); assert.equal(receipt.projects[0].revision, 1);
            assert.ok(receipt.assets.every(asset => asset.action === 'create_draft')); assert.notEqual(receipt.projects[0].id, manifest.project_id);
            assert.deepEqual(receipt.assets.map(asset => asset.origin_id).sort(), item.bundle.dependencies.map(asset => asset.origin_id).sort());
            await write(path.join(caseDir, 'import-upload.json'), { ...importedUpload, response: receipt, raw_response: await saveRawResponse(imported, path.join(caseDir, 'import-raw.json')) });
            await expect(page.getByRole('heading', { name: '资料与工程已导入', exact: true })).toBeVisible();
            await publishedSummary(item.project_name, item.bundle, '新机已保存外部来源且保持草稿');
            report.target = { project_id: receipt.projects[0].id, assets: receipt.assets };
            const target = await readTarget(report.target);
            const index = await get('/api/index/objects?kind=project&limit=100', 'target-project-index');
            assert.ok(index.value.items.some(project => project.id === target.value.id && project.kind === 'project'));
            await expect(page.getByRole('link', { name: `打开工程：${item.project_name}`, exact: true })).toHaveAttribute('href', `/studies?workspace=${target.value.id}`);
            const checkpoint = path.join(directory, 'target.sqlite');
            const snapshot = pythonJSON([
              'import json,sys', 'from contextlib import closing', 'from backend.kernel.database_ops import snapshot,readonly',
              'receipt=snapshot(sys.argv[1],sys.argv[2])',
              'with closing(readonly(sys.argv[2])) as db:',
              ' counts={name:db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in ("studies","study_runs","type_submissions","engineering_type_releases")}',
              'assert all(n==0 for n in counts.values()); print(json.dumps({"snapshot":receipt,"local_history_counts":counts}))',
            ].join('\n'), [process.env.CABLESIM_DB, checkpoint]);
            report.checkpoint = { ...await fileEvidence(checkpoint), ...snapshot };
            assert.equal(report.checkpoint.sha256, snapshot.snapshot.sha256);
          } else {
            report.target = task.target; const target = await readTarget(task.target);
            const exported = await download(task.target.project_id, target.value.domain.name, 'restarted-target-ui');
            report.reexport = { ...compareDownloads(item.download.file, exported.download.file), download: exported.download, bundle: exported.bundle };
            await readTarget(task.target); await capture('重启目标再次导出完整来源与锁');
          }
        }
      } catch (error) {
        report.failures.push({ case: item.id, message: String(error), stack: error.stack });
        await capture('失败现场', false).catch(cause => report.failures.push({ case: item.id, phase: '失败截图', message: String(cause) }));
      } finally {
        try { await observer.assertComplete(); }
        catch (error) { report.failures.push({ case: item.id, phase: '完整上传观测', message: String(error) }); }
        try { await write(path.join(caseDir, 'upload-observations.json'), await observer.snapshot()); }
        catch (error) { report.failures.push({ case: item.id, phase: '保存上传观测快照', message: String(error) }); }
        try { await expect.poll(() => pending.size).toBe(0); await Promise.all([...bodies]); }
        catch (error) { report.failures.push({ case: item.id, phase: '请求与响应正文收尾', message: String(error) }); }
        await context.close(); await save();
      }
    }
  } catch (error) { report.failures.push({ message: String(error), stack: error.stack }); }
  finally { if (browser) await browser.close(); await save(); }
  assert.deepEqual(report.errors, [], '新发布工程正向流程存在控制台、网络、取消或正文错误，全部原样保留');
  assert.deepEqual(report.failures, [], '新发布工程真实UI流程未通过');
  assert.deepEqual(report.layout_failures, [], '新发布工程截图布局未通过');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await orchestrate();
