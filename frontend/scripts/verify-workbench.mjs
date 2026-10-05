import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { openHeadlessBrowser, settle } from './browser.mjs';

// Use the existing isolated database/CDP lifecycle, never a live engineering service.
if (process.env.E2E_ISOLATED !== '1' || !process.env.FRONTEND_URL) {
  throw new Error('请使用 npm run test:workbench-browser，禁止直接连接开发服务。');
}
const origin = new URL(process.env.FRONTEND_URL);
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') {
  throw new Error('验收只允许临时本机服务。');
}
const session = await openHeadlessBrowser();
const { page, context } = session;
const errors = [];
const writes = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    writes.push(`${request.method()} ${request.url()}`);
  }
});
try {
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.goto(new URL(`/?theme=${theme}`, origin).href);
      await settle(page);
      await expect(page.locator('.workbench-shell')).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const launcher = page.getByRole('button', { name: '快速导航', exact: true });
      await launcher.click();
      const input = page.getByRole('searchbox', { name: '搜索工作区' });
      await expect(input).toBeFocused();
      await input.fill('ｍｏｄｅｌ');
      await expect(page.locator('.wb-command-result')).toHaveCount(1);
      await expect(page.locator('.wb-command-result')).toContainText('型号');
      await input.fill('没有这样的入口');
      await expect(page.locator('.wb-command-result')).toHaveCount(0);
      await expect(page.locator('.wb-command-count')).toHaveText('没有匹配入口');
      await page.keyboard.press('Escape');
      await expect(launcher).toBeFocused();
      console.log(`工作台布局与导航对话框：${width}×${height} / ${theme}`);
    }
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true })));
  await expect(page.locator('[role="dialog"][data-state="open"]')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('searchbox', { name: '搜索工作区' });
  await input.fill('研究');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.wb-command-result').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/studies(?:\?|$)/);
  await expect(page.getByRole('heading', { name: '研究', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收起模块导航', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开模块导航', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.module-sidebar')).toBeHidden();
  await page.reload();
  await expect(page.locator('.module-sidebar')).toBeHidden();
  await page.getByRole('button', { name: '展开模块导航', exact: true }).click();
  await expect(page.locator('.module-sidebar')).toBeVisible();
  await context.setOffline(true);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox', { name: '搜索工作区' })).toBeVisible();
  await page.keyboard.press('Escape');
  assert.deepEqual(writes, [], '导航、主题和侧栏操作不得触发工程写入或计算');
  assert.deepEqual(errors, [], '浏览器不能出现未处理的运行错误');
  console.log('通过：输入法、搜索、键盘导航、焦点恢复、侧栏持久化、离线菜单及零工程写入。');
} finally {
  await context.setOffline(false).catch(() => {});
  await session.close();
}
