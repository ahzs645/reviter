/** Measured dimension readers adapted from rvt-rs commit 1c3d337,
 * partition_curve_fields.rs (RE-134/157), partition_fitting_sizes.rs (RE-165),
 * partition_pipe_axes.rs (RE-131), Apache-2.0. No adjacency is inferred. */
import type { MepCollectorOptions, MepPartitionSource, NativeMepDimensions } from "./native-mep.ts";
import { hypot } from "./deterministic-math.ts";

export const MEP_DIMENSION_RELEASES = [2025] as const;
type Point = [number, number, number];
type Box = [number, number, number, number, number, number];
export type MepBoundsEvidence = { elementId: number; stream: string; categoryId?: number; boundsFeet: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } };
const MAX_ANCHORS = 50_000, MAX_GRID_ENTRIES = 250_000;
const distance = (a: Point, b: Point) => hypot(...a.map((v, k) => v - b[k]!));
const inside = (p: Point, b: Box) => p.every((v, k) => v >= b[k]! - .001 && v <= b[k + 3]! + .001);
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function numberAt(view: DataView, p: number): number | undefined { return p >= 0 && p + 8 <= view.byteLength ? view.getFloat64(p, true) : undefined; }
function twice(radius: number | undefined, diameter: number | undefined): number | undefined { return radius != null && diameter != null && Number.isFinite(diameter) && diameter >= .001 && diameter < 20 && diameter === 2 * radius ? diameter : undefined; }

/** Return undefined for no measured size, null for disagreeing connectors. */
export function fittingNominalDiameter(payload: Uint8Array): number | null | undefined {
  const view = viewOf(payload), connectors: number[] = [];
  for (let p = 0; p + 72 <= payload.length; p++) {
    const direction = [numberAt(view, p)!, numberAt(view, p + 8)!, numberAt(view, p + 16)!];
    if (!direction.every(Number.isFinite) || Math.abs(hypot(...direction) - 1) > 1e-9 || ![24, 32, 40].every((offset) => Number.isFinite(numberAt(view, p + offset)))) continue;
    const diameter = twice(numberAt(view, p + 48), numberAt(view, p + 64));
    if (diameter == null) continue;
    connectors.push(diameter); p += 71;
  }
  if (connectors.length) return connectors.every((d) => d === connectors[0]) ? connectors[0] : null;
  let smallest: number | undefined;
  for (let at = 38; at + 8 <= payload.length; at++) {
    if (!payload.subarray(at - 30, at - 22).every((b) => b === 255) || view.getUint32(at - 22, true) === 0 || !payload.subarray(at - 18, at).every((b) => b === 0)) continue;
    const diameter = twice(numberAt(view, at - 38), numberAt(view, at));
    if (diameter != null) smallest = smallest == null ? diameter : Math.min(smallest, diameter);
  }
  return smallest;
}

/** A native endpoint pair must reconstruct all six source bounds faces. */
export function pipeAxisFromBounds(box: Box, start: Point, end: Point): { startFeet: Point; endFeet: Point; radiusFeet: number } | undefined {
  if (![...box, ...start, ...end].every(Number.isFinite) || box.some((v, k) => k < 3 && v >= box[k + 3]!)) return undefined;
  const length = distance(start, end);
  if (length < .001) return undefined;
  const u = start.map((v, k) => (end[k]! - v) / length);
  const across = u.map((v) => Math.sqrt(Math.max(0, 1 - v * v)));
  const radii = across.flatMap((share, k) => share > .3 ? [((box[k + 3]! - box[k]!) / 2 - Math.abs(length * u[k]!) / 2) / share] : []);
  if (!radii.length || Math.max(...radii) - Math.min(...radii) > .002) return undefined;
  const radius = radii.reduce((a, b) => a + b) / radii.length;
  if (!Number.isFinite(radius) || radius <= 0) return undefined;
  for (let k = 0; k < 3; k++) {
    const centre = (start[k]! + end[k]!) / 2, half = Math.abs(length * u[k]!) / 2 + radius * across[k]!;
    if (Math.abs(centre - half - box[k]!) > .002 || Math.abs(centre + half - box[k + 3]!) > .002) return undefined;
  }
  const difference = start.map((v, k) => v - end[k]!).find((v) => Math.abs(v) > 1e-9) ?? 0;
  return difference <= 0 ? { startFeet: start, endFeet: end, radiusFeet: radius } : { startFeet: end, endFeet: start, radiusFeet: radius };
}

