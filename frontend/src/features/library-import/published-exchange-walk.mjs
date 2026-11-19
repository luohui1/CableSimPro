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
const errorCode = error => error?.code || error?.name || 'UNKNOWN';
function progressFailure(error) {
  // Protocol diagnostics only: never inspect browser objects, headers or bodies.
  const scalar = value => value === null || typeof value === 'boolean' || typeof value === 'number'
    ? value : typeof value === 'string' ? value.slice(0, 512) : undefined;
  return { error_code: errorCode(error), message: typeof error?.message === 'string' ? error.message.slice(0, 1024) : undefined,
    operator: scalar(error?.operator), actual: scalar(error?.actual), expected: scalar(error?.expected) };
}
async function progressResources() {
  const memory = process.memoryUsage();
  const result = { node: { rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed, external_bytes: memory.external } };
  if (process.platform !== 'linux') return result;
  const inspect = async operation => { try { return await operation(); } catch (error) { return { error_code: errorCode(error) }; } };
  const readText = filename => fs.readFile(filename, { encoding: 'utf8', signal: AbortSignal.timeout(1000) });
  result.host_memory = await inspect(async () => {
    const values = Object.fromEntries((await readText('/proc/meminfo')).split('\n').map(line => /^(MemAvailable|SwapFree):\s+(\d+) kB$/.exec(line)).filter(Boolean).map(match => [match[1] + '_bytes', Number(match[2]) * 1024]));
    return values;
  });
  result.cgroup = await inspect(async () => {
    const relative = (await readText('/proc/self/cgroup')).split('\n').find(line => line.startsWith('0::'))?.slice(3);
    if (!relative?.startsWith('/')) return { error_code: 'CGROUP_V2_UNAVAILABLE' };
    const directory = path.resolve('/sys/fs/cgroup', '.' + relative);
    if (directory !== '/sys/fs/cgroup' && !directory.startsWith('/sys/fs/cgroup/')) return { error_code: 'CGROUP_PATH_OUTSIDE_MOUNT' };
    return Object.fromEntries(await Promise.all(['memory.current', 'memory.max', 'memory.events'].map(async name => [name, await inspect(async () => {
      const text = (await readText(path.join(directory, name))).trim();
      return name === 'memory.events' ? Object.fromEntries(text.split('\n').map(line => { const [key, value] = line.split(' '); return [key, Number(value)]; })) : text;
    })])));
  });
  return result;
}
function progressJournal(directory, scope) {
  const started = performance.now(), filename = path.join(directory, 'progress.jsonl'), failures = [];
  let sequence = 0, lastOperation = null, queued = Promise.resolve(), beating = null, beats = 0, counters = () => ({});
  const checkpoint = (event, details = {}) => {
    if (event !== 'heartbeat') lastOperation = { event, case: details.case ?? null, method: details.method ?? null, label: details.label ?? null };
    const entry = { at: new Date().toISOString(), sequence: ++sequence, scope, pid: process.pid, ppid: process.ppid,
      elapsed_ms: Math.round(performance.now() - started), event, last_operation: lastOperation, ...details };
    const line = JSON.stringify(entry) + '\n';
    process.stdout.write('[published-progress] ' + line);
    queued = queued.then(() => fs.appendFile(filename, line)).catch(error => {
      failures.push(error); process.stderr.write('[published-progress-write-error] ' + JSON.stringify({ scope, error_code: errorCode(error) }) + '\n');
    });
  };
  const heartbeat = () => {
    if (beating) return;
    if (beats >= 180) { clearInterval(timer); return; }
    beats++;
    beating = progressResources().then(resources => checkpoint('heartbeat', { heartbeat: beats, ...counters(), resources }))
      .catch(error => { failures.push(error); checkpoint('heartbeat.failed', { error_code: errorCode(error) }); })
      .finally(() => { beating = null; });
  };
  // At most 180 small samples per process; observation cannot keep a phase alive.
  const timer = setInterval(heartbeat, 10000); timer.unref();
  checkpoint('journal.start'); heartbeat();
  return {
    checkpoint,
    counters(read) { counters = read; },
    async close() {
      clearInterval(timer); if (beating) await beating;
      checkpoint('journal.stop', { heartbeat_count: beats }); await queued;
      if (failures.length) throw new AggregateError(failures, '发布交换进度记录失败');
    },
  };
}
async function frontendInventory(directory) {
  const files = [];
  async function visit(relative) {
    for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else {
        assert.ok(entry.isFile(), `生产前端只接受构建产生的普通文件：${name}`);
        const bytes = await fs.readFile(path.join(directory, name));
        files.push({ path: name.split(path.sep).join('/'), bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await visit('');
  assert.ok(files.some(item => item.path === 'index.html'));
  return { files, file_count: files.length, bytes: files.reduce((sum, item) => sum + item.bytes, 0), inventory_sha256: digest(JSON.stringify(files)) };
}

// Observe this one original POST before Chromium's fetch().blob() can evict its
// Network.getResponseBody copy (microsoft/playwright#42862). No request is replayed
// or fulfilled. The paused original is continued without overrides, after the
// body command has completely settled; timing of this observation is recorded.
async function observeExportResponses(page, base, directory, caseId, identity, report, progress) {
  const endpoint = new URL('/api/library/exchange/export', base).href;
  progress.checkpoint('cdp.session.before', { case: caseId });
  const session = await page.context().newCDPSession(page), tasks = new Set(), actualRequests = new WeakMap();
  progress.checkpoint('cdp.session.after', { case: caseId });
  const ledger = { case: caseId, endpoint, stage: 'Response', interception_pattern_resource_type: 'Fetch', actions: [], unexpected: [], errors: [] };
  report.export_observations.push(ledger);
  let active = null, terminated = false, saving = Promise.resolve();
  const persist = () => (saving = saving.then(() => write(path.join(directory, 'export-observations.json'), ledger)));
  function failure(phase, error, detail = {}) {
    const entry = { at: new Date().toISOString(), phase, message: String(error), ...detail };
    ledger.errors.push(entry); report.errors.push({ case: caseId, kind: 'export-response-observation', ...entry });
  }
  async function bounded(label, operation, milliseconds = 120000) {
    const timer = setTimeout(() => {
      terminated = true; ledger.context_termination = { at: new Date().toISOString(), reason: `${label} 超过 ${milliseconds} ms` };
      failure(label, ledger.context_termination.reason);
      // Never continue/disable a request with getResponseBody still in flight.
      // Abort the entire failed context instead of treating timeout as recovery.
      void persist().catch(error => failure('保存超时证据', error));
      void page.context().close().then(() => { ledger.context_closed_at = new Date().toISOString(); })
        .catch(error => failure('关闭超时上下文', error));
    }, milliseconds);
    try { const value = await operation(); assert.equal(terminated, false, '导出观测超时，整个上下文已判失败'); return value; }
    finally { clearTimeout(timer); }
  }
  const command = async (method, params, timeout) => {
    progress.checkpoint('cdp.command.before', { case: caseId, method, action_id: active?.record.id ?? null });
    try {
      const result = await bounded(method, () => session.send(method, params), timeout);
      progress.checkpoint('cdp.command.after', { case: caseId, method, action_id: active?.record.id ?? null }); return result;
    } catch (error) {
      progress.checkpoint('cdp.command.failed', { case: caseId, method, error_code: errorCode(error) }); throw error;
    }
  };
  function recordRequest(request) {
    if (request.url() !== endpoint) return;
    const record = { request_id: identity(request).id, at: new Date().toISOString(), method: request.method(), url: request.url(),
      post_data: request.postData(), post_data_sha256: digest(request.postDataBuffer() ?? Buffer.alloc(0)) };
    if (!active) { ledger.unexpected.push({ channel: 'Playwright', ...record }); failure('未武装的导出请求', '没有对应人工操作', record); return; }
    active.requests.push(request); active.record.playwright_requests.push(record); actualRequests.set(request, active);
  }
  const networkRequests = new Map();
  function recordNetwork(event) {
    if (event.request.url !== endpoint) return;
    const record = { network_id: event.requestId, at: new Date().toISOString(), timestamp: event.timestamp, wall_time: event.wallTime,
      frame_id: event.frameId, type: event.type, method: event.request.method, url: event.request.url,
      post_data: event.request.postData, post_data_sha256: digest(event.request.postData ?? ''), redirect: event.redirectResponse ?? null };
    if (networkRequests.has(event.requestId)) failure('重复 CDP 请求身份', event.requestId, record);
    networkRequests.set(event.requestId, { record, action: active });
    if (active) active.record.network_requests.push(record);
    else { ledger.unexpected.push({ channel: 'Network', ...record }); failure('未武装的 CDP 导出请求', '没有对应人工操作', record); }
  }
  function paused(event) {
    const action = active;
    const record = { fetch_request_id: event.requestId, network_id: event.networkId ?? null, at: new Date().toISOString(),
      method: event.request.method, url: event.request.url, post_data: event.request.postData, resource_type: event.resourceType,
      status: event.responseStatusCode, headers: event.responseHeaders ?? [], error_reason: event.responseErrorReason ?? null,
      redirected_request_id: event.redirectedRequestId ?? null };
    progress.checkpoint('export.response.paused', { case: caseId, action_id: action?.record.id ?? null,
      fetch_request_id: record.fetch_request_id, network_id: record.network_id, status: record.status,
      method: record.method, url: record.url, resource_type: record.resource_type,
      error_reason: record.error_reason, redirected_request_id: record.redirected_request_id });
    if (action) action.record.pauses.push(record); else ledger.unexpected.push({ channel: 'Fetch', ...record });
    const work = (async () => {
      try {
        assert.ok(action, '没有人工操作对应此暂停响应');
        assert.equal(record.url, endpoint, '暂停响应必须来自本次导出端点');
        assert.equal(record.method, 'POST', '暂停响应必须对应原始 POST');
        // Chromium may label the same fetch() response XHR in Fetch.requestPaused
        // while Network.requestWillBeSent reports Fetch. Keep both actual labels;
        // finish still requires Network Fetch and the identical networkId/POST.
        assert.ok(record.resource_type === 'Fetch' || record.resource_type === 'XHR', '暂停响应必须具有 Fetch 或 XHR 脚本资源类型');
        assert.equal(record.error_reason, null, '暂停响应不得包含传输错误');
        assert.equal(record.redirected_request_id, null, '暂停响应不得来自重定向');
        assert.ok(record.network_id, '暂停响应必须保留 Network 请求身份');
        assert.ok(record.status >= 200 && record.status < 300, '导出响应必须成功且不能重定向');
        record.body_read_started_at = new Date().toISOString();
        let body;
        try { body = await command('Fetch.getResponseBody', { requestId: event.requestId }); }
        finally { record.body_read_settled_at = new Date().toISOString(); }
        record.base64_encoded = body.base64Encoded;
        const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
        const filename = path.join(directory, `export-fetch-${action.record.id}-${action.record.pauses.indexOf(record) + 1}.bin`);
        await fs.writeFile(filename, bytes, { flag: 'wx' }); record.raw_response = await fileEvidence(filename);
        progress.checkpoint('export.response.saved', { case: caseId, action_id: action.record.id, ...record.raw_response });
        assert.ok(bytes.length > 0, '原始导出响应正文不得为空');
        await persist();
      } catch (error) {
        progress.checkpoint('export.response.failed', { case: caseId, action_id: action?.record.id ?? null,
          fetch_request_id: event.requestId, ...progressFailure(error) });
        record.failure = String(error); failure('读取原始导出响应', error, { fetch_request_id: event.requestId });
      }
      finally {
        // Rejection also settles the body command. Only context termination skips
        // continuation; that remains a recorded failure, never a successful case.
        if (!terminated) {
          record.continue_sent_at = new Date().toISOString();
          try { await command('Fetch.continueRequest', { requestId: event.requestId }, 30000); record.continue_ack_at = new Date().toISOString(); }
          catch (error) { record.continue_failure = String(error); failure('原样继续导出响应', error, { fetch_request_id: event.requestId }); }
        } else record.continue_skipped = 'failed_context_terminated';
        await persist();
      }
    })().catch(error => failure('导出响应任务', error));
    tasks.add(work); if (action) action.tasks.push(work);
    void work.then(() => tasks.delete(work));
  }
  page.on('request', recordRequest); session.on('Network.requestWillBeSent', recordNetwork); session.on('Fetch.requestPaused', paused);
  await command('Network.enable', { maxPostDataSize: 65536 }, 30000);
  await command('Fetch.enable', { patterns: [{ urlPattern: endpoint, resourceType: 'Fetch', requestStage: 'Response' }] }, 30000);
  return {
    async begin(label, selection) {
      assert.ok(active === null, '开始导出前必须没有尚未完成的操作'); assert.equal(terminated, false);
      const record = { id: ledger.actions.length + 1, label, armed_at: new Date().toISOString(), selection,
        playwright_requests: [], network_requests: [], pauses: [], completed: false };
      active = { record, requests: [], tasks: [] }; ledger.actions.push(record); await persist(); return active;
    },
    click(action) { assert.ok(action === active, '点击必须对应当前同一个导出操作'); action.record.click_started_at = new Date().toISOString(); },
    async finish(action, response, download) {
      const record = action.record;
      try {
        await Promise.all(action.tasks);
        record.download = download; record.download_saved_at = new Date().toISOString();
        record.playwright_response = { at: new Date().toISOString(), status: response.status(), headers: await response.allHeaders() };
        record.playwright_body = await saveRawResponse(response, path.join(directory, `export-network-${record.id}.bin`));
        record.playwright_body.empty_copy = record.playwright_body.size === 0;
        const finished = await bounded('等待原始导出正文完成', () => response.finished(), 30000);
        record.playwright_finished = { at: new Date().toISOString(), error: finished ? String(finished) : null };
        assert.ok(finished === null, '原始导出响应必须完整结束且没有浏览器错误');
        assert.ok(action === active, '收尾必须对应当前同一个导出操作'); assert.ok(record.click_started_at);
        assert.equal(action.requests.length, 1); assert.equal(record.network_requests.length, 1); assert.equal(record.pauses.length, 1);
        assert.ok(action.requests[0] === response.request(), '必须是实际点击产生的同一个 Playwright Request 对象');
        assert.ok(actualRequests.get(response.request()) === action, 'Playwright Request 必须归属当前同一个导出操作');
        const request = record.playwright_requests[0], network = record.network_requests[0], pause = record.pauses[0];
        assert.ok(networkRequests.get(pause.network_id)?.action === action, 'CDP Network 请求必须归属当前同一个导出操作');
        assert.equal(pause.network_id, network.network_id);
        assert.equal(request.method, 'POST'); assert.equal(network.method, 'POST'); assert.equal(network.type, 'Fetch'); assert.equal(network.redirect, null);
        assert.equal(request.post_data, network.post_data); assert.equal(request.post_data, pause.post_data);
        assert.equal(request.post_data_sha256, network.post_data_sha256); assert.deepEqual(JSON.parse(request.post_data), record.selection);
        assert.equal(pause.failure, undefined); assert.ok(pause.continue_ack_at); assert.equal(pause.continue_failure, undefined);
        assert.equal(response.status(), 200); assert.equal(pause.status, 200);
        for (const name of ['x-content-sha256', 'x-bundle-sha256', 'content-length']) {
          const values = pause.headers.filter(header => header.name.toLowerCase() === name);
          assert.equal(values.length, 1, `同一原始响应必须具有唯一 ${name}`);
          assert.equal(values[0].value, record.playwright_response.headers[name]);
        }
        assert.equal(download.bytes, pause.raw_response.bytes); assert.equal(download.bytes, Number(record.playwright_response.headers['content-length']));
        assert.equal(download.sha256, pause.raw_response.sha256); assert.equal(download.sha256, record.playwright_response.headers['x-content-sha256']);
        // Keep the real Network copy, whether empty or complete. A nonempty copy
        // remains subject to the same byte/hash check; never replace it with Fetch.
        if (record.playwright_body.size) {
          assert.equal(record.playwright_body.size, download.bytes); assert.equal(record.playwright_body.sha256, download.sha256);
        }
        record.association = 'unique_armed_action_and_Request_object_with_identical_url_method_post_data_and_CDP_networkId';
        record.completed = true; record.completed_at = new Date().toISOString(); active = null;
        return { action_id: record.id, fetch_request_id: pause.fetch_request_id, network_id: pause.network_id,
          request_id: request.request_id, original_response: pause.raw_response, playwright_body: record.playwright_body };
      } finally { await persist(); }
    },
    async close() {
      await Promise.all([...tasks]);
      try {
        if (!terminated) {
          await command('Fetch.disable', {}, 10000); await command('Network.disable', {}, 10000);
          progress.checkpoint('cdp.detach.before', { case: caseId });
          try {
            await bounded('断开独立 CDP 会话', () => session.detach(), 10000);
            progress.checkpoint('cdp.detach.after', { case: caseId });
          } catch (error) {
            progress.checkpoint('cdp.detach.failed', { case: caseId, ...progressFailure(error) }); throw error;
          }
        }
      } finally {
        page.off('request', recordRequest); session.off('Network.requestWillBeSent', recordNetwork); session.off('Fetch.requestPaused', paused);
        await persist();
      }
      assert.ok(active === null, '导出观测必须全部完成'); assert.deepEqual(ledger.unexpected, []); assert.deepEqual(ledger.errors, []);
      assert.ok(ledger.actions.every(action => action.completed));
    },
  };
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

async function run(command, args, environment, logfile, progress, label) {
  const stream = createWriteStream(logfile, { flags: 'wx' });
  const started = new Date().toISOString();
  progress.checkpoint('child.spawn.before', { label, executable: path.basename(command) });
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  progress.checkpoint('child.spawn.after', { label, child_pid: child.pid });
  for (const output of [child.stdout, child.stderr]) output.on('data', bytes => { stream.write(bytes); process.stdout.write(bytes); });
  const [exit_code, signal] = await once(child, 'close');
  await new Promise(resolve => stream.end(resolve));
  const log = await fileEvidence(logfile);
  progress.checkpoint('child.closed', { label, child_pid: child.pid, exit_code, signal, log });
  return { command, args, pid: child.pid, started, completed: new Date().toISOString(), exit_code, signal, log };
}
async function orchestrate() {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out, { recursive: false }); // A rerun may not reuse earlier evidence.
  const progress = progressJournal(out, 'orchestrator');
  const report = { production_frontend: null, producer: null, manifest: null, phases: [], completed_cases: [], failures: [] };
  const save = () => write(path.join(out, 'report.json'), report);
  const buildDirectory = path.join(root, '.data/release/frontend'), servedDirectory = path.join(root, 'frontend/dist');
  let linked = false, buildInventory = null;
  try {
    assert.equal(process.env.E2E_DEV, '0', '独立发布交换只使用本轮真实 shipped production build');
    progress.checkpoint('production.inventory.before');
    const build = await fs.realpath(buildDirectory), inventory = await frontendInventory(build); buildInventory = inventory;
    const frontendFile = path.join(out, 'production-frontend.json');
    await write(frontendFile, { mode: 'production', source_commit: process.env.GITHUB_SHA ?? null,
      build_directory: build, served_directory: servedDirectory, ...inventory });
    report.production_frontend = { ...await fileEvidence(frontendFile), mode: 'production', inventory_sha256: inventory.inventory_sha256 };
    progress.checkpoint('production.inventory.after', { manifest: report.production_frontend, asset_count: inventory.file_count, asset_bytes: inventory.bytes });
    if (!(await fs.lstat(servedDirectory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }))) {
      await fs.symlink(path.relative(path.dirname(servedDirectory), build), servedDirectory, 'dir'); linked = true;
    }
    assert.equal(await fs.realpath(servedDirectory), build, 'runner 默认 dist 必须指向本轮 shipped build，不能消费残留构建');
    assert.deepEqual(await frontendInventory(servedDirectory), inventory); await save();
    report.producer = { status: 'running', started: new Date().toISOString() }; await save();
    report.producer = await run(python, ['-m', 'pytest', '-n', '0', 'tests/test_published_project_exchange.py', '--junitxml=' + path.join(out, 'producer.xml')],
      { CABLESIM_PUBLISHED_EXCHANGE_EVIDENCE: path.join(out, 'source') }, path.join(out, 'producer.log'), progress, 'producer');
    await save(); assert.equal(report.producer.exit_code, 0, '真实源数据生产与后端门禁必须成功，不能复用旧库');
    const manifestFile = path.join(out, 'source/manifest.json'), manifest = await read(manifestFile);
    assert.equal(manifest.schema, 'cablesim.published-exchange-browser-source/1'); assert.equal(manifest.source_host_closed, true);
    const source = await fileEvidence(manifest.database);
    assert.equal(source.sha256, manifest.snapshot.sha256); assert.equal(source.bytes, manifest.snapshot.size_bytes);
    report.manifest = { ...await fileEvidence(manifestFile), source_database: source };
    progress.checkpoint('source.manifest.verified', { manifest: report.manifest }); await save();
    async function phase(name, phaseName, database, task) {
      const directory = path.join(out, name); await fs.mkdir(directory, { recursive: true });
      const taskFile = path.join(directory, 'task.json'); if (task) await write(taskFile, task);
      const lifecycle = { name, phase: phaseName, started: new Date().toISOString(), closed: [], status: 'running' };
      report.phases.push(lifecycle); await save(); progress.checkpoint('phase.before', { name, phase: phaseName });
      try {
      const receipt = await run(process.execPath, [path.join(root, 'frontend/scripts/isolated-e2e.mjs'), 'library-exchange-walk.mjs'], {
        E2E_DATABASE_SOURCE: database, PUBLISHED_EXCHANGE_PHASE: phaseName, PUBLISHED_EXCHANGE_PHASE_OUT: directory,
        PUBLISHED_EXCHANGE_MANIFEST: manifestFile, PUBLISHED_EXCHANGE_FRONTEND_MANIFEST: frontendFile,
        ...(task ? { PUBLISHED_EXCHANGE_TASK: taskFile } : {}),
      }, path.join(directory, 'process.log'), progress, name);
      const result = await read(path.join(directory, 'report.json')).catch(() => null);
      Object.assign(lifecycle, receipt, { service: result?.service, status: 'checking' }); await save();
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
        lifecycle.status = 'passed'; await save(); progress.checkpoint('phase.after', { name, phase: phaseName });
        return { result, lifecycle };
      } catch (error) {
        lifecycle.status = 'failed'; lifecycle.failure = { message: String(error), stack: error.stack };
        progress.checkpoint('phase.failed', { name, phase: phaseName, error_code: errorCode(error) });
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
  } catch (error) { report.failures.push({ message: String(error), stack: error.stack }); progress.checkpoint('orchestrator.failed', { error_code: errorCode(error) }); throw error; }
  finally {
    try {
      if (report.production_frontend) {
        const actual = await frontendInventory(buildDirectory);
        report.production_frontend.after = { inventory_sha256: actual.inventory_sha256, file_count: actual.file_count, bytes: actual.bytes };
        assert.deepEqual(actual, buildInventory, '所有生产构建文件必须保持原字节');
      }
      if (linked) { assert.equal(await fs.realpath(servedDirectory), await fs.realpath(buildDirectory)); await fs.unlink(servedDirectory); report.production_frontend.temporary_link_removed = true; }
    } catch (error) { report.failures.push({ phase: '生产构建字节与临时链接收尾', message: String(error), stack: error.stack }); throw error; }
    finally { try { await save(); } finally { await progress.close(); } }
  }
}

export async function runPublishedExchangePhase() {
  assert.equal(process.env.E2E_ISOLATED, '1');
  const phase = process.env.PUBLISHED_EXCHANGE_PHASE, directory = process.env.PUBLISHED_EXCHANGE_PHASE_OUT;
  assert.ok(['source', 'import', 'restart'].includes(phase)); assert.ok(directory);
  const base = process.env.FRONTEND_URL, backend = process.env.BACKEND_URL;
  for (const url of [base, backend]) assert.equal(new URL(url).hostname, '127.0.0.1');
  const manifestFile = process.env.PUBLISHED_EXCHANGE_MANIFEST, manifest = await read(manifestFile);
  const task = phase === 'source' ? null : await read(process.env.PUBLISHED_EXCHANGE_TASK);
  const report = { phase, service: { backend_url: backend, frontend_url: base, database: process.env.CABLESIM_DB }, production_frontend: null,
    requests: [], http: [], console: [], errors: [], failures: [], layout_failures: [], screenshots: [], downloads: [], closed_before_start: [], export_observations: [], served_entries: [], served_assets: [] };
  const save = () => write(path.join(directory, 'report.json'), report);
  const progress = progressJournal(directory, phase);
  let browser;
  try {
    assert.equal(process.env.E2E_DEV, '0');
    progress.checkpoint('phase.inventory.before');
    const frontendFile = process.env.PUBLISHED_EXCHANGE_FRONTEND_MANIFEST, frontend = await read(frontendFile);
    assert.equal(frontend.mode, 'production'); assert.equal(await fs.realpath(frontend.served_directory), frontend.build_directory);
    const inventory = await frontendInventory(frontend.served_directory);
    assert.deepEqual(inventory.files, frontend.files); assert.equal(inventory.inventory_sha256, frontend.inventory_sha256);
    const productionFiles = new Map(frontend.files.map(file => [file.path, file]));
    report.production_frontend = { ...await fileEvidence(frontendFile), mode: frontend.mode, inventory_sha256: inventory.inventory_sha256 };
    progress.checkpoint('phase.inventory.after', { manifest: report.production_frontend, asset_count: inventory.file_count, asset_bytes: inventory.bytes });
    for (const service of task?.stopped_services ?? []) for (const url of [service.backend_url, service.frontend_url]) {
      assert.ok(![base, backend].some(current => new URL(current).port === new URL(url).port), '来源、原目标与重启目标必须使用不同端口');
      report.closed_before_start.push(await closed(url));
    }
    await save();
    const executablePath = process.env.BROWSER_EXECUTABLE || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome'].find(existsSync);
    progress.checkpoint('browser.launch.before', { executable: executablePath });
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    progress.checkpoint('browser.launch.after');
    for (const item of phase === 'source' ? cases : [task]) {
      const caseDir = path.join(directory, item.id); await fs.mkdir(caseDir);
      progress.checkpoint('context.create.before', { case: item.id, viewport: item.viewport });
      const context = await browser.newContext({ viewport: item.viewport, acceptDownloads: true, locale: 'zh-CN' });
      progress.checkpoint('context.create.after', { case: item.id });
      progress.checkpoint('page.create.before', { case: item.id });
      const page = await context.newPage();
      progress.checkpoint('page.create.after', { case: item.id });
      progress.checkpoint('upload.observer.before', { case: item.id });
      const observer = await observeExchangeUploads(page);
      progress.checkpoint('upload.observer.after', { case: item.id });
      const requests = new WeakMap(), pending = new Set(), bodies = new Set(), readCounts = new Map(); let sequence = 0, shot = 0;
      progress.counters(() => ({ case: item.id, request_count: sequence, pending_requests: pending.size, pending_bodies: bodies.size }));
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
        const url = new URL(response.url()), asset = url.origin === new URL(base).origin ? productionFiles.get(decodeURIComponent(url.pathname).slice(1)) : undefined;
        if (!url.pathname.startsWith('/api/') && !asset) return;
        const work = (async () => {
          const error = await response.finished(); record.body_finished = { at: new Date().toISOString(), error: error ? String(error) : null };
          if (error) throw error;
          record.raw_response = await saveRawResponse(response, path.join(caseDir, `${asset ? 'asset' : 'http'}-${record.id}.bin`));
          if (asset) {
            report.served_assets.push({ case: item.id, request_id: record.id, asset: asset.path, url: response.url(), ...record.raw_response });
            assert.equal(record.raw_response.size, asset.bytes, `实际生产资产长度必须与构建一致：${asset.path}`);
            assert.equal(record.raw_response.sha256, asset.sha256, `实际生产资产字节必须与构建一致：${asset.path}`);
          }
        })().catch(error => { record.body_error = String(error); report.errors.push({ case: item.id, kind: 'response-body', request_id: record.id, message: String(error) }); });
        bodies.add(work); void work.finally(() => bodies.delete(work));
      });
      const exports = await observeExportResponses(page, base, caseDir, item.id, identity, report, progress);
      async function capture(label, inspect = true) {
        progress.checkpoint('screenshot.before', { case: item.id, label });
        await page.evaluate(() => document.fonts.ready);
        const filename = path.join(caseDir, `${String(++shot).padStart(2, '0')}-${label}.png`);
        await page.screenshot({ path: filename }); await fs.writeFile(filename.replace('.png', '.txt'), await page.locator('body').innerText());
        report.screenshots.push(filename);
        if (inspect) try { await assertLayout(page, `${phase} ${item.id} ${label}`); }
        catch (error) { report.layout_failures.push({ screenshot: filename, message: String(error) }); }
        await save();
        progress.checkpoint('screenshot.after', { case: item.id, label, file: filename });
      }
      async function get(endpoint, label) {
        progress.checkpoint('readback.before', { case: item.id, endpoint, label });
        const response = await page.request.get(base + endpoint, { timeout: 180000 });
        try {
          const count = (readCounts.get(label) || 0) + 1; readCounts.set(label, count);
          const filename = path.join(caseDir, label + (count === 1 ? '' : '-' + count) + '-raw.json');
          const raw = await saveRawResponse(response, filename); report.http.push({ case: item.id, method: 'GET', endpoint, status: response.status(), ...raw });
          progress.checkpoint('readback.after', { case: item.id, endpoint, label, status: response.status(), ...raw });
          assert.equal(response.status(), 200, await response.text()); return { value: await response.json(), file: filename };
        } finally { await response.dispose(); }
      }
      async function select(label, value) {
        progress.checkpoint('select.before', { case: item.id, label });
        const field = page.getByRole('combobox', { name: label, exact: true }); await field.click();
        await page.getByRole('option', { name: value, exact: true }).click(); await expect(field).toHaveText(value);
        progress.checkpoint('select.after', { case: item.id, label });
      }
      async function enter(operation) {
        progress.checkpoint('navigation.before', { case: item.id, operation });
        const response = await page.goto(base + '/resources/cables/structure-import');
        progress.checkpoint('navigation.after', { case: item.id, status: response?.status() ?? null });
        assert.ok(response); assert.equal(response.status(), 200);
        const served = await saveRawResponse(response, path.join(caseDir, 'served-production-index.html'));
        report.served_entries.push({ case: item.id, url: response.url(), request_id: identity(response.request()).id, ...served });
        const expected = frontend.files.find(file => file.path === 'index.html');
        assert.equal(served.sha256, expected.sha256); assert.equal(served.size, expected.bytes);
        assert.ok(!report.requests.some(request => ['/@vite/client', '/@react-refresh'].includes(new URL(request.url).pathname)), '生产预览不能载入开发运行时');
        progress.checkpoint('exchange.tab.before', { case: item.id });
        await page.getByRole('tab', { name: '数据交换', exact: true }).click();
        progress.checkpoint('exchange.tab.after', { case: item.id });
        await select('交换内容', '材料、环境与工程'); await select('交换操作', operation);
      }
      async function download(projectId, projectName, name) {
        await enter('导出本机数据'); await select('导出内容类别', '工程输入');
        progress.checkpoint('project.selection.before', { case: item.id, project_id: projectId });
        await page.getByRole('textbox', { name: '按名称查找交换内容', exact: true }).fill(projectName);
        const row = page.locator(`[id="row-可导出的工程输入-${projectId}"]`); await expect(row).toContainText(projectName); await row.getByRole('checkbox').check();
        await expect(page.getByRole('table', { name: '已选择的交换内容', exact: true }).getByRole('row')).toHaveCount(2);
        progress.checkpoint('project.selection.after', { case: item.id, project_id: projectId });
        await select('交换文件格式', item.format === 'json' ? 'JSON 交换文件' : 'Excel 交换文件');
        await capture(name + '只勾选明确工程');
        const selection = { asset_ids: [], workspace_ids: [projectId], format: item.format };
        const exportAction = await exports.begin(name, selection);
        progress.checkpoint('export.click.before', { case: item.id, action_id: exportAction.record.id });
        const [exported, response] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }),
          page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/export' && value.request().method() === 'POST', { timeout: 180000 }),
          Promise.resolve().then(() => { exports.click(exportAction); return page.getByRole('button', { name: '导出已选资料与工程', exact: true }).click(); })]);
        progress.checkpoint('export.download.received', { case: item.id, action_id: exportAction.record.id, status: response.status() });
        assert.equal(response.status(), 200, await response.text());
        assert.deepEqual(response.request().postDataJSON(), selection);
        const filename = path.join(caseDir, name + '.' + item.format); await exported.saveAs(filename); assert.equal(await exported.failure(), null);
        const saved = await fileEvidence(filename); assert.equal(saved.sha256, response.headers()['x-content-sha256']);
        progress.checkpoint('export.download.saved', { case: item.id, action_id: exportAction.record.id, ...saved });
        const observation = await exports.finish(exportAction, response, saved);
        const bundle = bundleEvidence(filename, manifestFile, phase === 'source' ? path.join(caseDir, 'source-project-raw.json') : undefined);
        assert.equal(bundle.bundle_sha256, response.headers()['x-bundle-sha256']);
        await write(path.join(caseDir, name + '-download.json'), { request_id: identity(response.request()).id, request: response.request().postDataJSON(), download: saved, bundle, observation });
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
            progress.checkpoint('import.preview.before', { case: item.id });
            const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/preview' && value.request().method() === 'POST', { timeout: 180000 }),
              Promise.resolve().then(() => page.getByLabel('资料与工程交换文件', { exact: true }).setInputFiles(item.download.file))]);
            progress.checkpoint('import.preview.after', { case: item.id, status: response.status() });
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
            progress.checkpoint('import.confirm.before', { case: item.id });
            const [imported] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/exchange/import' && value.request().method() === 'POST', { timeout: 180000 }), Promise.resolve().then(() => confirm.click())]);
            progress.checkpoint('import.confirm.after', { case: item.id, status: imported.status() });
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
            progress.checkpoint('target.snapshot.before', { case: item.id });
            const snapshot = pythonJSON([
              'import json,sys', 'from contextlib import closing', 'from backend.kernel.database_ops import snapshot,readonly',
              'receipt=snapshot(sys.argv[1],sys.argv[2])',
              'with closing(readonly(sys.argv[2])) as db:',
              ' counts={name:db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in ("studies","study_runs","type_submissions","engineering_type_releases")}',
              'assert all(n==0 for n in counts.values()); print(json.dumps({"snapshot":receipt,"local_history_counts":counts}))',
            ].join('\n'), [process.env.CABLESIM_DB, checkpoint]);
            report.checkpoint = { ...await fileEvidence(checkpoint), ...snapshot };
            assert.equal(report.checkpoint.sha256, snapshot.snapshot.sha256);
            progress.checkpoint('target.snapshot.after', { case: item.id, file: report.checkpoint.file, bytes: report.checkpoint.bytes, sha256: report.checkpoint.sha256 });
          } else {
            report.target = task.target; const target = await readTarget(task.target);
            const exported = await download(task.target.project_id, target.value.domain.name, 'restarted-target-ui');
            report.reexport = { ...compareDownloads(item.download.file, exported.download.file), download: exported.download, bundle: exported.bundle };
            await readTarget(task.target); await capture('重启目标再次导出完整来源与锁');
          }
        }
      } catch (error) {
        report.failures.push({ case: item.id, message: String(error), stack: error.stack });
        progress.checkpoint('case.failed', { case: item.id, error_code: errorCode(error) });
        await capture('失败现场', false).catch(cause => report.failures.push({ case: item.id, phase: '失败截图', message: String(cause) }));
      } finally {
        progress.checkpoint('case.cleanup.before', { case: item.id });
        try { await observer.assertComplete(); }
        catch (error) { report.failures.push({ case: item.id, phase: '完整上传观测', message: String(error) }); }
        try { await write(path.join(caseDir, 'upload-observations.json'), await observer.snapshot()); }
        catch (error) { report.failures.push({ case: item.id, phase: '保存上传观测快照', message: String(error) }); }
        try {
          await expect.poll(() => pending.size).toBe(0); await Promise.all([...bodies]);
          const loaded = report.served_assets.filter(asset => asset.case === item.id);
          assert.ok(loaded.some(asset => asset.asset.endsWith('.js')), '必须实际加载并核对生产 JS 字节');
          assert.ok(loaded.some(asset => asset.asset.endsWith('.css')), '必须实际加载并核对生产 CSS 字节');
        }
        catch (error) { report.failures.push({ case: item.id, phase: '请求与响应正文收尾', message: String(error) }); }
        try { await exports.close(); }
        catch (error) { report.failures.push({ case: item.id, phase: '原始导出响应观测收尾', message: String(error), stack: error.stack }); }
        progress.checkpoint('context.close.before', { case: item.id });
        await context.close(); await save();
        progress.checkpoint('context.close.after', { case: item.id }); progress.counters(() => ({}));
      }
    }
  } catch (error) { report.failures.push({ message: String(error), stack: error.stack }); progress.checkpoint('phase.failed', { error_code: errorCode(error) }); }
  finally {
    try {
      if (browser) { progress.checkpoint('browser.close.before'); await browser.close(); progress.checkpoint('browser.close.after'); }
      await save();
    } finally { await progress.close(); }
  }
  assert.deepEqual(report.errors, [], '新发布工程正向流程存在控制台、网络、取消或正文错误，全部原样保留');
  assert.deepEqual(report.failures, [], '新发布工程真实UI流程未通过');
  assert.deepEqual(report.layout_failures, [], '新发布工程截图布局未通过');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await orchestrate();
