import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const outputRoot = path.join(repositoryRoot, '.data', 'frontend-handoff');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function openHeadlessBrowser({ headed = false, executable: requestedExecutable } = {}) {
  const executable = requestedExecutable || process.env.BROWSER_EXECUTABLE || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', chromium.executablePath(),
  ].find(existsSync);
  if (!executable) throw new Error('未找到 Edge / Chrome；可设置 BROWSER_EXECUTABLE。');
  const scratchRoot = path.resolve(repositoryRoot, '.tmp', 'frontend');
  const profile = path.join(scratchRoot, `browser-profile-${randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const child = spawn(executable, [
    ...(!headed ? ['--headless=new'] : []), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', 'about:blank',
  ], { windowsHide: !headed, stdio: 'ignore' });
  let browser;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { /* Edge is starting. */ }
      if (port) break;
      await pause(200);
    }
    if (!port) throw new Error('浏览器 CDP 启动超时。');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if(process.env.E2E_ISOLATED==="1")await context.route('**/api/**',route=>{
      if(!['GET','HEAD','OPTIONS'].includes(route.request().method()) && new URL(route.request().url()).origin!==process.env.FRONTEND_URL)return route.abort('blockedbyclient');
      return route.fallback();
    });
    const page = await context.newPage();
    // This browser and all its tabs are task-owned, with an isolated profile.
    for (const initial of context.pages()) if (initial !== page) await initial.close();
    return { browser, context, page, close: async () => {
      for (const ownedPage of context.pages()) await ownedPage.close();
      console.log(`浏览器清理：剩余标签页 ${context.pages().length}。`);
      try {
        const cdp = await browser.newBrowserCDPSession();
        await Promise.race([cdp.send('Browser.close').catch(() => {}), pause(2000)]);
      } catch { /* A closed browser still owes profile cleanup. */ }
      await pause(800);
      if (child.exitCode === null) child.kill();
      // Verify the final absolute target stays inside the exact task scratch directory.
      if (!path.resolve(profile).startsWith(scratchRoot + path.sep)) throw new Error('拒绝删除工作区外的浏览器目录。');
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    } };
  } catch (error) {
    await browser?.close().catch(() => {});
    child.kill();
    if (path.resolve(profile).startsWith(scratchRoot + path.sep)) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    throw error;
  }
}

export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5000))]));
  await page.waitForTimeout(400);
}