export function curveLengthInBounds(box: Box, width: number, height: number): number | undefined {
  const dims = [box[3] - box[0], box[4] - box[1], box[5] - box[2]], values: number[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= .002;
  for (let k = 0; k < 3; k++) {
    const a = dims[(k + 1) % 3]!, b = dims[(k + 2) % 3]!;
    if ((near(a, width) && near(b, height)) || (near(a, height) && near(b, width))) values.push(dims[k]!);
  }
  return values.length && values.every((v) => Number.isFinite(v) && v > 0 && near(v, values[0]!)) ? values[0] : undefined;
}

export function createNativeMepDimensionCollector(options: MepCollectorOptions) {
  const admitted = options.revitVersion === 2025;
  const manager = options.classes.find((c) => c.name === "RbsCurveConnectorManager")?.tag;
  const categories = new Map<number, number>(), bounds = new Map<number, { stream: string; box: Box }>();
  const blockedBounds = new Set<number>();
  const values = new Map<number, { fields: Partial<NativeMepDimensions>; blocked: Set<string>; sources: MepPartitionSource[] }>();
  const nominal = new Map<number, { value: number | null; sources: MepPartitionSource[] }>();
  const anchors = new Map<string, { width: number; height: number; typeId: number; points: Point[]; source: MepPartitionSource }>();
  let capped = false, invalidBounds = false;
  function merge(id: number, fields: Partial<NativeMepDimensions>, source: MepPartitionSource) {
    const current = values.get(id) ?? { fields: {}, blocked: new Set<string>(), sources: [] };
    for (const [key, value] of Object.entries(fields)) {
      if (current.blocked.has(key)) continue;
      const old = (current.fields as Record<string, unknown>)[key];
      if (old !== undefined && JSON.stringify(old) !== JSON.stringify(value)) { delete (current.fields as Record<string, unknown>)[key]; current.blocked.add(key); }
      else (current.fields as Record<string, unknown>)[key] = value;
    }
    if (!current.sources.some((s) => s.stream === source.stream && s.chunkIndex === source.chunkIndex && s.byteOffset === source.byteOffset && s.decoder === source.decoder)) current.sources.push(source);
    values.set(id, current);
  }
  function readFields(bytes: Uint8Array, at: number) {
    const view = viewOf(bytes);
    if (manager == null || at + 72 > bytes.length || view.getUint16(at, true) !== manager || view.getUint32(at + 2, true) !== 0xffffffff || view.getUint16(at + 6, true) !== ((manager + 1) & 0xffff)) return undefined;
    const width = view.getFloat64(at + 8, true), height = view.getFloat64(at + 16, true), type = view.getBigUint64(at + 64, true);
    if (![width, height].every((v) => Number.isFinite(v) && v > 0 && v < 1000) || type < 1n || type > 0xffffffffn || !options.elementIds.has(Number(type))) return undefined;
    return { width, height, typeId: Number(type) };
  }
  return {
    observeElementHeaders(headers: Iterable<{ elementId: number; categoryId: number | null }>) {
      for (const h of headers) if (h.categoryId != null && options.elementIds.has(h.elementId)) categories.set(h.elementId, h.categoryId);
    },
    observeElementBounds(records: Iterable<MepBoundsEvidence>) {
      for (const r of records) {
        if (!options.elementIds.has(r.elementId) || blockedBounds.has(r.elementId)) continue;
        if (r.categoryId != null) categories.set(r.elementId, r.categoryId);
        const { min, max } = r.boundsFeet, box: Box = [min.x, min.y, min.z, max.x, max.y, max.z];
        if (!box.every((v) => Number.isFinite(v) && Math.abs(v) < 1e8) || box.some((v, k) => k < 3 && v >= box[k + 3]!)) { invalidBounds = true; continue; }
        const stream = r.stream.replace(/^Root Entry\//, ""), previous = bounds.get(r.elementId);
        if (previous && (previous.stream !== stream || JSON.stringify(previous.box) !== JSON.stringify(box))) { bounds.delete(r.elementId); blockedBounds.add(r.elementId); invalidBounds = true; continue; }
        bounds.set(r.elementId, { stream, box });
      }
    },
    /** Called only for the complete checksum-verified owning data object. */
    observeVerifiedObject(bytes: Uint8Array, elementId: number, className: string, source: MepPartitionSource) {
      if (!admitted || !options.elementIds.has(elementId)) return;
      if (className === "RbsPipeCurve" && bytes.length >= 565) {
        const view = viewOf(bytes), inner = view.getFloat64(549, true), outer = view.getFloat64(557, true);
        if (inner > 0 && inner < outer && outer < 10) merge(elementId, { pipeInnerDiameterFeet: inner, pipeOuterDiameterFeet: outer }, { ...source, decoder: "RE-157" });
      }
      if (className === "FamilyInstance") {
        const size = fittingNominalDiameter(bytes.subarray(20, bytes.length - 4));
        if (size !== undefined) {
          const held = nominal.get(elementId);
          if (!held) nominal.set(elementId, { value: size, sources: [{ ...source, decoder: "RE-165" }] });
          else { if (held.value !== size) held.value = null; held.sources.push({ ...source, decoder: "RE-165" }); }
        }
      }
    },
    observeCurveAnchor(bytes: Uint8Array, at: number, source: MepPartitionSource) {
      if (!admitted) return;
      const fields = readFields(bytes, at);
      if (!fields) return;
      const key = `${source.stream}:${source.chunkIndex}:${source.byteOffset}`;
      if (!anchors.has(key) && anchors.size >= MAX_ANCHORS) { capped = true; return; }
      const points: Point[] = [], view = viewOf(bytes);
      for (let p = at + 1; p + 28 <= Math.min(bytes.length, at + 2004) && points.length < 64; p++) {
        if (p < 12 || view.getUint32(p, true) !== 1 || view.getUint32(p - 4, true) > 255) continue;
        const ref = view.getBigUint64(p - 12, true);
        if (ref < 1n || ref > 0xffffffffn || !options.elementIds.has(Number(ref))) continue;
        const point: Point = [view.getFloat64(p + 4, true), view.getFloat64(p + 12, true), view.getFloat64(p + 20, true)];
        if (!point.every((v) => Number.isFinite(v) && Math.abs(v) < 1e8) || points.some((kept) => distance(kept, point) < 1e-7)) continue;
        points.push(point);
      }
      if (!anchors.has(key) || anchors.get(key)!.points.length < points.length) anchors.set(key, { ...fields, points, source: { ...source, decoder: "RE-134" } });
    },
    finish(): { dimensions: NativeMepDimensions[]; limitations: string[] } {
      if (!admitted) return { dimensions: [], limitations: [`Measured MEP dimensions are not admitted for Revit ${options.revitVersion}.`] };
      const grid = new Map<string, number[]>();
      let entries = 0;
      for (const [id, record] of bounds) {
        if (![ -2008000, -2008044 ].includes(categories.get(id) ?? 0)) continue;
        const first = record.box.slice(0, 3).map((v) => Math.floor(v - .001)), last = record.box.slice(3).map((v) => Math.floor(v + .001));
        const cells = first.reduce((n, v, k) => n * (last[k]! - v + 1), 1);
        if (cells > 4096 || entries + cells > MAX_GRID_ENTRIES) { capped = true; continue; }
        for (let x = first[0]!; x <= last[0]!; x++) for (let y = first[1]!; y <= last[1]!; y++) for (let z = first[2]!; z <= last[2]!; z++) {
          const key = `${record.stream}:${x}:${y}:${z}`, list = grid.get(key) ?? []; list.push(id); grid.set(key, list); entries++;
        }
      }
      for (const anchor of anchors.values()) {
        const stream = anchor.source.stream.replace(/^Root Entry\//, "");
        const candidates = (point: Point) => (grid.get(`${stream}:${point.map(Math.floor).join(":")}`) ?? []).filter((id) => inside(point, bounds.get(id)!.box));
        const points = anchor.points.filter((p) => candidates(p).length).slice(0, 2);
        if (points.length !== 2) continue;
        const owners = candidates(points[0]!).filter((id) => inside(points[1]!, bounds.get(id)!.box));
        if (owners.length !== 1) continue;
        const id = owners[0]!, box = bounds.get(id)!.box;
        merge(id, { typeId: anchor.typeId, widthFeet: anchor.width, heightFeet: anchor.height }, anchor.source);
        if (categories.get(id) === -2008000) {
          const length = curveLengthInBounds(box, anchor.width, anchor.height);
          if (length != null) merge(id, { lengthFeet: length }, anchor.source);
        } else {
          const axis = pipeAxisFromBounds(box, points[0]!, points[1]!);
          if (axis) merge(id, { pipeAxis: axis, lengthFeet: distance(axis.startFeet, axis.endFeet) }, { ...anchor.source, decoder: "RE-131" });
        }
      }
      for (const [id, size] of nominal) if (categories.get(id) === -2008049 && size.value != null) for (const source of size.sources) merge(id, { nominalDiameterFeet: size.value }, source);
      const dimensions = [...values].filter(([id]) => [-2008000, -2008044, -2008049].includes(categories.get(id) ?? 0)).filter(([, value]) => Object.keys(value.fields).length).map(([elementId, value]) => ({ ...value.fields, elementId, sources: value.sources }));
      const limitations = ["Duct width equal to height does not establish circular versus rectangular shape.", "Curve ownership requires two native connector entry points and one unique source box; pipe axes must reproduce all six bounds faces."];
      if (capped) limitations.push("Measured MEP anchor/grid budget reached; dimensional evidence is partial.");
      if (invalidBounds) limitations.push("Invalid or conflicting native MEP bounds were suppressed.");
      if ([...values.values()].some((v) => v.blocked.size)) limitations.push("Conflicting native dimensional fields were suppressed.");
      return { dimensions: dimensions.sort((a, b) => a.elementId - b.elementId), limitations };
    },
  };
}
