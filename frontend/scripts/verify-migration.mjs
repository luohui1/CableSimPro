import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { currentSelection } from "./research-fixtures.mjs";
if (process.env.E2E_ISOLATED !== "1")
  throw Error("写入验收只能通过独立临时数据库运行：npm run test:migration");

const base = process.env.FRONTEND_URL || "http://127.0.0.1:5175";
await currentSelection(base);
const output = path.join(outputRoot, "migration");
await fs.mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 15000 });
async function read(endpoint) {
  const r = await fetch(base + endpoint);
  if (!r.ok) throw Error(`${endpoint}: ${r.status}`);
  return r.json();
}
const workspaces = await read("/api/workspaces");
const studies = (
  await Promise.all(
    workspaces.map(async (workspace) =>
      (await read(`/api/workspaces/${workspace.id}/studies`)).map((study) => ({
        ...study,
        workspace: workspace.id,
      })),
    ),
  )
).flat();
const selected = studies.find(
  (study) =>
    study.definition.driver.kind === "selection" &&
    study.definition.driver.minimum === 350,
);
if (!selected)
  throw Error("缺少已保存的350 A真实三芯选型研究；不生成替代数据。");
const runs = (
  await read(
    `/api/workspaces/${selected.workspace}/studies/${selected.id}/runs`,
  )
).items;
const current = runs.findLast(
  (run) => run.freshness === "current" && run.integrity === "verified",
);
const run = current || runs.findLast((run) => run.integrity === "verified");
if (!run) throw Error("缺少完整性已校验的真实选型运行。");
const contextQuery = `workspace=${selected.workspace}&run=${run.id}&delivery=`;
const selectionPath = `/studies/${selected.id}/selection/results?${contextQuery}`;
const session = await openHeadlessBrowser();
const { page, context } = session;
const errors = [],
  writes = [],
  captures = [],
  layouts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Failed to load resource"))
    errors.push(m.text());
});
page.on("request", (r) => {
  if (
    r.url().includes("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(r.method())
  )
    writes.push({ method: r.method(), url: r.url() });
});
async function layout() {
  const value = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentOverflow:
      document.documentElement.scrollWidth > innerWidth ||
      document.documentElement.scrollHeight > innerHeight,
    fontMinimum: Math.min(
      ...[
        ...document.querySelectorAll(
          "button,h1,h2,h3,td,th,p,span,label,dt,dd",
        ),
      ]
        .filter(
          (el) =>
            el.textContent.trim() && el.getBoundingClientRect().height > 0,
        )
        .map((el) => parseFloat(getComputedStyle(el).fontSize)),
    ),
  }));
  expect(value.documentOverflow).toBe(false);
  expect(value.fontMinimum).toBeGreaterThanOrEqual(13);
  layouts.push({ url: page.url(), ...value });
}
async function capture(name) {
  await settle(page);
  await layout();
  await page.screenshot({ path: path.join(output, name), fullPage: true });
  captures.push(name);
  console.log(`迁移截图 ${name}`);
}
try {
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      for (const [route, name] of [
        ["/", "home"],
        ["/studies", "studies"],
        [selectionPath, "selection"],
        [`/studies/${selected.id}/report/preview?${contextQuery}`, "report"],
      ]) {
        await page.goto(
          base + route + (route.includes("?") ? "&" : "?") + `theme=${theme}`,
        );
        if (name === "home" || name === "studies")
          await expect(
            page.getByRole("table", {
              name: name === "home" ? "最近研究" : "研究列表",
            }),
          ).toBeVisible();
        if (name === "selection")
          await expect(
            page.getByRole("table", { name: "真实选型候选" }),
          ).toBeVisible();
        if (name === "report")
          await expect(
            page.getByRole("tab", { name: "预览", exact: true }),
          ).toBeVisible();
        await capture(`${name}-${theme}-${width}.png`);
      }
    }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base + selectionPath + "&theme=light");
  await expect(
    page.getByRole("heading", { name: "YJV22-8.7/15 kV 3×300", exact: true }),
  ).toBeVisible();
  const expected = run.output.assessment.find(
    (item) =>
      run.snapshot.candidate_snapshots[Number(item.case_id.split("-")[1])]
        .payload.name === "YJV22-8.7/15 kV 3×300",
  ).value;
  await expect(page.locator(".conclusion-metrics")).toContainText(
    expected.toFixed(1),
  );
  await expect(
    page.getByRole("columnheader", { name: "限制原因", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row", { name: "选择 YJV22-8.7/15 kV 3×300", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".property-panel h2")).toHaveText(
    "YJV22-8.7/15 kV 3×300",
  );
  const rowHeights = await page
    .locator(".data-row")
    .evaluateAll((rows) => rows.map((el) => el.getBoundingClientRect().height));
  expect(rowHeights.every((height) => height === 40)).toBe(true);
  await page.getByRole("tab", { name: "候选结果" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/selection\/settings/);
  await expect(
    page.getByRole("link", { name: "在旧版中打开" }),
  ).toHaveAttribute("href", /127\.0\.0\.1:8027.*selection\/settings/);
  await page.goBack();
  await expect(page).toHaveURL(/selection\/results/);
  await page.reload();
  await expect(page.getByRole("table", { name: "真实选型候选" })).toBeVisible();
  if (current) {
    await page.getByRole("button", { name: "预览计算书", exact: true }).click();
    await page
      .getByRole("button", { name: "生成客户计算书", exact: true })
      .click();
    await expect(page.getByTitle("计算书预览")).toBeVisible();
    await capture("report-generated-1366.png");
  }
  await page.goto(base + "/studies?theme=light");
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await page.getByRole("combobox", { name: "研究任务" }).click();
  await page.getByRole("option", { name: "客户问询选型", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称" })
    .fill("真实三芯问询创建检查");
  await page.getByRole("combobox", { name: "引用型号版本" }).click();
  await page.getByRole("option", { name: /YJV22-8\.7\/15 kV 3×300/ }).click();
  await page.getByRole("combobox", { name: "计算方法" }).click();
  await page
    .getByRole("option", { name: /IEC.*稳态/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "目标电流" }).fill("400");
  await page.getByRole("textbox", { name: "目标电流" }).press("Enter");
  await page.getByRole("button", { name: "建立研究", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("尚缺工程参数");
  await expect(page.getByRole("textbox", { name: "研究名称" })).toHaveValue(
    "真实三芯问询创建检查",
  );
  await capture("create-study-parameter-missing-1366.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Supported complete model branch: create a saved study without invoking any solver.
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await page.getByRole("combobox", { name: "研究任务" }).click();
  await page.getByRole("option", { name: "额定载流量", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称" })
    .fill("前端研究创建验收");
  await page.getByRole("combobox", { name: "引用型号版本" }).click();
  await page.getByRole("option", { name: /YJL02-12\/20 kV 1×240/ }).click();
  await page.getByRole("combobox", { name: "计算方法" }).click();
  await page
    .getByRole("option", { name: /IEC.*稳态/ })
    .first()
    .click();
  await page.getByRole("button", { name: "建立研究", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "前端研究创建验收", exact: true }),
  ).toBeVisible();
  const createdUrl = page.url();
  await page.locator(".topbar .status-mark").click();
  await page.getByRole("button", { name: "修改研究名称", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称" })
    .fill("前端研究保存验收");
  await page.getByRole("button", { name: "保留草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "电缆", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "前端研究保存验收", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "研究", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("有未保存修改");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "前端研究保存验收", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "载流量", exact: true }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("dialog")).toContainText("撤销接口尚未提供");
  await page.keyboard.press("Escape");
  await page.locator(".topbar .status-mark").click();
  await page.getByRole("button", { name: "修改研究名称", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称" })
    .fill("冲突时必须保留的草稿");
  await page.getByRole("button", { name: "保留草稿", exact: true }).click();
  await page.route("**/api/workspaces/*/studies/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "修订冲突，不能覆盖" }),
        })
      : route.continue(),
  );
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert")).toContainText("修订冲突");
  await expect(
    page.getByRole("heading", { name: "冲突时必须保留的草稿", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "研究", exact: true }).click();
  await page
    .getByRole("button", { name: "保存后留在研究", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("有未保存修改");
  await page.keyboard.press("Escape");
  await capture("study-save-conflict-1366.png");
  await page.unrouteAll();
  expect(writes.every((item) => !item.url.endsWith("/runs"))).toBe(true);
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(output, "verification.json"),
    JSON.stringify(
      {
        captures,
        layouts,
        writes,
        errors,
        source: {
          workspace: selected.workspace,
          study: selected.id,
          run: run.id,
          current: !!current,
        },
        createdUrl,
        keyboard: "passed",
        deepLinks: "passed",
        dirtyGuard: "passed",
        revisionConflict: "draft and departure dialog preserved",
        creation: "passed with explicit incomplete-model rejection",
        browserSolverCalls: 0,
        fixtureExecution: "临时库显式选择当前IEC版本并实际运行，原生求解调用为0",
      },
      null,
      2,
    ),
  );
  console.log(
    "迁移验收通过：真实列表/选型、完整性、路由、新建/保存/冲突、当前报告生成；仅临时库IEC运行，无原生求解。",
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  await fs.writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        url: page.url(),
        errors,
        body: await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await session.close();
}
