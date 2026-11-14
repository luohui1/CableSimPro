// The temperature ramp: the six --temperature-* tokens, interpolated in OKLab so that equal
// temperature steps look like equal colour steps. One lookup table feeds the GPU field and the SVG fills.

type Triple = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgb([L, a, b]: Triple): Triple {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function parse(colour: string): Triple {
  const hex = colour.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`温度色阶的颜色不是六位十六进制值：${colour}`);
  return [0, 2, 4].map(at => toLinear(Number.parseInt(hex.slice(at, at + 2), 16) / 255)) as Triple;
}

export const RAMP_SIZE = 256;

/** How far the soil tint is pulled toward the paper tone. Solid objects keep the full ramp. */
const SOIL_SOFTENING = 0.3;

export interface Ramp {
  /** RGBA bytes in sRGB, RAMP_SIZE entries, from the ambient temperature to the conductor limit: the soil tint. */
  fieldBytes: Uint8Array<ArrayBuffer>;
  /** CSS colour of the soil tint at a position. The same hues as `css`, lighter, so a large area stays calm. */
  field: (position: number) => string;
  /** CSS colour for a position between 0 (ambient) and 1 (limit), at full strength: conductors, meters. */
  css: (position: number) => string;
}

/** Reads the ramp tokens from the document, so that a theme change gives a new ramp. */
export function readRamp(): Ramp {
  const style = getComputedStyle(document.documentElement);
  const stops = [1, 2, 3, 4, 5, 6].map(index => oklab(parse(style.getPropertyValue(`--temperature-${index}`))));
  const bytes = new Uint8Array(RAMP_SIZE * 4);
  const fieldBytes = new Uint8Array(RAMP_SIZE * 4);
  const write = (target: Uint8Array, index: number, colour: Triple) => {
    linearRgb(colour).forEach((channel, offset) => {
      target[index * 4 + offset] = Math.round(toGamma(Math.max(0, Math.min(1, channel))) * 255);
    });
    target[index * 4 + 3] = 255;
  };
  for (let index = 0; index < RAMP_SIZE; index += 1) {
    const at = (index / (RAMP_SIZE - 1)) * (stops.length - 1);
    const lower = Math.min(stops.length - 2, Math.floor(at));
    const t = at - lower;
    const mixed = stops[lower].map((value, channel) => value + (stops[lower + 1][channel] - value) * t) as Triple;
    write(bytes, index, mixed);
    write(fieldBytes, index, mixed.map((value, channel) => value + (stops[0][channel] - value) * SOIL_SOFTENING) as Triple);
  }
  const slot = (position: number) => Math.round(Math.max(0, Math.min(1, position)) * (RAMP_SIZE - 1));
  const colour = (source: Uint8Array) => (position: number) => {
    const at = slot(position) * 4;
    return `rgb(${source[at]} ${source[at + 1]} ${source[at + 2]})`;
  };
  return { fieldBytes, field: colour(fieldBytes), css: colour(bytes) };
}

/** Position of a temperature on the ramp: 0 at the ambient temperature, 1 at the conductor limit. */
export const rampPosition = (temperature: number, ambient: number, limit: number) =>
  Math.max(0, Math.min(1, (temperature - ambient) / Math.max(1, limit - ambient)));
