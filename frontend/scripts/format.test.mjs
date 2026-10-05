import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNumber,
  parameterUnit,
  engineeringQuantity,
} from "../src/lib/format.ts";
import { inspectStyles } from "./check-styles.mjs";

test("Motion 只允许从唯一封装入口导入", () => {
  const source = "import { motion } from 'motion/react';";
  assert.equal(inspectStyles(source, "src/pages/page.tsx").length, 1);
  assert.equal(inspectStyles(source, "src/components/motion.tsx").length, 0);
});

test("缺项与非有限值保持缺项，不编造零值", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity])
    assert.equal(formatNumber(value), "—");
  assert.equal(engineeringQuantity("current", null, "A").text, "—");
});
test("五位整数起分组，保留精度与负号", () => {
  assert.equal(formatNumber(9999, 1), "9999.0");
  assert.equal(formatNumber(12345.6, 1), "12 345.6");
  assert.equal(formatNumber(-1234567.89, 2), "−1 234 567.89");
  assert.equal(formatNumber(-0, 1), "0.0");
  assert.equal(formatNumber(0.0601, 4), "0.0601");
  assert.throws(() => formatNumber(1, 13), RangeError);
});
test("按展示物理量取精度，单位原样保留", () => {
  assert.equal(engineeringQuantity("current", 452, "A").text, "452.0");
  assert.equal(engineeringQuantity("temperature", 25, "°C").text, "25.0");
  assert.equal(engineeringQuantity("ratio", 13, "%").text, "13.0");
});

test("复合SI单位不截断为温度或长度，明确契约单位优先", () => {
  assert.equal(parameterUnit("k_w_m_k", {}), "W/(m·K)");
  assert.equal(parameterUnit("heat_capacity_j_kg_k", {}), "J/(kg·K)");
  assert.equal(parameterUnit("conductivity_s_m", {}), "S/m");
  assert.equal(parameterUnit("initial_temperature_k", {}), "K");
  assert.equal(
    parameterUnit("k_w_m_k", { "x-unit": "declared-unit" }),
    "declared-unit",
  );
  assert.equal(parameterUnit("unknown", {}), "—");
});
test("微小的非零结果保留数量级，真实零值与缺项不变", () => {
  assert.equal(engineeringQuantity("relative", 2.5e-10, "1").text, "2.50e−10");
  assert.equal(engineeringQuantity("relative", -2.5e-10, "1").text, "−2.50e−10");
  assert.equal(engineeringQuantity("relative", 0, "1").text, "0");
  assert.equal(engineeringQuantity("relative", null, "1").text, "—");
  assert.equal(engineeringQuantity("current", 531.1, "A").text, "531.1");
});
test("坐标按米或毫米显示工程精度，原始位置不变", () => {
  assert.equal(engineeringQuantity("coordinate", 0.0002, "m").text, "0.2");
  assert.equal(engineeringQuantity("coordinate", 0.0002, "m").unit, "mm");
  assert.equal(engineeringQuantity("coordinate", -0.854321, "m").text, "−0.85");
  assert.equal(engineeringQuantity("coordinate", -0.854321, "m").original, "-0.854321 m");
});
test("工程单位、有效数字和完整原始精度共用展示契约", () => {
  assert.equal(
    engineeringQuantity("ac_resistance", 0.0001, "ohm/m").unit,
    "Ω/km",
  );
  assert.equal(
    engineeringQuantity("ac_resistance", 0.0001, "ohm/m").text,
    "0.1000",
  );
  assert.equal(
    engineeringQuantity("capacitance", 3.135e-10, "F/m").text,
    "0.3135",
  );
  assert.equal(
    engineeringQuantity("inductance", 1.234e-7, "H/m").unit,
    "mH/km",
  );
  assert.equal(
    engineeringQuantity("losses.total", 10.5683, "W/m").text,
    "10.6",
  );
  assert.equal(
    engineeringQuantity("thermal_resistance.external", 1.23456, "K*m/W").text,
    "1.23",
  );
  assert.equal(engineeringQuantity("loss_factor.sheath", 0.05, "1").unit, "—");
  assert.equal(
    engineeringQuantity("losses.total", 10.5683, "W/m").original,
    "10.5683 W/m",
  );
});
test("绝对温度与温差分离，缺项不转换为零", () => {
  assert.equal(engineeringQuantity("diameter_rounding", 5e-5, "m").unit, "mm");
  assert.equal(engineeringQuantity("diameter_rounding", 5e-5, "m").value, 0.05);
  assert.equal(
    engineeringQuantity("conductor_temperature", 323.45, "K").text,
    "50.3",
  );
  assert.equal(engineeringQuantity("temperature_margin", 39.7, "K").unit, "K");
  assert.equal(
    engineeringQuantity("temperature_margin", 39.7, "K").text,
    "39.7",
  );
  assert.equal(
    engineeringQuantity("conductor_temperature", null, "K").text,
    "—",
  );
});
