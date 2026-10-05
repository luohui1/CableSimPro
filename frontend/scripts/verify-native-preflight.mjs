import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { checkNativeTasks } from "./native-task-check.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("只允许临时数据库验收");
const base = process.env.FRONTEND_URL,
  out = path.join(outputRoot, "research");
const expect = playwrightExpect.configure({ timeout: 20000 });
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser();
const { page } = session;
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
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  const checks = await checkNativeTasks({
    base,
    page,
    expect,
    go: async (route) => {
      await page.goto("about:blank");
      await page.goto(base + route);
      await settle(page);
    },
    capture: async (name) => {
      await settle(page);
      await page.screenshot({ path: path.join(out, name + ".png") });
    },
  });
  expect(errors).toEqual([]);
  expect(runs).toEqual([]);
  await fs.writeFile(
    path.join(out, "native-preflight-verification.json"),
    JSON.stringify({ checks, errors, nativeRuns: runs }, null, 2),
  );
  console.log(
    "三项原生任务创建与实际预检拒绝通过：读取真实预检响应，无原生执行请求。",
  );
} finally {
  await session.close();
}
