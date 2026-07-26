/**
 * A plan comparison of the recovery against its paired export, as one SVG.
 *
 *   node --experimental-strip-types scripts/compare-view.ts model.rvt model.ifc out.svg
 *
 * ## Why this exists
 *
 * The studio can already draw the overlay, and does it better — in 3D, shaded,
 * navigable. What it cannot do is be fast: parsing an 83 MB IFC through web-ifc
 * in a browser tab takes the better part of an hour, which is too slow to look
 * at after every change to a decoder rule.
 *
 * This renders the same comparison from node in the time one conversion takes,
 * so a change can be *seen* and not only scored. It is deliberately a plan view:
 * plan is where a footprint drawn as the wrong rectangle is obvious, which is
 * the class of defect the numbers are worst at conveying.
 *
 * Three panels, all in one frame and at one scale so they can be compared by
 * eye without measuring:
 *
 *   - **recovered** — what the viewer draws, following the same precedence
 *   - **export** — the paired IFC, the ground truth
 *   - **overlay** — both, with elements the export holds and the recovery does
 *     not picked out
 *
 * Each element is drawn as the convex hull of its plan points rather than its
 * full outline. That is a deliberate simplification: 35,000 exact outlines make
 * an SVG no browser will open, and the hull preserves the thing being judged —
 * whether the shape sits where the export's does and covers what it covers.
 */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { drawnPlanPoints, hull, readTruthFootprints, type Point2 } from "./footprint-audit.ts";

import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

/** Panel size in SVG units; three of these sit side by side. */
const PANEL = 900;

/** Margin inside each panel, so nothing touches the frame. */
const PAD = 24;

/** Elements smaller than this in plan are dropped: they are noise at this scale. */
const MIN_PLAN_SQ_FEET = 0.5;

const STYLE = {
  recovered: { fill: "#e8a33d", stroke: "#b3762180", opacity: 0.55 },
  export: { fill: "#8fa4bd", stroke: "#5c718c80", opacity: 0.55 },
  missing: { fill: "#d8443c", stroke: "#a32f2880", opacity: 0.85 },
} as const;

type Shape = { points: Point2[]; area: number };

function planArea(ring: Point2[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const here = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += here[0] * next[1] - next[0] * here[1];
  }
  return Math.abs(total) / 2;
}

function toShape(points: Point2[]): Shape | null {
  if (points.length < 3) return null;
  const ring = hull(points);
  if (ring.length < 3) return null;
  const area = planArea(ring);
  return area >= MIN_PLAN_SQ_FEET ? { points: ring, area } : null;
}

/** World feet to panel units, y flipped so north is up. */
function projector(box: [number, number, number, number]) {
  const [minX, minY, maxX, maxY] = box;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (PANEL - 2 * PAD) / span;
  const offsetX = PAD + ((PANEL - 2 * PAD) - (maxX - minX) * scale) / 2;
  const offsetY = PAD + ((PANEL - 2 * PAD) - (maxY - minY) * scale) / 2;
  return (x: number, y: number): [number, number] => [
    offsetX + (x - minX) * scale,
    PANEL - (offsetY + (y - minY) * scale),
  ];
}

function pathFor(
  shape: Shape,
  project: (x: number, y: number) => [number, number],
  originX: number,
): string {
  const parts: string[] = [];
  for (let index = 0; index < shape.points.length; index += 1) {
    const [x, y] = project(shape.points[index]![0], shape.points[index]![1]);
    parts.push(`${index === 0 ? "M" : "L"}${(x + originX).toFixed(1)} ${y.toFixed(1)}`);
  }
  return `${parts.join("")}Z`;
}

/**
 * One layer of shapes as a single `<path>`. Merging them matters: 35,000
 * separate elements is an SVG that takes seconds to parse and megabytes to
 * hold, and nothing here needs them individually addressable. Largest first, so
 * a slab does not cover the walls standing on it.
 */
