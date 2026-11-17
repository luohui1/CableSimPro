/** Main-content readiness, shared by the real-data audits. Sidebar text is not content. */
export function readinessSnapshot() {
  const styles = new WeakMap(), bounds = new WeakMap();
  const css = e => { if (!styles.has(e)) styles.set(e, getComputedStyle(e)); return styles.get(e); };
  const box = e => { if (!bounds.has(e)) bounds.set(e, e.getBoundingClientRect()); return bounds.get(e); };
  const visible = e => {
    // A loader fading in is still loading. Opacity zero during the entry animation
    // must not turn an unfinished view into a ready page.
    if (!e.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = box(e);
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = css(p), b = box(p);
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (/(hidden|clip|auto|scroll)/.test(s.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return right - left > 1 && bottom - top > 1;
  };
  const regions = [...document.querySelectorAll('.main-content,.provider-state')].filter(visible);
  const content = regions.some(e => e.innerText.trim().length > 0 || [...e.querySelectorAll('canvas,svg,input,textarea,table')].some(visible));
  const busy = [...document.querySelectorAll('[aria-busy="true"],[data-type-state="loading"],.route-skeleton,.skeleton-lines,.skeleton-bar,.route-progress[data-active="true"]')]
    .filter(visible).map(e => ({ canvas: !!e.closest('.cad-viewport,.field-view,.type-canvas-frame'), selector: e.className?.baseVal ?? e.className, text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 160) }));
  // Some older readers expose a status message without aria-busy. Do not wait for polling/networkidle.
  for (const e of document.querySelectorAll('[role="status"],.muted')) if (visible(e) && /^(正在读取|正在加载|正在打开)/.test(e.innerText.trim())) {
    busy.push({ canvas: !!e.closest('.cad-viewport,.field-view,.type-canvas-frame'), selector: e.className, text: e.innerText.trim().slice(0, 160) });
  }
  const illustrations = [...document.querySelectorAll('.plugin-figure img')].filter(visible)
    .map(e => ({ label: e.alt, complete: e.complete, ready: e.complete && e.naturalWidth > 0 }));
  for (const illustration of illustrations) if (!illustration.complete)
    busy.push({ canvas: false, selector: '.plugin-figure img', text: '正在读取方法示意图：' + illustration.label });
  const canvases = [...document.querySelectorAll('.cad-viewport,canvas.field-canvas')]
    .filter(visible).map(e => {
    const cad = e.matches('.cad-viewport'), canvas = cad ? e.querySelector('canvas') : e;
    const error = cad && e.dataset.cadState === 'error';
    const empty = cad && (e.dataset.cadState === 'empty' || !!e.querySelector('.cad-state-overlay .state-empty'));
    const rect = e.getBoundingClientRect();
    return { kind: cad ? '三维' : '场图', ready: visible(e) && (cad ? e.dataset.cadReady === 'true' && !!canvas && visible(canvas) : !!e.dataset.auditFirstDraw),
      error, empty, visible: true, width: Math.round(rect.width), height: Math.round(rect.height), localFirstDisplayMs: cad ? Number(e.dataset.cadFirstDisplayMs) || null : null,
      rendering: { selector:e.className, width:Math.round(rect.width), height:Math.round(rect.height),
        attributes:Object.fromEntries([...e.attributes].filter(a => /^(data-cad-|aria-busy)/.test(a.name)).map(a => [a.name,a.value])) } };
  });
  // A newly visible lazy field may not have mounted its canvas yet. Wait for its
  // real draw after scrolling; an existing off-screen canvas is never counted.
  for (const field of document.querySelectorAll('.field-view')) if (visible(field) && !field.querySelector('canvas.field-canvas'))
    canvases.push({ kind:'场图', ready:false, visible:true, pendingMount:true, error:false });
  // Deferred CAD needs a real frame only while its requested viewport is visible.
  const three = document.querySelector('.type-canvas-frame');
  if (!canvases.length && /\/structure\/three\/?$/.test(location.pathname) && three && visible(three) && !three.querySelector('.state-inline,.state-view[role="alert"]'))
    canvases.push({ kind: '三维', ready: false, pendingMount: true, error: false });
  const errors = [...document.querySelectorAll('.state-view[role="alert"],.provider-state [role="alert"]')].filter(visible).map(e => e.innerText.trim());
  errors.push(...illustrations.filter(e => e.complete && !e.ready).map(e => '方法示意图读取失败：' + e.label));
  return { content, busy, canvases, illustrations, errors, mainReady: content && !busy.some(b => !b.canvas),
    ready: content && !busy.length && canvases.every(c => c.ready || c.error || c.empty) };
}

/** Observe existing rendering; no artificial data, delays or solver execution. */
export async function installReadinessObserver(page) {
  await page.addInitScript(({ snapshot }) => {
    const inspect = (0, eval)('(' + snapshot + ')');
    window.__loadAudit = { url: location.href, mainMs: null, frameMs: null, sampledAtMs: null, longTasks: [], workers: [], latest: null };
    const audit = window.__loadAudit;
    try { new PerformanceObserver(list => { for (const t of list.getEntries()) audit.longTasks.push({ startMs: t.startTime, durationMs: t.duration, name: t.name }); }).observe({ type: 'longtask', buffered: true }); } catch { /* Not supported by every engine. */ }
    // FieldView draws saved meshes with WebGL. An allocated blank canvas is not a frame.
    for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (Type) for (const name of ['drawElements', 'drawArrays']) {
      const original = Type.prototype[name];
      Type.prototype[name] = function (...args) {
        const result = original.apply(this, args);
        const count = name === 'drawArrays' ? args[2] : args[1];
        if (this.canvas?.matches?.('canvas.field-canvas') && count > 0 && !this.canvas.dataset.auditFirstDraw)
          requestAnimationFrame(() => { this.canvas.dataset.auditFirstDraw = String(performance.now()); });
        return result;
      };
    }
    let mainCandidate = false, frameCandidate = false, queued = false, currentUrl = location.href;
    function sample() {
      if (document.body) {
        // A client redirect can briefly paint the preceding workspace. Its
        // ready timestamp cannot describe the target saved run or page.
        if (currentUrl !== location.href) {
          currentUrl = location.href; audit.url = currentUrl; audit.mainMs = null; audit.frameMs = null;
          mainCandidate = false; frameCandidate = false;
        }
        const state = inspect(); audit.latest = state; audit.sampledAtMs = performance.now();
        if (!state.mainReady) audit.mainMs = null;
        if (state.mainReady && mainCandidate && audit.mainMs === null) audit.mainMs = performance.now();
        mainCandidate = state.mainReady;
        if (state.canvases.length && state.canvases.every(c => c.ready) && frameCandidate && audit.frameMs === null) audit.frameMs = performance.now();
        frameCandidate = !!state.canvases.length && state.canvases.every(c => c.ready);
      }
      if ((mainCandidate && audit.mainMs === null) || (frameCandidate && audit.frameMs === null)) requestAnimationFrame(sample);
      else queued = false;
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(sample); } };
    // Readiness depends on status text as well as element insertion. React may
    // update an existing Text node without changing its parent's children.
    new MutationObserver(schedule).observe(document, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['aria-busy', 'data-active', 'data-type-state', 'data-cad-ready', 'data-cad-state', 'data-audit-first-draw', 'class', 'hidden'] });
    addEventListener('DOMContentLoaded', schedule);
    // Image completion changes a DOM property, not an observed attribute.
    addEventListener('load', schedule, { capture: true });
    addEventListener('error', schedule, { capture: true });
    addEventListener('scroll', schedule, { capture:true, passive:true });
    addEventListener('resize', schedule, { passive:true }); schedule();
  }, { snapshot: readinessSnapshot.toString() });
}

