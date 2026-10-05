import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowserFixture, navigate } from './browser-fixture.mjs';

const fixture = await createBrowserFixture(), { page } = fixture;
const output = path.resolve(import.meta.dirname, '../../../../../.data/frontend-type/drawings');
const result = { cases: [], screenshots: [], errors: fixture.errors };
await fs.mkdir(output, { recursive: true });
try {
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await navigate(fixture, 'cable-section', { theme }); await page.locator('[data-layer-number="3"] circle').click();
    const cable = await page.evaluate(() => {
      const rings = [...document.querySelectorAll('.drawing-ring')].map(node => node.getBoundingClientRect());
      const dimension = [...document.querySelectorAll('[data-cable-dimensions] text')].find(node => node.textContent.includes('本层外径')).getBoundingClientRect();
      return { ringBottom: Math.max(...rings.map(box => box.bottom)), labelTop: dimension.top };
    });
    assert.ok(cable.labelTop > cable.ringBottom, '直径数字须在整个外圈之外');
    const cableFile = path.join(output, `cable-section-${theme}-${width}.png`); await page.screenshot({ path: cableFile }); result.screenshots.push(cableFile);
    await navigate(fixture, 'laying-section', { theme }); await page.locator('[data-section-object="cable/cable/A"] .drawing-hit-area').click();
    const laying = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.drawing-dimension-chip rect')].map(node => node.getBoundingClientRect());
      const intersect = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const objectBoxes = [...document.querySelectorAll('.drawing-section-objects .drawing-text,.drawing-hit-area')].map(node => node.getBoundingClientRect());
      const objectCollisions = labels.flatMap((box, index) => objectBoxes.filter(other => intersect(box, other)).map(() => index));
      const labelCollisions = labels.flatMap((box, index) => labels.slice(index + 1).filter(other => intersect(box, other)).map(() => index));
      const paths = [...document.querySelectorAll('.drawing-dimensions path,.drawing-detail-leader')];
      const leaderCollisions = [];
      for (const path of paths) {
        const length = path.getTotalLength(), transform = path.getScreenCTM();
        for (let n = 0; n <= length; n += 2) {
          const point = path.getPointAtLength(n), screen = new DOMPoint(point.x, point.y).matrixTransform(transform);
          labels.forEach((box, index) => { if (screen.x > box.left - 2 && screen.x < box.right + 2 && screen.y > box.top - 2 && screen.y < box.bottom + 2) leaderCollisions.push(index); });
        }
      }
      return { labels: labels.length, objectCollisions, labelCollisions, leaderCollisions, detailLength: document.querySelector('.drawing-detail-leader')?.getTotalLength(), detailTitle: document.querySelector('.drawing-detail svg text')?.textContent };
    });
    assert.ok(laying.labels >= 2); assert.deepEqual(laying.objectCollisions, []); assert.deepEqual(laying.labelCollisions, []); assert.deepEqual(laying.leaderCollisions, []);
    assert.ok(laying.detailLength <= 20); assert.match(laying.detailTitle, /详图 A/);
    const layingFile = path.join(output, `laying-section-${theme}-${width}.png`); await page.screenshot({ path: layingFile }); result.screenshots.push(layingFile);
    result.cases.push({ width, theme, cable, laying });
  }
  assert.deepEqual(fixture.errors, []);
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); await page.screenshot({ path: path.join(output, 'dimensions-failure.png') }); process.exitCode = 1; }
finally { await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