function layer(
  shapes: Shape[],
  project: (x: number, y: number) => [number, number],
  originX: number,
  style: { fill: string; stroke: string; opacity: number },
): string {
  if (!shapes.length) return "";
  const d = [...shapes]
    .sort((a, b) => b.area - a.area)
    .map((shape) => pathFor(shape, project, originX))
    .join("");
  return (
    `<path d="${d}" fill="${style.fill}" fill-opacity="${style.opacity}" ` +
    `stroke="${style.stroke}" stroke-width="0.4" fill-rule="evenodd"/>`
  );
}

export function renderComparison(
  records: ElementBoundsRecord[],
  truth: Map<number, { type: string; points: Point2[] }>,
): string {
  const recovered: Shape[] = [];
  const drawnIds = new Set<number>();
  for (const record of records) {
    const shape = toShape(drawnPlanPoints(record));
    if (!shape) continue;
    recovered.push(shape);
    drawnIds.add(record.elementId);
  }

  const exported: Shape[] = [];
  const missing: Shape[] = [];
  for (const [elementId, product] of truth) {
    const shape = toShape(product.points);
    if (!shape) continue;
    exported.push(shape);
    if (!drawnIds.has(elementId)) missing.push(shape);
  }

  // One frame for all three panels, so they share a scale and can be compared
  // by eye. Framing on the export alone would hide a recovered element that
  // escapes the building.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shapes of [recovered, exported]) {
    for (const shape of shapes) {
      for (const [x, y] of shape.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const project = projector([minX, minY, maxX, maxY]);

  const label = (text: string, originX: number, sub: string) =>
    `<text x="${originX + PAD}" y="${PAD + 6}" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="17" font-weight="600" fill="#1f2933">${text}</text>` +
    `<text x="${originX + PAD}" y="${PAD + 26}" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="13" fill="#66707a">${sub}</text>`;

  const frame = (originX: number) =>
    `<rect x="${originX + 0.5}" y="0.5" width="${PANEL - 1}" height="${PANEL - 1}" ` +
    `fill="#fbfaf7" stroke="#dfdcd4"/>`;

  const count = (n: number) => n.toLocaleString();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL * 3}" height="${PANEL}" viewBox="0 0 ${PANEL * 3} ${PANEL}">
<rect width="${PANEL * 3}" height="${PANEL}" fill="#fbfaf7"/>
${frame(0)}${frame(PANEL)}${frame(PANEL * 2)}
${layer(recovered, project, 0, STYLE.recovered)}
${layer(exported, project, PANEL, STYLE.export)}
${layer(exported, project, PANEL * 2, STYLE.export)}
${layer(recovered, project, PANEL * 2, STYLE.recovered)}
${layer(missing, project, PANEL * 2, STYLE.missing)}
${label("Recovered from the RVT", 0, `${count(recovered.length)} element footprints, no IFC involved`)}
${label("The paired IFC export", PANEL, `${count(exported.length)} products, ground truth`)}
${label("Overlay", PANEL * 2, `${count(missing.length)} in the export and not recovered, in red`)}
</svg>
`;
}

function isEntryPoint(): boolean {
  const invoked = process.argv[1] ?? "";
  return invoked.endsWith("compare-view.ts") || invoked.endsWith("compare-view.js");
}

if (isEntryPoint()) {
  const [rvtPath, ifcPath, outPath] = process.argv.slice(2);
  if (!rvtPath || !ifcPath || !outPath) {
    console.error("usage: compare-view.ts <model.rvt> <model.ifc> <out.svg>");
    process.exit(2);
  }
  const truth = await readTruthFootprints(ifcPath);
  const outcome = convertModel(rvtPath);
  const svg = renderComparison(outcome.elementBounds, truth);
  writeFileSync(outPath, svg);
  console.log(`${outPath}  ${(svg.length / 1e6).toFixed(1)} MB`);
}
