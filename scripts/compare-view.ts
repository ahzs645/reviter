/**
 * An isometric comparison of the recovery against its paired export, as one SVG.
 *
 *   node --experimental-strip-types scripts/compare-view.ts model.rvt model.ifc out.svg
 *
 * ## Why this exists
 *
 * The studio draws this better — shaded, navigable, in a real renderer. What it
 * cannot do is be fast: parsing an 83 MB IFC through web-ifc in a browser tab
 * takes the better part of an hour, which is too slow to look at after every
 * change to a decoder rule. This renders the same comparison from node in the
 * time one conversion takes, so a change can be *seen* and not only scored.
 *
 * Three panels sharing one frame and one scale, so they can be compared by eye
 * without measuring: what the viewer draws, the export, and both together with
 * the elements the export holds and the recovery does not picked out in red.
 *
 * ## Two things this got wrong, both worth stating
 *
 * **It drew every record, not the scene.** `selectDisplayBounds` holds back
 * 1,582 curtain-wall wrappers and 375 sheets *because the viewer does not draw
 * them* — a wrapper's envelope spans a whole facade, a sheet spans a storey.
 * Rendering all 38,951 records laid those envelopes over the building as solid
 * blocks and hid everything underneath. It is now given the display selection,
 * which is what the viewer itself draws.
 *
 * **It was a plan view**, which is the right projection for judging a footprint
 * and the wrong one for judging a building: a plan cannot show that a storey is
 * missing, or that a railing sits a floor too high. The projection is isometric
 * now, matching the studio's default `seIso` camera, so the two can be held side
 * by side.
 *
 * Each element is the convex hull of its projected points — the silhouette,
 * which is what an isometric view of a convex box shows anyway — and each layer
 * is one merged path. 35,000 individually addressable elements make an SVG no
 * browser will open, and nothing here needs them addressable.
 */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { hasFlag, isEntryPoint, positionals } from "./lib/rvt-harness.ts";
import { streamTruthVertices, type Point2 } from "./footprint-audit.ts";
import { drawnBounds } from "./overlay-diff.ts";

import { selectDisplayBounds } from "../lib/reviter/scene.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

/** Panel size in SVG units; three of these sit side by side. */
const PANEL = 1000;

/** Margin inside each panel, so nothing touches the frame. */
const PAD = 30;

/** Elements whose silhouette is smaller than this are noise at this scale. */
const MIN_SILHOUETTE_SQ_UNITS = 0.4;

const STYLE = {
  recovered: { fill: "#e2963a", stroke: "#9c6318", opacity: 0.5 },
  exported: { fill: "#8ea3bb", stroke: "#4f6480", opacity: 0.5 },
  missing: { fill: "#d33b30", stroke: "#8e211a", opacity: 0.92 },
  /** Drawn by the recovery, with no product in the export at all. */
  unmatched: { fill: "#7d6bb0", stroke: "#4c3d78", opacity: 0.42 },
} as const;

/**
 * South-east isometric, the studio's default camera. Z is up and in feet, as
 * everywhere else in this repo. `depth` orders the painter's algorithm: larger
 * is nearer the viewer.
 */
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);
function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS30, (x + y) * SIN30 - z];
}
function depthOf(x: number, y: number, z: number): number {
  return x + y + z;
}

type Silhouette = { points: Point2[]; depth: number; area: number };

