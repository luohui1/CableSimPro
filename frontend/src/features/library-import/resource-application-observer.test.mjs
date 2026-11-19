import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import test from 'node:test';
import { observeStudyOpening } from './resource-application-walk.mjs';

// Protocol fixtures exercise the exported production observer and actual file
// writes. They do not start a browser, issue HTTP, or prove application results.
const base = 'http://127.0.0.1:8100';
const events = ['request', 'requestfinished', 'requestfailed', 'response', 'framenavigated', 'console', 'pageerror'];
const bytes = Buffer.from('{"protocol_fixture":"原始正文","value":0}\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { await turn(); await turn(); }

class Page extends EventEmitter {
  constructor() {
    super();
    this.handle = { dispose: async () => { this.disposed += 1; } };
    this.disposed = 0; this.snapshotCalls = 0; this.identityCalls = 0;
    this.snapshot = () => ({ url: this.url(), ready_state: 'complete', time_origin: 1234, queries: { status: 'not_inspected' } });
    this.identity = () => true;
    this.frame = { url: () => this.url() };
    this.request = new Proxy({}, { get() { throw new Error('The observer must not issue or repeat HTTP'); } });
  }
  url() { return base + '/studies/fixture/ampacity/results?workspace=fixture'; }
  mainFrame() { return this.frame; }
  async evaluateHandle() { return this.handle; }
  async evaluate(_fn, input) {
    if (input === this.handle) { this.identityCalls += 1; return this.identity(); }
    this.snapshotCalls += 1; return this.snapshot();
  }
}

function request(url = base + '/api/workspaces/fixture/context') {
  const timing = { startTime: 1234, responseStart: -1, responseEnd: -1 };
  return {
    url: () => url, method: () => 'GET', headers: () => ({}), postDataBuffer: () => null,
    resourceType: () => 'fetch', isNavigationRequest: () => false,
    timing: () => timing,
    failure: () => ({ errorText: 'net::ERR_ABORTED' }),
  };
}
function response(req) {
  const finished = deferred(), body = deferred();
  let bodyCalls = 0;
  return {
    finished, body, get bodyCalls() { return bodyCalls; },
    value: {
      request: () => req, headers: () => ({ 'content-type': 'application/json', 'content-length': String(bytes.length) }),
      status: () => 200, statusText: () => 'OK', finished: () => finished.promise,
      body: () => { bodyCalls += 1; return body.promise; },
    },
  };
}

async function fixture(t) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'cablesim-study-observer-'));
  const page = new Page(), written = [];
  const observer = await observeStudyOpening({ page, base, viewport: { width: 1366, height: 768 }, out,
    workspaceId: 'fixture', studyId: 'fixture',
    write: async (name, ledger) => {
      const raw = JSON.stringify(ledger, null, 2); written.push({ name, raw });
      await fs.writeFile(path.join(out, name + '.json'), raw);
    } });
  let finishing, settled = false, clock;
  const state = {
    page, observer, out, written,
    get settled() { return settled; },
    finish(error) {
      finishing = observer.finish({ error, automaticRunRequests: [] });
      void finishing.then(() => { settled = true; }, () => { settled = true; });
      return finishing;
    },
    clock() {
      let now = Math.ceil(performance.now());
      t.mock.method(performance, 'now', () => now);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      clock = { advance(ms) { now += ms; t.mock.timers.tick(ms); } };
      return clock;
    },
  };
  t.after(async () => {
    clock?.advance(3000);
    if (finishing) await finishing.catch(() => {});
    page.removeAllListeners();
    await fs.rm(out, { recursive: true, force: true });
  });
  return state;
}
function assertClosed(f, ledger, status = 'complete') {
  assert.equal(ledger.observer_drain.status, status);
  assert.equal(ledger.final_observation_budget_ms, 2000);
  assert.equal(f.page.disposed, 1);
  for (const event of events) assert.equal(f.page.listenerCount(event), 0, event + ' listener removed');
  assert.equal(f.written.at(-1).raw, JSON.stringify(ledger, null, 2));
}
async function assertSaved(f, item, expected = bytes) {
  assert.equal(item.response.finished.result, 'null');
  assert.equal(item.response.body.status, 'saved');
  assert.equal(item.response.body.bytes, expected.length);
  assert.equal(item.response.body.sha256, digest(expected));
  assert.deepEqual(await fs.readFile(path.join(f.out, item.response.body.file)), expected);
}
async function assertLateEventsCannotMutate(f, ledger, finishLate) {
  const before = JSON.stringify(ledger);
  await finishLate();
  const late = request(base + '/api/late');
  f.page.emit('request', late); f.page.emit('requestfailed', late);
  f.page.emit('response', response(late).value);
  f.page.emit('console', { type: () => 'error', text: () => 'late console', location: () => ({}) });
  f.page.emit('pageerror', new Error('late page error'));
  f.page.emit('framenavigated', f.page.frame);
  f.observer.mark('late_mark'); await f.observer.checkpoint('late_checkpoint');
  await flush();
  assert.equal(JSON.stringify(ledger), before, 'No late event/promise may rewrite the closed ledger');
  assert.equal(f.written.at(-1).raw, JSON.stringify(ledger, null, 2));
}

