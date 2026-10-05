import test from "node:test";
import assert from "node:assert/strict";
import { niceAxis, tickPrecision } from "../src/lib/chart-axis.ts";
import { sweepSummary } from "../src/lib/sweep-summary.ts";
import {
  displayName,
  displayText,
  displayUnit,
} from "../src/lib/display-names.ts";
import { internalTokens } from "./visible-names.mjs";
test("工程刻度覆盖负数、常量和微小量；同轴精度一致", () => {
  assert.deepEqual(niceAxis(531, 648).ticks, [520, 560, 600, 640, 680]);
  for (const [low, high] of [
    [-9, -2],
    [0, 0],
    [1e-9, 8e-9],
    [1, 1],
  ]) {
    const axis = niceAxis(low, high);
    assert.ok(axis.low <= low && axis.high >= high && axis.high > axis.low);
    assert.ok(axis.ticks.every(Number.isFinite));
    assert.ok(axis.ticks.length <= 8);
  }
  assert.equal(tickPrecision([0.6, 0.8, 1]), 2);
});
test("端点差与手算一致，缺点或转折不编造趋势", () => {
  const points = [
    { x: 0.6, value: 648 },
    { x: 0.8, value: 590 },
    { x: 1, value: 531 },
  ];
  assert.match(
    sweepSummary(points, "土壤热阻率", "K*m/W", "ampacity", "A"),
    /0.1 K·m\/W 约降 29 A/,
  );
  assert.doesNotMatch(
    sweepSummary(
      [
        { x: 0.6, value: 648 },
        { x: 0.8, value: null },
        { x: 1, value: 531 },
      ],
      "土壤热阻率",
      "K*m/W",
      "ampacity",
      "A",
    ),
    /平均|约降/,
  );
  assert.match(
    sweepSummary(
      [
        { x: 0.6, value: 600 },
        { x: 0.8, value: 700 },
        { x: 1, value: 650 },
      ],
      "土壤热阻率",
      "K*m/W",
      "ampacity",
      "A",
    ),
    /转折/,
  );
});
test("显示名不改变内部身份；未知键让门禁继续报错", () => {
  assert.equal(displayName("ampacity"), "载流量");
  assert.equal(displayName("circuit/c1"), "回路 1");
  assert.equal(displayName("core/1"), "线芯 1");
  assert.equal(displayText("材料 material/cu"), "材料 铜");
  assert.equal(displayUnit("K*m/W"), "K·m/W");
  assert.deepEqual(
    internalTokens("GB/T 3956 K·m/W YJV22-8.7/15 kV 3×300 IEC 60287"),
    [],
  );
  for (const value of [
    "ampacity",
    "core/1",
    "material/cu",
    "unknown_field",
    "cablesim.iec60287",
  ])
    assert.ok(internalTokens(value).length);
  assert.ok(internalTokens(displayName("novel", "Novel parameter")).length);
});
