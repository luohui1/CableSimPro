import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("仅允许隔离数据库验收");
const base = process.env.FRONTEND_URL,
  out = path.join(outputRoot, "refinement");
await fs.mkdir(out, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 }),
  session = await openHeadlessBrowser(),
  { page } = session;
const errors = [],
  writes = [],
  captures = [],
  operations = [];
let started;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (value) => {
  if (
    value.url().includes("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(value.method())
  )
    writes.push({
      method: value.method(),
      url: value.url(),
      body: value.postDataJSON(),
    });
});
const faults = new Map();
await page.route("**/api/**", (route) => {
  const item = [...faults].find(([end]) =>
    new URL(route.request().url()).pathname.endsWith(end),
  );
  return item ? item[1](route) : route.fallback();
});
async function go(url) {
  await page.goto("about:blank");
  await page.goto(base + url);
  await settle(page);
}
async function capture(name, { loading = false } = {}) {
  if (!loading)
    await expect(page.locator(".state-view[aria-busy='true']")).toHaveCount(0);
  await settle(page);
  const layout = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth > innerWidth ||
      document.documentElement.scrollHeight > innerHeight,
    minimum: Math.min(
      ...[
        ...document.querySelectorAll(
          "button,h1,h2,td,th,p,span,label,dt,dd,text",
        ),
      ]
        .filter(
          (node) =>
            node.textContent.trim() && node.getBoundingClientRect().height > 0,
        )
        .map((node) => parseFloat(getComputedStyle(node).fontSize)),
    ),
  }));
  expect(layout.overflow).toBe(false);
  expect(layout.minimum).toBeGreaterThanOrEqual(13);
  await page.screenshot({ path: path.join(out, name + ".png") });
  captures.push({ name, ...layout });
  console.log("截图 " + name);
}
async function action(label, operation) {
  if (!started) started = performance.now();
  await operation();
  operations.push({
    number: operations.length + 1,
    label,
    elapsedMs: Math.round(performance.now() - started),
  });
}
const route = (study, module, tab, run = "", theme = "light") =>
  `/studies/${study.id}/${module}/${tab}?workspace=${study.workspace}&run=${run}&theme=${theme}`;