test('request without headers stays open for late headers, request finish and complete body bytes', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req);
  f.page.emit('request', req);
  const done = f.finish(); await flush(); assert.equal(f.settled, false);
  f.page.emit('response', res.value); await flush(); assert.equal(f.settled, false);
  f.page.emit('requestfinished', req); res.finished.resolve(null);
  await flush(); assert.equal(f.settled, false, 'Response.finished is not full body evidence');
  res.body.resolve(bytes);
  const ledger = await done;
  assertClosed(f, ledger); assert.deepEqual(ledger.pending_at_cutoff, []);
  assert.equal(ledger.pending_observation_tasks_at_cutoff, 0);
  assert.equal(ledger.requests.length, 1); assert.ok(ledger.requests[0].request_finished);
  await assertSaved(f, ledger.requests[0]);
});

test('request started in a terminal-event turn and its dynamic body task cannot be missed', { timeout: 10000 }, async t => {
  const f = await fixture(t), first = request(), second = request(base + '/api/second');
  const a = response(first), b = response(second);
  f.page.emit('request', first); f.page.emit('response', a.value);
  const done = f.finish(); await flush();
  f.page.once('requestfinished', () => { f.page.emit('request', second); f.page.emit('response', b.value); });
  f.page.emit('requestfinished', first); a.finished.resolve(null); a.body.resolve(bytes);
  await flush(); assert.equal(f.settled, false);
  b.finished.resolve(null); b.body.resolve(bytes);
  await flush(); assert.equal(f.settled, false, 'A completed body does not replace the Request terminal event');
  f.page.emit('requestfinished', second);
  const ledger = await done;
  assertClosed(f, ledger); assert.equal(ledger.requests.length, 2);
  assert.deepEqual(ledger.pending_at_cutoff, []);
  for (const item of ledger.requests) await assertSaved(f, item);
});

test('the final document-identity read may create a request that must also drain', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req);
  f.page.identity = () => { f.page.emit('request', req); f.page.emit('response', res.value); return true; };
  const done = f.finish(); await flush(); assert.equal(f.settled, false);
  f.page.emit('requestfinished', req); res.finished.resolve(null); res.body.resolve(bytes);
  const ledger = await done;
  assertClosed(f, ledger); assert.deepEqual(ledger.document_identity, { status: 'complete', value: true });
  await assertSaved(f, ledger.requests[0]);
});

test('a response first observed after registration remains tracked until the request terminates', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req);
  f.page.emit('response', res.value); res.finished.resolve(null); res.body.resolve(bytes);
  const done = f.finish(); await flush(); assert.equal(f.settled, false);
  f.page.emit('requestfinished', req);
  const ledger = await done;
  assertClosed(f, ledger); assert.equal(ledger.requests[0].first_observed_event, 'response');
  assert.equal(ledger.requests[0].request_started, null); await assertSaved(f, ledger.requests[0]);
});

