import { expect as playwrightExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";
import { currentSelection, request } from "./research-fixtures.mjs";
import { checkNativeTasks } from "./native-task-check.mjs";

if (process.env.E2E_ISOLATED !== "1") throw Error("研究验收只能使用临时数据库");
const base = process.env.FRONTEND_URL;
const out = path.join(outputRoot, "research");
await fs.mkdir(out, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 20000 });
const fixture = await currentSelection(base);
const selected = fixture.study;
const session = await openHeadlessBrowser();
const { page, context } = session;
const captures = [],
  checks = [],
  errors = [],
  writes = [];
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
  const match = [...faults].find(([value]) =>
    new URL(route.request().url()).pathname.endsWith(value),
  );
  return match ? match[1](route) : route.fallback();
});
const route = (study, module, tab, run = "", theme = "light", delivery = "") =>
  `/studies/${study.id}/${module}/${tab}?workspace=${study.workspace}&run=${run}&theme=${theme}&delivery=${delivery}`;
async function go(url) {
  const target = new URL(url, base);
  const oldInput = target.pathname.match(/^\/studies\/([^/]+)\/(cable|section|conditions)\/([^/]+)$/);
  if (oldInput) {
    target.pathname = `/studies/${oldInput[1]}`;
    target.searchParams.set('view', oldInput[2] === 'cable' ? 'cable' : 'section');
    target.searchParams.set('inspector', 'input');
  }
  await page.goto("about:blank");
  await page.goto(target.href);
  await settle(page);
  // The former input-page checks now exercise their real workbench controls.
  if (oldInput?.[3] === 'layers') await page.getByRole('button', { name: '分层参数', exact: true }).click();
  if (oldInput?.[3] === 'coordinates') await page.locator('.drawing-object[role="button"][data-section-object^="cable/"]').first().click();
  if (oldInput?.[3] === 'three-dimensional') await page.getByRole('button', { name: '三维', exact: true }).click();
}
async function capture(name) {
  if (/-ready-|-historical-|hotspot-selected/.test(name))
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
          (value) =>
            value.textContent.trim() &&
            value.getBoundingClientRect().height > 0,
        )
        .map((value) => parseFloat(getComputedStyle(value).fontSize)),
    ),
  }));
  expect(layout.overflow).toBe(false);
  expect(layout.minimum).toBeGreaterThanOrEqual(13);
  await page.screenshot({ path: path.join(out, name + ".png") });
  captures.push({ name, ...layout });
  console.log("研究截图 " + name);
}
const runPath = (study) =>
  `/api/workspaces/${study.workspace}/studies/${study.id}/runs`;
