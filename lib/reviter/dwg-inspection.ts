import { convertDwgEntities, dwgBlockDefinitions } from "./dwg-entities.ts";
import { dwgSectionSvg, entityBounds, unionBounds, type DwgBounds, type DwgEntity } from "./dwg-plan.ts";

export type DwgMatch = { bounds: DwgBounds; handle?: string; attributes?: { tag: string; value: string }[] };
export type DwgInspectionGroup = {
  id: string; name: string; kind: "block" | "repeat"; layer: string;
  instances: DwgMatch[]; previewSvg: string; entityCount: number;
};

function padded(box: DwgBounds): DwgBounds {
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * .08;
  return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
}

function geometryBounds(entities: readonly DwgEntity[]): DwgBounds | null {
  return unionBounds(entities.map(entityBounds).filter((box): box is DwgBounds => box != null));
}

/** Source INSERT references, including attribute-only blocks. No room inference. */
export function dwgExistingBlocks(database: unknown, ownerHandle: string | null): DwgInspectionGroup[] {
  const raw = (database as { entities?: Record<string, unknown>[] }).entities ?? [];
  const blocks = dwgBlockDefinitions(database);
  const groups = new Map<string, DwgInspectionGroup>();
  for (const record of raw) {
    if (record.type !== "INSERT" || record.isVisible === false || typeof record.name !== "string") continue;
    if (ownerHandle && record.ownerBlockRecordSoftId !== ownerHandle) continue;
    const geometry = convertDwgEntities([record], { blocks, maxEntities: 10_000 });
    const attrs = Array.isArray(record.attribs) ? record.attribs as Record<string, unknown>[] : [];
    const attributeGeometry = convertDwgEntities(attrs);
    const bounds = geometryBounds([...geometry, ...attributeGeometry]);
    const origin = record.insertionPoint as { x?: number; y?: number } | undefined;
    const box = bounds ?? (Number.isFinite(origin?.x) && Number.isFinite(origin?.y)
      ? { minX: origin!.x!, minY: origin!.y!, maxX: origin!.x!, maxY: origin!.y! } : null);
    if (!box) continue;
    const attributes = attrs.flatMap(attr => {
      const content = typeof attr.text === "object" && attr.text ? attr.text as { text?: unknown } : attr;
      return typeof attr.tag === "string" && typeof content.text === "string"
        ? [{ tag: attr.tag, value: content.text }] : [];
    });
    let group = groups.get(record.name);
    if (!group) {
      const sample = geometry.length ? geometry : attributeGeometry;
      group = { id: `block:${record.name}`, name: record.name, kind: "block", layer: String(record.layer ?? "0"),
        instances: [], previewSvg: dwgSectionSvg(sample, padded(box)), entityCount: sample.length };
      groups.set(record.name, group);
    }
    group.instances.push({ bounds: box, ...(typeof record.handle === "string" ? { handle: record.handle } : {}),
      ...(attributes.length ? { attributes } : {}) });
  }
  return [...groups.values()].sort((a, b) => b.instances.length - a.instances.length || a.name.localeCompare(b.name));
}

const rounded = (value: number) => Math.round(value * 10_000) / 10_000;

/** Translation-only geometry matching, scoped by layer and size. These are candidates, not classified objects. */
export function dwgRepeatedShapes(entities: readonly DwgEntity[]): DwgInspectionGroup[] {
  const shapes = entities.filter(entity => !entity.text && entityBounds(entity));
  const parent = shapes.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]!; }
    return index;
  };
  const endpoints = new Map<string, number>();
  shapes.forEach((entity, index) => {
    // Closed primitives stand alone; open runs join only at measured endpoints.
    const points = entity.points && !entity.closed ? [entity.points[0]!, entity.points.at(-1)!]
      : entity.centre && entity.radius != null && entity.startAngle != null && entity.endAngle != null
        ? [entity.startAngle, entity.endAngle].map(angle => [entity.centre![0] + entity.radius! * Math.cos(angle), entity.centre![1] + entity.radius! * Math.sin(angle)]) : [];
    for (const point of points) {
      const key = `${entity.layer}:${rounded(point[0]!)}:${rounded(point[1]!)}`;
      const other = endpoints.get(key);
      if (other != null) parent[root(index)] = root(other); else endpoints.set(key, index);
    }
  });
  const components = new Map<number, DwgEntity[]>();
  shapes.forEach((entity, index) => {
    const id = root(index); const list = components.get(id);
    if (list) list.push(entity); else components.set(id, [entity]);
  });
  const groups = new Map<string, DwgInspectionGroup>();
  for (const component of components.values()) {
    if (component.length > 96 || (component.length < 2 && !component[0]!.closed && component[0]!.radius == null)) continue;
    const box = geometryBounds(component)!;
    if (!(box.maxX > box.minX && box.maxY > box.minY)) continue;
    const xy = (point: readonly number[]) => `${rounded(point[0]! - box.minX)},${rounded(point[1]! - box.minY)}`;
    const signature = component.map(entity => {
      if (entity.points) {
        const points = entity.points.map(xy);
        const forward = points.join(";"); const reverse = [...points].reverse().join(";");
        return `${entity.layer}:points:${!!entity.closed}:${forward < reverse ? forward : reverse}`;
      }
      return `${entity.layer}:arc:${xy(entity.centre!)}:${rounded(entity.radius!)}:${entity.startAngle == null ? "circle" : rounded(entity.startAngle)}:${entity.endAngle == null ? "circle" : rounded(entity.endAngle)}`;
    }).sort().join("|");
    let group = groups.get(signature);
    if (!group) {
      group = { id: `repeat:${groups.size}`, name: "Repeated shape", kind: "repeat", layer: component[0]!.layer,
        instances: [], previewSvg: dwgSectionSvg(component, padded(box)), entityCount: component.length };
      groups.set(signature, group);
    }
    // Duplicate overlaid entities are not additional occurrences.
    if (!group.instances.some(instance => Math.abs(instance.bounds.minX - box.minX) < .0001 && Math.abs(instance.bounds.minY - box.minY) < .0001)) {
      group.instances.push({ bounds: box });
    }
  }
  return [...groups.values()].filter(group => group.instances.length > 1)
    .sort((a, b) => b.instances.length - a.instances.length || b.entityCount - a.entityCount)
    .slice(0, 200).map((group, index) => ({ ...group, name: `Shape ${index + 1}` }));
}

export function dwgBoundsOverlap(a: DwgBounds, b: DwgBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Highlights use the same model coordinates as the generated plan. */
export function dwgHighlightSvg(svg: string, matches: readonly DwgMatch[]): string {
  const boxes = matches.map(({ bounds: box }) => {
    const b = padded(box);
    return `<rect x="${b.minX}" y="${-b.maxY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  return svg.replace("</svg>", `<g data-dwg-highlights="true" fill="#62d7d1" fill-opacity=".12" stroke="#62d7d1" stroke-width="2" vector-effect="non-scaling-stroke">${boxes}</g></svg>`);
}