test('a request that never receives headers remains pending until the original 2000 ms deadline', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), clock = f.clock();
  f.page.emit('request', req);
  const done = f.finish(); await flush();
  clock.advance(1999); await flush(); assert.equal(f.settled, false);
  clock.advance(1);
  const ledger = await done;
  assertClosed(f, ledger, 'timeout'); assert.equal(ledger.final_observation_elapsed_ms, 2000);
  assert.deepEqual(ledger.pending_at_cutoff, [1]); assert.equal(ledger.pending_observation_tasks_at_cutoff, 0);
  assert.equal(ledger.requests[0].response, null); assert.equal(ledger.requests[0].request_failed, null);
  await assertLateEventsCannotMutate(f, ledger, async () => {
    // Playwright Request.timing() exposes the same mutable timing object.
    req.timing().responseStart = 1999; req.timing().responseEnd = 2500;
    const res = response(req); f.page.emit('response', res.value); f.page.emit('requestfinished', req);
    res.finished.resolve(null); res.body.resolve(bytes);
  });
  assert.equal((await fs.readdir(f.out)).filter(name => name.includes('-response-')).length, 0);
});

test('late headers and body share the budget already spent by checkpoint and identity reads', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req), clock = f.clock();
  const checkpoint = deferred(), identity = deferred();
  f.page.snapshot = () => checkpoint.promise; f.page.identity = () => identity.promise;
  f.page.emit('request', req);
  const done = f.finish(); await flush();
  clock.advance(1000); checkpoint.resolve({ ready_state: 'complete' }); await flush();
  assert.equal(f.page.identityCalls, 1);
  clock.advance(500); identity.resolve(true); await flush();
  f.page.emit('response', res.value);
  clock.advance(250); f.page.emit('requestfinished', req); res.finished.resolve(null); await flush();
  clock.advance(249); await flush(); assert.equal(f.settled, false);
  clock.advance(1);
  const ledger = await done;
  assertClosed(f, ledger, 'timeout'); assert.equal(ledger.final_observation_elapsed_ms, 2000);
  assert.deepEqual(ledger.pending_at_cutoff, [1]); assert.equal(ledger.pending_observation_tasks_at_cutoff, 1);
  assert.equal(ledger.requests[0].response.finished.result, 'null');
  assert.equal(ledger.requests[0].response.body, null);
  await assertLateEventsCannotMutate(f, ledger, async () => res.body.resolve(bytes));
  assert.equal((await fs.readdir(f.out)).filter(name => name.includes('-response-')).length, 0);
});

test('failed request is observed to its terminal event and ERR_ABORTED is preserved', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request();
  f.page.emit('request', req);
  const done = f.finish(); await flush(); assert.equal(f.settled, false);
  f.page.emit('requestfailed', req);
  const ledger = await done;
  assertClosed(f, ledger); assert.deepEqual(ledger.pending_at_cutoff, []);
  assert.equal(ledger.requests[0].request_failed.failure.errorText, 'net::ERR_ABORTED');
  assert.equal(ledger.requests[0].request_finished, null);
  assert.equal(ledger.outcome, 'passed', 'Outcome still describes the original operation, not invented observer success');
});

test('request failure after headers still waits for Response.finished and retains its error', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req);
  f.page.emit('request', req); f.page.emit('response', res.value);
  const operationError = new Error('original operation failed');
  const done = f.finish(operationError); await flush();
  f.page.emit('requestfailed', req); await flush(); assert.equal(f.settled, false);
  res.finished.resolve(new Error('connection reset'));
  const ledger = await done;
  assertClosed(f, ledger); assert.equal(ledger.outcome, 'failed'); assert.equal(ledger.failure, String(operationError));
  assert.equal(ledger.requests[0].request_failed.failure.errorText, 'net::ERR_ABORTED');
  assert.equal(ledger.requests[0].response.finished.result, 'error');
  assert.match(ledger.requests[0].response.finished.error, /connection reset/);
  assert.equal(res.bodyCalls, 0); assert.deepEqual(ledger.pending_at_cutoff, []);
});