function hull(points: Point2[]): Point2[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (source: Point2[]) => {
    const out: Point2[] = [];
    for (const point of source) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

function ringArea(ring: Point2[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const here = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += here[0] * next[1] - next[0] * here[1];
  }
  return Math.abs(total) / 2;
}

function silhouetteOf(projected: Point2[], depth: number): Silhouette | null {
  const ring = hull(projected);
  if (ring.length < 3) return null;
  const area = ringArea(ring);
  return area >= MIN_SILHOUETTE_SQ_UNITS ? { points: ring, depth, area } : null;
}

/**
 * The world points of what the viewer draws for a record, following the same
 * precedence `buildBoundsMeshes` uses. `drawnBounds` already follows it and
 * returns an axis-aligned box, which would draw every element as a box; the
 * oriented routes are unpacked here so a wall at an angle is drawn at that
 * angle and a swept railing is drawn as its ribbon.
 */
function drawnWorldPoints(record: ElementBoundsRecord): [number, number, number][] {
  const points: [number, number, number][] = [];
  if (record.railPath) {
    for (const polyline of record.railPath.polylines) {
      for (const [x, y, z] of polyline) {
        points.push([x, y, z], [x, y, z + record.railPath.guardHeightFeet]);
      }
    }
    return points;
  }
  if (record.loops?.length) {
    const { min, max } = record.boundsFeet;
    for (const ring of record.loops) {
      for (const [x, y] of ring) points.push([x, y, min.z], [x, y, max.z]);
    }
    return points;
  }
  if (record.orientedBox) return record.orientedBox.map(([x, y, z]) => [x, y, z]);
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    for (const solid of solids) {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * solid.thickness * 0.5;
      const ny = (dx / length) * solid.thickness * 0.5;
      for (const end of [solid.start, solid.end]) {
        for (const sign of [1, -1]) {
          points.push(
            [end.x + nx * sign, end.y + ny * sign, solid.baseElevation],
            [end.x + nx * sign, end.y + ny * sign, solid.topElevation],
          );
        }
      }
    }
    return points;
  }
  if (record.arcs?.length) {
    for (const arc of record.arcs) {
      const sweep = arc.endAngle - arc.startAngle;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
      for (let step = 0; step <= steps; step += 1) {
        const angle = arc.startAngle + (sweep * step) / steps;
        const ux = Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x;
        const uy = Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y;
        for (const radius of [arc.radius - arc.thickness / 2, arc.radius + arc.thickness / 2]) {
          points.push(
            [arc.centre.x + radius * ux, arc.centre.y + radius * uy, arc.baseElevation],
            [arc.centre.x + radius * ux, arc.centre.y + radius * uy, arc.topElevation],
          );
        }
      }
    }
    return points;
  }
  const box = drawnBounds(record);
  for (const x of [box[0]!, box[3]!]) {
    for (const y of [box[1]!, box[4]!]) {
      for (const z of [box[2]!, box[5]!]) points.push([x, y, z]);
    }
  }
  return points;
}

/**
 * One layer as a single `<path>`, painted far-to-near so a near wall covers the
 * one behind it rather than the other way round.
 */
function layer(
  shapes: Silhouette[],
  place: (point: Point2) => [number, number],
  originX: number,
  style: { fill: string; stroke: string; opacity: number },
): string {
  if (!shapes.length) return "";
  const parts: string[] = [];
  for (const shape of [...shapes].sort((a, b) => a.depth - b.depth)) {
    for (let index = 0; index < shape.points.length; index += 1) {
      const [x, y] = place(shape.points[index]!);
      parts.push(`${index === 0 ? "M" : "L"}${(x + originX).toFixed(1)} ${y.toFixed(1)}`);
    }
    parts.push("Z");
  }
  return (
    `<path d="${parts.join("")}" fill="${style.fill}" fill-opacity="${style.opacity}" ` +
    `stroke="${style.stroke}" stroke-opacity="0.45" stroke-width="0.35"/>`
  );
}

export function renderComparison(
  recovered: Silhouette[],
  exported: Silhouette[],
  missing: Silhouette[],
  unmatched: Silhouette[],
  counts: { recovered: number; exported: number; missing: number; heldBack: number },
): string {
  // One frame for all three panels. Framing on the export alone would hide a
  // recovered element that escapes the building, which is the thing the hull
  // assertion exists to catch.
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const shapes of [recovered, exported, unmatched]) {
    for (const shape of shapes) {
      for (const [u, v] of shape.points) {
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  const span = Math.max(maxU - minU, maxV - minV) || 1;
  const scale = (PANEL - 2 * PAD) / span;
  const offsetU = PAD + ((PANEL - 2 * PAD) - (maxU - minU) * scale) / 2;
  const offsetV = PAD + ((PANEL - 2 * PAD) - (maxV - minV) * scale) / 2;
  const place = ([u, v]: Point2): [number, number] => [
    offsetU + (u - minU) * scale,
    offsetV + (v - minV) * scale,
  ];

  const label = (text: string, originX: number, sub: string) =>
    `<text x="${originX + PAD}" y="${PAD + 4}" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="18" font-weight="600" fill="#1c2733">${text}</text>` +
    `<text x="${originX + PAD}" y="${PAD + 25}" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="13" fill="#6b7580">${sub}</text>`;
  const frame = (originX: number) =>
    `<rect x="${originX + 0.5}" y="0.5" width="${PANEL - 1}" height="${PANEL - 1}" ` +
    `fill="#fbfaf8" stroke="#e0ddd6"/>`;
  const n = (value: number) => value.toLocaleString();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL * 3}" height="${PANEL}" viewBox="0 0 ${PANEL * 3} ${PANEL}">
<rect width="${PANEL * 3}" height="${PANEL}" fill="#fbfaf8"/>
${frame(0)}${frame(PANEL)}${frame(PANEL * 2)}
${layer(unmatched, place, 0, STYLE.unmatched)}
${layer(recovered, place, 0, STYLE.recovered)}
${layer(exported, place, PANEL, STYLE.exported)}
${layer(exported, place, PANEL * 2, STYLE.exported)}
${layer(recovered, place, PANEL * 2, STYLE.recovered)}
${layer(missing, place, PANEL * 2, STYLE.missing)}
${label("Recovered from the RVT", 0, `${n(counts.recovered)} drawn as the viewer draws them` + (unmatched.length ? `, ${n(unmatched.length)} with no export product in violet` : ""))}
${label("The paired IFC export", PANEL, `${n(counts.exported)} products, ground truth`)}
${label("Overlay", PANEL * 2, `${n(counts.missing)} in the export and not recovered, in red`)}
</svg>
`;
}

if (isEntryPoint(import.meta.url)) {
  const matchedOnly = hasFlag("--matched-only");
  const [rvtPath, ifcPath, outPath] = positionals();
  if (!rvtPath || !ifcPath || !outPath) {
    console.error("usage: compare-view.ts <model.rvt> <model.ifc> <out.svg> [--matched-only]");
    process.exit(2);
  }

  const outcome = convertModel(rvtPath);
  // The scene, not every record: the wrappers and sheets the selection holds
  // back are exactly the storey-sized envelopes that would cover everything.
  const selection = selectDisplayBounds(outcome.elementBounds);
  const drawnIds = new Set(selection.records.map((record) => record.elementId));

  // The export's vertices, projected as they stream so the whole cloud never
  // has to be held at once.
  const byTag = new Map<number, { projected: Point2[]; depth: number }>();
  await streamTruthVertices(ifcPath, (tag, _type, x, y, z) => {
    const entry = byTag.get(tag) ?? { projected: [], depth: -Infinity };
    entry.projected.push(project(x, y, z));
    entry.depth = Math.max(entry.depth, depthOf(x, y, z));
    byTag.set(tag, entry);
  });

  // An element the recovery draws that the export has no product for at all is
  // a different thing from one drawn in the wrong place, and mixing them makes
  // the picture unreadable: on the supplied project 63 storey-sized floor
  // records the export never names carry 1.74 million sq ft of plan, three
  // quarters of the excess, and they cover the building they sit over. They are
  // drawn apart, in violet, and `--matched-only` leaves them out entirely.
  const recovered: Silhouette[] = [];
  const unmatched: Silhouette[] = [];
  for (const record of selection.records) {
    const world = drawnWorldPoints(record);
    if (!world.length) continue;
    let depth = 0;
    const projected: Point2[] = [];
    for (const [x, y, z] of world) {
      projected.push(project(x, y, z));
      depth = Math.max(depth, depthOf(x, y, z));
    }
    const shape = silhouetteOf(projected, depth);
    if (!shape) continue;
    if (byTag.has(record.elementId)) recovered.push(shape);
    else if (!matchedOnly) unmatched.push(shape);
  }

  const exported: Silhouette[] = [];
  const missing: Silhouette[] = [];
  for (const [tag, entry] of byTag) {
    const shape = silhouetteOf(entry.projected, entry.depth);
    if (!shape) continue;
    exported.push(shape);
    if (!drawnIds.has(tag)) missing.push(shape);
  }

  const svg = renderComparison(recovered, exported, missing, unmatched, {
    recovered: recovered.length,
    exported: exported.length,
    missing: missing.length,
    heldBack: selection.omittedWrapperCount + selection.omittedSheetCount,
  });
  writeFileSync(outPath, svg);
  console.log(
    `${outPath}  ${(svg.length / 1e6).toFixed(1)} MB  ` +
      `${recovered.length} matched, ${unmatched.length} with no export product, ` +
      `${exported.length} exported, ${missing.length} missing, ` +
      `${selection.omittedWrapperCount + selection.omittedSheetCount} held back`,
  );
}
