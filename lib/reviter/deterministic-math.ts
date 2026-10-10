/** Platform-independent replacements for the implementation-approximated Math
 * functions used by compiled indoor geometry.
 *
 * ECMAScript leaves Math.sin/cos/atan/atan2/acos/hypot (and exp/log/pow/...)
 * implementation-approximated. Engines and CPU/OS builds of one engine can
 * differ in the last ulp (for example FMA contraction in the C++ libm port on
 * arm64 versus x64), and the exact native room-area derivation is sensitive to
 * last-ulp changes in wall vertices. Basic IEEE arithmetic (+ - * /, sqrt,
 * abs) is exactly specified and JavaScript forbids contraction, so the
 * functions below return bit-identical results on every conforming runtime.
 *
 * - sin, cos, atan, atan2 are ports of FreeBSD msun (fdlibm), within 1 ulp of
 *   the true value. sin/cos accept |x| < 2^20 * pi/2 (Cody-Waite reduction);
 *   larger finite arguments throw instead of silently losing determinism.
 * - acos is atan2(sqrt((1 - x)(1 + x)), x), within a few ulps.
 * - hypot reproduces V8's Math.hypot algorithm (scale by the largest
 *   magnitude, Kahan-compensated sum of squares, sqrt), so on V8 it is
 *   bit-identical to Math.hypot while staying exact-arithmetic-only elsewhere.
 *
 * Special values follow ECMAScript (NaN, +-Infinity, +-0).
 */
const view = new DataView(new ArrayBuffer(8));
const highWord = (x: number) => {
  view.setFloat64(0, x);
  return view.getInt32(0);
};
const exponentOf = (x: number) => (highWord(x) >> 20) & 0x7_ff;

const S1 = -0.166_666_666_666_666_32,
  S2 = 0.008_333_333_333_322_49,
  S3 = -0.000_198_412_698_298_579_5,
  S4 = 0.000_002_755_731_370_707_006_8,
  S5 = -2.505_076_025_340_686_3e-8,
  S6 = 1.589_690_995_211_55e-10;
function kernelSin(x: number, y: number, iy: 0 | 1): number {
  const z = x * x,
    v = z * x,
    r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0
    ? x + v * (S1 + z * r)
    : x - (z * (0.5 * y - v * r) - y - v * S1);
}
const C1 = 0.041_666_666_666_666_6,
  C2 = -0.001_388_888_888_887_411,
  C3 = 0.000_024_801_587_289_476_73,
  C4 = -2.755_731_435_139_066_3e-7,
  C5 = 2.087_572_321_298_175e-9,
  C6 = -1.135_964_755_778_819_5e-11;
function kernelCos(x: number, y: number): number {
  const z = x * x,
    w = z * z,
    r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z,
    one = 1 - hz;
  return one + (1 - one - hz + (z * r - x * y));
}
const INV_PIO2 = 0.636_619_772_367_581_4,
  PIO2_1 = 1.570_796_326_734_125_6,
  PIO2_1T = 6.077_100_506_506_192e-11,
  PIO2_2 = 6.077_100_506_303_966e-11,
  PIO2_2T = 2.022_266_248_795_950_6e-21,
  PIO2_3 = 2.022_266_248_711_166_5e-21,
  PIO2_3T = 8.478_427_660_368_9e-32,
  ROUND = 6_755_399_441_055_744; // 0x1.8p52
/** Cody-Waite reduction (FreeBSD e_rem_pio2 medium path), |x| < 2^20 * pi/2. */
function remPio2(x: number): [number, number, number] {
  if (Math.abs(x) > 1_647_099.329_165_285_5)
    throw new RangeError("deterministic trig: |x| outside the supported range");
  const fn = x * INV_PIO2 + ROUND - ROUND,
    n = Math.trunc(fn);
  let r = x - fn * PIO2_1,
    w = fn * PIO2_1T,
    y0 = r - w;
  const j = exponentOf(x);
  if (j - exponentOf(y0) > 16) {
    let t = r;
    w = fn * PIO2_2;
    r = t - w;
    w = fn * PIO2_2T - (t - r - w);
    y0 = r - w;
    if (j - exponentOf(y0) > 49) {
      t = r;
      w = fn * PIO2_3;
      r = t - w;
      w = fn * PIO2_3T - (t - r - w);
      y0 = r - w;
    }
  }
  return [n, y0, r - y0 - w];
}
/** |x| <= pi/4 by high word, as FreeBSD s_sin/s_cos test it. */
const withinPio4 = (x: number) =>
  (highWord(x) & 0x7f_ff_ff_ff) <= 0x3f_e9_21_fb;

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (withinPio4(x)) return kernelSin(x, 0, 0);
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: {
      return kernelSin(y0, y1, 1);
    }
    case 1: {
      return kernelCos(y0, y1);
    }
    case 2: {
      return -kernelSin(y0, y1, 1);
    }
    default: {
      return -kernelCos(y0, y1);
    }
  }
}
export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (withinPio4(x)) return kernelCos(x, 0);
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0: {
      return kernelCos(y0, y1);
    }
    case 1: {
      return -kernelSin(y0, y1, 1);
    }
    case 2: {
      return -kernelCos(y0, y1);
    }
    default: {
      return kernelSin(y0, y1, 1);
    }
  }
}

