import { displayUnit } from './display-names.ts';
export function formatNumber(
  value: number | null | undefined,
  precision = 0,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (!Number.isInteger(precision) || precision < 0 || precision > 12)
    throw new RangeError("显示精度须为 0–12");
  const [integer, decimal] = (Object.is(value, -0) ? 0 : value)
    .toFixed(precision)
    .split(".");
  const sign = integer.startsWith("-") ? "−" : "";
  const digits = integer.replace("-", "");
  const grouped =
    digits.length >= 5 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : digits;
  return sign + grouped + (decimal === undefined ? "" : "." + decimal);
}

export function parameterUnit(
  key: string,
  field: Record<string, unknown>,
): string {
  for (const name of ["unit", "x-unit"])
    if (typeof field[name] === "string" && field[name]) return field[name];
  const suffixes: [string, string][] = [
    ["_w_m2_k", "W/(m²·K)"],
    ["_w_m_k", "W/(m·K)"],
    ["_j_m3_k", "J/(m³·K)"],
    ["_j_kg_k", "J/(kg·K)"],
    ["_kg_m3", "kg/m³"],
    ["_w_m3", "W/m³"],
    ["_w_m2", "W/m²"],
    ["_ohm_per_m", "Ω/m"],
    ["_ohm_m", "Ω·m"],
    ["_s_m", "S/m"],
    ["_w_m", "W/m"],
    ["_per_k", "1/K"],
    ["_c", "°C"],
    ["_k", "K"],
    ["_a", "A"],
    ["_m", "m"],
    ["_s", "s"],
  ];
  for (const [suffix, unit] of suffixes) if (key.endsWith(suffix)) return unit;
  if (
    field.type === "integer" ||
    (typeof field.description === "string" &&
      field.description.includes("Dimensionless"))
  )
    return "1";
  return "—";
}

export type EngineeringPresentation = {
  value: number | null;
  text: string;
  unit: string;
  original: string;
  complete: string;
  scale: number;
  offset: number;
};

const SUPERSCRIPT: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export function significantNumber(
  value: number | null | undefined,
  digits = 3,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(digits));
  const exponent = Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= 7) {
    // 工程写法 a × 10ⁿ，不用程序式的 e 记数
    const [mantissa, power] = rounded.toExponential(digits - 1).split("e");
    return `${mantissa.replace("-", "−")} × 10${power.replace("+", "").split("").map((c) => SUPERSCRIPT[c] ?? c).join("")}`;
  }
  return formatNumber(rounded, Math.max(0, digits - 1 - exponent));
}

/** Unit conversion and presentation only; saved engineering values remain unchanged. */
export function engineeringQuantity(
  key: string,
  raw: number | null | undefined,
  sourceUnit: string,
): EngineeringPresentation {
  const originalUnit = sourceUnit;
  let unit = displayUnit(sourceUnit);
  let scale = 1,
    offset = 0;
  if (unit === "Ω/m") {
    scale = 1000;
    unit = "Ω/km";
  } else if (unit === "F/m") {
    scale = 1e9;
    unit = "μF/km";
  } else if (unit === "H/m") {
    scale = 1e6;
    unit = "mH/km";
  } else if (unit === "m" && (/(?:diameter|thickness|radius)/i.test(key) || /coordinate/.test(key) && raw != null && Math.abs(raw) > 0 && Math.abs(raw) < 0.01)) {
    scale = 1000;
    unit = "mm";
  } else if (
    unit === "K" &&
    !/(?:rise|residual|update|difference|tolerance|change|margin|headroom|delta)/i.test(
      key,
    )
  ) {
    offset = -273.15;
    unit = "°C";
  } else if (unit === "1" || unit === "dimensionless" || !unit) unit = "—";
  const value =
    raw == null || !Number.isFinite(raw) ? null : raw * scale + offset;
  const text =
    /coordinate/.test(key) && unit === "mm"
      ? formatNumber(value, 1)
      : unit === "m" && /coordinate/.test(key)
      ? formatNumber(value, 2)
      // 差值不足 1 时按有效数字显示：0.03 A 的差不能显示成 0.0
      : /difference|delta/i.test(key) && value !== null && value !== 0 && Math.abs(value) < 1
      ? significantNumber(value, 2)
      : unit === "°C" || unit === "A" || unit === "%"
      ? formatNumber(value, 1)
      : significantNumber(
          value,
          ["Ω/km", "μF/km", "mH/km"].includes(unit) ? 4 : 3,
        );
  return {
    value,
    text,
    unit,
    scale,
    offset,
    original:
      raw == null || !Number.isFinite(raw)
        ? "未提供"
        : `${raw.toString()} ${originalUnit || "单位未提供"}`,
    complete:
      value === null
        ? "未提供"
        : `${value.toString()}${unit === "—" ? "" : " " + unit}`,
  };
}

export function engineeringInputPrecision(
  key: string,
  value: number | null | undefined,
  unit: string,
): number {
  const display = engineeringQuantity(key, value, unit);
  if (["°C", "A", "%"].includes(display.unit)) return 1;
  if (display.value === null || display.value === 0) return 3;
  const digits = ["Ω/km", "μF/km", "mH/km"].includes(display.unit) ? 4 : 3;
  return Math.min(
    12,
    Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(display.value)))),
  );
}
