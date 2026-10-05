import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { currentSelection } from "./research-fixtures.mjs";

const base = process.env.FRONTEND_URL || "http://127.0.0.1:5175";
const currentFixture = await currentSelection(base);
const out = path.join(outputRoot, "migration");
const expect = playwrightExpect.configure({ timeout: 15000 });
const read = async (endpoint) => {
  const r = await fetch(base + endpoint);
  if (!r.ok) throw Error(endpoint + ": " + r.status);
  return r.json();
};
const workspaces = await read("/api/workspaces");
const studies = (
  await Promise.all(
    workspaces.map(async (w) =>
      (await read("/api/workspaces/" + w.id + "/studies")).map((s) => ({
        ...s,
        wid: w.id,
      })),
    ),
  )
).flat();
const selected = studies.find(
  (s) =>
    s.definition.driver.kind === "selection" &&
    s.definition.driver.minimum === 350,
);
const runs = (
  await read(
    "/api/workspaces/" + selected.wid + "/studies/" + selected.id + "/runs",
  )
).items;
const run = runs.findLast(
  (r) => r.freshness === "current" && r.integrity === "verified",
);
if (!run) throw Error("缺少真实当前运行");
const historic = studies.find(
  (s) =>
    s.definition.driver.kind === "selection" &&
    s.id !== selected.id &&
    s.definition.driver.minimum === 350,
);
const historicalRun =
  historic &&
  (
    await read(
      "/api/workspaces/" + historic.wid + "/studies/" + historic.id + "/runs",
    )
  ).items.findLast(
    (r) => r.freshness === "historical" && r.integrity === "verified",
  );
if (!historicalRun) throw Error("缺少已保存历史运行");
const did = currentFixture.book.id;
const book = await read(
  "/api/workspaces/" + selected.wid + "/deliveries/" + did,
);
expect(book.sources[0].run_id).toBe(run.id);
const target = (module, item = selected, result = run, delivery = "") =>
  "/studies/" +
  item.id +
  "/" +
  module +
  (module === "report" ? "/preview" : "/results") +
  "?workspace=" +
  item.wid +
  "&run=" +
  result.id +
  "&delivery=" +
  delivery;
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser();
const { page, context } = session;
async function go(route) {
  await page.goto("about:blank");
  await page.goto(base + route);
}
const checks = [],
  comparisons = [];
