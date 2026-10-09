import assert from "node:assert/strict";
import { expect as pwExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { request, currentSelection } from "./research-fixtures.mjs";
import { assertLayout } from "./layout-assertions.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("仅允许隔离数据库");
const base = process.env.FRONTEND_URL,
  output = path.join(outputRoot, "expansion"),
  expect = pwExpect.configure({ timeout: 60000 });
await fs.mkdir(output, { recursive: true });
const session = await openHeadlessBrowser(),
  { page } = session,
  errors = [],
  checks = [],
  layouts = [],
  screenshots = [],
  writes = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    request.url().includes("/api/") &&
    !["GET", "HEAD"].includes(request.method())
  )
    writes.push({ url: request.url(), method: request.method() });
});
async function go(url) {
  await page.goto("about:blank");
  await page.goto(base + url);
  await settle(page);
}
async function ready() {
  await expect(
    page.locator(
      ".provider-state .state-view[aria-busy='true'],.main-content .state-view[aria-busy='true']",
    ),
  ).toHaveCount(0);
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
      await page.waitForTimeout(70);
      layouts.push({
        label,
        theme,
        ...size,
        ...(await assertLayout(page, label)),
      });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}
async function capture(name) {
  await page.screenshot({ path: path.join(output, name + ".png") });
  screenshots.push(name);
}
try {
  const fixture = await currentSelection(base);
  const root = "/studies/" + fixture.sid,
    query = "?workspace=" + fixture.wid + "&theme=light";
  const models = await request(base, "/api/design/study-cable-models"),
    model = models.find((value) => value.id === "system.cu-xlpe-al-240");
  const contracts = await request(base, "/api/input-contracts"),
    pin = contracts.find(
      (value) =>
        value.method.plugin_id === "cablesim.iec60287" &&
        value.method.capability === "steady-rating",
    ).method;
  const workspace = await request(
    base,
    "/api/design/study-workspaces",
    "POST",
    { model_id: model.id, content_sha256: model.content_sha256 },
  );
  const study = await request(
    base,
    "/api/workspaces/" + workspace.id + "/studies",
    "POST",
    {
      title: "土壤热阻率敏感性验收",
      task: "rating",
      method: pin,
      input_source: "domain",
      parameters: model.method_defaults[pin.plugin_id],
      driver: { kind: "single" },
      expected_revision: workspace.revision,
    },
  );
  const scanRoot = "/studies/" + study.id,
    scanQuery = "?workspace=" + workspace.id + "&theme=light";
  await go("/");
  await ready();
  await expect(
    page.getByRole("link", { name: "型号", exact: false }).first(),
  ).toHaveAttribute("href", /types/);
  await variants("home");
  await capture("home");
  await page.getByRole("link", { name: "型号设计", exact: true }).click();
  await expect(page).toHaveURL(/\/types/);
  await ready();
  await variants("types");
  await capture("types");
  for (const [url, label] of [
    ["/studies", "studies"],
    ["/resources/materials", "materials"],
    ["/plugins", "plugins"],
    ["/settings", "settings"],
    ["/validation", "reproductions"],
  ]) {
    await go(url + "?theme=light");
    await ready();
    await variants(label);
    await capture(label);
    checks.push(label + "正式路由与布局");
  }
  await page
    .getByRole("row")
    .filter({ hasText: "E02" })
    .first()
    .click()
    .catch(async () => {
      await go("/validation/E02/results?theme=light");
    });
  for (const tab of ["results", "overlay", "convergence", "sources", "scope"]) {
    await go("/validation/E02/" + tab + "?theme=light");
    await ready();
    await variants("reproduction-" + tab);
    if (tab === "results") await capture("reproduction-detail");
  }
  const history = await request(base, "/api/foundation/reproductions");
  if (history.history.length > 1) {
    await go(
      "/validation/E02/results?theme=light&snapshot=" +
        history.history[1].id,
    );
    await ready();
    await expect(page.locator('[data-state="historical"]')).toHaveCount(1);
    await variants("reproduction-historical");
    checks.push("复现历史快照");
  }
  await go(scanRoot + "/sweep/settings" + scanQuery);
  await ready();
  await page.getByRole("textbox", { name: "起点", exact: true }).fill("0.6");
  await page.getByRole("textbox", { name: "终点", exact: true }).fill("1.0");
  await page.getByRole("textbox", { name: "步长", exact: true }).fill("0.2");
  await page
    .getByRole("textbox", { name: "范围出处", exact: true })
    .fill("界面验收：明确采样0.6、0.8、1.0 K·m/W；演示输入，未审核");
  await page.getByRole("link", { name: "工况", exact: true }).click();
  await page.getByRole("link", { name: "参数扫描", exact: true }).click();
  await page.getByRole("tab", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "起点", exact: true }),
  ).toHaveValue("0.6");
  await page.getByRole("button", { name: "应用扫描设置", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "已核对适用范围，按已保存版本运行" })
    .check();
  await page.getByRole("button", { name: "确认并运行", exact: true }).click();
  await ready();
  await expect(page.getByRole("table", { name: "扫描点结果" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(4);
  await variants("sweep-success");
  await capture("sweep");
  checks.push("扫描草稿跨模块保留、Ctrl+S保存、真实IEC三点运行");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出逐点 CSV" }).click();
  const csv = await downloadPromise;
  await csv.saveAs(path.join(output, "sweep-results.csv"));
  checks.push("逐点CSV包含SI单位与来源");
  for (const [module, tab] of [
    ["batch", "space"],
    ["batch", "results"],
    ["batch", "execution"],
    ["method-compare", "inputs"],
    ["method-compare", "results"],
    ["method-compare", "evidence"],
    ["simulation", "inputs"],
    ["simulation", "results"],
    ["simulation", "evidence"],
  ]) {
    await go(scanRoot + "/" + module + "/" + tab + scanQuery);
    await ready();
    await variants(module + "-" + tab);
    if (["space", "inputs"].includes(tab)) await capture(module + "-" + tab);
  }
  await go(root + "/ampacity/results" + query);
  await ready();
  if (await page.locator(".conclusion h2").count()) {
    await expect(page.locator(".conclusion h2")).not.toContainText(
      "限制电缆 回路",
    );
    assert.equal(
      await page
        .getByRole("columnheader", { name: "来源", exact: true })
        .count(),
      0,
    );
    await variants("rating-title-source");
    await capture("rating");
  }
  const workspaces = await request(base, "/api/workspaces");
  let fieldCase;
  for (const ws of workspaces) {
    for (const s of await request(
      base,
      "/api/workspaces/" + ws.id + "/studies",
    )) {
      const runs = (
        await request(
          base,
          "/api/workspaces/" + ws.id + "/studies/" + s.id + "/runs",
        )
      ).items;
      const r = runs.find((value) =>
        JSON.stringify(value.output).includes("x-cablesim.temperature-field"),
      );
      if (r) {
        fieldCase = { ws, s, r };
        break;
      }
    }
    if (fieldCase) break;
  }
  if (fieldCase) {
    await go(
      "/studies/" +
        fieldCase.s.id +
        "/thermal-field/field?workspace=" +
        fieldCase.ws.id +
        "&theme=light&run=" +
        fieldCase.r.id,
    );
    await ready();
    await expect(page.locator(".conclusion")).toContainText("最高温度");
    await expect(
      page.getByRole("combobox", { name: "场图范围" }),
    ).toContainText("电缆周围");
    await variants("temperature");
    await capture("temperature");
    checks.push("温度场最高温度与坐标精度、局部默认视野");
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "verification.json"),
    JSON.stringify(
      {
        checks,
        layouts,
        screenshots,
        errors,
        writes,
        solverRuns: "仅IEC标准代数；未启动本机原生求解器",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      layoutAssertions: layouts.length,
      screenshots: screenshots.length,
      errors,
    }),
  );
} catch (error) {
  await fs.writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        checks,
        errors,
        page: await page.locator("body").innerText(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await session.close();
}
