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
import { matchingFieldPath, pointerParts } from '../src/lib/missing-input.ts';
import { requestErrorPointer, requestFieldMatch } from '../src/features/documents/request-fields.ts';
test('资料请求按完整路径定位，不混淆同名字段或数组元素', () => {
  assert.equal(requestErrorPointer({loc:['body','new_model','u0_v']}), '/new_model/u0_v');
  assert.equal(requestErrorPointer({loc:['body','selections',2,'region',0]}), '/selections/2/region/0');
  assert.equal(requestErrorPointer({loc:['body','a/b','c~d']}), '/a~1b/c~0d');
  assert.equal(requestFieldMatch('/new_model/name', ['/model/name','/new_model','/new_model/name']), '/new_model/name');
  assert.equal(requestFieldMatch('/selections/2/region/0', ['/selections','/selections/0','/selections/2']), '/selections/2');
  assert.equal(requestFieldMatch('/selections/2/page', ['/selections/0/page','/selections/1/page']), undefined);
});
test('预检位置按 RFC6901 解码，区分数组下标并支持方法参数根', () => {
  assert.deepEqual(pointerParts('/load_cases/0/currents/circuit~1c1'), ['load_cases', '0', 'currents', 'circuit/c1']);
  assert.deepEqual(pointerParts('/a~0b/c~1d'), ['a~b', 'c/d']);
  assert.equal(matchingFieldPath('/parameters/values/core_lay_length', ['/values/core_lay_length']), '/values/core_lay_length');
  assert.equal(matchingFieldPath('/load_cases/1/currents/circuit~1c1', ['/load_cases/0/currents/circuit~1c1']), undefined);
  assert.equal(matchingFieldPath('缺少 core_lay_length', ['/values/core_lay_length']), undefined);
  const input = {load_cases:[{id:'load/base',currents:{'circuit/c1':500}}]};
  assert.equal(matchingFieldPath('/load_cases/0/currents/circuit~1c1', ['/load_cases/load~1base/currents/circuit~1c1'], input), '/load_cases/load~1base/currents/circuit~1c1');
});
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
    /结果非单调\/突变，请检查/,
  );
});
test("突变不被平均值掩盖；按间距归一化并覆盖平段和零值", () => {
  const summary = (values) =>
    sweepSummary(values, "土壤热阻率", "K*m/W", "ampacity", "A");
  const anomaly = summary([
    { x: 0.6, value: 451.9 },
    { x: 0.8, value: 376.4 },
    { x: 1, value: 181.3 },
  ]);
  assert.match(anomaly, /结果非单调\/突变，请检查/);
  assert.doesNotMatch(anomaly, /平均|约降/);
  // Hand check: 10% / 0.1 == 20% / 0.2, despite unequal intervals.
  assert.match(
    summary([
      { x: 0, value: 100 },
      { x: 0.1, value: 90 },
      { x: 0.3, value: 72 },
    ]),
    /平均/,
  );
  assert.match(
    summary([
      { x: 0, value: 100 },
      { x: 1, value: 100 },
      { x: 2, value: 50 },
    ]),
    /请检查/,
  );
  assert.match(
    summary([
      { x: 0, value: 0 },
      { x: 1, value: 0 },
      { x: 2, value: 0 },
    ]),
    /保持不变/,
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
