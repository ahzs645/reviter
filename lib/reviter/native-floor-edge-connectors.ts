/** Stairs and ramps that the floor-edge rules must leave untouched (native-floor-edge-rules.ts).
 *
 * Native: every source stair (its runs' sketch treads, or the runs' own horizontal native faces when
 * the sketch has none, plus its owner-tagged landings) and every source ramp (its own sketch rings).
 * Recipe: a reviewed local-steps transition names its native stair, and a reviewed ramp recipe its
 * native ramp; the same source connector then also carries the "recipe" source. Nothing here is
 * inferred from proximity, room outlines or bounding boxes. */
import type { ConvertResult } from "./types.ts";
import type { NativeFloorEdgeConnector } from "./native-floor-edge-rules.ts";
import { nativeStairRunTreads } from "./indoor-stair-run-surfaces.ts";
import { nativeStairLandings } from "./indoor-stair-landings.ts";

type Point = [number, number];
const STAIRS = -2000120, RUNS = -2000919, LANDINGS = -2000920, RAMPS = -2000180;
const planRing = (ring: readonly (readonly number[])[]): Point[] => ring.map((p) => [p[0]!, p[1]!] as Point);
const ringArea2 = (r: Point[]) => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
const usable = (r: Point[]) => r.length >= 3 && r.every((p) => p.every(Number.isFinite)) && ringArea2(r) !== 0;

export function nativeFloorEdgeConnectors(
  model: Pick<ConvertResult, "elementBounds"> & Partial<ConvertResult>,
  recipes: { localStairIds?: readonly number[]; rampIds?: readonly number[] } = {},
): NativeFloorEdgeConnector[] {
  const elements = new Map(model.elementBounds.map((e) => [e.elementId, e]));
  const recipeStairs = new Set(recipes.localStairIds ?? []), recipeRamps = new Set(recipes.rampIds ?? []);
  const out: NativeFloorEdgeConnector[] = [];
  const assemblies = [...(model.nativeStairAssemblies ?? [])].sort((a, b) => a.stairElementId - b.stairElementId);
  const assigned = new Set<number>();
  let meshTreads: ReturnType<typeof nativeStairRunTreads> | undefined;
  let landings: ReturnType<typeof nativeStairLandings> | undefined;
  const runParts = (id: number): Point[][][] => {
    const r = elements.get(id);
    if (!r || r.categoryId !== RUNS) return [];
    const sketch = (r.stairTreads ?? []).map(planRing).filter(usable);
    if (sketch.length) return sketch.map((ring) => [ring]);
    meshTreads ??= nativeStairRunTreads(model);
    return (meshTreads.get(id) ?? []).map((t) => planRing(t.ringFeet)).filter(usable).map((ring) => [ring]);
  };
  const zRange = (ids: number[], extra: number[] = []) => {
    const zs = [...ids.flatMap((id) => { const b = elements.get(id)?.boundsFeet; return b ? [b.min.z, b.max.z] : []; }), ...extra].filter(Number.isFinite);
    return zs.length ? [Math.min(...zs), Math.max(...zs)] as const : undefined;
  };
  const stair = (stairId: number | undefined, runIds: number[]) => {
    const footprint = runIds.flatMap(runParts);
    const own = stairId === undefined ? [] : ((landings ??= nativeStairLandings(model)).get(stairId) ?? []);
    footprint.push(...own.map((l) => l.ringsFeet.map((r) => planRing(r))).filter((p) => p.length && usable(p[0]!)));
    const range = zRange(runIds, own.map((l) => l.elevationFeet));
    if (!footprint.length || !range) return;
    out.push({ id: stairId === undefined ? `stair-run:${runIds[0]}` : `stair:${stairId}`, kind: "stair",
      sources: stairId !== undefined && recipeStairs.has(stairId) ? ["native", "recipe"] : ["native"],
      bottomElevationFeet: range[0], topElevationFeet: range[1], footprintFeet: footprint });
  };
  for (const a of assemblies) {
    if (elements.get(a.stairElementId)?.categoryId !== STAIRS) continue;
    const ids = [...a.runAndLandingIds].filter((id) => elements.get(id)?.categoryId === RUNS || elements.get(id)?.categoryId === LANDINGS).sort((x, y) => x - y);
    ids.forEach((id) => assigned.add(id));
    stair(a.stairElementId, ids.filter((id) => elements.get(id)?.categoryId === RUNS));
  }
  for (const r of [...elements.values()].filter((e) => e.categoryId === RUNS && !assigned.has(e.elementId)).sort((a, b) => a.elementId - b.elementId)) stair(undefined, [r.elementId]);
  for (const r of [...elements.values()].filter((e) => e.categoryId === RAMPS).sort((a, b) => a.elementId - b.elementId)) {
    const loops = (r.loops ?? []).map(planRing);
    if (!loops[0] || !usable(loops[0])) continue;
    out.push({ id: `ramp:${r.elementId}`, kind: "ramp", sources: recipeRamps.has(r.elementId) ? ["native", "recipe"] : ["native"],
      bottomElevationFeet: r.boundsFeet.min.z, topElevationFeet: r.boundsFeet.max.z, footprintFeet: [[loops[0], ...loops.slice(1).filter(usable)]] });
  }
  return out;
}
