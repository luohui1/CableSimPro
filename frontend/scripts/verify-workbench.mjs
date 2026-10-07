import assert from "node:assert/strict";
import { expect as expectBase } from "@playwright/test";
import { openHeadlessBrowser, settle } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";

// 五区工作台的最小回归：工程首页与研究工作台用同一骨架；属性栏三页可切换；
// 工程内新建研究沿用工程模型并记录参数来源；深色主题生效；全程无页面错误。
if (process.env.E2E_ISOLATED !== "1") throw Error("仅在独立测试数据库验收");
const base = process.env.FRONTEND_URL, expect = expectBase.configure({ timeout: 20000 });
const session = await openHeadlessBrowser(), { page } = session, errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.setViewportSize({ width: 1366, height: 768 }); // 需求规定的最低可用尺寸
const go = async (route) => { await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 60000 }); await settle(page); };
const zones = async () => {
  await expect(page.getByRole("toolbar", { name: "工程命令" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "工程浏览器" })).toBeVisible();
  await expect(page.locator(".workbench-inspector")).toBeVisible();
  await expect(page.locator(".workbench-dock")).toBeVisible();
};

try {
  const types = new Set((await request(base, "/api/design/type-workspaces")).map((row) => row.id));
  const all = await request(base, "/api/workspaces");
  const projects = all.filter((row) => !types.has(row.id));
  const counted = await Promise.all(projects.map(async (row) => ({ row, studies: await request(base, `/api/workspaces/${row.id}/studies`) })));
  const { row: project, studies } = counted.sort((a, b) => b.studies.length - a.studies.length)[0];
  assert.ok(studies.length > 0, "演示库里应至少有一个带研究的工程");

  // 工程首页：五区齐全，数据区列出本工程全部研究
  await go(`/studies?workspace=${project.id}`);
  await zones();
  await expect(page.getByRole("table", { name: "本工程研究" }).locator("tbody tr")).toHaveCount(studies.length);

  // 研究工作台：同一骨架；属性栏 输入 / 方法 / Agent 三页
  await page.getByRole("table", { name: "本工程研究" }).locator("a.object-link").first().click();
  await page.waitForURL(/\/studies\/[^/?]+\/[^/?]+\/[^/?]+/);
  await settle(page);
  await zones();
  const tabs = page.getByRole("tablist", { name: "属性分页" });
  await tabs.getByRole("tab", { name: "Agent" }).click();
  await expect(page.locator(".inspector-agent .agent-panel-model")).toHaveText(/已连接|deepseek|服务尚未部署|未连接模型|检查中/);
  await tabs.getByRole("tab", { name: "输入" }).click();
  await expect(page.locator(".workbench-inspector").getByRole("heading", { name: "本次计算" })).toBeVisible();

  // 不带模块的分享链接只跳转一次到默认页签，页面不卡死
  await page.goto(`${base}/studies/${studies[0].id}?workspace=${project.id}`, { waitUntil: "commit", timeout: 60000 });
  await page.waitForURL(/\/studies\/[^/?]+\/[^/?]+\/[^/?]+/);
  await zones();

  // 工程内新建研究：不另建工程，参数来源写入研究
  await go(`/studies?workspace=${project.id}`);
  await page.getByRole("toolbar", { name: "工程命令" }).getByRole("button", { name: "新建研究" }).click();
  const dialog = page.getByRole("dialog", { name: "新建研究" });
  await dialog.getByRole("button", { name: "额定载流量" }).click();
  await dialog.getByLabel("研究名称").fill("回归 · 工程内新建研究");
  await dialog.getByRole("button", { name: "建立研究" }).click();
  await page.waitForURL(/inspector=method/, { timeout: 30000 });
  const after = await request(base, `/api/workspaces/${project.id}/studies`);
  assert.equal(after.length, studies.length + 1, "新研究应建在当前工程里");
  assert.equal((await request(base, "/api/workspaces")).length, all.length, "不应另建工程");
  const created = after.find((row) => row.definition.title === "回归 · 工程内新建研究");
  assert.ok(created, "应能按名称找到新研究");
  assert.equal(created.definition.input_sources["/parameters"].kind, "derived", "方法参数应记录沿用来源");
  await zones();

  // Agent 模式：左栏换成任务列表，中间是对话与输入栏；不再摆工具注册表
  await go(`/agent?workspace=${project.id}`);
  await expect(page.locator('[data-page="agent"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "新任务" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "要 Agent 做什么？" })).toBeVisible();
  await expect(page.getByLabel("给 Agent 的任务")).toBeEditable();
  await expect(page.getByText("可调用的工具")).toHaveCount(0);

  // 深色主题
  await go(`/studies?workspace=${project.id}&theme=dark`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");

  assert.deepEqual(errors, [], "页面不应抛出错误");
  console.log(`工作台回归通过：工程「${project.name || project.id}」${studies.length} 项研究，新建后 ${after.length} 项。`);
} finally {
  await session.close();
}