export async function waitForPageReady(page, { includeCanvas = true, timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForFunction(({ snapshot, includeCanvas }) => {
      // The observer already samples after DOM mutations/scroll/resize. Polling a
      // second full visibility/layout walk added artificial tasks to every page.
      const state = window.__loadAudit?.latest ?? (0, eval)('(' + snapshot + ')')();
      return includeCanvas ? state.ready : state.mainReady;
    }, { snapshot: readinessSnapshot.toString(), includeCanvas }, { timeout, polling: 50 });
    // Let the committed content paint. No fixed sleep and no networkidle (polling pages stay active).
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await page.evaluate(readinessSnapshot);
    if (!(includeCanvas ? state.ready : state.mainReady)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error('内容在绘制前再次进入读取状态');
      return waitForPageReady(page, { includeCanvas, timeout: remaining });
    }
    return state;
  } catch (error) {
    const state = await page.evaluate(({ snapshot }) => {
      const audit = window.__loadAudit;
      return { actualUrl: location.href, now: performance.now(),
        fresh: (0, eval)('(' + snapshot + ')')(),
        observed: audit ? { url: audit.url, sampledAtMs: audit.sampledAtMs, mainMs: audit.mainMs,
          frameMs: audit.frameMs, latest: audit.latest } : null };
    }, { snapshot: readinessSnapshot.toString() }).catch(() => null);
    throw Error('页面未就绪：' + JSON.stringify(state) + '\n' + error.message);
  }
}