const faults = new Map();
await page.route("**/api/**", async (route) => {
  const url = route.request().url();
  const entry = [...faults].find(([pattern]) => {
    const value = pattern.replace(/^\*\*/, "").replace(/\*$/, "");
    return pattern.endsWith("*") ? url.includes(value) : url.endsWith(value);
  });
  if (entry) return entry[1](route);
  return route.fallback();
});
const clear = async () => {
  faults.clear();
};
const capture = async (name) => {
  await settle(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({ path: path.join(out, name + ".png") });
  checks.push(name);
  console.log("五态截图 " + name);
};
const fault = async (pattern, body, status = 200) => {
  faults.set(pattern, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
};
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const [route, name] of [
    ["/", "home"],
    ["/studies", "studies"],
  ]) {
    await fault("**/api/workspaces", []);
    await go(route);
    await expect(
      page.getByRole("heading", { name: "尚无研究", exact: true }),
    ).toBeVisible();
    await capture(name + "-empty");
    await clear();
    faults.set("**/api/workspaces", async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      await r.continue();
    });
    await go(route);
    await expect(page.getByText("正在读取研究", { exact: true })).toBeVisible();
    await capture(name + "-loading");
    await clear({ behavior: "wait" });
    await fault("**/api/workspaces", { detail: "验收注入网络读取失败" }, 503);
    await go(route);
    await expect(page.getByRole("alert").first()).toContainText(
      "验收注入网络读取失败",
    );
    await capture(name + "-error");
    await clear();
    await go(route);
    await expect(
      page.getByRole("table", {
        name: name === "home" ? "最近研究" : "研究列表",
      }),
    ).toBeVisible();
    await expect(page.getByText("读取中", { exact: true })).toHaveCount(0);
    await capture(name + "-success");
    await fault("**/api/workspaces", { detail: "连接中断" }, 503);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(
      page.getByText("连接中断，保留上次读取的列表。"),
    ).toBeVisible();
    await capture(name + "-historical");
    await clear();
  }
  const runPattern =
    "**/api/workspaces/" + selected.wid + "/studies/" + selected.id + "/runs*";
  for (const module of ["selection", "report"]) {
    await fault(runPattern, { items: [], next_cursor: null });
    await page.goto(base + target(module).replace("&run=" + run.id, "&run="));
    await expect(
      page.getByRole("heading", {
        name: module === "selection" ? "尚无选型运行" : "尚无可交付运行",
        exact: true,
      }),
    ).toBeVisible();
    await capture(module + "-empty");
    await clear();
    faults.set(runPattern, async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      await r.continue();
    });
    await page.goto(base + target(module));
    await expect(
      page.getByText("正在读取运行记录", { exact: true }),
    ).toBeVisible();
    await capture(module + "-loading");
    await clear({ behavior: "wait" });
    await fault(runPattern, { detail: "验收注入运行读取失败" }, 503);
    await page.goto(base + target(module));
    await expect(page.getByRole("alert")).toContainText("验收注入运行读取失败");
    await capture(module + "-error");
    await clear();
    await page.goto(
      base + target(module, selected, run, module === "report" ? did : ""),
    );
    if (module === "report") {
      await expect(page.locator('iframe[title="计算书预览"]')).toBeVisible();
      await expect(page.frameLocator("iframe").locator("body")).toContainText(
        "381.4",
      );
    } else
      await expect(
        page.getByRole("table", { name: "真实选型候选" }),
      ).toBeVisible();
    await capture(module + "-success");
    await page.goto(base + target(module, historic, historicalRun));
    await expect(
      page.getByRole("button", { name: "历史结果", exact: true }),
    ).toBeVisible();
    await capture(module + "-historical");
    if (module === "report")
      await expect(
        page.getByRole("button", { name: "生成客户计算书", exact: true }),
      ).toHaveCount(0);
  }
  await page.goto(base + target("report", selected, run, did));
  await expect(page.locator("iframe")).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出计算书", exact: true }).click();
  const downloaded = await pendingDownload;
  expect(await downloaded.failure()).toBe(null);
  await downloaded.saveAs(path.join(out, "selection-report.html"));
  await capture("report-export-ready");
  // A mismatched stored document must never enter the preview iframe.
  await page.goto(base + target("report", selected, run, "不存在的交付"));
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.goto(base + "/studies");
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "研究任务" })).toBeVisible();
  await capture("create-study-empty");
  await page.keyboard.press("Escape");
  for (const state of ["loading", "error", "empty"]) {
    if (state === "loading")
      faults.set("**/api/methods", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.continue();
      });
    else
      await fault(
        "**/api/methods",
        state === "empty" ? [] : { detail: "方法目录读取失败" },
        state === "empty" ? 200 : 503,
      );
    await go("/studies");
    await page.getByRole("button", { name: "新建研究", exact: true }).click();
    if (state === "loading")
      await expect(
        page.getByText("正在读取型号与方法", { exact: true }),
      ).toBeVisible();
    if (state === "error")
      await expect(page.getByRole("alert")).toContainText("方法目录读取失败");
    if (state === "empty")
      await expect(
        page.getByRole("heading", { name: "无可用型号或方法", exact: true }),
      ).toBeVisible();
    await capture("create-study-" + state);
    await page.keyboard.press("Escape");
    await clear();
  }
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await go(target("report", selected, run, did) + "&theme=" + theme);
      await expect(page.locator("iframe")).toBeVisible();
      await capture("report-preview-" + theme + "-" + width);
      await go("/studies?theme=" + theme);
      await page.getByRole("button", { name: "新建研究", exact: true }).click();
      await page
        .getByRole("combobox", { name: "研究任务", exact: true })
        .click();
      await page
        .getByRole("option", { name: "额定载流量", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "研究名称", exact: true })
        .fill("固定型号版本的额定研究");
      await page
        .getByRole("combobox", { name: "引用型号版本", exact: true })
        .click();
      await page.getByRole("option", { name: /YJL02-12\/20 kV 1×240/ }).click();
      await page
        .getByRole("combobox", { name: "计算方法", exact: true })
        .click();
      await page
        .getByRole("option", { name: /IEC.*稳态/ })
        .first()
        .click();
      await capture("create-study-ready-" + theme + "-" + width);
      await page.keyboard.press("Escape");
    }
  await page.setViewportSize({ width: 1366, height: 768 });
  await fault("**/api/workspaces/" + selected.wid + "/deliveries/" + did, {
    ...book,
    sources: [{ ...book.sources[0], run_id: historicalRun.id }],
  });
  await go(target("report", selected, run, did));
  await expect(page.getByRole("alert")).toContainText("计算书与所选运行不一致");
  await expect(page.locator("iframe")).toHaveCount(0);
  await clear();
  await fault(runPattern, {
    items: runs.map((item) =>
      item.id === run.id ? { ...item, integrity: "failed" } : item,
    ),
    next_cursor: null,
  });
  await go(target("selection"));
  await expect(page.getByRole("alert")).toContainText("运行完整性未通过");
  await expect(page.getByRole("table", { name: "真实选型候选" })).toHaveCount(
    0,
  );
  await clear();
  // Selected row uses shared fill/ink; property rows are exactly 32px.
  for (const theme of ["light", "dark"]) {
    await page.goto(base + target("selection") + "&theme=" + theme);
    await page
      .getByRole("row", { name: "选择 YJV22-8.7/15 kV 3×300", exact: true })
      .click();
    expect(
      await page
        .locator(".property-row")
        .evaluateAll((rows) =>
          rows.every((r) => r.getBoundingClientRect().height === 32),
        ),
    ).toBe(true);
    await capture("selection-selected-" + theme + "-1366");
  }
  // Read-only comparison with the required 8027 service, preserving its actual failures.
  for (const [route, name] of [
    ["/", "home"],
    ["/studies", "studies"],
    [target("selection"), "selection"],
    [target("report", selected, run, did), "report"],
  ]) {
    await page.goto(base + route);
    await settle(page);
    const own = await page.screenshot();
    const oldUrl =
      "http://127.0.0.1:8027/design/workbench/#" +
      (name === "home"
        ? "/"
        : name === "studies"
          ? "/studies"
          : "/studies/" +
            selected.id +
            "/" +
            name +
            (name === "selection" ? "/results" : "/preview"));
    await page.goto(oldUrl);
    await settle(page);
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    const original = await page.screenshot({
      path: path.join(out, name + "-8027.png"),
    });
    comparisons.push({ name, oldUrl, oldText: text.slice(0, 1500) });
    await page.evaluate(
      ({ own, original }) => {
        document.body.replaceChildren();
        const host = document.createElement("div");
        host.id = "comparison";
        host.style.cssText = "display:flex;width:2732px;background:#fff";
        for (const [label, data] of [
          ["样板 8027：实际运行现场", original],
          ["本次正式前端：真实保存数据", own],
        ]) {
          const figure = document.createElement("figure");
          figure.style.cssText = "margin:0;width:1366px";
          const caption = document.createElement("div");
          caption.style.cssText = "font:14px sans-serif;height:32px;color:#000";
          caption.textContent = label;
          const img = document.createElement("img");
          img.src = "data:image/png;base64," + data;
          img.style.cssText = "display:block;width:1366px;height:768px";
          figure.append(caption, img);
          host.append(figure);
        }
        document.body.append(host);
      },
      { own: own.toString("base64"), original: original.toString("base64") },
    );
    await page.setViewportSize({ width: 2732, height: 800 });
    await page
      .locator("#comparison img")
      .last()
      .evaluate((img) => img.decode());
    await page.screenshot({ path: path.join(out, name + "-comparison.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
  }
  await fs.writeFile(
    path.join(out, "states-verification.json"),
    JSON.stringify(
      {
        checks,
        comparisons,
        fixturePolicy:
          "仅注入空响应、延迟和读取错误；成功和历史数值均为已保存运行",
        reportPreview: "saved single current run verified",
        download: "formal integrity checked HTML saved",
        creationHistorical: "不适用：对话框引用固定版本，不展示运行结果",
      },
      null,
      2,
    ),
  );
  console.log(
    "迁移五态、真实计算书预览与下载、历史交付拒绝、8027并排截图通过。",
  );
} finally {
  await session.close();
}