const sizes = [
    [1366, 768],
    [1920, 1080],
  ],
  themes = ["light", "dark"];
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  await go("/studies?theme=light");
  await action("新建问询", () =>
    page.getByRole("button", { name: "新建研究", exact: true }).click(),
  );
  await expect(page.getByRole("dialog")).toContainText("新建问询");
  await expect(
    page.getByRole("textbox", { name: "目标电流", exact: true }),
  ).toBeVisible();
  await action("填写目标电流350 A", () =>
    page.getByRole("textbox", { name: "目标电流", exact: true }).fill("350"),
  );
  await action("选择YJV22 300–400 mm²范围", () =>
    page.getByRole("radio").first().check(),
  );
  await action("建立研究并查看缺项", () =>
    page.getByRole("button", { name: "建立研究", exact: true }).click(),
  );
  await expect(page.getByRole("dialog")).toContainText("补录工程师给定参数");
  await capture("inquiry-completion-empty-light-1366");
  await action("显式采用参考值及来源出处", () =>
    page.getByRole("button", { name: "采用参考输入", exact: true }).click(),
  );
  await capture("inquiry-completion-ready-light-1366");
  const checkReply = page.waitForResponse(
    (response) =>
      response.url().includes("/preflight") &&
      response.request().method() === "GET",
    { timeout: 180000 },
  );
  await action("保存工程输入并预检", () =>
    page.getByRole("button", { name: "保存并预检", exact: true }).click(),
  );
  const reply = await checkReply;
  const preflight = await reply.json();
  await fs.writeFile(
    path.join(out, "inquiry-preflight.json"),
    JSON.stringify({ status: reply.status(), body: preflight }, null, 2),
  );
  expect(reply.status()).toBe(200);
  expect(preflight.ready).toBe(true);
  await expect(page.getByRole("dialog")).toContainText("运行前预检");
  await capture("inquiry-preflight-ready-light-1366");
  await action("确认方法适用范围", () => page.getByRole("checkbox").check());
  await action("运行候选比较", () =>
    page.getByRole("button", { name: "确认并运行", exact: true }).click(),
  );
  await expect(page.locator(".conclusion")).toBeVisible();
  await expect(page.locator(".state-view[aria-busy='true']")).toHaveCount(0);
  const selectionUrl = new URL(page.url()),
    sid = selectionUrl.pathname.split("/")[2],
    wid = selectionUrl.searchParams.get("workspace"),
    study = { id: sid, workspace: wid };
  const savedStudy = (
    await request(base, `/api/workspaces/${wid}/studies`)
  ).find((value) => value.id === sid);
  expect(savedStudy.definition.driver.candidate_ids.length).toBe(2);
  expect(Object.keys(savedStudy.definition.candidate_completions)).toHaveLength(
    2,
  );
  const run = (
    await request(base, `/api/workspaces/${wid}/studies/${sid}/runs`)
  ).items.findLast((value) => value.integrity === "verified");
  expect(run.freshness).toBe("current");
  expect(["succeeded", "partial"]).toContain(run.status);
  await capture("inquiry-recommendation-ready-light-1366");
  await action("生成客户计算书", () =>
    page.getByRole("button", { name: "生成客户计算书", exact: true }).click(),
  );
  await expect(page.getByTitle("计算书预览")).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await action("下载客户计算书", () =>
    page.getByRole("button", { name: "下载 PDF", exact: true }).click(),
  );
  const file = await downloaded;
  await file.saveAs(path.join(out, "inquiry-report.pdf"));
  expect(await file.failure()).toBe(null);
  const elapsedMs = Math.round(performance.now() - started);
  await fs.writeFile(
    path.join(out, "inquiry-flow.json"),
    JSON.stringify(
      {
        operations,
        count: operations.length,
        elapsedMs,
        target: { operations: 10, elapsedMs: 300000 },
        actualCandidateIds: savedStudy.definition.driver.candidate_ids,
        study: sid,
        run: run.id,
        reportBytes: (await fs.stat(path.join(out, "inquiry-report.pdf")))
          .size,
        sourcePolicy:
          "Backend reference values explicitly adopted; all sources unreviewed; demo laying and environment retained",
      },
      null,
      2,
    ),
  );
  console.log(`问询全流程 ${operations.length} 次操作，${elapsedMs} ms`);
  expect(operations.length).toBe(10);
  expect(elapsedMs).toBeLessThan(300000);
  await go(route(study, "section", "section"));
  await expect(
    page.locator("[data-laying-section-state='success']"),
  ).toBeVisible();
  const object = page.locator(".drawing-object[role='button']").first();
  await expect(object).toBeVisible();
  await object.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".property-panel h2")).toBeVisible();
  await page.getByRole("button", { name: "尺寸链", exact: true }).click();
  const dimension = page.locator(".drawing-dimension-chip.is-editable").first();
  await expect(dimension).toBeVisible();
  await dimension.focus();
  await page.keyboard.press("Enter");
  const input = page.locator(".drawing-dimension-editor input");
  await expect(input).toBeVisible();
  const old = await input.inputValue();
  await input.fill(String(Number(old) + 0.1));
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "保存敷设", exact: true }),
  ).toBeVisible();
  await page.locator(".drawing-svg").first().focus();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "保存敷设", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page.getByRole("button", { name: "保存敷设", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存敷设", exact: true }),
  ).toHaveCount(0);
  const models = await request(base, "/api/design/study-cable-models"),
    pin = (await request(base, "/api/input-contracts")).find(
      (value) =>
        value.method.plugin_id === "cablesim.iec60287" &&
        value.method.capability === "steady-rating",
    ).method;
  const model = models.find((value) => value.id === "system.cu-xlpe-al-240");
  const ws = await request(base, "/api/design/study-workspaces", "POST", {
    model_id: model.id,
    content_sha256: model.content_sha256,
  });
  const rating = await request(
    base,
    `/api/workspaces/${ws.id}/studies`,
    "POST",
    {
      title: "临时结果与单芯画布验收",
      task: "rating",
      expected_revision: ws.revision,
      method: pin,
      input_source: "domain",
      parameters: model.method_defaults[pin.plugin_id],
      driver: { kind: "single" },
    },
  );
  const pre = await request(
    base,
    `/api/workspaces/${ws.id}/studies/${rating.id}/preflight?expected_revision=${ws.revision}&expected_study_revision=${rating.revision}`,
  );
  expect(pre.ready).toBe(true);
  const ratingRun = await request(
    base,
    `/api/workspaces/${ws.id}/studies/${rating.id}/runs`,
    "POST",
    {
      request_id: randomUUID(),
      expected_revision: ws.revision,
      expected_study_revision: rating.revision,
      scope_acknowledged: true,
      lock_digest: pre.lock_digest,
    },
  );
  const sceneModel = models.find(
    (value) => value.id === "system.cu-xlpe-al-compacted-400",
  );
  const sceneWorkspace = await request(
    base,
    "/api/design/type-workspaces",
    "POST",
    { model_id: sceneModel.id, content_sha256: sceneModel.content_sha256 },
  );
  const sceneStudy = await request(
    base,
    `/api/workspaces/${sceneWorkspace.id}/studies`,
    "POST",
    {
      title: "临时单芯空气场景包络验收",
      task: "rating",
      expected_revision: sceneWorkspace.revision,
      method: pin,
      input_source: "domain",
      parameters: sceneModel.method_defaults[pin.plugin_id],
      driver: { kind: "single" },
    },
  );
  for (const [width, height] of sizes)
    for (const theme of themes) {
      await page.setViewportSize({ width, height });
      await go(route(rating, "ampacity", "results", "", theme));
      await expect(page.locator(".conclusion")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "收起温度", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "展开损耗", exact: true }),
      ).toBeVisible();
      await capture(`rating-after-${theme}-${width}`);
      await page.getByRole("button", { name: "收起温度", exact: true }).click();
      await page
        .getByRole("button", { name: "展开电气参数", exact: true })
        .click();
      await expect(
        page.getByRole("cell", { name: "Ω/km", exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "μF/km", exact: true }).first(),
      ).toBeVisible();
      await capture(`units-after-${theme}-${width}`);
      await go(route(study, "conditions", "inputs", "", theme));
      const widths = await page
        .locator(".number-input")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().width),
        );
      expect(widths.every((value) => value >= 160 && value <= 240.5)).toBe(
        true,
      );
      await capture(`conditions-after-${theme}-${width}`);
      await go(route(study, "cable", "section", "", theme));
      await expect(
        page.locator("[data-cable-section-state='success']"),
      ).toBeVisible();
      await capture(`cable-canvas-ready-${theme}-${width}`);
      await go(route(study, "section", "section", "", theme));
      await expect(
        page.locator("[data-laying-section-state='success']"),
      ).toBeVisible();
      await capture(`laying-canvas-ready-${theme}-${width}`);
      await go(route(sceneStudy, "section", "three-dimensional", "", theme));
      await expect(page.locator(".cad-viewport")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 180000 },
      );
      expect(
        await page.locator(".cad-viewport").getAttribute("data-cad-state"),
        await page.locator(".cad-viewport").innerText(),
      ).toBe("success");
      await expect(page.locator(".cad-canvas-host canvas")).toBeVisible();
      await capture(`scene-canvas-ready-${theme}-${width}`);
      await go(route(study, "selection", "results", "", theme));
      await page.getByRole("button", { name: "运行记录", exact: true }).click();
      await expect(page.locator(".record-drawer")).toBeVisible();
      await capture(`run-records-ready-${theme}-${width}`);
      await page.keyboard.press("Escape");
    }
  const field = {
    id: "5850a3d6-f42b-460d-a75e-4556828327d8",
    workspace: "91a3addc-13cd-4769-9ab7-ad97c0d57054",
  };
  const native = [
    {
      id: "cb4a240a-0c85-4a41-9ab9-99add51c02d2",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "transient",
      tab: "history",
    },
    {
      id: "f9fd1e08-a108-482f-af56-b12a6783bf69",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "sheath-losses",
      tab: "losses",
    },
    {
      id: "ade9fa97-4d1b-4ddb-974e-3c77957b15e5",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "electrothermal",
      tab: "convergence",
    },
  ];
  const pages = [
    [study, "cable", "section"],
    [study, "conditions", "inputs"],
    [study, "section", "section"],
    [rating, "ampacity", "results"],
    [field, "thermal-field", "field"],
    ...native.map((value) => [value, value.module, value.tab]),
  ];
  for (const [item, module, tab] of pages)
    for (const [width, height] of sizes)
      for (const theme of themes) {
        await page.setViewportSize({ width, height });
        await go(route(item, module, tab, "", theme));
        await expect(page.locator(".topbar h1")).toBeVisible();
        if (module === "thermal-field") {
          await expect(page.locator("canvas.temperature-plot")).toBeVisible();
          await expect(
            page.getByRole("combobox", { name: "场图范围" }),
          ).toContainText("敷设全景");
          expect(
            await page
              .locator("canvas.temperature-plot")
              .getAttribute("data-cable-outlines"),
          ).not.toBe("0");
          await capture(`field-after-${theme}-${width}`);
        }
        await capture(`${module}-ready-${theme}-${width}`);
        const input = ["cable", "conditions", "section"].includes(module),
          endpoint = input
            ? `/api/workspaces/${item.workspace}`
            : `/api/workspaces/${item.workspace}/studies/${item.id}/runs`;
        faults.set(endpoint, async (intercepted) => {
          const response = await intercepted.fetch(),
            body = await response.json();
          if (input) delete body.domain;
          else body.items = [];
          await intercepted.fulfill({ response, json: body });
        });
        await go(route(item, module, tab, "", theme));
        await expect(
          page.locator(".state-view:not([role])").first(),
        ).toBeVisible();
        await capture(`${module}-empty-${theme}-${width}`);
        faults.clear();
        faults.set(endpoint, async (intercepted) => {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await intercepted.continue().catch(() => {});
        });
        await page.goto("about:blank");
        await page.goto(base + route(item, module, tab, "", theme));
        await expect(
          page.locator(".state-view[aria-busy='true']").first(),
        ).toBeVisible();
        await capture(`${module}-loading-${theme}-${width}`, { loading: true });
        faults.clear();
        await page.waitForTimeout(2600);
        faults.set(endpoint, (intercepted) =>
          intercepted.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              detail: { code: "READ_UNAVAILABLE", message: "研究接口暂不可用" },
            }),
          }),
        );
        await go(route(item, module, tab, "", theme));
        await expect(page.getByRole("alert").first()).toBeVisible();
        await capture(`${module}-error-${theme}-${width}`);
        faults.clear();
        const saved = (
          await request(
            base,
            `/api/workspaces/${item.workspace}/studies/${item.id}/runs`,
          )
        ).items.findLast((value) => value.integrity === "verified");
        if (saved) {
          await go(route(item, module, tab, saved.id, theme));
          await capture(`${module}-historical-${theme}-${width}`);
        }
      }
  for (const [width, height] of sizes)
    for (const theme of themes) {
      await page.setViewportSize({ width, height });
      await go(`/gallery?theme=${theme}`);
      await expect(
        page.locator("[data-gallery-entry='cable-section']"),
      ).toBeVisible();
      await expect(page.locator(".cad-viewport")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await capture(`gallery-canvases-${theme}-${width}`, { loading: true });
    }
  expect(errors).toEqual([]);
  const nativeRuns = writes.filter(
    (value) =>
      value.url.endsWith("/runs") &&
      value.body?.module &&
      ["transient", "sheath-losses", "electrothermal"].includes(
        value.body.module,
      ),
  );
  expect(nativeRuns).toEqual([]);
  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(
      {
        checks: [
          "4 refinements",
          "10-action inquiry download",
          "controlled dimension undo redo and save",
          "single-core real scene",
          "8 modules five states; two sizes and two themes",
          "shared records drawer",
          "formal gallery",
        ],
        operations,
        elapsedMs,
        captures,
        errors,
        writes,
        ratingRun: ratingRun.id,
        nativeRuns,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        stack: error.stack,
        url: page.url(),
        operations,
        errors,
        writes,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(out, "failure.png") });
  throw error;
} finally {
  await session.close();
}
