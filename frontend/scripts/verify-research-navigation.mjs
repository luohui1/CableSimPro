import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("只允许独立临时环境");
const base = process.env.FRONTEND_URL,
  out = path.join(outputRoot, "research");
await fs.mkdir(out, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 20000 });
const session = await openHeadlessBrowser();
const { page } = session;
const prefix = "/studies/5850a3d6-f42b-460d-a75e-4556828327d8/thermal-field/";
const query = "?workspace=91a3addc-13cd-4769-9ab7-ad97c0d57054&run=&delivery=";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base + prefix + "samples" + query);
  await expect(page.getByRole("table", { name: "保存温度取样" })).toBeVisible();
  await page.getByRole("row").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".property-panel h2")).toBeVisible();
  await page.getByRole("tab", { name: "取样", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/thermal-field\/parameters/);
  await page.goBack();
  await expect(page).toHaveURL(/thermal-field\/samples/);
  await page.waitForLoadState("domcontentloaded");
  await page.reload();
  await expect(page.getByRole("table", { name: "保存温度取样" })).toBeVisible();
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + prefix + "field" + query + "&theme=" + theme);
      await page
        .getByRole("combobox", { name: "场图范围", exact: true })
        .click();
      await page
        .getByRole("option", { name: "热点 · 256×", exact: true })
        .click();
      await page.getByRole("button", { name: "选择热点", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".property-panel h2")).toHaveText(
        "保存节点热点",
      );
      await settle(page);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      );
      expect(overflow).toBe(false);
      const panelOverflow = await page
        .locator(".property-panel")
        .evaluate((panel) => panel.scrollWidth > panel.clientWidth);
      expect(panelOverflow).toBe(false);
      await page.screenshot({
        path: path.join(
          out,
          `thermal-field-hotspot-selected-${theme}-${width}.png`,
        ),
      });
    }
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(out, "navigation-verification.json"),
    JSON.stringify(
      {
        keyboard: "passed",
        backAndReload: "passed",
        hotspot: "passed",
        sizes: [1366, 1920],
        themes: ["light", "dark"],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("温度场取样键盘、页签后退/刷新、热点缩放与属性联动验证通过。");
} finally {
  await session.close();
}
