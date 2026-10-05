import { request } from "./research-fixtures.mjs";

export async function checkNativeTasks({ base, page, expect, go, capture }) {
  const checks = [];
  for (const [label, module, sourceId] of [
    ["暂态温升", "transient", "cb4a240a-0c85-4a41-9ab9-99add51c02d2"],
    ["护套损耗", "sheath-losses", "f9fd1e08-a108-482f-af56-b12a6783bf69"],
    ["电热耦合", "electrothermal", "ade9fa97-4d1b-4ddb-974e-3c77957b15e5"],
  ]) {
    await go("/studies?theme=light");
    await page.getByRole("button", { name: "新建研究", exact: true }).click();
    await page.getByRole("combobox", { name: "研究任务" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page
      .getByRole("textbox", { name: "研究名称" })
      .fill("临时" + label + "任务验收");
    await page.getByRole("combobox", { name: "引用型号版本" }).click();
    await page.getByRole("option", { name: /YJL02-12\/20 kV 1×240/ }).click();
    await page.getByRole("combobox", { name: "计算方法" }).click();
    await page.getByRole("option").first().click();
    const fixture = (
      await request(
        base,
        "/api/workspaces/688dbfb4-f8cb-419b-a2fc-4c1311bd5402/studies",
      )
    ).find((value) => value.id === sourceId);
    const parameters = page.getByRole("textbox", {
      name: "方法参数 / SI",
      exact: true,
    });
    await parameters.fill(
      JSON.stringify(fixture.definition.parameters, null, 2),
    );
    await page.getByRole("button", { name: "建立研究", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/" + module + "/results"));
    await page.getByRole("tab", { name: "方法参数", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "方法版本", exact: true }),
    ).toBeVisible();
    if (module === "electrothermal") {
      const conductivity = page
        .locator(".number-field")
        .filter({
          has: page.getByRole("textbox", { name: "热导率", exact: true }),
        })
        .first();
      await expect(conductivity.locator(".unit")).toHaveText("W/(m·K)");
    }
    const response = page.waitForResponse(
      (value) => new URL(value.url()).pathname.endsWith("/preflight"),
      { timeout: 180000 },
    );
    await page.getByRole("button", { name: "预检并运行", exact: true }).click();
    const preflight = await response;
    const data = await preflight.json();
    expect([200, 422]).toContain(preflight.status());
    if (preflight.status() === 200) expect(data.ready).toBe(false);
    else expect(data.detail).toBeTruthy();
    await expect(
      page.getByRole("dialog").locator(".state-view[aria-busy='true']"),
    ).toHaveCount(0, { timeout: 180000 });
    await expect(
      page.getByRole("button", { name: "确认并运行", exact: true }),
    ).toBeDisabled();
    await capture(module + "-preflight-missing-input-light-1366");
    checks.push({
      module,
      status: preflight.status(),
      ready: data.ready ?? false,
      inputRejected: true,
    });
    await page.keyboard.press("Escape");
  }
  return checks;
}
