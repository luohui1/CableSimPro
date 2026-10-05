import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import path from "node:path";
import { openHeadlessBrowser, settle, outputRoot } from "./browser.mjs";
import { request } from "./research-fixtures.mjs";
import { assertLayout } from "./layout-assertions.mjs";
if (process.env.E2E_ISOLATED !== "1") throw Error("只允许隔离数据库");
const base = process.env.FRONTEND_URL,
  session = await openHeadlessBrowser(),
  { page } = session,
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function select(label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function axis(levels = '2') {
  await page.getByRole("combobox", { name: "基准参数", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "土壤" }).first().click();
  await page.getByRole("button", { name: "添加参数" }).click();
  await page.getByRole("textbox", { name: "下限", exact: true }).fill("0.6");
  await page.getByRole("textbox", { name: "上限", exact: true }).fill("1.0");
  await page.getByRole('textbox', { name: '网格点数', exact: true }).fill(levels);
  await page
    .getByRole("textbox", { name: "范围来源", exact: true })
    .fill("隔离UI验收，未审核");
  await page
    .getByRole("textbox", { name: "参数空间出处", exact: true })
    .fill("选择固定基准验证；不运行求解器");
  await page.getByRole("button", { name: "保存批量配置" }).click();
  await expect(page.getByRole("button", { name: "预检批量" })).toBeVisible();
  await expect(page.locator('.number-input.is-dirty')).toHaveCount(0);
}
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base + "/library/reproductions/E02/results");
  await settle(page);
  await expect(page.getByRole("combobox", { name: "记录版本" })).toContainText(
    "当前记录",
  );
  await page.getByRole("combobox", { name: "记录版本" }).click();
  await page.getByRole("option").filter({ hasText: "历史 ·" }).first().click();
  await expect(
    page.locator('[data-page="reproduction-detail"]'),
  ).toHaveAttribute("data-state", "historical");
  await select("记录版本", "当前记录");
  await expect(
    page.locator('[data-page="reproduction-detail"]'),
  ).toHaveAttribute("data-state", "success");
  await page.screenshot({
    path: path.join(outputRoot, "expansion/reproduction-detail.png"),
  });
  const models = await request(base, "/api/design/study-cable-models"),
    model = models.find((v) => v.id === "system.cu-xlpe-al-240"),
    contracts = await request(base, "/api/input-contracts"),
    pin = contracts.find(
      (v) =>
        v.method.plugin_id === "cablesim.iec60287" &&
        v.method.capability === "steady-rating",
    ).method;
  const ws = await request(base, "/api/design/study-workspaces", "POST", {
    model_id: model.id,
    content_sha256: model.content_sha256,
  });
  const study = await request(
    base,
    "/api/workspaces/" + ws.id + "/studies",
    "POST",
    {
      title: "批量根基准验收",
      task: "rating",
      method: pin,
      input_source: "domain",
      parameters: model.method_defaults[pin.plugin_id],
      driver: { kind: "single" },
      expected_revision: ws.revision,
    },
  );
  const { modules: _modules, ...module } = study.definition;
  void _modules;
  const current = await request(base, "/api/workspaces/" + ws.id);
  await request(
    base,
    "/api/workspaces/" + ws.id + "/studies/" + study.id,
    "PUT",
    {
      ...study.definition,
      modules: { ampacity: { ...module, title: "模块基准验收" } },
      expected_revision: current.revision,
      expected_study_revision: study.revision,
    },
  );
  await page.goto(
    base + "/studies/" + study.id + "/batch/space?workspace=" + ws.id,
  );
  await settle(page);
  await select("基准模块", "模块基准验收");
  await axis();
  let config = await request(
    base,
    "/api/workspaces/" +
      ws.id +
      "/studies/" +
      study.id +
      "/batch-configuration",
  );
  assert.equal(config.configuration.definition.source_module, "ampacity");
  await select("基准模块", "批量根基准验收");
  await select('采样方式', '网格');
  await axis('4');
  config = await request(
    base,
    "/api/workspaces/" +
      ws.id +
      "/studies/" +
      study.id +
      "/batch-configuration",
  );
  assert.equal(config.configuration.definition.source_module, null);
  assert.equal(config.configuration.definition.parameter_space.sample_count, 4);
  await expect(page.getByRole('textbox', { name: '样本数', exact: true })).toHaveValue('4');
  assert.equal(config.configuration.definition.execution.backend, "slurm");
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
      await assertLayout(page, "batch-baseline");
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: path.join(outputRoot, "expansion/batch-space.png"),
  });
  await page.getByRole('link', { name: '参数扫描', exact: true }).click();
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('textbox', { name: '起点', exact: true }).fill('0.6');
  await page.getByRole('textbox', { name: '终点', exact: true }).fill('1.0');
  await page.getByRole('textbox', { name: '步长', exact: true }).fill('0.2');
  await page.getByRole('textbox', { name: '范围出处', exact: true }).fill('隔离前端范围验收，未审核');
  await page.getByRole('button', { name: '应用扫描设置', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toHaveCount(0);
  await expect(page.locator('.number-input.is-dirty')).toHaveCount(0);
  let savedRun, fieldRun;
  for (const workspace of await request(base, '/api/workspaces')) {
    for (const item of await request(base, '/api/workspaces/' + workspace.id + '/studies')) {
      const runs = (await request(base, '/api/workspaces/' + workspace.id + '/studies/' + item.id + '/runs')).items;
      const run = runs.find(value => value.integrity === 'verified' && ['succeeded', 'partial'].includes(value.status));
      if (run && !savedRun) savedRun = { workspace, study: item, run };
      const field = runs.find(value => value.integrity === 'verified' && JSON.stringify(value.output).includes('x-cablesim.temperature-field'));
      if (field && !fieldRun) fieldRun = { workspace, study: item, run: field };
      if (savedRun && fieldRun) break;
    }
    if (savedRun && fieldRun) break;
  }
  assert.ok(savedRun, '缺少可读取的既有运行快照');
  await page.goto(base + '/studies/' + savedRun.study.id + '/batch/space?workspace=' + savedRun.workspace.id + '&run=' + savedRun.run.id);
  await expect(page.getByText('该运行未保存批量配置')).toBeVisible();
  await assertLayout(page, 'batch-fixed-run-missing-configuration');
  assert.ok(fieldRun, '缺少可读取的既有温度场工件');
  await page.goto(base + '/studies/' + fieldRun.study.id + '/thermal-field/field?workspace=' + fieldRun.workspace.id + '&run=' + fieldRun.run.id);
  await expect(page.locator('.conclusion')).toContainText('最高温度');
  await expect(page.getByRole('combobox', { name: '场图范围' })).toContainText('电缆周围');
  assert.ok(await page.locator('canvas').evaluate(canvas => canvas.toDataURL().length > 2000));
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(size);
    for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await assertLayout(page,'saved-temperature-field');}
  }
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForTimeout(150);
  await page.screenshot({path:path.join(outputRoot,'expansion/temperature.png')});
  assert.deepEqual(errors, []);
  console.log(
    "复现当前/历史、批量基准/网格/保存态、扫描保存、历史缺项和保存温度场断言通过；求解器提交0。",
  );
} finally {
  await session.close();
}