for (const stage of ['finished', 'body']) {
  test(`a rejected response.${stage} remains evidence and does not leave a lost drain wakeup`, { timeout: 10000 }, async t => {
    const f = await fixture(t), req = request(), res = response(req);
    f.page.emit('request', req); f.page.emit('response', res.value);
    const done = f.finish(); await flush();
    f.page.emit('requestfinished', req);
    if (stage === 'body') { res.finished.resolve(null); await flush(); }
    res[stage].reject(new Error('protocol rejection'));
    const ledger = await done;
    assertClosed(f, ledger); assert.equal(ledger.pending_observation_tasks_at_cutoff, 0);
    assert.deepEqual(ledger.pending_at_cutoff, []);
    const failure = stage === 'finished' ? ledger.requests[0].response.finished : ledger.requests[0].response.body_error;
    assert.equal(failure.result, 'rejected'); assert.match(failure.error, /protocol rejection/);
  });
}

for (const stage of ['checkpoint', 'identity']) {
  test(`the final ${stage} read shares the same deadline and cannot mutate a closed ledger`, { timeout: 10000 }, async t => {
    const f = await fixture(t), gate = deferred(), clock = f.clock();
    if (stage === 'checkpoint') f.page.snapshot = () => gate.promise;
    else f.page.identity = () => gate.promise;
    const done = f.finish(); await flush();
    clock.advance(1999); await flush(); assert.equal(f.settled, false);
    clock.advance(1);
    const ledger = await done;
    assertClosed(f, ledger, 'timeout'); assert.equal(ledger.final_observation_elapsed_ms, 2000);
    assert.equal(ledger.document_identity.status, 'timeout');
    if (stage === 'checkpoint') {
      assert.equal(ledger.boundaries.at(-1).browser.status, 'timeout');
      assert.equal(f.page.identityCalls, 0, 'Do not start another browser read after cutoff');
    }
    await assertLateEventsCannotMutate(f, ledger, async () => gate.resolve(stage === 'identity' ? true : { late: true }));
  });
}

test('a pending write retains its exact cutoff state when the original I/O completes later', { timeout: 10000 }, async t => {
  const f = await fixture(t), req = request(), res = response(req), gate = deferred(), started = deferred(), written = deferred();
  const originalWrite = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (filename, ...args) => {
    const bodyFile = String(filename).includes('-study-open-response-');
    if (bodyFile) { started.resolve(); await gate.promise; }
    const result = await originalWrite(filename, ...args);
    if (bodyFile) written.resolve();
    return result;
  });
  const clock = f.clock();
  f.page.emit('request', req); f.page.emit('response', res.value);
  f.page.emit('requestfinished', req); res.finished.resolve(null); res.body.resolve(bytes);
  const done = f.finish(); await started.promise; await flush();
  clock.advance(2000);
  const ledger = await done;
  assertClosed(f, ledger, 'timeout'); assert.deepEqual(ledger.pending_at_cutoff, [1]);
  assert.equal(ledger.requests[0].response.body.status, 'writing');
  assert.equal(ledger.requests[0].response.body.sha256, digest(bytes));
  await assertLateEventsCannotMutate(f, ledger, async () => { gate.resolve(); await written.promise; });
  assert.equal(ledger.requests[0].response.body.status, 'writing', 'A late file completion does not rewrite cutoff evidence');
});

test('an idle observer closes without sleeping and retains unrelated page listeners', { timeout: 10000 }, async t => {
  const f = await fixture(t), foreign = () => {};
  f.page.on('request', foreign);
  f.page.emit('request', request('https://example.invalid/api/outside'));
  f.page.emit('request', request(base + '/assets/fixture.js'));
  const ledger = await f.finish();
  assert.equal(ledger.observer_drain.status, 'complete');
  assert.deepEqual(ledger.requests, []); assert.deepEqual(ledger.pending_at_cutoff, []);
  assert.equal(ledger.pending_observation_tasks_at_cutoff, 0);
  assert.equal(f.page.listenerCount('request'), 1); assert.ok(f.page.listeners('request')[0] === foreign);
  f.page.off('request', foreign); assertClosed(f, ledger);
  assert.equal(ledger.scope, 'All same-origin page API requests during this operation; direct API readbacks remain in the applications HTTP index.');
});
