import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect as expectBase } from "@playwright/test";
import { openHeadlessBrowser, settle, outputRoot } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";
import { inspectVisibleNames, assertVisibleNames } from "./visible-names.mjs";
import { assertLayout } from "./layout-assertions.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("仅在独立测试数据库验收");
const base = process.env.FRONTEND_URL,
  expect = expectBase.configure({ timeout: 20000 }),
  output = path.join(outputRoot, "names");
await fs.mkdir(output, { recursive: true });
const session = await openHeadlessBrowser(),
  { page } = session,
  report = { pages: [], states: [], checks: [], screenshots: [], errors: [] };
page.on("pageerror", (error) => report.errors.push(error.message));
async function get(p) {
  return request(base, p);
}
async function go(route) {
  await page.goto("about:blank");
  await page.goto(base + route, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await settle(page);
  await expect(
    page.locator(
      '.provider-state [aria-busy="true"],.main-content .state-view[aria-busy="true"]',
    ),
  ).toHaveCount(0);
}
async function scan(route) {
  await go(route);
  const violations = await inspectVisibleNames(page);
  report.pages.push({ route, violations });
  console.log(route + ": " + violations.length);
  await save();
}
async function save() {
  await fs.writeFile(
    path.join(
      output,
      process.env.NAMES_FLOWS_ONLY === "1" ? "flows.json" : "verification.json",
    ),
    JSON.stringify(report, null, 2),
  );
}
async function variants(label) {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.waitForTimeout(60);
      await assertLayout(page, label);
      report.states.push({ label, theme, ...size });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}
async function shot(name) {
  await page.screenshot({ path: path.join(output, name + ".png") });
  report.screenshots.push(name);
}
try {
  const ws = await get("/api/workspaces"),
    studies = [];
  for (const w of ws)
    for (const s of await get("/api/workspaces/" + w.id + "/studies"))
      studies.push({ ...s, wid: w.id });
  const inquiry = studies.find((s) => s.definition.driver.kind === "selection"),
    sweep = studies.find((s) => s.definition.driver.kind === "sweep"),
    compare = studies.find((s) => s.definition.driver.kind === "crosscheck"),
    temperature = studies.find((s) => s.definition.title.includes("温度场"));
  assert.ok(
    inquiry && sweep && compare && temperature,
    "五个工程研究须真实存在",
  );
  assert.equal(studies.length, 5);
  const types = await get("/api/design/type-workspaces");
  assert.equal(types.length, 2);
  assert.ok(types.some((t) => t.name === "YJV22-8.7/15 3×300"));
  assert.ok(types.some((t) => t.name === "YJLW03-64/110 1×800"));
  const route = (s, module, tab) =>
    `/studies/${s.id}/${module}/${tab}?workspace=${s.wid}`;
  const routes = [
    "/",
    "/studies",
    "/types",
    "/library",
    "/plugins",
    "/settings",
    "/library/reproductions",
    "/plugins/cablesim.iec60287",
  ];
  for (const tab of ["results", "overlay", "convergence", "sources", "scope"])
    routes.push("/library/reproductions/E02/" + tab);
  const studyTabs = {
    cable: ["section", "layers", "references"],
    section: ["section", "three-dimensional", "coordinates", "media"],
    conditions: ["inputs"],
    ampacity: ["results", "parameters"],
    selection: ["results", "settings"],
    "thermal-field": [
      "field",
      "samples",
      "parameters",
      "diagnostics",
      "convergence",
    ],
    sweep: ["curve", "points", "settings"],
    batch: ["space", "results", "execution"],
    "method-compare": ["inputs", "results", "evidence"],
    simulation: ["inputs", "results", "evidence"],
    report: ["content", "sources", "preview"],
    hybrid: ["results", "validation", "sources"],
    transient: [
      "results",
      "history",
      "field",
      "samples",
      "diagnostics",
      "convergence",
      "parameters",
    ],
    "sheath-losses": ["results", "losses", "parameters"],
    electrothermal: [
      "results",
      "field",
      "samples",
      "parameters",
      "diagnostics",
      "convergence",
    ],
  };
  for (const [module, tabs] of Object.entries(studyTabs))
    for (const tab of tabs)
      routes.push(
        route(
          module === "sweep"
            ? sweep
            : module === "method-compare"
              ? compare
              : ["thermal-field", "electrothermal"].includes(module)
                ? temperature
                : inquiry,
          module,
          tab,
        ),
      );
  const type = types.find((t) => t.name.startsWith("YJV22"));
  for (const [module, tabs] of Object.entries({
    structure: ["section", "three", "table", "quantities"],
    "standard-check": ["results"],
    electrical: ["results", "parameters"],
    "short-circuit": ["results", "parameters"],
    "rating-table": ["results", "parameters"],
    comparison: ["matrix", "parameters", "geometry"],
    specification: ["content", "preview", "review", "revisions"],
  }))
    for (const tab of tabs) routes.push(`/types/${type.id}/${module}/${tab}`);
  if (process.env.NAMES_FLOWS_ONLY !== "1")
    for (const url of routes) await scan(url);
  await go(`/types/${type.id}/specification/preview`);
  await expect(
    page.getByRole("button", { name: "导出 PDF", exact: true }),
  ).toBeEnabled();
  const pdfResponse = page.waitForResponse((r) =>
    r.url().includes("/specification/file"),
  );
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const reply = await pdfResponse;
  assert.equal(reply.status(), 422, "未计算型号必须拒绝客户PDF导出");
  assert.equal((await reply.json()).detail.channel, "geometry");
  await expect(page.locator('[role="alert"]')).toContainText(
    "尚无当前修订的完整运行",
  );
  await assertVisibleNames(page, "规格书缺项拒绝");
  report.checks.push(
    "生成OpenAPI客户端请求PDF；真实缺项422保留并显示具体原因，无批准或伪造导出",
  );
  await go(route(sweep, "sweep", "curve"));
  await expect(page.locator(".evidence-summary h2")).toContainText(
    "土壤热阻率",
  );
  await expect(page.locator(".evidence-summary h2")).toContainText("区间平均");
  await page.getByRole("combobox", { name: "结果量", exact: true }).click();
  await assertVisibleNames(page, "扫描结果量下拉");
  await page.keyboard.press("Escape");
  await expect(page.locator(".series-chart")).toContainText("K·m/W");
  await expect(page.locator(".series-chart")).toContainText("1.00");
  await variants("扫描成功");
  await shot("sweep");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出逐点 CSV" }).click();
  assert.ok((await download).suggestedFilename().endsWith(".csv"));
  report.checks.push("真实扫描、中文结果选择、统一单位精度、端点结论和CSV");
  await go(route(inquiry, "selection", "results"));
  await expect(page.getByRole("table", { name: "真实选型候选" })).toBeVisible();
  assert.equal(
    await page.getByRole("columnheader", { name: "来源", exact: true }).count(),
    0,
  );
  await expect(
    page
      .locator(".toolbar")
      .getByRole("button", { name: "来源：计算", exact: true }),
  ).toHaveCount(1);
  await variants("选型成功");
  await shot("selection");
  for (const p of ["/studies", "/types", "/settings"]) {
    await go(p);
    await variants(p + "成功");
    await shot(p.slice(1));
  }
  // A real revision makes the immutable scan historical; only the isolated DB is edited.
  const w = await get("/api/workspaces/" + sweep.wid);
  w.domain.name += " · 隔离历史检查";
  await request(base, "/api/workspaces/" + w.id + "/domain", "PUT", {
    expected_revision: w.revision,
    document: w.domain,
  });
  const runs = (
    await get(`/api/workspaces/${sweep.wid}/studies/${sweep.id}/runs`)
  ).items;
  const saved = runs.find((r) => r.integrity === "verified");
  await go(route(sweep, "sweep", "curve") + "&run=" + saved.id);
  await expect(
    page.getByText("历史结果", { exact: true }).first(),
  ).toBeVisible();
  await variants("扫描历史");
  const inquiryRuns = (
    await get(`/api/workspaces/${inquiry.wid}/studies/${inquiry.id}/runs`)
  ).items;
  await go(
    route(inquiry, "selection", "results") +
      "&run=" +
      inquiryRuns.find((r) => r.integrity === "verified").id,
  );
  await variants("选型历史");
  // Transport faults / empty collections only; never manufacture successful physics data.
  for (const target of [sweep, inquiry])
    for (const state of ["empty", "loading", "error"]) {
      await page.route("**/api/workspaces/*/studies/*/runs*", async (r) => {
        if (r.request().method() !== "GET") return r.fallback();
        if (state === "loading")
          await new Promise((resolve) => setTimeout(resolve, 5000));
        await r.fulfill({
          status: state === "error" ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            state === "error"
              ? { detail: "网络暂时不可用，请重试" }
              : { items: [] },
          ),
        });
      });
      await page.goto("about:blank");
      await page.goto(
        base +
          route(
            target,
            target === sweep ? "sweep" : "selection",
            target === sweep ? "curve" : "results",
          ),
        { waitUntil: "domcontentloaded" },
      );
      await settle(page);
      if (state === "loading")
        await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
      else
        await expect(
          page.locator('.provider-state [aria-busy="true"]'),
        ).toHaveCount(0);
      await variants((target === sweep ? "扫描" : "选型") + state);
      await page.unroute("**/api/workspaces/*/studies/*/runs*");
    }
  await save();
  const violations = report.pages.flatMap((p) =>
    p.violations.map((v) => ({ ...v, route: p.route })),
  );
  assert.deepEqual(
    violations,
    [],
    "全局内部名称门禁：" + JSON.stringify(violations),
  );
  assert.deepEqual(report.errors, []);
  console.log(
    JSON.stringify({
      pages: report.pages.length,
      states: report.states.length,
      screenshots: report.screenshots,
      violations: violations.length,
    }),
  );
} finally {
  await save();
  await session.close();
}
