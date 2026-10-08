import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("只允许临时数据库验收");
const base = process.env.FRONTEND_URL,
  out = path.join(outputRoot, "research");
const expect = playwrightExpect.configure({ timeout: 20000 });
const session = await openHeadlessBrowser(),
  { page } = session;
const errors = [],
  runs = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (value) => {
  if (
    value.method() === "POST" &&
    new URL(value.url()).pathname.endsWith("/runs")
  )
    runs.push(value.url());
});
async function create(label, name, parameters) {
  await page.goto("about:blank");
  await page.goto(base + "/studies?theme=light");
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await page.getByRole("combobox", { name: "研究任务" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("textbox", { name: "研究名称" }).fill(name);
  await page.getByRole("combobox", { name: "引用型号版本" }).click();
  await page.getByRole("option", { name: /YJL02-12\/20 kV 1×240/ }).click();
  await page.getByRole("combobox", { name: "计算方法" }).click();
  await page.getByRole("option").first().click();
  if (parameters)
    await page
      .getByRole("textbox", { name: "方法参数 / SI", exact: true })
      .fill(JSON.stringify(parameters, null, 2));
  await page.getByRole("button", { name: "建立研究", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return new URL(page.url());
}
async function capture(name) {
  await settle(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
  await page.screenshot({ path: path.join(out, name + ".png") });
}
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  const studies = await request(
    base,
    "/api/workspaces/688dbfb4-f8cb-419b-a2fc-4c1311bd5402/studies",
  );
  const coupled = studies.find(
    (value) => value.id === "ade9fa97-4d1b-4ddb-974e-3c77957b15e5",
  );
  const parameterUrl = await create(
    "电热耦合",
    "临时参数单位验收",
    coupled.definition.parameters,
  );
  parameterUrl.searchParams.set('inspector', 'method');
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      parameterUrl.searchParams.set("theme", theme);
      await page.goto("about:blank");
      await page.goto(parameterUrl.href);
      const field = page
        .locator(".number-field")
        .filter({
          has: page.getByRole("textbox", { name: "热导率", exact: true }),
        })
        .first();
      await expect(field.locator(".unit")).toHaveText("W/(m·K)");
      await field.scrollIntoViewIfNeeded();
      await capture(`electrothermal-parameter-units-${theme}-${width}`);
    }
  const ratingUrl = await create("额定载流量", "临时 IEC 研究验收");
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认并运行", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "研究物理量结果" }),
  ).toBeVisible();
  const sid = ratingUrl.pathname.split("/")[2],
    wid = ratingUrl.searchParams.get("workspace");
  const run = (
    await request(base, `/api/workspaces/${wid}/studies/${sid}/runs`)
  ).items.findLast((value) => value.integrity === "verified");
  expect(run.freshness).toBe("current");
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      ratingUrl.searchParams.set("theme", theme);
      await page.goto("about:blank");
      await page.goto(ratingUrl.href);
      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name: "电容", exact: true }) })
        .first();
      await expect(row).toContainText(/\d\.\d{3}e−\d+/);
      await expect(row).toContainText("F/m");
      await row.scrollIntoViewIfNeeded();
      await capture(`ampacity-results-ready-${theme}-${width}`);
    }
  expect(errors).toEqual([]);
  expect(runs.length).toBe(1);
  expect(runs[0]).toContain(`/studies/${sid}/runs`);
  await fs.writeFile(
    path.join(out, "presentation-verification.json"),
    JSON.stringify(
      {
        compoundUnit: "W/(m·K)",
        smallNonzeroResult: "scientific notation; original F/m",
        run: run.id,
        sizes: [1366, 1920],
        themes: ["light", "dark"],
        nativeRuns: [],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "复合单位与微小结果的真实页面、双尺寸及浅深色验证通过；仅运行IEC。",
  );
} finally {
  await session.close();
}
