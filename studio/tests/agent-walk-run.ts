// Walks Agent mode alone, with a scripted model: about two minutes instead of the full walk's ten.
//
//   npm run build && npm run walk:agent [output folder]
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createApp } from '../host/server.ts';
import { walkAgent } from './agent-walk.ts';
import { probe } from './layout-probe.ts';
import { scriptedModel } from './support.ts';

const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '.tmp', 'studio-agent-walk'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'cable-studio-agent-walk-'));
const model = await scriptedModel();
const app = createApp({ home, runtime: model.runtime });
await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const problems: string[] = [];
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || ['/usr/bin/google-chrome', chromium.executablePath()].find(existsSync);
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await walkAgent(browser, base, app, model.faux, out, probe, problems);
} finally {
  await browser?.close();
  await app.close();
  rmSync(home, { recursive: true, force: true });
}
console.log(`screenshots: ${out}`);
if (problems.length) {
  console.error([`${problems.length} problem(s):`, ...problems].join('\n'));
  process.exit(1);
}
console.log('Agent mode: 0 layout problems at 1366×768 and 1920×1080');