const workspacePath = `/api/workspaces/${selected.workspace}`;
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  // SI conversion, invalid raw text, module switching, source preservation, save/undo.
  await go(route(selected, "conditions", "inputs"));
  const temperature = page.getByRole("textbox", {
    name: "地表温度",
    exact: true,
  });
  await expect(temperature).toHaveValue("25.0");
  await temperature.fill("bad");
  await page.getByRole('button', { name: '电缆截面', exact: true }).click();
  await page.getByRole('button', { name: '敷设截面', exact: true }).click();
  await expect(temperature).toHaveValue("bad");
  const beforeInvalid = writes.length;
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert")).toContainText("有效数值");
  expect(writes.length).toBe(beforeInvalid);
  await temperature.fill("26.5");
  await temperature.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存工况", exact: true }),
  ).toHaveCount(0);
  let workspace = await request(base, workspacePath);
  expect(workspace.domain.sections[0].medium.surface_temperature).toBe(299.65);
  const source =
    workspace.domain.provenance[
      "/sections/section~1s1/medium/surface_temperature"
    ];
  expect(source.kind).toBe("user");
  expect(source.reviewed).toBe(false);
  await page.locator("h1").click();
  await page.keyboard.press("Control+z");
  await expect(temperature).toHaveValue("25.0");
  workspace = await request(base, workspacePath);
  expect(workspace.domain.sections[0].medium.surface_temperature).toBe(298.15);
  await temperature.fill("26.2");
  await page.locator(".topbar .status-mark").click();
  await page.getByRole("button", { name: "修改研究名称", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称", exact: true })
    .fill("临时同步保存工况与研究配置");
  await page.getByRole("button", { name: "保留草稿", exact: true }).click();
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "临时同步保存工况与研究配置",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await request(base, workspacePath)).domain.sections[0].medium
      .surface_temperature,
  ).toBeCloseTo(299.35, 10);
  await expect(
    page.getByRole("button", { name: "预检并运行", exact: true }),
  ).toBeEnabled();
  await page.locator("h1").click();
  await page.keyboard.press("Control+z");
  await expect(temperature).toHaveValue("25.0");
  checks.push(
    "工况非法草稿跨模块保留、无非法请求、Celsius/SI保存、工程师来源、服务端撤销",
  );

  await page.getByRole('button', { name: '分层参数', exact: true }).click();
  await expect(
    page.locator('[role="gridcell"][data-column-id="area"]').first(),
  ).toHaveAttribute("data-readonly", "true");
  await page.keyboard.press('Escape');
  checks.push("引用型号锁定字段只读");

  await page.getByRole('button', { name: '敷设截面', exact: true }).click();
  await page.locator('.drawing-object[role="button"][data-section-object^="cable/"]').first().click();
  const coordinate = page
    .getByRole("textbox", { name: "水平位置 x", exact: true })
    .first();
  const oldCoordinate = await coordinate.inputValue();
  await coordinate.fill("-0.3");
  await coordinate.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("alert")).toContainText("管内边界");
  await expect(coordinate).toHaveValue("-0.300");
  await coordinate.fill("-0.251");
  await coordinate.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存修改", exact: true }),
  ).toHaveCount(0);
  expect(
    (await request(base, workspacePath)).domain.sections[0].placements[0].x,
  ).toBe(-0.251);
  await page.locator("h1").click();
  await page.keyboard.press("Control+z");
  await expect(coordinate).toHaveValue(oldCoordinate);
  await page.getByRole('button', { name: '敷设截面', exact: true }).click();
  expect(
    await page.locator("[data-drawing-mount='laying-section']").count(),
  ).toBe(1);
  await expect(page.locator('.workbench-canvas svg').first()).toBeVisible();
  checks.push("坐标实际保存/撤销、真实敷设画布挂载");

  // Create one real IEC study through the product, then use its preflight and run controls.
  await go("/studies?theme=light");
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await page.getByRole("combobox", { name: "研究任务" }).click();
  await page.getByRole("option", { name: "额定载流量", exact: true }).click();
  await page
    .getByRole("textbox", { name: "研究名称" })
    .fill("临时 IEC 研究验收");
  await page.getByRole("combobox", { name: "引用型号版本" }).click();
  await page.getByRole("option", { name: /YJL02-12\/20 kV 1×240/ }).click();
  await page.getByRole("combobox", { name: "计算方法" }).click();
  await page
    .getByRole("option", { name: /IEC.*稳态/ })
    .first()
    .click();
  await page.getByRole("button", { name: "建立研究", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "临时 IEC 研究验收", exact: true }),
  ).toBeVisible();
  const createdUrl = new URL(page.url()),
    sid = createdUrl.pathname.split("/")[2],
    wid = createdUrl.searchParams.get("workspace");
  let rating = (await request(base, `/api/workspaces/${wid}/studies`)).find(
    (value) => value.id === sid,
  );
  await page.getByRole("tab", { name: "方法", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "方法版本", exact: true }),
  ).toBeVisible();
  await capture("ampacity-parameters-ready-light-1366");
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("运行前预检");
  await expect(page.getByRole("checkbox")).toBeEnabled();
  const changedWorkspace = await request(base, `/api/workspaces/${wid}`);
  const staleDocument = structuredClone(changedWorkspace.domain);
  staleDocument.sections[0].medium.surface_temperature += 0.1;
  await request(base, `/api/workspaces/${wid}/domain`, "PUT", {
    expected_revision: changedWorkspace.revision,
    document: staleDocument,
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认并运行", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    /修订|版本|变化/,
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "预检并运行", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认并运行", exact: true }).click();
  await expect(page.getByRole("table", { name: "研究物理量结果" })).toBeVisible(
    { timeout: 180000 },
  );
  const ratingRunId = new URL(page.url()).searchParams.get("run");
  const ratingRun = await request(
    base,
    `/api/workspaces/${wid}/studies/${sid}/runs/${ratingRunId}`,
  );
  expect(ratingRun.integrity).toBe("verified");
  expect(ratingRun.freshness).toBe("current");
  const submitted = writes.findLast((value) => value.url.endsWith("/runs"));
  expect(submitted.body.scope_acknowledged).toBe(true);
  expect(submitted.body.lock_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(submitted.body).sort()).toEqual(
    [
      "expected_revision",
      "expected_study_revision",
      "lock_digest",
      "request_id",
      "scope_acknowledged",
    ].sort(),
  );
  checks.push(
    "新建真实IEC研究、正式输入契约、预检范围确认、锁与修订绑定、实际运行数值",
  );
  await page.getByRole("link", { name: "计算书", exact: true }).click();
  await page
    .getByRole("button", { name: "生成客户计算书", exact: true })
    .click();
  await expect(page.getByTitle("计算书预览")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const file = await download;
  await file.saveAs(path.join(out, "ampacity-report.pdf"));
  expect(await file.failure()).toBe(null);
  checks.push("当前计算书生成、同次源摘要验证、实际保存客户版 PDF");
  await checkNativeTasks({ base, page, expect, go, capture });
  checks.push(
    "三项原生任务正式创建、方法契约读取、缺物理输入的预检拒绝；无原生运行请求",
  );

  const fields = {
    id: "5850a3d6-f42b-460d-a75e-4556828327d8",
    workspace: "91a3addc-13cd-4769-9ab7-ad97c0d57054",
  };
  const native = [
    {
      id: "cb4a240a-0c85-4a41-9ab9-99add51c02d2",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "transient",
      tab: "history",
      table: "保存暂态温度时间步",
    },
    {
      id: "f9fd1e08-a108-482f-af56-b12a6783bf69",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "sheath-losses",
      tab: "losses",
      table: "保存护套损耗系数",
    },
    {
      id: "ade9fa97-4d1b-4ddb-974e-3c77957b15e5",
      workspace: "688dbfb4-f8cb-419b-a2fc-4c1311bd5402",
      module: "electrothermal",
      tab: "convergence",
      table: "保存耦合迭代记录",
    },
  ];
  const pages = [
    [selected, "cable", "section"],
    [selected, "cable", "layers"],
    [selected, "cable", "references"],
    [selected, "conditions", "inputs"],
    [selected, "section", "section"],
    [selected, "section", "three-dimensional"],
    [selected, "section", "coordinates"],
    [selected, "section", "media"],
    [rating, "ampacity", "results"],
    [rating, "ampacity", "parameters"],
    [fields, "thermal-field", "field"],
    [fields, "thermal-field", "samples"],
    [fields, "thermal-field", "diagnostics"],
    [fields, "thermal-field", "convergence"],
    ...native.map((value) => [value, value.module, value.tab]),
  ];
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      for (const [study, module, tab] of pages) {
        await go(route(study, module, tab, "", theme));
        await expect(page.locator(".topbar h1")).toBeVisible();
        if (study === fields && tab === "field") {
          await expect(page.locator("canvas.temperature-plot")).toBeVisible();
          const colors = await page
            .locator("canvas.temperature-plot")
            .evaluate((canvas) => {
              const pixels = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              const set = new Set();
              for (let i = 0; i < pixels.length; i += 128)
                set.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
              return set.size;
            });
          expect(colors).toBeGreaterThan(20);
        }
        if (study.table)
          await expect(
            page.getByRole("table", { name: study.table }),
          ).toBeVisible();
        await capture(`${module}-${tab}-ready-${theme}-${width}`);
      }
    }
  checks.push("17个页面或页签：两种尺寸、浅深色、最小13px、文档无越界");

  // Five states: only suppress/delay/error reads. Saved successful/historical evidence stays unchanged.
  for (const [study, module, tab] of [
    [selected, "cable", "layers"],
    [selected, "conditions", "inputs"],
    [selected, "section", "coordinates"],
    [rating, "ampacity", "results"],
    [fields, "thermal-field", "field"],
    ...native.map((value) => [value, value.module, value.tab]),
  ]) {
    const input = ["cable", "conditions", "section"].includes(module);
    const endpoint = input
      ? `/api/workspaces/${study.workspace}`
      : runPath(study);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height });
        faults.set(endpoint, async (intercepted) => {
          const response = await intercepted.fetch();
          const body = await response.json();
          if (input) delete body.domain;
          else body.items = [];
          await intercepted.fulfill({ response, json: body });
        });
        await go(route(study, module, tab, "", theme));
        await expect(page.locator(".state-view:not([role])")).toBeVisible();
        await capture(`${module}-empty-${theme}-${width}`);
        faults.clear();
        faults.set(endpoint, async (intercepted) => {
          await page.waitForTimeout(1400);
          await intercepted.continue();
        });
        await page.goto("about:blank");
        await page.goto(base + route(study, module, tab, "", theme));
        await expect(
          page.locator(".state-view[aria-busy='true']"),
        ).toBeVisible();
        await capture(`${module}-loading-${theme}-${width}`);
        await page.waitForTimeout(1500);
        faults.clear();
        faults.set(endpoint, (intercepted) =>
          intercepted.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              detail: { code: "READ_UNAVAILABLE", message: "研究接口暂不可用" },
            }),
          }),
        );
        await go(route(study, module, tab, "", theme));
        await expect(page.getByRole("alert")).toBeVisible();
        await capture(`${module}-error-${theme}-${width}`);
        faults.clear();
        const saved = (await request(base, runPath(study))).items.findLast(
          (value) => value.integrity === "verified",
        );
        if (saved) {
          await go(route(study, module, tab, saved.id, theme));
          if (input)
            await expect(page.locator("input[readonly]").first()).toBeVisible();
          await capture(`${module}-historical-${theme}-${width}`);
        }
      }
  }
  checks.push("八个模块五态；历史数值来自不可变运行，固定输入只读");
  // History navigation and keyboard restore keep the fixed snapshot visible.
  await go(route(fields, "thermal-field", "samples"));
  await page.getByRole("row").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".workbench-inspector .inspector-block h2").first()).toBeVisible();
  await page.getByRole("tab", { name: "取样", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/thermal-field\/diagnostics/);
  await page.goBack();
  await expect(page).toHaveURL(/thermal-field\/samples/);
  await page.waitForLoadState("domcontentloaded");
  await page.reload();
  await expect(page.getByRole("table", { name: "保存温度取样" })).toBeVisible();
  checks.push("温度取样键盘选择、属性来源、页签键盘、后退和刷新");
  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await go(route(fields, "thermal-field", "field", "", theme));
      await page
        .getByRole("combobox", { name: "场图范围", exact: true })
        .click();
      await page
        .getByRole("option", { name: "热点 · 256×", exact: true })
        .click();
      await page.getByRole("button", { name: "选择热点", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".workbench-inspector .inspector-block h2").first()).toHaveText(
        "保存节点热点",
      );
      await capture(`thermal-field-hotspot-selected-${theme}-${width}`);
    }
  checks.push("温度场视图缩放、键盘热点选择与固定取样属性，浅深色及两种尺寸");
  expect(errors).toEqual([]);
  expect(
    writes
      .filter((value) => value.url.endsWith("/runs"))
      .every((value) => value.url.includes(`/studies/${sid}/`)),
  ).toBe(true);

  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(
      {
        checks,
        captures,
        errors,
        writes,
        fixturePolicy:
          "开发数据库只读复制；历史原生求解证据逐行原样复制；仅实际运行IEC；无本地原生求解、无新的原生求解run请求；宿主check预检可通过Slurm执行。",
        fieldState: "已保存原生结果成功展示；方法版本过期时保持历史状态",
        reportRun: ratingRunId,
      },
      null,
      2,
    ),
  );
  console.log(
    "研究迁移验收通过：表单保存/撤销、预检与真实IEC运行、报告生成与实际下载、温度场和原生工件、五态/尺寸/主题/键盘。 ",
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  await fs.writeFile(
    path.join(out, "failure.json"),
    JSON.stringify(
      {
        message: error.message,
        url: page.url(),
        body: await page.locator("body").innerText(),
        errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await session.close();
}
