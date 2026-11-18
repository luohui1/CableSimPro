import assert from "node:assert/strict";
import { displayNames } from "../src/lib/display-names.ts";
// Engineering notation and document references are deliberately narrow exceptions.
const allowed =
  /^(?:GB\/T|GBZ\/T|K(?:·m)?\/W|W\/m|W\/km|W\/K|m\/s|A\/m|A\/km|V\/m|Ω\/m|Ω\/km|S\/m|J\/kg|kg\/m|F\/m|H\/m|μF\/km|mH\/km|CU\/XLPE\/LC\/PVC-3\.6\/6|[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+(?:\.\d+)?\/\d+(?:\.\d+)?)$/;
export function internalTokens(text) {
  if (
    displayNames[text.trim()] &&
    !["x", "z", "u", "v", "ks", "kp"].includes(text.trim())
  )
    return [text.trim()];
  const stripped = text
    .replace(/https?:\/\/[^\s<>]+/g, "")
    .replace(/\b[A-Za-z0-9_.-]+\.pdf\b/gi, "原件文件名")
    .replace(/\bkg\/(?:100m|km)\b/g, "质量单位")
    .replace(/\bGB\s*\/\s*T(?=\d|\b)/g, "国标")
    .replace(/K[·*]m\/W/g, "热阻率单位")
    .replace(/A[·∙]√s\/mm²/g, "短路电流系数单位")
    .replace(/\b(?:MS\/m|Rc\/Rs|YJV\/YJV22|U0\/U|F\/km)\b/g, "工程记号");
  return [
    ...new Set(
      stripped.match(
        /未翻译名称（[^）]+）|\b[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\b|\b(?:cablesim|system|x-cablesim)\.[a-zA-Z0-9._-]+\b|\b[a-zA-Z][a-zA-Z0-9.-]*\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\b|\b(?:ampacity|rating|operating|succeeded|failed|queued|unavailable|steady-rating|transient-temperature|crosscheck|thermal-field|Synthetic)\b/g,
      ) || [],
    ),
  ].filter((value) => !allowed.test(value));
}

/** Preserve cited annex/example labels without exempting unrelated paths. */
export function engineeringReferenceException(text, token) {
  if (typeof text !== 'string' || !text.includes(token)) return null;
  const citation = token === 'A/B'
    ? { id: 'standard-annex', pattern: /附录\s+A\/B(?![A-Za-z0-9_./\\-])/g }
    : token === 'Case2/10'
      ? { id: 'tb880-examples', pattern: /\bTB\s*880\s+Case2\/10(?![A-Za-z0-9_./\\-])/g }
      : null;
  if (!citation) return null;
  // A second, uncited occurrence in the same node must still be reported.
  const remaining = text.replace(citation.pattern, match => match.replace(token, ''));
  return remaining.includes(token) ? null : citation.id;
}

/** Only the catalogue's manufacturer series group label is an engineering name. */
export const cableSeriesLabelSelector = '[data-page="cable-versions"] table[aria-label="电缆型号版本"] tr.group-row > th[scope="rowgroup"] > button > strong';
export function cableSeriesException({ page, text, token, cableSeriesLabel } = {}) {
  return /^\/resources\/cables(?:[?#]|$)/.test(page || '')
    && cableSeriesLabel === true && text === token && token === 'CU/XLPE/LC/PVC'
    ? 'cable-series-label' : null;
}

/** Exact, explicitly opened resource provenance; surrounding prose remains audited. */
export const resourceSourceReferenceSelector = 'aside.property-panel[aria-label="所选对象属性"] .resource-source-reference[open] > pre[data-source-reference="raw"][tabindex="0"]';
export function resourceSourceReferenceException({ page, text, resourceSourceReference, sourceReferenceSummary } = {}) {
  if (!/^\/resources\/(?:materials|templates|standards)(?:[?#]|$)/.test(page || '')
    || resourceSourceReference !== true || sourceReferenceSummary !== '查看结构化出处原文'
    || typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' ? 'resource-source-reference' : null;
  } catch { return null; }
}

export async function inspectVisibleNames(page, { includeFrames = true } = {}) {
  const violations = [];
  for (const frame of includeFrames ? page.frames() : [page.mainFrame()]) {
    const texts = await frame
      .evaluate(({ cableSeriesSelector, resourceSourceSelector }) => {
        const result = [],
          walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          );
        while (walker.nextNode()) {
          const node = walker.currentNode,
            parent = node.parentElement;
          if (!parent || parent.closest('script,style,[aria-hidden="true"]'))
            continue;
          if (
            !parent.checkVisibility({
              checkVisibilityCSS: true,
              checkOpacity: true,
            }) ||
            (parent.closest("details:not([open])") &&
              !parent.closest("summary"))
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (
            ![...range.getClientRects()].some(
              (rect) => rect.width && rect.height,
            )
          )
            continue;
          const style = getComputedStyle(parent);
          if (style.visibility === "hidden" || style.display === "none")
            continue;
          const text = node.textContent.trim();
          if (text) result.push({ text, page: location.pathname, cableSeriesLabel: parent.matches(cableSeriesSelector),
            resourceSourceReference: parent.matches(resourceSourceSelector),
            sourceReferenceSummary: parent.matches(resourceSourceSelector) ? parent.parentElement.querySelector(':scope > summary')?.textContent.trim() : undefined });
        }
        return result;
      }, { cableSeriesSelector: cableSeriesLabelSelector, resourceSourceSelector: resourceSourceReferenceSelector })
      .catch(() => []);
    for (const entry of texts) {
      // String entries preserve callers that provide text-only audit fixtures.
      const context = typeof entry === 'string' ? { text: entry } : entry;
      const { text } = context;
      for (const token of internalTokens(text))
        if (!engineeringReferenceException(text, token) && !cableSeriesException({ ...context, token }) && !resourceSourceReferenceException(context)) violations.push({
          frame: frame === page.mainFrame() ? "页面" : "文档",
          token,
          text: text.slice(0, 200),
        });
    }
  }
  return violations;
}
export async function assertVisibleNames(page, label, options) {
  const violations = await inspectVisibleNames(page, options);
  assert.deepEqual(
    violations,
    [],
    label + "：内部名称露出 " + JSON.stringify(violations),
  );
}
