import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { request, currentSelection } from "./research-fixtures.mjs";
import { assertLayout } from "./layout-assertions.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("只允许隔离数据库");
const base = process.env.FRONTEND_URL,
  session = await openHeadlessBrowser(),
  { page } = session,
  checks = [];
const output = path.join(outputRoot, "expansion");
async function go(url) {
  await page.goto("about:blank");
  await page.goto(base + url);
  await settle(page);
}
async function variants(label) {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (v) => (document.documentElement.dataset.theme = v),
        theme,
      );
      await assertLayout(page, label);
    }
  }
}
try {
  await fs.mkdir(output, { recursive: true });
  await currentSelection(base);
  const models = await request(base, "/api/design/study-cable-models"),
    model = models.find((v) => v.id === "system.cu-xlpe-al-240"),
    contracts = await request(base, "/api/input-contracts"),
    pin = contracts.find(
      (v) =>
        v.method.plugin_id === "cablesim.iec60287" &&
        v.method.capability === "steady-rating",
    ).method;
  const workspace = await request(
      base,
      "/api/design/study-workspaces",
      "POST",
      { model_id: model.id, content_sha256: model.content_sha256 },
    ),
    created = await request(
      base,
      "/api/workspaces/" + workspace.id + "/studies",
      "POST",
      {
        title: "独立前端操作验收",
        task: "rating",
        method: pin,
        input_source: "domain",
        parameters: model.method_defaults[pin.plugin_id],
        driver: { kind: "single" },
        expected_revision: workspace.revision,
      },
    );
  const fixture = { wid: workspace.id, sid: created.id },
    root = "/studies/" + fixture.sid,
    query = "?workspace=" + fixture.wid;
  await go("/resources/materials");
  await page.getByRole("button", { name: "导入资源草稿", exact: true }).click();
  await page.getByRole("textbox", { name: "定义内容" }).fill("{");
  await page.getByRole("button", { name: "校验并导入" }).click();
  await expect(page.getByRole("alert")).toContainText("有效 JSON");
  const asset = {
    asset_id: "ui-check-" + randomUUID(),
    version: "0.1.0",
    kind: "material",
    name: "隔离验收资源",
    sources: [
      {
        kind: "project_input",
        reference: "界面交互验收，无工程数值，未审核",
        reviewed: false,
      },
    ],
  };
  await page
    .getByRole("textbox", { name: "定义内容" })
    .fill(JSON.stringify(asset));
  await page.getByRole("button", { name: "校验并导入" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "隔离验收资源" }),
  ).toBeVisible();
  await variants("asset-import-success");
  const saved = (await request(base, "/api/foundation/assets")).items.find(
    (v) => v.asset_id === asset.asset_id,
  );
  assert.equal(saved.status, "draft");
  checks.push("导入错误保留内容；真实资源只创建未审核草稿");
  await page.getByRole("button", { name: "导入资源草稿", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const [url, endpoint, selector] of process.env.E2E_FLOWS_ONLY === "1"
    ? []
    : [
        ["/resources/materials", "/api/foundation/assets", '[data-page="library"]'],
        ["/plugins", "/api/methods", '[data-page="plugins"]'],
        ["/settings", "/api/health", '[data-page="settings"]'],
        [
          "/validation",
          "/api/foundation/reproductions",
          '[data-page="reproductions"]',
        ],
        [
          "/validation/E02/results",
          "/api/foundation/reproductions/E02",
          '[data-page="reproduction-detail"]',
        ],
      ]) {
    let release;
    const gate = new Promise((r) => (release = r));
    const matcher = (u) => new URL(u).pathname === endpoint;
    const delayed = async (route) => {
      await gate;
      try {
        await route.continue();
      } catch (error) {
        if (!/already handled|closed/i.test(error.message)) throw error;
      }
    };
    await page.route(matcher, delayed);
    await go(url);
    await expect(page.locator(selector)).toHaveAttribute(
      "data-state",
      "loading",
    );
    await variants(url + "-loading");
    release();
    await expect(page.locator(selector)).not.toHaveAttribute(
      "data-state",
      "loading",
    );
    await page.unroute(matcher, delayed);
    await page.route(matcher, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "隔离网络断开验收" }),
      }),
    );
    await go(url);
    await expect(page.locator(selector)).toHaveAttribute("data-state", "error");
    await variants(url + "-error");
    await page.unroute(matcher);
    await go(url);
    await expect(page.locator(selector)).toHaveAttribute(
      "data-state",
      "success",
    );
    await page.route(matcher, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.getByRole("button", { name: "首页", exact: true }).click();
    await page.goBack();
    await expect(page.locator(selector)).toHaveAttribute(
      "data-state",
      "historical",
    );
    await variants(url + "-cached-history");
    await page.unroute(matcher);
    checks.push(url + "加载/错误/成功/断网保留缓存布局");
    console.log("状态断言通过：" + url);
  }
  await go("/resources/materials");
  await page
    .getByRole("textbox", { name: "检索", exact: true })
    .fill("没有此资源-" + randomUUID());
  await expect(page.locator('[data-page="library"]')).toHaveAttribute(
    "data-state",
    "empty",
  );
  await variants("library-empty");
  await go("/validation");
  await page
    .getByRole("textbox", { name: "检索", exact: true })
    .fill("不存在的目标");
  await expect(page.getByText("没有匹配的复现目标")).toBeVisible();
  await variants("reproductions-empty");
  await go("/plugins/cablesim.iec60287");
  await expect(
    page.getByRole("table", { name: "插件能力与验证" }),
  ).toBeVisible();
  await variants("plugin-detail");
  await go("/settings");
  await page.getByRole("checkbox", { name: "减少动态" }).check();
  await page.keyboard.press("Control+s");
  await expect(page.getByText("偏好已保存")).toBeVisible();
  await page.reload();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.reducedMotion),
    "true",
  );
  checks.push("设置Ctrl+S持久化");
  await go(root + "/ampacity/results" + query);
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "已核对适用范围，按已保存版本运行" })
    .check();
  await page.getByRole("button", { name: "确认并运行", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator(".conclusion h2")).toContainText("允许电流", {
    timeout: 60000,
  });
  await expect(page.locator(".conclusion h2")).not.toContainText(
    "限制电缆 回路",
  );
  assert.equal(
    await page.getByRole("columnheader", { name: "来源", exact: true }).count(),
    0,
  );
  await variants("rating-sentence");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({ path: path.join(output, "rating.png") });
  checks.push("载流量一句话结论、共同来源只标一次、属性栏无横向残影");
  for (const tab of ["results", "validation", "sources"]) {
    await go(root + "/hybrid/" + tab + query);
    await variants("hybrid-" + tab);
  }
  checks.push("混合载流量三页签样式统一；未运行预测");
  await go(root + "/batch/space" + query);
  await expect(
    page.getByRole("combobox", { name: "基准参数", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "基准参数", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "土壤" }).first().click();
  await page.getByRole("button", { name: "添加参数" }).click();
  await page.getByRole("textbox", { name: "下限", exact: true }).fill("0.6");
  await page.getByRole("textbox", { name: "上限", exact: true }).fill("1.0");
  await page
    .getByRole("textbox", { name: "范围来源", exact: true })
    .fill("隔离验收范围；非工程批准");
  await page
    .getByRole("textbox", { name: "参数空间出处", exact: true })
    .fill("界面验收；禁止本机求解");
  await page.getByRole("button", { name: "保存批量配置" }).click();
  await expect(page.getByRole("button", { name: "预检批量" })).toBeVisible();
  const batch = await request(
    base,
    "/api/workspaces/" +
      fixture.wid +
      "/studies/" +
      fixture.sid +
      "/batch-configuration",
  );
  assert.equal(batch.configuration.definition.execution.backend, "slurm");
  assert.equal(
    batch.configuration.definition.parameter_space.axes[0].minimum,
    0.6,
  );
  checks.push("批量配置真实保存SI参数与Slurm约束；未提交求解");
  await variants("batch-saved");
  const prefix = "/api/workspaces/" + fixture.wid + "/studies/" + fixture.sid;
  let runs = (await request(base, prefix + "/runs")).items.filter(
    (v) =>
      v.integrity === "verified" && ["succeeded", "partial"].includes(v.status),
  );
  if (runs.length < 2) {
    const ws = await request(base, "/api/workspaces/" + fixture.wid),
      study = (
        await request(base, "/api/workspaces/" + fixture.wid + "/studies")
      ).find((value) => value.id === fixture.sid),
      check = await request(
        base,
        prefix +
          "/preflight?expected_revision=" +
          ws.revision +
          "&expected_study_revision=" +
          study.revision,
      );
    assert.equal(check.ready, true);
    await request(base, prefix + "/runs", "POST", {
      request_id: randomUUID(),
      expected_revision: ws.revision,
      expected_study_revision: study.revision,
      lock_digest: check.lock_digest,
      scope_acknowledged: true,
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      runs = (await request(base, prefix + "/runs")).items.filter(
        (v) =>
          v.integrity === "verified" &&
          ["succeeded", "partial"].includes(v.status),
      );
      if (runs.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(runs.length >= 2);
  await go(root + "/method-compare/inputs" + query);
  await page.getByRole("checkbox", { name: /比较 / }).nth(0).check();
  await page.getByRole("checkbox", { name: /比较 / }).nth(1).check();
  await page.getByRole("button", { name: "比较所选运行" }).click();
  await expect(page.getByRole("table", { name: "对比输入差异" })).toBeVisible();
  await variants("comparison-inputs");
  await page.getByRole("tab", { name: "结果", exact: true }).click();
  await expect(page.getByRole("table", { name: "方法结果差异" })).toBeVisible();
  await variants("comparison-results");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出对比 CSV" }).click();
  assert.ok((await download).suggestedFilename().endsWith(".csv"));
  checks.push("真实保存运行POST对比；输入/方法/结果差异及CSV");
  await fs.rm(path.join(output, "states-failure.json"), { force: true });
  await fs.writeFile(
    path.join(output, "state-verification.json"),
    JSON.stringify(
      {
        checks,
        solver: "未启动原生求解器；仅IEC代数运行",
        screenshots: 1,
        flowsOnly: process.env.E2E_FLOWS_ONLY === "1",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks }));
} catch (error) {
  await fs.writeFile(
    path.join(output, "states-failure.json"),
    JSON.stringify(
      {
        error: error.message,
        checks,
        body: await page.locator("body").innerText(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await session.close();
}
