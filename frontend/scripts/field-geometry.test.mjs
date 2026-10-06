import test from "node:test";
import assert from "node:assert/strict";
import { buildLocator, contourLevels, contourSegments, probe } from "../src/features/field/contours.ts";
import { turbo } from "../src/features/field/colormap.ts";

// 两个三角形拼成单位正方形，节点值 = x（线性场），用来核对插值与等值线位置。
const points = [[0, 0], [1, 0], [1, 1], [0, 1]];
const triangles = [[0, 1, 2], [0, 2, 3]];
const values = [0, 1, 1, 0];

test("等值线层级取 1/2/5 步长且落在开区间内", () => {
  assert.deepEqual(contourLevels(20, 90, 7), [30, 40, 50, 60, 70, 80]);
  assert.deepEqual(contourLevels(1, 1), []);
  for (const level of contourLevels(25.3, 87.8)) assert.ok(level > 25.3 && level < 87.8);
});

test("线性场的等值线位于 x = level", () => {
  const segments = contourSegments(points, triangles, values, 0.25);
  assert.ok(segments.length >= 2);
  for (const segment of segments) for (const [x] of segment) assert.ok(Math.abs(x - 0.25) < 1e-12);
});

test("取点按重心坐标插值，网格外返回 undefined", () => {
  const locator = buildLocator(points, triangles, 8);
  assert.ok(Math.abs(probe(locator, triangles, values, 0.3, 0.6) - 0.3) < 1e-12);
  assert.ok(Math.abs(probe(locator, triangles, values, 0.9, 0.1) - 0.9) < 1e-12);
  assert.equal(probe(locator, triangles, values, 1.5, 0.5), undefined);
});

test("色带由蓝经绿到红（低温蓝、中段绿黄、高温红），超出范围截断", () => {
  const [rLow, , bLow] = turbo(0.15), [, gMid] = turbo(0.5), [rHigh, gHigh, bHigh] = turbo(0.9);
  assert.ok(bLow > rLow);
  assert.ok(gMid > 0.9);
  assert.ok(rHigh > gHigh && rHigh > bHigh);
  assert.deepEqual(turbo(-1), turbo(0));
  assert.deepEqual(turbo(2), turbo(1));
});
