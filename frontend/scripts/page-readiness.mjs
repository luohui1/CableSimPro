/** Main-content readiness, shared by the real-data audits. Sidebar text is not content. */
export function readinessSnapshot() {
  const visible = e => {
    // A loader fading in is still loading. Opacity zero during the entry animation
    // must not turn an unfinished view into a ready page.
    if (!e.checkVisibility({ checkVisibilityCSS: true })) return false;
    const r = e.getBoundingClientRect();
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(s.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (/(hidden|clip|auto|scroll)/.test(s.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return right - left > 1 && bottom - top > 1;
  };
  const regions = [...document.querySelectorAll('.main-content,.provider-state')].filter(visible);
  const content = regions.some(e => e.innerText.trim().length > 0 || [...e.querySelectorAll('canvas,svg,input,textarea,table')].some(visible));
  const busy = [...document.querySelectorAll('[aria-busy="true"],.route-skeleton,.skeleton-lines,.skeleton-bar,.route-progress[data-active="true"]')]
    .filter(visible).map(e => ({ canvas: !!e.closest('.cad-viewport,.field-view,.type-canvas-frame'), selector: e.className?.baseVal ?? e.className, text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 160) }));
  // Some older readers expose a status message without aria-busy. Do not wait for polling/networkidle.
  for (const e of document.querySelectorAll('[role="status"],.muted')) if (visible(e) && /^(正在读取|正在加载|正在打开)/.test(e.innerText.trim())) {
    busy.push({ canvas: !!e.closest('.cad-viewport,.field-view,.type-canvas-frame'), selector: e.className, text: e.innerText.trim().slice(0, 160) });
  }
  const canvases = [...document.querySelectorAll('.cad-viewport,canvas.field-canvas')]
    .filter(e => e.checkVisibility({ checkVisibilityCSS: true }) && (visible(e) || regions.some(r => r.contains(e)))).map(e => {
    const cad = e.matches('.cad-viewport'), canvas = cad ? e.querySelector('canvas') : e;
    const error = cad && e.dataset.cadState === 'error';
    const empty = cad && (e.dataset.cadState === 'empty' || !!e.querySelector('.cad-state-overlay .state-empty'));
    const rect = e.getBoundingClientRect();
    return { kind: cad ? '三维' : '场图', ready: visible(e) && (cad ? e.dataset.cadReady === 'true' && !!canvas && visible(canvas) : !!e.dataset.auditFirstDraw),
      error, empty, visible: visible(e), width: Math.round(rect.width), height: Math.round(rect.height), localFirstDisplayMs: cad ? Number(e.dataset.cadFirstDisplayMs) || null : null };
  });
  // Deferred CAD has not mounted its viewport yet. The requested 3D view needs a
  // real frame even when its loading placeholder has zero height.
  const three = document.querySelector('.type-canvas-frame');
  if (!canvases.length && /\/structure\/three\/?$/.test(location.pathname) && three && !three.querySelector('.state-inline,.state-view[role="alert"]'))
    canvases.push({ kind: '三维', ready: false, pendingMount: true, error: false });
  const errors = [...document.querySelectorAll('.state-view[role="alert"],.provider-state [role="alert"]')].filter(visible).map(e => e.innerText.trim());
  return { content, busy, canvases, errors, mainReady: content && !busy.some(b => !b.canvas),
    ready: content && !busy.length && canvases.every(c => c.ready || c.error || c.empty) };
}

/** Observe existing rendering; no artificial data, delays or solver execution. */
export async function installReadinessObserver(page) {
  await page.addInitScript(({ snapshot }) => {
    const inspect = (0, eval)('(' + snapshot + ')');
    window.__loadAudit = { mainMs: null, frameMs: null, longTasks: [], workers: [], latest: null };
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
    let mainCandidate = false, frameCandidate = false, queued = false;
    function sample() {
      if (document.body) {
        const state = inspect(); audit.latest = state;
        if (state.mainReady && mainCandidate && audit.mainMs === null) audit.mainMs = performance.now();
        mainCandidate = state.mainReady;
        if (state.canvases.length && state.canvases.every(c => c.ready) && frameCandidate && audit.frameMs === null) audit.frameMs = performance.now();
        frameCandidate = !!state.canvases.length && state.canvases.every(c => c.ready);
      }
      if ((mainCandidate && audit.mainMs === null) || (frameCandidate && audit.frameMs === null)) requestAnimationFrame(sample);
      else queued = false;
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(sample); } };
    new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-busy', 'data-active', 'data-cad-ready', 'data-cad-state', 'data-audit-first-draw', 'class', 'hidden'] });
    addEventListener('DOMContentLoaded', schedule); schedule();
  }, { snapshot: readinessSnapshot.toString() });
}

export async function waitForPageReady(page, { includeCanvas = true, timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForFunction(({ snapshot, includeCanvas }) => {
      const state = (0, eval)('(' + snapshot + ')')();
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
    const state = await page.evaluate(readinessSnapshot).catch(() => null);
    throw Error('页面未就绪：' + JSON.stringify(state) + '\n' + error.message);
  }
}
