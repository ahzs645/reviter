/**
 * Registering a survey DWG floor plan onto a Revit model's walls.
 *
 * A campus survey drawing lays each floor plan out on its own patch of model
 * space, drawn square to the page, in millimetres. The Revit model of the same
 * campus holds every building at its true position and bearing, in metres. To
 * carry what only the drawing knows (room numbers, room names) onto the model,
 * each sheet needs the similarity transform — rotation, uniform scale, maybe a
 * reflection, translation — that lays its walls over the model's, and the model
 * level whose walls it lays over best.
 *
 * The search is in two stages:
 *
 * 1. Coarse: for a handful of candidate rotations (the model's dominant wall
 *    bearings less the sheet's), the sheet's linework is rasterised and
 *    cross-correlated (FFT) with a proximity map of the model's walls. Each
 *    peak is a translation at which many of the sheet's lines sit near a wall.
 * 2. Fine: from each promising peak, a robust point-to-line ICP pulls the
 *    sheet onto one level's wall faces, and the fit is scored as the fraction
 *    of sheet sample points within a tolerance of a wall face.
 *
 * Pure: segments in, transforms and scores out. The driver
 * (`scripts/register-dwg-sheets.ts`) supplies the drawing and the model.
 */

/** Segments packed as x1, y1, x2, y2, x1, y1, ... */
export type Segments = Float64Array;
/** Points packed as x, y, x, y, ... */
export type Points = Float64Array;

/**
 * p' = scale · R(theta) · M · p + (tx, ty), where M reflects x (x → −x) when
 * `mirror` is set. Angles are radians, counter-clockwise.
 */
export type Similarity = { scale: number; theta: number; tx: number; ty: number; mirror: boolean };

/** The same map as a 2D affine matrix: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function similarityMatrix(transform: Similarity): AffineMatrix {
  const cos = Math.cos(transform.theta) * transform.scale;
  const sin = Math.sin(transform.theta) * transform.scale;
  const m = transform.mirror ? -1 : 1;
  return { a: cos * m, b: sin * m, c: -sin, d: cos, e: transform.tx, f: transform.ty };
}

export function applySimilarity(transform: Similarity, x: number, y: number): [number, number] {
  const { a, b, c, d, e, f } = similarityMatrix(transform);
  return [a * x + c * y + e, b * x + d * y + f];
}

export function transformPoints(transform: Similarity, points: Points): Points {
  const { a, b, c, d, e, f } = similarityMatrix(transform);
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    out[i] = a * x + c * y + e;
    out[i + 1] = b * x + d * y + f;
  }
  return out;
}

export function transformSegments(transform: Similarity, segments: Segments): Segments {
  return transformPoints(transform, segments);
}

export function pointsBounds(points: Points): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return bounds;
}

/** Points every `spacing` along each segment, both ends included. */
export function sampleSegments(segments: Segments, spacing: number): Points {
  const out: number[] = [];
  for (let i = 0; i < segments.length; i += 4) {
    const x1 = segments[i]!;
    const y1 = segments[i + 1]!;
    const x2 = segments[i + 2]!;
    const y2 = segments[i + 3]!;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  }
  return Float64Array.from(out);
}

/**
 * Drops points that fall in an already-occupied cell of a `cell`-sized grid, so
 * dense hatching and overdrawn lines count once, then thins to at most `limit`
 * with a deterministic stride.
 */
