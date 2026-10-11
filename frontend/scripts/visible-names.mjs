import assert from "node:assert/strict";
import { displayNames } from "../src/lib/display-names.ts";
// Engineering notation and document references are deliberately narrow exceptions.
const allowed =
  /^(?:GB\/T|GBZ\/T|K(?:·m)?\/W|W\/m|W\/K|m\/s|A\/m|V\/m|Ω\/m|Ω\/km|S\/m|J\/kg|kg\/m|F\/m|H\/m|μF\/km|mH\/km|[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+(?:\.\d+)?\/\d+(?:\.\d+)?)$/;
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
    .replace(/\b(?:MS\/m|Rc\/Rs|YJV\/YJV22|U0\/U|F\/km)\b/g, "工程记号");
  return [
    ...new Set(
      stripped.match(
        /未翻译名称（[^）]+）|\b[a-zA-Z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\b|\b(?:cablesim|system|x-cablesim)\.[a-zA-Z0-9._-]+\b|\b[a-zA-Z][a-zA-Z0-9.-]*\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\b|\b(?:ampacity|rating|operating|succeeded|failed|queued|unavailable|steady-rating|transient-temperature|crosscheck|thermal-field|Synthetic)\b/g,
      ) || [],
    ),
  ].filter((value) => !allowed.test(value));
}
export async function inspectVisibleNames(page, { includeFrames = true } = {}) {
  const violations = [];
  for (const frame of includeFrames ? page.frames() : [page.mainFrame()]) {
    const texts = await frame
      .evaluate(() => {
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
          if (text) result.push(text);
        }
        return result;
      })
      .catch(() => []);
    for (const text of texts)
      for (const token of internalTokens(text))
        violations.push({
          frame: frame === page.mainFrame() ? "页面" : "文档",
          token,
          text: text.slice(0, 200),
        });
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
