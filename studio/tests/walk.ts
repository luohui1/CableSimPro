// Hands-on walk: the real host, computing core and clicks. The rating workbench is walked on desktop (tests/rating-walk.ts,
// which also runs on its own), the product library at 1366×768, 1920×1080 and 390×844.
// Every step saves a screenshot and runs a layout probe (tests/probe.ts): no label on the drawing may overlap another label or
// the canvas frame, and no text may be cut off unless it ends in an ellipsis on purpose.
//
//   npm run build && npm run walk [output folder]
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../host/server.ts';
import { walkLibrary } from './library-walk.ts';
import { probe } from './probe.ts';
import { walkRating } from './rating-walk.ts';

const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '.tmp', 'studio-walk'));
mkdirSync(out, { recursive: true });
const home = mkdtempSync(join(tmpdir(), 'cable-studio-walk-'));
const app = createApp({ home, runtime: null });
await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

const problems: string[] = [];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  // The rating walk goes first: the library's walk stops at the first check that fails.
  await walkRating(browser, base, out, problems);
  await walkLibrary(browser, base, home, out, probe, problems);
} finally {
  await browser.close();
  await app.close();
  rmSync(home, { recursive: true, force: true });
}

console.log(`screenshots: ${out}`);
if (problems.length) {
  console.error(`${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('layout probe: 0 problems at 1366×768 and 1920×1080; product library also checked at 390×844');