const ATANHI = [
  0.463_647_609_000_806_1, 0.785_398_163_397_448_3, 0.982_793_723_247_329,
  1.570_796_326_794_896_6,
];
const ATANLO = [
  2.269_877_745_296_168_7e-17, 3.061_616_997_868_383e-17,
  1.390_331_103_123_099_8e-17, 6.123_233_995_736_766e-17,
];
const AT = [
  0.333_333_333_333_329_3, -0.199_999_999_998_764_83, 0.142_857_142_725_034_66,
  -0.111_111_104_054_623_56, 0.090_908_871_334_365_07, -0.076_918_762_050_448_3,
  0.066_610_731_373_875_31, -0.058_335_701_337_905_735,
  0.049_768_779_946_159_324, -0.036_531_572_744_216_916,
  0.016_285_820_115_365_782,
];
export function atan(value: number): number {
  if (value !== value) return Number.NaN;
  const negative = value < 0 || Object.is(value, -0);
  let x = Math.abs(value),
    id: number;
  if (x >= 73_786_976_294_838_210_000)
    return negative ? -(ATANHI[3]! + ATANLO[3]!) : ATANHI[3]! + ATANLO[3]!;
  if (x < 0.4375) {
    if (x < 7.450_580_596_923_828e-9) return value;
    id = -1;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x,
    w = z * z;
  const s1 =
    z *
    (AT[0]! +
      w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 =
    w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return value - value * (s1 + s2);
  const r = ATANHI[id]! - (x * (s1 + s2) - ATANLO[id]! - x);
  return negative ? -r : r;
}

const PI = 3.141_592_653_589_793,
  PI_LO = 1.224_646_799_147_353_2e-16,
  PIO2 = 1.570_796_326_794_896_6,
  PIO4 = 0.785_398_163_397_448_3;
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return Number.NaN;
  if (x === 1) return atan(y);
  const yNeg = y < 0 || Object.is(y, -0),
    xNeg = x < 0 || Object.is(x, -0);
  let m = (yNeg ? 1 : 0) | (xNeg ? 2 : 0);
  if (y === 0) return m === 0 || m === 1 ? y : m === 2 ? PI : -PI;
  if (x === 0) return yNeg ? -PIO2 : PIO2;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity)
      return [PIO4, -PIO4, 3 * PIO4, -3 * PIO4][m]!;
    return [0, -0, PI, -PI][m]!;
  }
  if (y === Infinity || y === -Infinity) return yNeg ? -PIO2 : PIO2;
  const k =
    ((highWord(y) & 0x7f_ff_ff_ff) - (highWord(x) & 0x7f_ff_ff_ff)) >> 20;
  let z: number;
  if (k > 60) {
    z = PIO2 + 0.5 * PI_LO;
    m &= 1;
  } else if (xNeg && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: {
      return z;
    }
    case 1: {
      return -z;
    }
    case 2: {
      return PI - (z - PI_LO);
    }
    default: {
      return z - PI_LO - PI;
    }
  }
}

export function acos(x: number): number {
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

export function hypot(...values: number[]): number {
  const n = values.length;
  let max = 0,
    nan = false;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(+values[i]!);
    if (v !== v) nan = true;
    else if (v > max) max = v;
  }
  if (max === Infinity) return Infinity;
  if (nan) return Number.NaN;
  if (max === 0) return 0;
  let sum = 0,
    compensation = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(+values[i]!) / max;
    const summand = r * r - compensation;
    const preliminary = sum + summand;
    compensation = preliminary - sum - summand;
    sum = preliminary;
  }
  return Math.sqrt(sum) * max;
}