export function thinPoints(points: Points, cell: number, limit = Infinity): Points {
  const seen = new Set<string>();
  const kept: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const key = `${Math.floor(points[i]! / cell)},${Math.floor(points[i + 1]! / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(points[i]!, points[i + 1]!);
  }
  const count = kept.length / 2;
  if (count <= limit) return Float64Array.from(kept);
  const out = new Float64Array(limit * 2);
  for (let k = 0; k < limit; k += 1) {
    const source = Math.floor((k * count) / limit);
    out[2 * k] = kept[2 * source]!;
    out[2 * k + 1] = kept[2 * source + 1]!;
  }
  return out;
}

/**
 * Length-weighted histogram of segment bearings folded into [0°, 90°), and its
 * peaks refined to a fraction of a degree. Plans are drawn on orthogonal grids,
 * so a quarter turn is the natural period.
 */
export function dominantBearings(
  segments: Segments,
  options: { binsPerDegree?: number; minShare?: number; limit?: number } = {},
): { degrees: number; share: number }[] {
  const perDegree = options.binsPerDegree ?? 4;
  const bins = 90 * perDegree;
  const histogram = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < segments.length; i += 4) {
    const dx = segments[i + 2]! - segments[i]!;
    const dy = segments[i + 3]! - segments[i + 1]!;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    let degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
    degrees = ((degrees % 90) + 90) % 90;
    histogram[Math.floor(degrees * perDegree) % bins] += length;
    total += length;
  }
  if (total === 0) return [];
  // Smooth over ±1° so a bearing split across bins still reads as one peak.
  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i += 1) {
    for (let k = -perDegree; k <= perDegree; k += 1) smooth[i] += histogram[(i + k + bins) % bins]!;
  }
  const peaks: { degrees: number; share: number }[] = [];
  for (let i = 0; i < bins; i += 1) {
    const value = smooth[i]!;
    let isPeak = true;
    for (let k = 1; k <= 2 * perDegree && isPeak; k += 1) {
      if (smooth[(i + k) % bins]! > value || smooth[(i - k + bins) % bins]! >= value) isPeak = false;
    }
    if (!isPeak) continue;
    // Length-weighted mean bearing within ±1° of the peak.
    let weight = 0;
    let sum = 0;
    for (let k = -perDegree; k <= perDegree; k += 1) {
      const w = histogram[(i + k + bins) % bins]!;
      weight += w;
      sum += w * (i + k + 0.5) / perDegree;
    }
    const degrees = ((sum / weight) % 90 + 90) % 90;
    peaks.push({ degrees, share: value / total });
  }
  peaks.sort((p, q) => q.share - p.share);
  return peaks.filter((peak) => peak.share >= (options.minShare ?? 0.03)).slice(0, options.limit ?? 8);
}

/* ------------------------------------------------------------------------ */
/* FFT cross-correlation                                                     */

function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = size >> 1;
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

/** In-place 2D FFT of a row-major width × height complex grid (powers of two). */
export function fft2d(re: Float64Array, im: Float64Array, width: number, height: number, inverse = false): void {
  const rowRe = new Float64Array(width);
  const rowIm = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    rowRe.set(re.subarray(offset, offset + width));
    rowIm.set(im.subarray(offset, offset + width));
    fft1d(rowRe, rowIm, inverse);
    re.set(rowRe, offset);
    im.set(rowIm, offset);
  }
  const colRe = new Float64Array(height);
  const colIm = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      colRe[y] = re[y * width + x]!;
      colIm[y] = im[y * width + x]!;
    }
    fft1d(colRe, colIm, inverse);
    for (let y = 0; y < height; y += 1) {
      re[y * width + x] = colRe[y]!;
      im[y * width + x] = colIm[y]!;
    }
  }
}

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(2, value)));

/** Marks every grid cell a segment passes through. */
function rasteriseSegments(
  grid: Float64Array, width: number, height: number, origin: [number, number], cell: number, segments: Segments,
): void {
  for (let i = 0; i < segments.length; i += 4) {
    const x1 = (segments[i]! - origin[0]) / cell;
    const y1 = (segments[i + 1]! - origin[1]) / cell;
    const x2 = (segments[i + 2]! - origin[0]) / cell;
    const y2 = (segments[i + 3]! - origin[1]) / cell;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let k = 0; k <= steps; k += 1) {
      const x = Math.floor(x1 + ((x2 - x1) * k) / steps);
      const y = Math.floor(y1 + ((y2 - y1) * k) / steps);
      if (x >= 0 && y >= 0 && x < width && y < height) grid[y * width + x] = 1;
    }
  }
}

/** Squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells². */
export function distanceTransform(occupied: Float64Array, width: number, height: number): Float64Array {
  const INF = 1e20;
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = occupied[i]! > 0 ? 0 : INF;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q += 1) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k -= 1;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1]! < q) k += 1;
      d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
  };
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = out[y * width + x]!;
    pass(height);
    for (let y = 0; y < height; y += 1) out[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = out[y * width + x]!;
    pass(width);
    for (let x = 0; x < width; x += 1) out[y * width + x] = d[x]!;
  }
  return out;
}

/**
 * A target's walls, rasterised once and transformed for correlation: each
 * cell holds exp(−d²/2σ²) of its distance d to the nearest wall, so a sheet
 * line landing near a wall earns close to 1 and one in open floor earns 0.
 */
export type CorrelationTarget = {
  width: number;
  height: number;
  cell: number;
  origin: [number, number];
  /** Largest sheet extent (in cells) the padding leaves room for without wrap-around. */
  maxSheetCells: [number, number];
  spectrumRe: Float64Array;
  spectrumIm: Float64Array;
};

/** Mean of a row-major grid over a (2r+1)² box around each cell (edges clamp the box). */
function boxMean(grid: Float64Array, width: number, height: number, radius: number): Float64Array {
  const rows = new Float64Array(width * height);
  const prefix = new Float64Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) prefix[x + 1] = prefix[x]! + grid[y * width + x]!;
    for (let x = 0; x < width; x += 1) {
      const lo = Math.max(0, x - radius);
      const hi = Math.min(width, x + radius + 1);
      rows[y * width + x] = (prefix[hi]! - prefix[lo]!) / (hi - lo);
    }
  }
  const out = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) prefix[y + 1] = prefix[y]! + rows[y * width + x]!;
    for (let y = 0; y < height; y += 1) {
      const lo = Math.max(0, y - radius);
      const hi = Math.min(height, y + radius + 1);
      out[y * width + x] = (prefix[hi]! - prefix[lo]!) / (hi - lo);
    }
  }
  return out;
}

/**
 * `highPass` (target units, default 4) subtracts the proximity map's local
 * mean over a box that wide on each side. Without it, the densest part of the
 * model (a ground floor with every storey's walls stacked over it) scores well
 * for any sheet at all; with it, a placement earns only what it gains over a
 * random placement in the same neighbourhood. 0 disables it.
 */
export function correlationTarget(
  segments: Segments,
  options: { cell?: number; sigma?: number; maxSheetSize?: number; highPass?: number } = {},
): CorrelationTarget {
  const cell = options.cell ?? 1;
  const sigma = options.sigma ?? cell;
  const maxSheet = options.maxSheetSize ?? 200;
  const bounds = pointsBounds(segments);
  const origin: [number, number] = [bounds.minX - cell, bounds.minY - cell];
  const spanX = Math.ceil((bounds.maxX - bounds.minX) / cell) + 2;
  const spanY = Math.ceil((bounds.maxY - bounds.minY) / cell) + 2;
  const sheetCells = Math.ceil(maxSheet / cell);
  const width = nextPowerOfTwo(spanX + sheetCells);
  const height = nextPowerOfTwo(spanY + sheetCells);
  const grid = new Float64Array(width * height);
  rasteriseSegments(grid, width, height, origin, cell, segments);
  const squared = distanceTransform(grid, width, height);
  const re = new Float64Array(width * height);
  const scale = 1 / (2 * (sigma / cell) ** 2);
  for (let i = 0; i < re.length; i += 1) {
    const x = i % width;
    const y = Math.floor(i / width);
    re[i] = x < spanX && y < spanY ? Math.exp(-squared[i]! * scale) : 0;
  }
  const highPass = Math.round((options.highPass ?? 4) / cell);
  if (highPass > 0) {
    const mean = boxMean(re, width, height, highPass);
    for (let i = 0; i < re.length; i += 1) re[i] = re[i]! - mean[i]!;
  }
  const im = new Float64Array(width * height);
  fft2d(re, im, width, height);
  return {
    width, height, cell, origin,
    maxSheetCells: [width - spanX, height - spanY],
    spectrumRe: re, spectrumIm: im,
  };
}

export type CorrelationPeak = { tx: number; ty: number; score: number };

type SheetRaster = { origin: [number, number]; spanX: number; spanY: number; count: number };

function rasteriseSheet(target: CorrelationTarget, grid: Float64Array, segments: Segments): SheetRaster {
  const { width, height, cell } = target;
  const bounds = pointsBounds(segments);
  const origin: [number, number] = [bounds.minX, bounds.minY];
  const spanX = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const spanY = Math.ceil((bounds.maxY - bounds.minY) / cell) + 1;
  if (spanX > target.maxSheetCells[0] || spanY > target.maxSheetCells[1]) {
    throw new Error(`Sheet (${spanX}×${spanY} cells) exceeds the correlation padding.`);
  }
  rasteriseSegments(grid, width, height, origin, cell, segments);
  let count = 0;
  for (let i = 0; i < grid.length; i += 1) count += grid[i]!;
  return { origin, spanX, spanY, count };
}

function correlationPeaks(
  target: CorrelationTarget, map: Float64Array, sheet: SheetRaster, wanted: number, radius: number,
): CorrelationPeak[] {
  const { width, height, cell } = target;
  if (sheet.count === 0) return [];
  const found: { index: number; value: number }[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = map[y * width + x]!;
      if (value <= 0 || !Number.isFinite(value)) continue;
      if (found.length === wanted && value <= found[found.length - 1]!.value) continue;
      // Only shifts that keep the sheet overlapping the (unwrapped) target.
      const sx = x >= width - sheet.spanX ? x - width : x;
      const sy = y >= height - sheet.spanY ? y - height : y;
      if (sx > width - target.maxSheetCells[0] || sy > height - target.maxSheetCells[1]) continue;
      let isMax = true;
      for (let dy = -radius; dy <= radius && isMax; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!dx && !dy) continue;
          const other = map[((y + dy + height) % height) * width + ((x + dx + width) % width)]!;
          if (other > value || (other === value && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      found.push({ index: y * width + x, value });
      found.sort((p, q) => q.value - p.value);
      if (found.length > wanted) found.pop();
    }
  }
  return found.map(({ index, value }) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const sx = x >= width - sheet.spanX ? x - width : x;
    const sy = y >= height - sheet.spanY ? y - height : y;
    return {
      tx: target.origin[0] - sheet.origin[0] + sx * cell,
      ty: target.origin[1] - sheet.origin[1] + sy * cell,
      score: value / sheet.count,
    };
  });
}

/**
 * Best translations for each of several sheet segment sets, already rotated
 * and scaled into target units. The score is the mean proximity of the
 * sheet's occupied cells, so 1 means every drawn cell lies on a wall.
 *
 * Two real sheets share one complex FFT (one in the real part, one in the
 * imaginary), and their two real correlations share the inverse, which halves
 * the transforms.
 */
export function correlatePeaksMany(
  target: CorrelationTarget,
  sheets: readonly Segments[],
  options: { peaks?: number; suppressRadius?: number } = {},
): CorrelationPeak[][] {
  const { width, height } = target;
  const radius = options.suppressRadius ?? Math.max(2, Math.round(3 / target.cell));
  const wanted = options.peaks ?? 5;
  const out: CorrelationPeak[][] = [];
  for (let first = 0; first < sheets.length; first += 2) {
    const re = new Float64Array(width * height);
    const im = new Float64Array(width * height);
    const a = rasteriseSheet(target, re, sheets[first]!);
    const b = first + 1 < sheets.length ? rasteriseSheet(target, im, sheets[first + 1]!) : null;
    fft2d(re, im, width, height);
    const pr = new Float64Array(width * height);
    const pi = new Float64Array(width * height);
    for (let ky = 0; ky < height; ky += 1) {
      const my = (height - ky) % height;
      for (let kx = 0; kx < width; kx += 1) {
        const k = ky * width + kx;
        const m = my * width + (width - kx) % width;
        // Z[k] and conj(Z[−k]) separate the two real inputs' spectra.
        const zr = re[k]!;
        const zi = im[k]!;
        const wr = re[m]!;
        const wi = -im[m]!;
        const f1r = (zr + wr) / 2;
        const f1i = (zi + wi) / 2;
        // (Z − conj Z[−k]) / 2i
        const f2r = (zi - wi) / 2;
        const f2i = -(zr - wr) / 2;
        const rr = target.spectrumRe[k]!;
        const ri = target.spectrumIm[k]!;
        // C = conj(F) · R
        const c1r = f1r * rr + f1i * ri;
        const c1i = f1r * ri - f1i * rr;
        const c2r = f2r * rr + f2i * ri;
        const c2i = f2r * ri - f2i * rr;
        // P = C1 + i·C2
        pr[k] = c1r - c2i;
        pi[k] = c1i + c2r;
      }
    }
    fft2d(pr, pi, width, height, true);
    out.push(correlationPeaks(target, pr, a, wanted, radius));
    if (b) out.push(correlationPeaks(target, pi, b, wanted, radius));
  }
  return out;
}

/** Best translations for one sheet; see `correlatePeaksMany`. */
export function correlatePeaks(
  target: CorrelationTarget,
  segments: Segments,
  options: { peaks?: number; suppressRadius?: number } = {},
): CorrelationPeak[] {
  return correlatePeaksMany(target, [segments], options)[0]!;
}

/* ------------------------------------------------------------------------ */
/* Nearest wall face                                                         */

/** A uniform-grid index of segments for nearest-point queries within `cell`. */
export class SegmentIndex {
  readonly segments: Segments;
  readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly stamp: Uint32Array;
  private tick = 0;

  constructor(segments: Segments, cell: number) {
    this.segments = segments;
    this.cell = cell;
    this.stamp = new Uint32Array(segments.length / 4);
    for (let s = 0; s < segments.length / 4; s += 1) {
      const x1 = segments[4 * s]!;
      const y1 = segments[4 * s + 1]!;
      const x2 = segments[4 * s + 2]!;
      const y2 = segments[4 * s + 3]!;
      const steps = Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / cell) * 2));
      let last = NaN;
      for (let k = 0; k <= steps; k += 1) {
        const key = this.key(x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps);
        if (key === last) continue;
        last = key;
        const bucket = this.buckets.get(key);
        if (!bucket) this.buckets.set(key, [s]);
        else if (bucket[bucket.length - 1] !== s) bucket.push(s);
      }
    }
  }

  private key(x: number, y: number): number {
    return (Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(y / this.cell) + 32768);
  }

  /**
   * The nearest point on any segment within `radius` (default: one cell) of
   * (x, y), with the segment's unit normal, or null.
   */
  nearest(x: number, y: number, radius = this.cell): { x: number; y: number; distance: number; nx: number; ny: number } | null {
    this.tick += 1;
    if (this.tick === 0xffffffff) { this.stamp.fill(0); this.tick = 1; }
    const cx = Math.floor(x / this.cell) + 32768;
    const cy = Math.floor(y / this.cell) + 32768;
    const rings = Math.max(1, Math.ceil(radius / this.cell));
    let best = radius;
    let bx = 0;
    let by = 0;
    let bnx = 0;
    let bny = 0;
    let hit = false;
    const s = this.segments;
    for (let dx = -rings; dx <= rings; dx += 1) {
      for (let dy = -rings; dy <= rings; dy += 1) {
        const bucket = this.buckets.get((cx + dx) * 65536 + cy + dy);
        if (!bucket) continue;
        for (const index of bucket) {
          if (this.stamp[index] === this.tick) continue;
          this.stamp[index] = this.tick;
          const x1 = s[4 * index]!;
          const y1 = s[4 * index + 1]!;
          const ux = s[4 * index + 2]! - x1;
          const uy = s[4 * index + 3]! - y1;
          const length2 = ux * ux + uy * uy;
          let t = length2 > 0 ? ((x - x1) * ux + (y - y1) * uy) / length2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = x1 + ux * t;
          const py = y1 + uy * t;
          const distance = Math.hypot(x - px, y - py);
          if (distance < best) {
            best = distance;
            bx = px;
            by = py;
            hit = true;
            const length = Math.sqrt(length2);
            if (length > 0) { bnx = -uy / length; bny = ux / length; } else { bnx = 0; bny = 0; }
          }
        }
      }
    }
    return hit ? { x: bx, y: by, distance: best, nx: bnx, ny: bny } : null;
  }
}

export type FitStats = {
  /** Sample points within `tolerance` of a wall face, as a share of all sample points. */
  inlierRatio: number;
  /** Root-mean-square distance of the inliers, in target units. */
  rms: number;
  inliers: number;
  total: number;
};

export function fitStats(index: SegmentIndex, points: Points, transform: Similarity, tolerance: number): FitStats {
  const moved = transformPoints(transform, points);
  let inliers = 0;
  let sum = 0;
  for (let i = 0; i < moved.length; i += 2) {
    const hit = index.nearest(moved[i]!, moved[i + 1]!, tolerance);
    if (hit && hit.distance <= tolerance) {
      inliers += 1;
      sum += hit.distance * hit.distance;
    }
  }
  const total = points.length / 2;
  return { inlierRatio: total ? inliers / total : 0, rms: inliers ? Math.sqrt(sum / inliers) : NaN, inliers, total };
}

/** Solves the n×n system A·x = b (Gaussian elimination, partial pivoting). */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k += 1) m[r]![k] = m[r]![k]! - factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

export type IcpOptions = {
  /** Correspondence cut-offs, tightened stage by stage (target units). */
  schedule?: number[];
  iterationsPerStage?: number;
  /** Also fit the scale (otherwise it stays at the initial value). */
  fitScale?: boolean;
};

/**
 * Robust point-to-line ICP: each sheet point is paired with the nearest wall
 * face within the stage's cut-off, and rotation, translation (and optionally
 * log-scale) are solved by Gauss–Newton on the point-to-line residuals with
 * Tukey-style down-weighting towards the cut-off.
 */
export function icpRefine(
  index: SegmentIndex,
  points: Points,
  initial: Similarity,
  options: IcpOptions = {},
): Similarity {
  const schedule = options.schedule ?? [2, 1, 0.5, 0.25];
  const iterations = options.iterationsPerStage ?? 8;
  let current = { ...initial };
  for (const cutoff of schedule) {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const size = options.fitScale ? 4 : 3;
      const ata = Array.from({ length: size }, () => new Array<number>(size).fill(0));
      const atb = new Array<number>(size).fill(0);
      const moved = transformPoints(current, points);
      // Rotate and scale about the moved points' centroid, which keeps the
      // normal equations well conditioned far from the target's origin.
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < moved.length; i += 2) { cx += moved[i]!; cy += moved[i + 1]!; }
      cx /= moved.length / 2;
      cy /= moved.length / 2;
      let pairs = 0;
      for (let i = 0; i < moved.length; i += 2) {
        const x = moved[i]!;
        const y = moved[i + 1]!;
        const hit = index.nearest(x, y, cutoff);
        if (!hit || hit.distance > cutoff) continue;
        let nx = hit.nx;
        let ny = hit.ny;
        // Past a segment's end the nearest point is its endpoint: use the
        // direction to it instead of the line normal.
        const along = Math.abs((x - hit.x) * ny - (y - hit.y) * nx);
        if (hit.distance > 1e-9 && along > 1e-6 * Math.max(1, cutoff)) {
          nx = (x - hit.x) / hit.distance;
          ny = (y - hit.y) / hit.distance;
        }
        const r = nx * (x - hit.x) + ny * (y - hit.y);
        const u = hit.distance / cutoff;
        const w = (1 - u * u) ** 2;
        // Derivatives of the moved point w.r.t. theta and log-scale.
        const rx = x - cx;
        const ry = y - cy;
        const jTheta = nx * -ry + ny * rx;
        const jScale = nx * rx + ny * ry;
        const j = options.fitScale ? [jTheta, nx, ny, jScale] : [jTheta, nx, ny];
        for (let p = 0; p < size; p += 1) {
          atb[p] = atb[p]! - w * j[p]! * r;
          for (let q = 0; q < size; q += 1) ata[p]![q] = ata[p]![q]! + w * j[p]! * j[q]!;
        }
        pairs += 1;
      }
      if (pairs < 10) return current;
      for (let p = 0; p < size; p += 1) ata[p]![p] = ata[p]![p]! * (1 + 1e-9) + 1e-12;
      const step = solve(ata, atb);
      if (!step) return current;
      const [dTheta, dx, dy, dScale = 0] = step as [number, number, number, number?];
      // p'' = k·R(dθ)·(p' − c) + c + d, folded into the transform.
      const cos = Math.cos(dTheta);
      const sin = Math.sin(dTheta);
      const factor = Math.exp(dScale);
      const tx = factor * (cos * (current.tx - cx) - sin * (current.ty - cy)) + cx + dx;
      const ty = factor * (sin * (current.tx - cx) + cos * (current.ty - cy)) + cy + dy;
      current = { scale: current.scale * factor, theta: current.theta + dTheta, tx, ty, mirror: current.mirror };
      if (Math.abs(dTheta) < 1e-7 && Math.hypot(dx, dy) < 1e-5 && Math.abs(dScale) < 1e-7) break;
    }
  }
  current.theta = Math.atan2(Math.sin(current.theta), Math.cos(current.theta));
  return current;
}

/* ------------------------------------------------------------------------ */
/* Coarse search                                                             */

export type CoarseCandidate = { transform: Similarity; score: number };

/**
 * Candidate placements of a sheet on a target: for each rotation in
 * `thetas` (and its reflection when `tryMirror`), the best `peaksPerRotation`
 * correlation peaks. Sorted by score, best first.
 */
export function coarseCandidates(
  target: CorrelationTarget,
  sheetSegments: Segments,
  options: {
    scale: number;
    thetas: readonly number[];
    tryMirror?: boolean;
    /** Exactly these reflections (overrides `tryMirror`). */
    mirrors?: readonly boolean[];
    peaksPerRotation?: number;
  },
): CoarseCandidate[] {
  const rotations: Similarity[] = [];
  for (const mirror of options.mirrors ?? (options.tryMirror ? [false, true] : [false])) {
    for (const theta of options.thetas) rotations.push({ scale: options.scale, theta, tx: 0, ty: 0, mirror });
  }
  const peaks = correlatePeaksMany(
    target, rotations.map((rotation) => transformSegments(rotation, sheetSegments)),
    { peaks: options.peaksPerRotation ?? 4 },
  );
  const out: CoarseCandidate[] = [];
  rotations.forEach((rotation, index) => {
    for (const peak of peaks[index]!) out.push({ transform: { ...rotation, tx: peak.tx, ty: peak.ty }, score: peak.score });
  });
  return out.sort((p, q) => q.score - p.score);
}

/**
 * Rotations to try: every model bearing less every sheet bearing, in each
 * quarter turn. Degrees in, radians out, near-duplicates merged.
 */
export function candidateRotations(
  targetBearings: readonly number[],
  sheetBearings: readonly number[],
  mergeDegrees = 1,
): number[] {
  const degrees: number[] = [];
  for (const t of targetBearings) {
    for (const s of sheetBearings) {
      for (let quarter = 0; quarter < 4; quarter += 1) {
        const value = (((t - s + quarter * 90) % 360) + 360) % 360;
        if (!degrees.some((d) => Math.abs(((d - value + 540) % 360) - 180) < mergeDegrees)) degrees.push(value);
      }
    }
  }
  return degrees.sort((a, b) => a - b).map((d) => (d * Math.PI) / 180);
}

/* ------------------------------------------------------------------------ */
/* Label checks                                                              */

/** Convex hull (Andrew's monotone chain), counter-clockwise, as [x, y] pairs. */
export function convexHull(points: Points): [number, number][] {
  const list: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) list.push([points[i]!, points[i + 1]!]);
  list.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (list.length < 3) return list;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of list) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function insideConvexHull(hull: readonly [number, number][], x: number, y: number): boolean {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

/**
 * Which wall-bounded region each point falls in: walls are rasterised at
 * `cell` (thickened by `thicken` cells to close hairline gaps) and the free
 * space flood-filled. Returns a region id per point (−1 when the point lands
 * on a wall or outside the window) and whether that region touches the
 * window's edge (i.e. is outside the building, or leaks out of it).
 */
export function wallRegions(
  segments: Segments,
  points: readonly [number, number][],
  options: { cell?: number; thicken?: number; bounds?: Bounds } = {},
): { region: number[]; open: boolean[] } {
  const cell = options.cell ?? 0.1;
  const thicken = options.thicken ?? 1;
  const bounds = options.bounds ?? pointsBounds(segments);
  const origin: [number, number] = [bounds.minX - 2 * cell, bounds.minY - 2 * cell];
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell) + 4;
  const height = Math.ceil((bounds.maxY - bounds.minY) / cell) + 4;
  const wall = new Float64Array(width * height);
  rasteriseSegments(wall, width, height, origin, cell, segments);
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < wall.length; i += 1) mask[i] = wall[i]! > 0 ? 1 : 0;
  for (let pass = 0; pass < thicken; pass += 1) {
    const grown = mask.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (mask[i]) continue;
        if (mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width]) grown[i] = 1;
      }
    }
    mask = grown;
  }
  const label = new Int32Array(width * height).fill(-1);
  const open: boolean[] = [];
  const region = points.map(([px, py]) => {
    const x = Math.floor((px - origin[0]) / cell);
    const y = Math.floor((py - origin[1]) / cell);
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    const start = y * width + x;
    if (mask[start]) return -1;
    if (label[start]! >= 0) return label[start]!;
    const id = open.length;
    let touchesEdge = false;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % width;
      const cy = (i - cx) / width;
      if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) { touchesEdge = true; continue; }
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (!mask[j] && label[j] === -1) { label[j] = id; stack.push(j); }
      }
    }
    open.push(touchesEdge);
    return id;
  });
  return { region, open };
}

/**
 * Splits a sheet's linework into the separate drawings on it: segments whose
 * rasterised, dilated footprints touch are one part. A sheet with two floors
 * side by side ("LVL 0 and 2") comes apart into two, and each can be placed on
 * its own. Parts with less than `minShare` of the total line length, or less
 * than `minLength`, are dropped (scale bars, north arrows, stray notes).
 * Returns each part's segments, largest first.
 */
export function splitParts(
  segments: Segments,
  options: { cell: number; gap: number; minShare?: number; minLength?: number },
): Segments[] {
  const count = segments.length / 4;
  if (!count) return [];
  const bounds = pointsBounds(segments);
  const cell = options.cell;
  const pad = Math.ceil(options.gap / cell) + 1;
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell) + 2 * pad + 1;
  const height = Math.ceil((bounds.maxY - bounds.minY) / cell) + 2 * pad + 1;
  const origin: [number, number] = [bounds.minX - pad * cell, bounds.minY - pad * cell];
  const grid = new Float64Array(width * height);
  rasteriseSegments(grid, width, height, origin, cell, segments);
  // Dilate by the gap: two drawings closer than that are one.
  const reach = Math.max(0, Math.round(options.gap / cell / 2));
  const squared = distanceTransform(grid, width, height);
  const parent = new Int32Array(width * height).fill(-1);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < squared.length; i += 1) if (squared[i]! <= reach * reach) parent[i] = i;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (parent[i]! < 0) continue;
      for (const j of [x > 0 ? i - 1 : -1, y > 0 ? i - width : -1]) {
        if (j < 0 || parent[j]! < 0) continue;
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, { indices: number[]; length: number }>();
  let total = 0;
  for (let s = 0; s < count; s += 1) {
    const x1 = segments[4 * s]!;
    const y1 = segments[4 * s + 1]!;
    const x2 = segments[4 * s + 2]!;
    const y2 = segments[4 * s + 3]!;
    const cx = Math.floor(((x1 + x2) / 2 - origin[0]) / cell);
    const cy = Math.floor(((y1 + y2) / 2 - origin[1]) / cell);
    const i = cy * width + cx;
    const root = parent[i]! >= 0 ? find(i) : -1 - s;
    const length = Math.hypot(x2 - x1, y2 - y1);
    total += length;
    const group = groups.get(root) ?? { indices: [], length: 0 };
    group.indices.push(s);
    group.length += length;
    groups.set(root, group);
  }
  return [...groups.values()]
    .filter((group) => group.length >= total * (options.minShare ?? 0.1) && group.length >= (options.minLength ?? 0))
    .sort((a, b) => b.length - a.length)
    .map((group) => {
      const out = new Float64Array(group.indices.length * 4);
      group.indices.forEach((s, k) => out.set(segments.subarray(4 * s, 4 * s + 4), 4 * k));
      return out;
    });
}
