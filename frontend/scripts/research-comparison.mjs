import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessBrowser, outputRoot, settle } from "./browser.mjs";

export async function captureResearchComparisons(page, comparisons) {
  const out = path.join(outputRoot, "research");
  const tabs = {
    cable: "layers",
    conditions: "inputs",
    section: "coordinates",
    ampacity: "results",
    "thermal-field": "field",
    transient: "history",
    "sheath-losses": "losses",
    electrothermal: "convergence",
  };
  for (const item of comparisons) {
    const ownCapture = `${item.module}-${tabs[item.module]}-ready-light-1366.png`;
    const own = await fs.readFile(path.join(out, ownCapture));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("about:blank");
    await page.goto(item.oldUrl);
    await settle(page);
    await page.waitForTimeout(1000);
    item.oldText = (await page.locator("body").innerText()).slice(0, 500);
    item.ownCapture = ownCapture;
    const original = await page.screenshot();
    await page.setContent(
      `<html><body style="margin:0;font:14px sans-serif"><div style="display:flex">${[
        ["8027 样板实际现场", original],
        ["正式前端已验收的输入 / 结果", own],
      ]
        .map(
          ([caption, image]) =>
            `<figure style="margin:0;width:1366px"><figcaption style="height:32px">${caption}</figcaption><img width="1366" height="768" src="data:image/png;base64,${image.toString("base64")}"></figure>`,
        )
        .join("")}</div></body></html>`,
    );
    await page.setViewportSize({ width: 2732, height: 800 });
    await page
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(images.map((image) => image.decode())),
      );
    await page.screenshot({
      path: path.join(out, item.module + "-comparison.png"),
    });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const filename = path.join(outputRoot, "research", "verification.json");
  const report = JSON.parse(await fs.readFile(filename, "utf8"));
  const session = await openHeadlessBrowser();
  try {
    await session.context.route("**/api/**", (route) =>
      ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
    await captureResearchComparisons(session.page, report.comparisons);
    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    console.log("八个研究模块并排图已生成；正式侧采用本轮已验收的成功截图。");
  } finally {
    await session.close();
  }
}
