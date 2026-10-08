import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("仅允许独立临时数据库");
const base = process.env.FRONTEND_URL,
  out = path.join(outputRoot, "refinement"),
  expect = playwrightExpect.configure({ timeout: 60000 });
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser(),
  { page } = session,
  errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
async function go(url) {
  await page.goto("about:blank");
  await page.goto(base + url);
  await settle(page);
}
async function capture(name) {
  await expect(page.locator(".state-view[aria-busy='true']")).toHaveCount(0);
  await settle(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
  await page.screenshot({ path: path.join(out, name + ".png") });
  console.log("收尾截图 " + name);
}
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  const models = await request(base, "/api/design/study-cable-models"),
    model = models.find((value) => value.id === "system.cu-xlpe-al-240");
  const pin = (await request(base, "/api/input-contracts")).find(
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
    `/api/workspaces/${workspace.id}/studies`,
    "POST",
    {
      title: "临时缺项跳转与模板验收",
      task: "rating",
      expected_revision: workspace.revision,
      method: pin,
      input_source: "domain",
      parameters: model.method_defaults[pin.plugin_id],
      driver: { kind: "single" },
    },
  );
  const root = `/studies/${study.id}`,
    query = `?workspace=${workspace.id}&theme=light`;
  await go(root + "/conditions/inputs" + query);
  const rho = page.getByRole("textbox", { name: "介质热阻率", exact: true });
  await rho.fill("");
  await rho.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存工况", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认并运行", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "前往工况输入", exact: true }),
  ).toBeVisible();
  await capture("preflight-missing-ready-light-1366");
  await page.getByRole("button", { name: "前往工况输入", exact: true }).click();
  await expect(page).toHaveURL(/ampacity\/results/);
  await expect(rho).toHaveValue("");
  await rho.fill("1.25");
  await rho.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存工况", exact: true }),
  ).toHaveCount(0);
  checks.push("真实IEC缺土壤输入预检失败、运行禁用、跳转至可补录的工况输入");
  await go(root + "/section/section" + query);
  await expect(
    page.locator("[data-laying-section-state='success']"),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "模板", exact: true }).click();
  await page.getByRole("option", { name: "单回水平", exact: true }).click();
  await page.getByRole("button", { name: "应用模板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toBeVisible();
  await page.locator(".drawing-svg").first().focus();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  checks.push("正式模板请求、页面撤销/重做与保存");
  await page.getByRole("button", { name: "尺寸链", exact: true }).click();
  const object = page.locator(".drawing-object[role='button']").first();
  await object.focus();
  await page.keyboard.press("Enter");
  const dimension = page.locator(".drawing-dimension-chip.is-editable").first();
  await dimension.focus();
  await page.keyboard.press("Enter");
  const dimensionInput = page.locator(".drawing-dimension-editor input");
  await expect(dimensionInput).toBeVisible();
  const value = await dimensionInput.inputValue();
  await dimensionInput.fill(String(Number(value) + 0.1));
  const savedDimension = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith(`/api/workspaces/${workspace.id}/domain`),
  );
  await dimensionInput.press("Control+s");
  expect((await savedDimension).status()).toBe(200);
  await expect(dimensionInput).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  checks.push("尺寸编辑器中Ctrl+S确认数值并保存最新页面状态");
  let aligned;
  for (const ws of await request(base, "/api/workspaces")) {
    const full = await request(base, `/api/workspaces/${ws.id}`);
    if (Object.keys(full.domain?.load_cases?.[0]?.currents || {}).length < 3)
      continue;
    const studies = await request(base, `/api/workspaces/${ws.id}/studies`);
    if (studies.length) {
      aligned = studies[0];
      break;
    }
  }
  expect(aligned).toBeDefined();
  const formStudy = aligned || study;
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await go(
        `/studies/${formStudy.id}/conditions/inputs?workspace=${formStudy.workspace}&theme=${theme}`,
      );
      await expect(
        page.getByRole("textbox", { name: "导体温限", exact: true }),
      ).toBeVisible();
      const widths = await page
        .locator(".number-input")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().width),
        );
      expect(widths.length).toBeGreaterThan(0);
      expect(widths.every((value) => value >= 160 && value <= 240.5)).toBe(
        true,
      );
      const first = page
        .locator(".input-form-grid")
        .first()
        .locator(".number-input");
      if ((await first.count()) >= 3) {
        const tops = await first.evaluateAll((nodes) =>
          nodes.slice(0, 3).map((node) => node.getBoundingClientRect().top),
        );
        expect(new Set(tops.map((value) => Math.round(value))).size).toBe(1);
      }
      await capture(`conditions-after-${theme}-${width}`);
      await go(
        `/studies/bdadae72-1cba-4655-a7f6-7714bd394ece/thermal-field/field?workspace=9d7101b2-8055-4865-bd23-f1d33e2f45c8&theme=${theme}`,
      );
      await expect(page.locator("canvas.temperature-plot")).toHaveAttribute(
        "data-soil-layer-outlines",
        "2",
      );
      await expect(page.locator("canvas.temperature-plot")).toHaveAttribute(
        "data-field-view",
        "section",
      );
      await capture(`field-layers-ready-${theme}-${width}`);
    }
  checks.push(
    "全部数值框含只读温限160–240，三回电流对齐，四组尺寸/主题",
    "原样保存的分层土壤场工件、两层边界、全景与电缆轮廓",
  );
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(out, "finishing-verification.json"),
    JSON.stringify(
      {
        checks,
        errors,
        fieldStudy: "bdadae72-1cba-4655-a7f6-7714bd394ece",
        nativeRuns: [],
        inputWidths: [160, 240],
      },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "finishing-failure.json"),
    JSON.stringify(
      { message: error.message, url: page.url(), checks, errors },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(out, "finishing-failure.png") });
  throw error;
} finally {
  await session.close();
}
