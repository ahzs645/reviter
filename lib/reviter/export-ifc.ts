/**
 * IFC4 Reference View export of Reviter's recovered model.
 *
 * The first implementation of this module exported every recovered element as
 * an axis-aligned `IfcBuildingElementProxy`. That was a useful smoke test for
 * STEP emission, but it threw away the per-triangle element ownership, native
 * categories, levels, identities, materials, types and host relationships that
 * the converter now recovers. The exporter below deliberately consumes those
 * facts from `ConvertResult` rather than scraping the Three.js scene.
 *
 * Geometry fidelity and semantic identity are kept separate. A natively named
 * wall may be emitted as `IfcWall` while its `Reviter_Recovery` property set
 * still says that its body is reconstructed or a bounds fallback. This keeps
 * the IFC useful without claiming that an approximate stair, door or wall is
 * exact native geometry.
 */
import { elementManifest } from "./export-report.ts";
import { outputName } from "./export-naming.ts";
import { stairAssemblyParts } from "./stair-assemblies.ts";
import { spacePredefinedType } from "./room-review.ts";

import type {
  ConvertResult,
  ElementBoundsRecord,
  MaterialData,
  MeshGeometrySource,
} from "./types.ts";
import type { ReviewedRoom } from "./room-review.ts";

const METRES_PER_FOOT = 0.3048;
const IFC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

type ManifestElement = ReturnType<typeof elementManifest>[number];

type GeometryFragment = {
  name?: string;
  positions: number[];
  indices: number[];
  materialIndex: number;
  source: MeshGeometrySource | undefined;
};

type IfcClass = {
  entity: string;
  typeEntity: string;
  predefinedType: string;
};

export type IfcExportOptions = {
  /** Only accepted rooms with `ifc.export` enabled become IfcSpace entities. */
  rooms?: readonly ReviewedRoom[];
};

class StepWriter {
  readonly entities: string[] = [];

  add(expression: string): number {
    const id = this.entities.length + 1;
    this.entities.push(`#${id}=${expression};`);
    return id;
  }

  ref(id: number): string {
    return `#${id}`;
  }

  refs(ids: readonly number[]): string {
    return `(${ids.map((id) => `#${id}`).join(",")})`;
  }
}

function fnv1a64(value: string, seed: bigint): bigint {
  let hash = seed & UINT64_MASK;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & UINT64_MASK;
  }
  return hash;
}

/** A deterministic, valid 128-bit IFC compressed GUID. */
function compressedIfcGuid(value: string): string {
  const high = fnv1a64(value, 0xcbf29ce484222325n);
  const low = fnv1a64([...value].reverse().join(""), 0x84222325cbf29ce4n);
  let number = (high << 64n) | low;
  const result = new Array<string>(22).fill("0");
  for (let index = result.length - 1; index >= 0; index -= 1) {
    result[index] = IFC_ALPHABET[Number(number & 63n)]!;
    number >>= 6n;
  }
  return result.join("");
}

function guidNamespace(result: ConvertResult): string {
  const identities = result.nativeIdentity?.identities ?? [];
  if (identities.length) {
    return `revit:${identities[0]!.uniqueId}:${identities.at(-1)!.uniqueId}:${identities.length}`;
  }
  return [
    "reviter-fallback",
    result.fileName,
    result.byteLength,
    result.origin.x,
    result.origin.y,
    result.origin.z,
    result.elementBounds.length,
  ].join(":");
}

function guidFor(namespace: string, kind: string, key: string | number): string {
  return compressedIfcGuid(`${namespace}:${kind}:${key}`);
}

/** Encode non-ASCII text using STEP's UTF-16 `X2` escape. */
function ifcText(value: string): string {
  const normalized = value.replace(/[\r\n]+/g, " ");
  let result = "";
  let unicode = "";
  const flushUnicode = () => {
    if (!unicode) return;
    let encoded = "";
    for (let index = 0; index < unicode.length; index += 1) {
      encoded += unicode.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
    }
    result += `\\X2\\${encoded}\\X0\\`;
    unicode = "";
  };
  for (const character of normalized) {
    const code = character.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      flushUnicode();
      if (character === "'") result += "''";
      else if (character === "\\") result += "\\\\";
      else result += character;
    } else {
      unicode += character;
    }
  }
  flushUnicode();
  return result;
}

function quoted(value: string): string {
  return `'${ifcText(value)}'`;
}

/**
 * A conforming ISO 10303-21 REAL literal.
 *
 * The STEP grammar is `[SIGN] DIGIT {DIGIT} "." {DIGIT} [ "E" [SIGN] DIGIT
 * {DIGIT} ]`. The decimal point is mandatory and the exponent is optional, so
 * exponent notation stays available for magnitudes that genuinely need it —
 * provided the mantissa still carries the point. JavaScript's `String` switches
 * to exponent form below 1e-6 and at or above 1e21, and normalises the mantissa
 * to a single leading digit, so it hands back `1e-9` and `1e+21`: no point, and
 * therefore not a REAL at all. Both are reachable here, from coordinates that
 * land just off the local origin after the `-origin` subtraction and from raw
 * Revit parameter doubles, which `realProperty` emits unfiltered.
 *
 * `web-ifc` accepts the malformed forms, so a round-trip cannot be the only
 * check on this; the exported text itself has to be conforming.
 */
function ifcNumber(value: number): string {
  // A NaN or infinite measure has no STEP spelling. Zero is the honest stand-in
  // for a value the recovery could not establish, and it keeps the literal
  // parseable rather than emitting a token that halts a reader mid-file.
  if (!Number.isFinite(value)) return "0.";
  // Denormals, negative zero and sub-picometre coordinate noise collapse to a
  // plain zero instead of riding out as an exponent nobody downstream wants.
  if (Math.abs(value) < 5e-12) return "0.";
  const text = String(Number(value.toPrecision(12)));
  const exponent = text.indexOf("e");
  if (exponent < 0) return text.includes(".") ? text : `${text}.`;
  const mantissa = text.slice(0, exponent);
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.`}E${text.slice(exponent + 1)}`;
}

function feet(value: number): string {
  return ifcNumber(value * METRES_PER_FOOT);
}

function optionalPositiveFeet(value: number): string {
  return Number.isFinite(value) && value > 0 ? feet(value) : "$";
}

/**
 * `BuiltInCategory` id to IFC class.
 *
 * Keyed by id, not by the category's display name. The display name is what
 * Revit prints, it is not stable, and keying behaviour on it makes an export
 * class silently depend on a label: when `OST_CurtainWallPanels` started
 * reading "Curtain Panels" rather than "Curtain Wall Panels", a name-keyed
 * switch quietly demoted every curtain panel in the model to a proxy. Ids do
 * not move.
 *
 * `OST_StructuralFraming` is mapped to `IFCMEMBER` rather than `IFCBEAM`, and
 * `OST_Ceilings` to `IFCCOVERING`, because that is what the name-keyed table
 * did. Its `beams`, `members`, `coverings`, `plates`, `foundations` and
 * `structural foundations` arms never matched any Revit category name and so
 * never ran; they are not carried over rather than guessed at.
 */
const IFC_CLASS_BY_CATEGORY: ReadonlyMap<number, readonly [string, string?]> = new Map([
  [-2_000_011, ["IFCWALL"]],
  [-2_000_032, ["IFCSLAB", ".FLOOR."]],
  [-2_000_035, ["IFCROOF"]],
  [-2_000_038, ["IFCCOVERING", ".CEILING."]],
  [-2_000_023, ["IFCDOOR", ".DOOR."]],
  [-2_000_014, ["IFCWINDOW", ".WINDOW."]],
  [-2_000_100, ["IFCCOLUMN"]],
  [-2_001_330, ["IFCCOLUMN"]],
  [-2_001_320, ["IFCMEMBER"]],
  [-2_000_171, ["IFCMEMBER"]],
  [-2_000_170, ["IFCPLATE"]],
  [-2_000_120, ["IFCSTAIR"]],
  [-2_000_919, ["IFCSTAIRFLIGHT"]],
  [-2_000_175, ["IFCRAILING"]],
  [-2_000_126, ["IFCRAILING"]],
  [-2_000_920, ["IFCSLAB", ".LANDING."]],
  [-2_000_946, ["IFCMEMBER"]],
  [-2_000_127, ["IFCMEMBER"]],
  [-2_000_123, ["IFCMEMBER"]],
  [-2_000_080, ["IFCFURNITURE"]],
  [-2_001_100, ["IFCFURNITURE"]],
  [-2_000_180, ["IFCRAMP"]],
]);

function ifcClassFor(element: ManifestElement): IfcClass {
  const mapped = element.category?.id == null
    ? undefined
    : IFC_CLASS_BY_CATEGORY.get(element.category.id);
  const [entity, predefinedType = ".NOTDEFINED."] = mapped ?? ["IFCBUILDINGELEMENTPROXY"];
  return { entity, typeEntity: `${entity}TYPE`, predefinedType };
}

function collectGeometry(result: ConvertResult): {
  byElement: Map<number, GeometryFragment[]>;
  unowned: GeometryFragment[];
} {
  const byElement = new Map<number, GeometryFragment[]>();
  const unowned: GeometryFragment[] = [];
  for (const mesh of result.meshes) {
    const triangleIds = mesh.elementIds;
    if (!mesh.indices.length || !mesh.positions.length) continue;
    if (!triangleIds?.length) {
      unowned.push({
        name: mesh.name,
        positions: Array.from(mesh.positions, (value) => value * METRES_PER_FOOT),
        indices: Array.from(mesh.indices, (value) => value + 1),
        materialIndex: mesh.materialIndex,
        source: mesh.source,
      });
      continue;
    }
    const facesByElement = new Map<number, number[]>();
    const faceCount = Math.min(triangleIds.length, Math.floor(mesh.indices.length / 3));
    for (let face = 0; face < faceCount; face += 1) {
      const elementId = triangleIds[face]!;
      const faces = facesByElement.get(elementId) ?? [];
      faces.push(face);
      facesByElement.set(elementId, faces);
    }
    for (const [elementId, faces] of facesByElement) {
      const vertexMap = new Map<number, number>();
      const positions: number[] = [];
      const indices: number[] = [];
      for (const face of faces) {
        for (let corner = 0; corner < 3; corner += 1) {
          const sourceIndex = mesh.indices[face * 3 + corner]!;
          let targetIndex = vertexMap.get(sourceIndex);
          if (targetIndex == null) {
            const offset = sourceIndex * 3;
            if (offset + 2 >= mesh.positions.length) continue;
            targetIndex = positions.length / 3;
            vertexMap.set(sourceIndex, targetIndex);
            positions.push(
              mesh.positions[offset]! * METRES_PER_FOOT,
              mesh.positions[offset + 1]! * METRES_PER_FOOT,
              mesh.positions[offset + 2]! * METRES_PER_FOOT,
            );
          }
          indices.push(targetIndex + 1);
        }
      }
      if (!positions.length || indices.length < 3) continue;
      const fragments = byElement.get(elementId) ?? [];
      fragments.push({
        name: mesh.name,
        positions,
        indices,
        materialIndex: mesh.materialIndex,
        source: mesh.source,
      });
      byElement.set(elementId, fragments);
    }
  }
  return { byElement, unowned };
}

function boxDimensions(record: ManifestElement): { width: number; depth: number; height: number } {
  const { min, max } = record.geometry.boundsFeet;
  return {
    width: Math.max(0, max.x - min.x),
    depth: Math.max(0, max.y - min.y),
    height: Math.max(0, max.z - min.z),
  };
}

function elementName(element: ManifestElement): string {
  const family = element.type?.familyName?.trim();
  const type = element.type?.name?.trim();
  if (family) return `${family}:${type ?? family}:${element.elementId}`;
  if (type) return `${element.category?.name ?? "Revit"}:${type}:${element.elementId}`;
  return `${element.category?.name ?? "Revit element"} ${element.elementId}`;
}

function emitStyle(writer: StepWriter, material: MaterialData): number {
  const [red, green, blue, alpha] = material.baseColorLinear;
  const colour = writer.add(
    `IFCCOLOURRGB($,${ifcNumber(Math.max(0, Math.min(1, red)))},${ifcNumber(Math.max(0, Math.min(1, green)))},${ifcNumber(Math.max(0, Math.min(1, blue)))})`,
  );
  const shading = writer.add(
    `IFCSURFACESTYLESHADING(#${colour},${ifcNumber(Math.max(0, Math.min(1, 1 - alpha)))})`,
  );
  return writer.add(`IFCSURFACESTYLE(${quoted(material.name)},.BOTH.,(#${shading}))`);
}

function emitTessellatedShape(
  writer: StepWriter,
  context: number,
  fragments: readonly GeometryFragment[],
  styleByMaterial: ReadonlyMap<number, number>,
): number | null {
  const items: number[] = [];
  for (const fragment of fragments) {
    const points: string[] = [];
    for (let index = 0; index + 2 < fragment.positions.length; index += 3) {
      points.push(
        `(${ifcNumber(fragment.positions[index]!)},${ifcNumber(fragment.positions[index + 1]!)},${ifcNumber(fragment.positions[index + 2]!)})`,
      );
    }
    const triangles: string[] = [];
    for (let index = 0; index + 2 < fragment.indices.length; index += 3) {
      triangles.push(`(${fragment.indices[index]},${fragment.indices[index + 1]},${fragment.indices[index + 2]})`);
    }
    if (!points.length || !triangles.length) continue;
    const coordinates = writer.add(`IFCCARTESIANPOINTLIST3D((${points.join(",")}))`);
    const faceSet = writer.add(
      `IFCTRIANGULATEDFACESET(#${coordinates},$,$,(${triangles.join(",")}),$)`,
    );
    const style = styleByMaterial.get(fragment.materialIndex);
    if (style) writer.add(`IFCSTYLEDITEM(#${faceSet},(#${style}),$)`);
    items.push(faceSet);
  }
  if (!items.length) return null;
  const representation = writer.add(
    `IFCSHAPEREPRESENTATION(#${context},'Body','Tessellation',${writer.refs(items)})`,
  );
  return writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
}

function emitBoundsShape(
  writer: StepWriter,
  context: number,
  extrusionDirection: number,
  element: ManifestElement,
  origin: ConvertResult["origin"],
): number | null {
  const { min, max } = element.geometry.boundsFeet;
  const width = max.x - min.x;
  const depth = max.y - min.y;
  const height = max.z - min.z;
  if (width <= 0.001 || depth <= 0.001 || height <= 0.001) return null;
  const profileOrigin = writer.add("IFCCARTESIANPOINT((0.,0.))");
  const profilePosition = writer.add(`IFCAXIS2PLACEMENT2D(#${profileOrigin},$)`);
  const location = writer.add(
    `IFCCARTESIANPOINT((${feet((min.x + max.x) / 2 - origin.x)},${feet((min.y + max.y) / 2 - origin.y)},${feet(min.z - origin.z)}))`,
  );
  const axis = writer.add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`);
  const profile = writer.add(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilePosition},${feet(width)},${feet(depth)})`,
  );
  const solid = writer.add(
    `IFCEXTRUDEDAREASOLID(#${profile},#${axis},#${extrusionDirection},${feet(height)})`,
  );
  const representation = writer.add(
    `IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`,
  );
  return writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
}

function emitRoomShape(
  writer: StepWriter,
  context: number,
  extrusionDirection: number,
  room: ReviewedRoom,
  baseElevation: number,
  origin: ConvertResult["origin"],
): number | null {
  const height = room.details.heightFeet;
  if (!(height != null && Number.isFinite(height) && height > 0.1)) return null;
  const valid = room.geometry.loopsFeet.filter((loop) => loop.length >= 3);
  if (!valid.length) return null;
  const area = (loop: readonly [number, number][]) => Math.abs(loop.reduce((sum, point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  const loops = [...valid].sort((left, right) => area(right) - area(left));
  const polyline = (loop: readonly [number, number][]) => {
    const points = loop.map(([x, y]) => writer.add(`IFCCARTESIANPOINT((${feet(x - origin.x)},${feet(y - origin.y)}))`));
    points.push(points[0]!);
    return writer.add(`IFCPOLYLINE(${writer.refs(points)})`);
  };
  const outer = polyline(loops[0]!);
  const profile = loops.length === 1
    ? writer.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${outer})`)
    : writer.add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,#${outer},${writer.refs(loops.slice(1).map(polyline))})`);
  const location = writer.add(`IFCCARTESIANPOINT((0.,0.,${feet(baseElevation - origin.z)}))`);
  const axis = writer.add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`);
  const solid = writer.add(`IFCEXTRUDEDAREASOLID(#${profile},#${axis},#${extrusionDirection},${feet(height)})`);
  const representation = writer.add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
  return writer.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
}

/**
 * A door or window's true opening width, from the footprint's own axes.
 *
 * `max(boundsFeet.width, boundsFeet.depth)` is the larger side of an
 * AXIS-ALIGNED box, which is the width only when the leaf happens to be
 * aligned with the model. A quarter of this building's walls sit at 58
 * degrees, and for a leaf of width w and thickness t at angle θ the box sides
 * are `w·|cosθ| + t·|sinθ|` and `w·|sinθ| + t·|cosθ|` -- so a 0.9 m leaf at 58
 * degrees reports 0.82 m, and the number moves with the angle, which a width
 * does not.
 *
 * The first principal axis of the plan footprint is the leaf's own long
 * direction whatever the wall's angle, so its extent is the width. Measured
 * against the paired Autodesk export of this building, the AABB rule leaves
 * 394 doors within a tenth of a cell of a `round(width / pitch)` boundary
 * where the export leaves 35.
 *
 * Returns null when the footprint has no dominant direction (a square stub),
 * where a computed width would be a coin toss and the caller should fall back.
 *
 * NB the fragments' positions are already in METRES -- `emitTessellatedShape`
 * converts them on the way in -- while `boxDimensions` and every other length
 * reaching `optionalPositiveFeet` is in feet. The extent is divided back so
 * the caller's unit stays uniform; without that the width is multiplied by
 * 0.3048 twice and a 3 ft door reports 0.28 m.
 */
function planarWidthFeet(fragments: readonly GeometryFragment[]): number | null {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (const fragment of fragments) {
    for (let index = 0; index + 2 < fragment.positions.length; index += 3) {
      sumX += fragment.positions[index]!;
      sumY += fragment.positions[index + 1]!;
      count += 1;
    }
  }
  if (count < 3) return null;
  const meanX = sumX / count;
  const meanY = sumY / count;

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const fragment of fragments) {
    for (let index = 0; index + 2 < fragment.positions.length; index += 3) {
      const dx = fragment.positions[index]! - meanX;
      const dy = fragment.positions[index + 1]! - meanY;
      xx += dx * dx;
      xy += dx * dy;
      yy += dy * dy;
    }
  }
  // Principal axis of the 2x2 covariance, in closed form.
  const trace = xx + yy;
  const diff = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
  const major = (trace + diff) / 2;
  const minor = (trace - diff) / 2;
  if (major <= 1e-9 || minor / major > 0.7) return null;   // no dominant axis
  const angle = Math.atan2(major - xx, xy || 1e-12);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);

  let low = Infinity;
  let high = -Infinity;
  for (const fragment of fragments) {
    for (let index = 0; index + 2 < fragment.positions.length; index += 3) {
      const projected = (fragment.positions[index]! - meanX) * axisX
        + (fragment.positions[index + 1]! - meanY) * axisY;
      if (projected < low) low = projected;
      if (projected > high) high = projected;
    }
  }
  const extent = (high - low) / METRES_PER_FOOT;
  return Number.isFinite(extent) && extent > 0 ? extent : null;
}

/** Revit's `BuiltInCategory.OST_Walls`, the only host a centreline is read from. */
const WALL_CATEGORY_ID = -2_000_011;

/** Below this a location line is a degenerate point, not a direction. */
const MIN_HOST_AXIS_LENGTH_FEET = 1e-3;

/**
 * How far the wall's own reading may fall below the box's largest side before
 * it is refused as an implausible width.
 *
 * A correct projection can legitimately read *smaller* than the box, and that
 * is the whole point of it: the box side of a swing footprint on a 32 degree
 * wall is 1.4x the opening. Swept over leaves and swings of 2.5 to 8 ft at
 * every whole degree, the worst honest ratio is 0.684 while reading a leaf
 * ACROSS its wall instead of along it never exceeds 0.165, so 0.5 separates
 * them. This is the second gate, not the first: a swing footprint is square,
 * so a crossed host reads a plausible number off it and only the centreline
 * check in `hostWallAxis` refuses that one.
 */
const MIN_HOST_PROJECTION_RATIO = 0.5;

type PlanAxis = { x: number; y: number };

/** Plan distance from `point` to the segment `ax,ay`..`bx,by`. */
function distanceToSegment(
  point: PlanAxis,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(point.x - ax, point.y - ay);
  const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length2));
  return Math.hypot(point.x - (ax + dx * t), point.y - (ay + dy * t));
}

/**
 * The direction the host wall's centreline runs beneath a hosted opening.
 *
 * A wall modelled as several runs carries one solid per run, so the run whose
 * location line passes closest to the opening is the one the opening sits in.
 * A curved host has no straight centreline and yields nothing; the caller
 * falls back rather than projecting onto a chord.
 */
function hostWallAxis(
  host: ElementBoundsRecord,
  centre: PlanAxis,
  reach: number,
): PlanAxis | null {
  const runs = host.solids?.length ? host.solids : host.solid ? [host.solid] : [];
  let best: { distance: number; axis: PlanAxis } | null = null;
  for (const run of runs) {
    const dx = run.end.x - run.start.x;
    const dy = run.end.y - run.start.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_HOST_AXIS_LENGTH_FEET) continue;
    const distance = distanceToSegment(centre, run.start.x, run.start.y, run.end.x, run.end.y);
    if (best && distance >= best.distance) continue;
    best = { distance, axis: { x: dx / length, y: dy / length } };
  }
  // A door is in its own wall. The persisted relation says which wall that is,
  // and this says the geometry agrees -- which rejects the case that would
  // otherwise be silent, a host resolved to the perpendicular wall at a corner.
  if (!best || best.distance > reach) return null;
  return best.axis;
}

/**
 * Host wall direction per hosted opening, keyed by the opening's element id.
 *
 * The relation itself is already resolved -- `makeIfcCenterlines` writes it out
 * as `IfcRelFillsElement` -- so this only has to follow it to the wall's own
 * rebuilt location line.
 */
function hostAxesByOpening(result: ConvertResult): Map<number, PlanAxis> {
  const axes = new Map<number, PlanAxis>();
  const relations = result.nativeHostRelations ?? [];
  if (!relations.length) return axes;
  const recordById = new Map(result.elementBounds.map((record) => [record.elementId, record]));
  for (const relation of relations) {
    const host = recordById.get(relation.hostId);
    const opening = recordById.get(relation.elementId);
    if (!host || !opening || host.categoryId !== WALL_CATEGORY_ID) continue;
    const { min, max } = opening.boundsFeet;
    const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
    // The record of a door with a modelled swing is the opening *plus* the arc,
    // so its centre sits off the wall by about half the leaf. Half the box's
    // plan diagonal covers that and still excludes a wall elsewhere.
    const reach = Math.hypot(max.x - min.x, max.y - min.y) / 2;
    const axis = hostWallAxis(host, centre, reach);
    if (axis) axes.set(relation.elementId, axis);
  }
  return axes;
}

/**
 * A hosted opening's width, read along the wall it is cut into.
 *
 * `planarWidthFeet` takes the footprint's own dominant direction, which is the
 * leaf's long axis only while the leaf is the whole footprint. It is not: a
 * door drawn with its swing is a quarter disc, whose dominant direction is a
 * diagonal, and the extent along that diagonal is the *swing*. Measured in
 * `tests/door-host-width.test.ts`, a 6 ft opening drawn with its swing reads
 * 2.62 m that way at every angle -- three whole voxel blocks of hole punched
 * for a two-block door.
 *
 * The wall's centreline is the direction that makes the number a width: an
 * opening's width is its extent along the wall it perforates, whatever the leaf
 * does in front of it and whatever angle the wall runs at.
 *
 * Returns null when there is no host axis or when the reading is implausibly
 * small against the box, so the caller keeps today's answer rather than a
 * worse one.
 */
function hostedWidthFeet(
  fragments: readonly GeometryFragment[],
  axis: PlanAxis | null,
): number | null {
  if (!axis) return null;
  let along = Infinity;
  let alongHigh = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const fragment of fragments) {
    for (let index = 0; index + 2 < fragment.positions.length; index += 3) {
      const x = fragment.positions[index]!;
      const y = fragment.positions[index + 1]!;
      const projected = x * axis.x + y * axis.y;
      if (projected < along) along = projected;
      if (projected > alongHigh) alongHigh = projected;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      count += 1;
    }
  }
  if (count < 3) return null;
  // The fragments are already in METRES -- `emitTessellatedShape` converts them
  // on the way in -- while every length reaching `optionalPositiveFeet` is in
  // feet. See the same note on `planarWidthFeet`.
  const extent = (alongHigh - along) / METRES_PER_FOOT;
  if (!Number.isFinite(extent) || extent <= 0) return null;
  const boxSide = Math.max(maxX - minX, maxY - minY) / METRES_PER_FOOT;
  if (extent < boxSide * MIN_HOST_PROJECTION_RATIO) return null;
  return extent;
}

function emitProduct(
  writer: StepWriter,
  ifcClass: IfcClass,
  guid: string,
  ownerHistory: number,
  element: ManifestElement,
  placement: number,
  shape: number | null,
  fragments: readonly GeometryFragment[] = [],
  hostAxis: PlanAxis | null = null,
): number {
  const name = quoted(elementName(element));
  const description = quoted(
    `Recovered from RVT; geometry=${element.geometry.finalProvenance}; evidence=${element.category?.evidence ?? "unknown"}.`,
  );
  const objectType = element.type?.name || element.type?.familyName
    ? quoted([element.type?.familyName, element.type?.name].filter(Boolean).join(":"))
    : "$";
  const common = [
    quoted(guid),
    `#${ownerHistory}`,
    name,
    description,
    objectType,
    `#${placement}`,
    shape ? `#${shape}` : "$",
    quoted(String(element.elementId)),
  ];
  const dimensions = boxDimensions(element);
  if (ifcClass.entity === "IFCDOOR") {
    const planar = hostedWidthFeet(fragments, hostAxis)
      ?? planarWidthFeet(fragments)
      ?? Math.max(dimensions.width, dimensions.depth);
    return writer.add(
      `IFCDOOR(${[...common, optionalPositiveFeet(dimensions.height), optionalPositiveFeet(planar), ".DOOR.", ".NOTDEFINED.", "$"].join(",")})`,
    );
  }
  if (ifcClass.entity === "IFCWINDOW") {
    const planar = hostedWidthFeet(fragments, hostAxis)
      ?? planarWidthFeet(fragments)
      ?? Math.max(dimensions.width, dimensions.depth);
    return writer.add(
      `IFCWINDOW(${[...common, optionalPositiveFeet(dimensions.height), optionalPositiveFeet(planar), ".WINDOW.", ".NOTDEFINED.", "$"].join(",")})`,
    );
  }
  if (ifcClass.entity === "IFCSTAIRFLIGHT") {
    // Riser count, tread count, riser height and tread length are `$` because
    // nothing decoded reads them off a flight; the shape enum is the class's,
    // which is `.NOTDEFINED.` unless the spiral replay proved otherwise.
    return writer.add(
      `IFCSTAIRFLIGHT(${[...common, "$", "$", "$", "$", ifcClass.predefinedType].join(",")})`,
    );
  }
  if (ifcClass.entity === "IFCBUILDINGELEMENTPROXY") {
    return writer.add(`IFCBUILDINGELEMENTPROXY(${common.join(",")},.NOTDEFINED.)`);
  }
  return writer.add(`${ifcClass.entity}(${common.join(",")},${ifcClass.predefinedType})`);
}

function emitTypeObject(
  writer: StepWriter,
  ifcClass: IfcClass,
  guid: string,
  ownerHistory: number,
  element: ManifestElement,
): number {
  const name = [element.type?.familyName, element.type?.name]
    .filter(Boolean)
    .join(":") || `${element.category?.name ?? "Revit"} type`;
  const common = [
    quoted(guid),
    `#${ownerHistory}`,
    quoted(name),
    "$",
    "$",
    "$",
    "$",
    element.type?.elementId == null ? "$" : quoted(String(element.type.elementId)),
    quoted(element.type?.name ?? name),
  ];
  if (ifcClass.typeEntity === "IFCDOORTYPE") {
    return writer.add(`IFCDOORTYPE(${[...common, ".DOOR.", ".NOTDEFINED.", ".F.", "$"].join(",")})`);
  }
  if (ifcClass.typeEntity === "IFCWINDOWTYPE") {
    return writer.add(`IFCWINDOWTYPE(${[...common, ".WINDOW.", ".NOTDEFINED.", ".F.", "$"].join(",")})`);
  }
  if (ifcClass.typeEntity === "IFCFURNITURETYPE") {
    return writer.add(`IFCFURNITURETYPE(${[...common, ".NOTDEFINED.", ".NOTDEFINED."].join(",")})`);
  }
  return writer.add(`${ifcClass.typeEntity}(${common.join(",")},${ifcClass.predefinedType})`);
}

function textProperty(writer: StepWriter, name: string, value: string): number {
  return writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCTEXT(${quoted(value)}),$)`);
}

function integerProperty(writer: StepWriter, name: string, value: number): number {
  return writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCINTEGER(${Math.trunc(value)}),$)`);
}

function realProperty(writer: StepWriter, name: string, value: number): number {
  return writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCREAL(${ifcNumber(value)}),$)`);
}

function booleanProperty(writer: StepWriter, name: string, value: boolean): number {
  return writer.add(`IFCPROPERTYSINGLEVALUE(${quoted(name)},$,IFCBOOLEAN(${value ? ".T." : ".F."}),$)`);
}

/**
 * Fidelity of a body assembled from render fragments alone.
 *
 * Elements that reached `elementManifest` report `renderGeometryProvenance`
 * directly; the triangle-owned bodies below have no such record, so their
 * verdict has to come from the batches their triangles arrived in. It uses the
 * same vocabulary and the same definition of exactness as
 * `emitElementProperties`: a paired-IFC body is an exact tessellated surface,
 * not an envelope, so it reports `reference-assisted` and `GeometryExact` true
 * rather than being lumped in with reconstructed proxies.
 */
function fragmentGeometryFidelity(
  fragments: readonly GeometryFragment[],
): { provenance: string; exact: boolean } {
  const exact = fragments.every((fragment) =>
    fragment.source === "native-brep" || fragment.source === "reference-ifc");
  if (!exact) return { provenance: "reconstructed", exact: false };
  const referenced = fragments.some((fragment) => fragment.source === "reference-ifc");
  return { provenance: referenced ? "reference-assisted" : "native", exact: true };
}

function emitElementProperties(
  writer: StepWriter,
  namespace: string,
  ownerHistory: number,
  product: number,
  element: ManifestElement,
  source: ElementBoundsRecord | undefined,
): void {
  const exact =
    element.geometry.finalProvenance === "native" ||
    element.geometry.finalProvenance === "reference-assisted";
  const properties = [
    integerProperty(writer, "RevitElementId", element.elementId),
    ...(element.uniqueId ? [textProperty(writer, "RevitUniqueId", element.uniqueId)] : []),
    ...(element.category?.id == null ? [] : [integerProperty(writer, "RevitCategoryId", element.category.id)]),
    ...(element.category?.name ? [textProperty(writer, "RevitCategory", element.category.name)] : []),
    textProperty(writer, "CategoryEvidence", element.category?.evidence ?? "unknown"),
    textProperty(writer, "GeometrySource", element.geometry.source),
    textProperty(writer, "GeometryProvenance", element.geometry.finalProvenance),
    booleanProperty(writer, "GeometryExact", exact),
    ...(source ? [textProperty(
      writer,
      "SourceRecord",
      `${source.stream}; chunk ${source.chunkIndex}; record 0x${source.recordOffset.toString(16)}`,
    )] : []),
  ];
  const propertySet = writer.add(
    `IFCPROPERTYSET(${quoted(guidFor(namespace, "pset-recovery", element.elementId))},#${ownerHistory},'Reviter_Recovery','Recovered-model fidelity and source evidence',${writer.refs(properties)})`,
  );
  writer.add(
    `IFCRELDEFINESBYPROPERTIES(${quoted(guidFor(namespace, "rel-recovery", element.elementId))},#${ownerHistory},$,$,(#${product}),#${propertySet})`,
  );

  if (!element.parameters.length) return;
  // Revit stores a parameter as a double, an integer or a string depending on
  // which of its value sets holds it, so the property follows the value.
  const parameterProperties = element.parameters.map((parameter) =>
    typeof parameter.value === "string"
      ? textProperty(writer, `${parameter.name} [${parameter.id}]`, parameter.value)
      : realProperty(writer, `${parameter.name} [${parameter.id}]`, parameter.value));
  const parameterSet = writer.add(
    `IFCPROPERTYSET(${quoted(guidFor(namespace, "pset-parameters", element.elementId))},#${ownerHistory},'Reviter_RevitInstanceParameters','Raw Revit internal values; dimensional values are stored in feet',${writer.refs(parameterProperties)})`,
  );
  writer.add(
    `IFCRELDEFINESBYPROPERTIES(${quoted(guidFor(namespace, "rel-parameters", element.elementId))},#${ownerHistory},$,$,(#${product}),#${parameterSet})`,
  );
}

/**
 * Render Reviter's recovered model as an IFC4 Reference View STEP document.
 *
 * The historical function name remains as a compatibility alias for the UI and
 * CLI. Its output is no longer limited to centerlines or bounding boxes.
 */
export function makeIfcCenterlines(result: ConvertResult, options: IfcExportOptions = {}): string {
  const writer = new StepWriter();
  const namespace = guidNamespace(result);
  const guid = (kind: string, key: string | number) => guidFor(namespace, kind, key);
  const manifest = elementManifest(result);
  const { byElement: fragmentsByElement, unowned: unownedFragments } = collectGeometry(result);
  const hostAxes = hostAxesByOpening(result);
  const sourceByElement = new Map<number, ElementBoundsRecord>();
  for (const source of result.elementBounds) {
    if (!sourceByElement.has(source.elementId)) sourceByElement.set(source.elementId, source);
  }

  const ownerPerson = writer.add("IFCPERSON($,$,'Reviter',$,$,$,$,$)");
  const organization = writer.add("IFCORGANIZATION($,'Reviter',$,$,$)");
  const personOrg = writer.add(`IFCPERSONANDORGANIZATION(#${ownerPerson},#${organization},$)`);
  const application = writer.add(
    `IFCAPPLICATION(#${organization},'1.0','Reviter recovered-model IFC4 exporter','REVITER')`,
  );
  const ownerHistory = writer.add(
    `IFCOWNERHISTORY(#${personOrg},#${application},$,.ADDED.,0,#${personOrg},#${application},0)`,
  );
  // IfcProject's units have to cover length, area, volume and plane angle: a
  // reader that meets an area or an angle with no declared unit has nothing to
  // interpret it against, whether or not this particular export happens to
  // write one.
  const metre = writer.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const squareMetre = writer.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const cubicMetre = writer.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  const radian = writer.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  const units = writer.add(
    `IFCUNITASSIGNMENT((#${metre},#${squareMetre},#${cubicMetre},#${radian}))`,
  );
  const worldPoint = writer.add("IFCCARTESIANPOINT((0.,0.,0.))");
  const worldAxis = writer.add(`IFCAXIS2PLACEMENT3D(#${worldPoint},$,$)`);
  const context = writer.add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldAxis},$)`,
  );
  const bodyContext = writer.add(
    `IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${context},$,.MODEL_VIEW.,$)`,
  );
  const project = writer.add(
    `IFCPROJECT(${quoted(guid("project", 1))},#${ownerHistory},${quoted(result.fileName)},$,$,$,$,(#${context}),#${units})`,
  );

  const zeroPlacement = writer.add(`IFCLOCALPLACEMENT($,#${worldAxis})`);
  const site = writer.add(
    `IFCSITE(${quoted(guid("site", 1))},#${ownerHistory},'Recovered site',$,$,#${zeroPlacement},$,$,.ELEMENT.,$,$,$,$,$)`,
  );
  const buildingPlacement = writer.add(`IFCLOCALPLACEMENT(#${zeroPlacement},#${worldAxis})`);
  const building = writer.add(
    `IFCBUILDING(${quoted(guid("building", 1))},#${ownerHistory},'Recovered building',$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$)`,
  );
  writer.add(`IFCRELAGGREGATES(${quoted(guid("aggregate", "project-site"))},#${ownerHistory},$,$,#${project},(#${site}))`);
  writer.add(`IFCRELAGGREGATES(${quoted(guid("aggregate", "site-building"))},#${ownerHistory},$,$,#${site},(#${building}))`);

  const modelOriginPoint = writer.add(
    `IFCCARTESIANPOINT((${feet(result.origin.x)},${feet(result.origin.y)},${feet(result.origin.z)}))`,
  );
  const modelOriginAxis = writer.add(`IFCAXIS2PLACEMENT3D(#${modelOriginPoint},$,$)`);
  const modelPlacement = writer.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${modelOriginAxis})`);
  const extrusionDirection = writer.add("IFCDIRECTION((0.,0.,1.))");

  const levels = result.levels.length
    ? [...result.levels].sort((left, right) => left.elevation - right.elevation)
    : [{ elevation: 0, candidates: manifest.length, source: "elevation-band" as const }];
  const storeyByLevelId = new Map<number, number>();
  const storeys: Array<{ id: number; elevation: number; levelId?: number }> = [];
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index]!;
    const point = writer.add(`IFCCARTESIANPOINT((0.,0.,${feet(level.elevation)}))`);
    const axis = writer.add(`IFCAXIS2PLACEMENT3D(#${point},$,$)`);
    const placement = writer.add(`IFCLOCALPLACEMENT(#${buildingPlacement},#${axis})`);
    const levelKey = level.levelId ?? `elevation-${level.elevation}`;
    const name = level.levelId == null
      ? `Recovered level ${index + 1}`
      : `Revit level ${level.levelId}`;
    const storey = writer.add(
      `IFCBUILDINGSTOREY(${quoted(guid("storey", levelKey))},#${ownerHistory},${quoted(name)},$,$,#${placement},$,$,.ELEMENT.,${feet(level.elevation)})`,
    );
    storeys.push({ id: storey, elevation: level.elevation, ...(level.levelId == null ? {} : { levelId: level.levelId }) });
    if (level.levelId != null) storeyByLevelId.set(level.levelId, storey);
  }
  writer.add(
    `IFCRELAGGREGATES(${quoted(guid("aggregate", "building-storeys"))},#${ownerHistory},$,$,#${building},${writer.refs(storeys.map((storey) => storey.id))})`,
  );

  const styleByMaterial = new Map<number, number>();
  result.materials.forEach((material, index) => {
    styleByMaterial.set(index, emitStyle(writer, material));
  });

  const materialEntityById = new Map<number, number>();
  for (const material of result.nativeMaterialDefinitions ?? []) {
    if (materialEntityById.has(material.elementId)) continue;
    materialEntityById.set(
      material.elementId,
      writer.add(`IFCMATERIAL(${quoted(material.name)},'Decoded native RVT material','Revit')`),
    );
  }
  const materialEntity = (materialId: number): number => {
    let entity = materialEntityById.get(materialId);
    if (entity) return entity;
    entity = writer.add(`IFCMATERIAL('Revit material ${materialId}','Material identity recovered without a decoded name','Revit')`);
    materialEntityById.set(materialId, entity);
    return entity;
  };

  const identityByElement = new Map(
    (result.nativeIdentity?.identities ?? []).map((identity) => [identity.elementId, identity.uniqueId]),
  );
  const levelByElement = new Map(
    (result.nativeAssociatedLevelRelations ?? []).map((relation) => [relation.elementId, relation.levelId]),
  );
  const productByElement = new Map<number, number>();
  const classByElement = new Map<number, IfcClass>();
  const storeyByElement = new Map<number, number>();
  const productsByStorey = new Map<number, number[]>();
  const typeGroups = new Map<string, { type: number; products: number[] }>();
  const typeObjectByElement = new Map<number, number>();
  const noMeshScene = result.meshes.length === 0;

  /*
   * Stair shape, carried from the one decoder that can prove it.
   *
   * `revit-2027-spiral-stair-mesh` recovers a run's body only from two
   * top-level `GCylindricalHelix` guides in that run's own GRep that are
   * coaxial, share one angular interval and one pitch, and stand exactly the
   * run's persisted `actualRunWidthFeet` apart. A run drawn by a helical pair
   * is a helical run, so the replay's success is a reading of the file's own
   * curves rather than a shape guessed from a bounding box, and
   * `stair-assemblies.ts` carries which runs it recovered onto the assembly.
   *
   * Absence of that evidence stays `.NOTDEFINED.` and never becomes a straight
   * or turned stair: this file has no reading for those. An assembly that
   * mixes a proven helical run with a decoded run the replay declined is
   * `"undetermined"` for the same reason -- see `NativeStairAssembly.shape`.
   */
  const spiralStairElementIds = new Set<number>();
  const spiralRunElementIds = new Set<number>();
  for (const assembly of result.nativeStairAssemblies ?? []) {
    if (assembly.shape !== "spiral") continue;
    spiralStairElementIds.add(assembly.stairElementId);
    for (const runId of assembly.spiralRunIds) spiralRunElementIds.add(runId);
  }
  /**
   * The occurrence's own shape enum.
   *
   * `IfcStair` and `IfcStairFlight` do not share an enumeration --
   * `IfcStairTypeEnum` spells the winding stair `SPIRAL_STAIR` and
   * `IfcStairFlightTypeEnum` spells it `SPIRAL` -- so the entity, not the
   * evidence, picks the spelling. The type object keeps `.NOTDEFINED.`: one
   * `IfcStairFlightType` is shared by every occurrence of a Revit type, and
   * only some of those occurrences are proven.
   */
  const shapedClass = (ifcClass: IfcClass, elementId: number): IfcClass => {
    if (ifcClass.entity === "IFCSTAIR" && spiralStairElementIds.has(elementId)) {
      return { ...ifcClass, predefinedType: ".SPIRAL_STAIR." };
    }
    if (
      ifcClass.entity === "IFCSTAIRFLIGHT" &&
      spiralRunElementIds.has(elementId)
    ) {
      return { ...ifcClass, predefinedType: ".SPIRAL." };
    }
    return ifcClass;
  };

  const nearestStorey = (element: ManifestElement): number => {
    const statedLevel = levelByElement.get(element.elementId);
    if (statedLevel != null) {
      const statedStorey = storeyByLevelId.get(statedLevel);
      if (statedStorey) return statedStorey;
    }
    const elevation = element.geometry.boundsFeet.min.z;
    return storeys.reduce((best, candidate) =>
      Math.abs(candidate.elevation - elevation) < Math.abs(best.elevation - elevation)
        ? candidate
        : best).id;
  };

  for (const element of manifest) {
    const hasSemanticIdentity = Boolean(element.category || element.type);
    if (!element.displayed && element.geometry.finalProvenance === "not-rendered-helper") continue;
    if (!element.displayed && !hasSemanticIdentity && !noMeshScene) continue;
    const ifcClass = ifcClassFor(element);
    const fragments = fragmentsByElement.get(element.elementId) ?? [];
    const shape = fragments.length
      ? emitTessellatedShape(writer, bodyContext, fragments, styleByMaterial)
      : noMeshScene
        ? emitBoundsShape(writer, bodyContext, extrusionDirection, element, result.origin)
        : null;
    const identity = identityByElement.get(element.elementId) ?? element.uniqueId ?? element.elementId;
    const product = emitProduct(
      writer,
      shapedClass(ifcClass, element.elementId),
      guid("element", identity),
      ownerHistory,
      element,
      modelPlacement,
      shape,
      fragments,
      hostAxes.get(element.elementId) ?? null,
    );
    productByElement.set(element.elementId, product);
    classByElement.set(element.elementId, ifcClass);
    const storey = nearestStorey(element);
    storeyByElement.set(element.elementId, storey);
    const products = productsByStorey.get(storey) ?? [];
    products.push(product);
    productsByStorey.set(storey, products);
    emitElementProperties(
      writer,
      namespace,
      ownerHistory,
      product,
      element,
      sourceByElement.get(element.elementId),
    );

    if (element.type) {
      // A recovered family or type name can itself contain the separator, and
      // every id in this tuple is nullable, so joining on `:` lets two distinct
      // types spell one key — collapsing them onto a single IfcTypeObject under
      // a single GUID. JSON encoding of the tuple is injective, so distinct
      // types stay distinct.
      const typeKey = JSON.stringify([
        ifcClass.typeEntity,
        element.type.elementId ?? null,
        element.type.symbolId ?? null,
        element.type.familyId ?? null,
        element.type.familyName ?? null,
        element.type.name ?? null,
      ]);
      let group = typeGroups.get(typeKey);
      if (!group) {
        group = {
          type: emitTypeObject(
            writer,
            ifcClass,
            guid("type", typeKey),
            ownerHistory,
            element,
          ),
          products: [],
        };
        typeGroups.set(typeKey, group);
      }
      group.products.push(product);
      typeObjectByElement.set(element.elementId, group.type);
    }
  }

  // Native GRep owners can have certified triangles even when no duplicated
  // bounds/semantic record survived into `elementManifest`. Their triangle id
  // is still a real persisted Revit element id. Export the body and tag as an
  // honest proxy, preserving visual completeness without guessing a category.
  for (const [elementId, fragments] of fragmentsByElement) {
    if (productByElement.has(elementId) || !fragments.length) continue;
    const shape = emitTessellatedShape(writer, bodyContext, fragments, styleByMaterial);
    if (!shape) continue;
    const identity = identityByElement.get(elementId) ?? elementId;
    const product = writer.add(
      `IFCBUILDINGELEMENTPROXY(${quoted(guid("element", identity))},#${ownerHistory},${quoted(fragments[0]!.name ?? `Recovered element ${elementId}`)},'Certified recovered triangles without a resolved semantic record','Reviter unclassified element',#${modelPlacement},#${shape},${quoted(String(elementId))},.NOTDEFINED.)`,
    );
    productByElement.set(elementId, product);
    classByElement.set(elementId, ifcClassFor({ category: null } as ManifestElement));
    const statedStorey = storeyByLevelId.get(levelByElement.get(elementId) ?? -1);
    const storey = statedStorey ?? storeys[0]!.id;
    const products = productsByStorey.get(storey) ?? [];
    products.push(product);
    productsByStorey.set(storey, products);
    const fidelity = fragmentGeometryFidelity(fragments);
    const recoveryProperties = [
      integerProperty(writer, "RevitElementId", elementId),
      textProperty(writer, "GeometrySource", "triangle-owned-without-semantic-record"),
      textProperty(writer, "GeometryProvenance", fidelity.provenance),
      booleanProperty(writer, "GeometryExact", fidelity.exact),
    ];
    const propertySet = writer.add(
      `IFCPROPERTYSET(${quoted(guid("pset-recovery", elementId))},#${ownerHistory},'Reviter_Recovery','Recovered-model fidelity and source evidence',${writer.refs(recoveryProperties)})`,
    );
    writer.add(
      `IFCRELDEFINESBYPROPERTIES(${quoted(guid("rel-recovery", elementId))},#${ownerHistory},$,$,(#${product}),#${propertySet})`,
    );
  }

  // A few render batches are legitimate recovered context without a resolvable
  // per-triangle Revit owner. Keep those triangles in the IFC as explicitly
  // anonymous proxies so the exported visual model remains identical to GLB;
  // do not invent a Revit tag or category for them.
  if (unownedFragments.length) {
    const contextStorey = storeys[0]!.id;
    const contextProducts = productsByStorey.get(contextStorey) ?? [];
    unownedFragments.forEach((fragment, index) => {
      const shape = emitTessellatedShape(writer, bodyContext, [fragment], styleByMaterial);
      if (!shape) return;
      const product = writer.add(
        `IFCBUILDINGELEMENTPROXY(${quoted(guid("unowned-context", index))},#${ownerHistory},${quoted(fragment.name ?? `Recovered context ${index + 1}`)},'Recovered display geometry without a resolvable element owner','Reviter context',#${modelPlacement},#${shape},$,.NOTDEFINED.)`,
      );
      contextProducts.push(product);
    });
    productsByStorey.set(contextStorey, contextProducts);
  }

  // Room recovery remains a review workflow, not an inference shortcut: only
  // explicitly accepted, export-enabled records become authoritative IFC
  // spaces. They stay under their exact raw Revit storey even when the floor
  // workspace visually composes several split levels.
  const spacesByStorey = new Map<number, number[]>();
  for (const room of options.rooms ?? []) {
    if (room.disposition !== "accepted" || !room.ifc.export) continue;
    const storey = storeyByLevelId.get(room.levelId);
    const level = result.levels.find((candidate) => candidate.levelId === room.levelId);
    if (!storey || !level) continue;
    const shape = emitRoomShape(writer, bodyContext, extrusionDirection, room, level.elevation, result.origin);
    const name = room.details.number && room.details.name
      ? `${room.details.number} · ${room.details.name}`
      : room.details.name || room.details.number || `Reviewed room ${room.roomId}`;
    const description = room.details.description || "Room boundary reviewed in Reviter";
    const objectType = room.details.occupancyType || room.details.department || "Reviewed room";
    const longName = room.details.longName || room.details.name || "$";
    // Every other string in this file reaches STEP through `quoted`, which
    // escapes it. An enum cannot be escaped — it is a bare `.ITEM.` token — so
    // it is checked against the permitted set instead. `isReviewedRoom` already
    // rejects an imported sidecar carrying anything else, and this second pass
    // covers rooms that reach the exporter by some other road: an older
    // localStorage record, or a direct caller of `options.rooms`.
    const predefined = spacePredefinedType(room.ifc.predefinedType);
    const space = writer.add(
      `IFCSPACE(${quoted(guid("space", room.roomId))},#${ownerHistory},${quoted(name)},${quoted(description)},${quoted(objectType)},#${modelPlacement},${shape ? `#${shape}` : "$"},${longName === "$" ? "$" : quoted(longName)},.ELEMENT.,.${predefined}.,$)`,
    );
    const properties = [
      textProperty(writer, "RoomId", room.roomId),
      textProperty(writer, "CandidateKey", room.candidateKey),
      textProperty(writer, "BoundaryClosure", room.closure),
      realProperty(writer, "AreaSquareFeet", room.geometry.areaSquareFeet),
      ...(room.details.number ? [textProperty(writer, "Number", room.details.number)] : []),
      ...(room.details.department ? [textProperty(writer, "Department", room.details.department)] : []),
      ...(room.details.occupancyType ? [textProperty(writer, "OccupancyType", room.details.occupancyType)] : []),
      ...(room.details.accessibility ? [textProperty(writer, "Accessibility", room.details.accessibility)] : []),
      ...(room.details.notes ? [textProperty(writer, "Notes", room.details.notes)] : []),
      ...(room.details.heightFeet == null ? [] : [realProperty(writer, "ReviewedHeightFeet", room.details.heightFeet)]),
      textProperty(writer, "GapIds", room.gapIds.join(",")),
    ];
    const propertySet = writer.add(
      `IFCPROPERTYSET(${quoted(guid("pset-room-review", room.roomId))},#${ownerHistory},'Reviter_RoomReview','Reviewed room recovery, metadata, and inference provenance',${writer.refs(properties)})`,
    );
    writer.add(`IFCRELDEFINESBYPROPERTIES(${quoted(guid("rel-room-review", room.roomId))},#${ownerHistory},$,$,(#${space}),#${propertySet})`);
    const spaces = spacesByStorey.get(storey) ?? [];
    spaces.push(space);
    spacesByStorey.set(storey, spaces);
  }

  for (const [storey, spaces] of spacesByStorey) {
    writer.add(`IFCRELAGGREGATES(${quoted(guid("aggregate-spaces", storey))},#${ownerHistory},'Reviewed rooms',$,#${storey},${writer.refs(spaces)})`);
  }

  // Stair assemblies. The parts are already exported and already placed in a
  // storey; what was missing is the statement that they are one stair. Three
  // things downstream of this file cannot be recovered from geometry -- which
  // `IfcMember` is a stringer rather than a curtain-wall mullion, which flights
  // share a stairwell, and which flights belong to one stair at all -- and all
  // three are read off `Decomposes`.
  //
  // The container carries NO representation. Its geometry is duplicate: the
  // runs, landings, stringers and railings already draw the stair, and the
  // display scene suppresses the wrapper for exactly that reason. Suppressing
  // the wrapper's geometry and suppressing the wrapper are different acts, and
  // only the first one was ever wanted.
  //
  // `PredefinedType` is `.SPIRAL_STAIR.` exactly where the spiral mesh replay
  // recovered the assembly's runs from matching inner/outer `GCylindricalHelix`
  // guides, and `.NOTDEFINED.` everywhere else. Nothing decoded here can tell a
  // straight run from a half-turn, so absence of the helical reading stays
  // absence rather than becoming a second claim.
  for (const assembly of result.nativeStairAssemblies ?? []) {
    const parts = stairAssemblyParts(assembly)
      .map((elementId) => productByElement.get(elementId))
      .filter((product): product is number => product != null);
    if (!parts.length) continue;

    let container = productByElement.get(assembly.stairElementId);
    if (container == null) {
      const identity = identityByElement.get(assembly.stairElementId)
        ?? assembly.stairElementId;
      container = writer.add(
        `IFCSTAIR(${quoted(guid("element", identity))},#${ownerHistory},` +
        `${quoted(`Stairs ${assembly.stairElementId}`)},` +
        `${quoted(`Recovered stair assembly; parts joined from ${assembly.evidence}.`)},` +
        `$,#${modelPlacement},$,${quoted(String(assembly.stairElementId))},` +
        `${assembly.shape === "spiral" ? ".SPIRAL_STAIR." : ".NOTDEFINED."})`,
      );
      productByElement.set(assembly.stairElementId, container);
      // Place the container in the storey its own parts landed in, so it is
      // reachable from the spatial structure like any other product rather
      // than floating outside it.
      const storey = assembly.runAndLandingIds
        .map((elementId) => storeyByElement.get(elementId))
        .find((value): value is number => value != null);
      if (storey != null) {
        const products = productsByStorey.get(storey) ?? [];
        products.push(container);
        productsByStorey.set(storey, products);
      }
    }

    writer.add(
      `IFCRELAGGREGATES(${quoted(guid("stair-assembly", assembly.stairElementId))},` +
      `#${ownerHistory},'Stair assembly',` +
      `${quoted(`Runs/landings ${assembly.runAndLandingIds.length}, stringers ${assembly.stringerIds.length}, ` +
        `railings ${assembly.railingIds.length}, supports ${assembly.supportIds.length}`)},` +
      `#${container},${writer.refs(parts)})`,
    );
  }

  for (const [storey, products] of productsByStorey) {
    if (!products.length) continue;
    writer.add(
      `IFCRELCONTAINEDINSPATIALSTRUCTURE(${quoted(guid("containment", storey))},#${ownerHistory},$,$,${writer.refs(products)},#${storey})`,
    );
  }
  for (const [key, group] of typeGroups) {
    writer.add(
      `IFCRELDEFINESBYTYPE(${quoted(guid("rel-type", key))},#${ownerHistory},$,$,${writer.refs(group.products)},#${group.type})`,
    );
  }

  const compoundByElement = new Map<
    number,
    Array<NonNullable<ConvertResult["nativeCompoundLayerMaterialAssignments"]>[number]>
  >();
  for (const assignment of result.nativeCompoundLayerMaterialAssignments ?? []) {
    const layers = compoundByElement.get(assignment.elementId) ?? [];
    layers.push(assignment);
    compoundByElement.set(assignment.elementId, layers);
  }
  const layerSetByKey = new Map<string, number>();
  const typeLayerAssociations = new Set<string>();
  for (const [elementId, unsortedLayers] of compoundByElement) {
    const product = productByElement.get(elementId);
    if (!product || !unsortedLayers.length) continue;
    const layers = [...unsortedLayers].sort((left, right) => left.layerIndex - right.layerIndex);
    const key = layers.map((layer) =>
      `${layer.typeId}:${layer.layerIndex}:${layer.materialId}:${layer.widthFeet}:${layer.function}`).join("|");
    let layerSet = layerSetByKey.get(key);
    if (!layerSet) {
      const layerEntities = layers.map((layer) => writer.add(
        `IFCMATERIALLAYER(#${materialEntity(layer.materialId)},${feet(layer.widthFeet)},$,'Layer ${layer.layerIndex + 1}',$,${quoted(`Revit function ${layer.function}`)},$)`,
      ));
      layerSet = writer.add(
        `IFCMATERIALLAYERSET(${writer.refs(layerEntities)},${quoted(`Revit type ${layers[0]!.typeId}`)},'Persisted Revit compound structure')`,
      );
      layerSetByKey.set(key, layerSet);
    }
    const elementClass = classByElement.get(elementId)?.entity;
    const direction = elementClass === "IFCWALL" ? ".AXIS2." : ".AXIS3.";
    const usage = writer.add(
      `IFCMATERIALLAYERSETUSAGE(#${layerSet},${direction},.POSITIVE.,0.,$)`,
    );
    writer.add(
      `IFCRELASSOCIATESMATERIAL(${quoted(guid("rel-layer-usage", elementId))},#${ownerHistory},$,$,(#${product}),#${usage})`,
    );
    const typeObject = typeObjectByElement.get(elementId);
    const typeKey = typeObject == null ? null : `${typeObject}:${layerSet}`;
    if (typeObject && typeKey && !typeLayerAssociations.has(typeKey)) {
      typeLayerAssociations.add(typeKey);
      writer.add(
        `IFCRELASSOCIATESMATERIAL(${quoted(guid("rel-layer-type", typeKey))},#${ownerHistory},$,$,(#${typeObject}),#${layerSet})`,
      );
    }
  }

  const assignmentsByElement = new Map<number, Set<number>>();
  for (const assignment of result.nativeElementMaterialAssignments ?? []) {
    const materials = assignmentsByElement.get(assignment.elementId) ?? new Set<number>();
    materials.add(assignment.materialId);
    assignmentsByElement.set(assignment.elementId, materials);
  }
  for (const [elementId, materialIds] of assignmentsByElement) {
    const product = productByElement.get(elementId);
    if (!product || !materialIds.size || compoundByElement.has(elementId)) continue;
    const ids = [...materialIds].sort((left, right) => left - right);
    let relatingMaterial: number;
    if (ids.length === 1) {
      relatingMaterial = materialEntity(ids[0]!);
    } else {
      const constituents = ids.map((materialId) => writer.add(
        `IFCMATERIALCONSTITUENT($,$,#${materialEntity(materialId)},$,$)`,
      ));
      relatingMaterial = writer.add(
        `IFCMATERIALCONSTITUENTSET('Recovered face materials',$,${writer.refs(constituents)})`,
      );
    }
    writer.add(
      `IFCRELASSOCIATESMATERIAL(${quoted(guid("rel-material", elementId))},#${ownerHistory},$,$,(#${product}),#${relatingMaterial})`,
    );
  }

  // A proven hosted door/window produces an IFC opening relationship. The
  // opening body is intentionally omitted: its recovered element envelope is
  // not necessarily the exact host cut, while RelVoids/RelFills still preserve
  // the persisted BIM relationship without inventing a solid.
  for (const relation of result.nativeHostRelations ?? []) {
    const filling = productByElement.get(relation.elementId);
    const host = productByElement.get(relation.hostId);
    const childClass = classByElement.get(relation.elementId)?.entity;
    if (!filling || !host || (childClass !== "IFCDOOR" && childClass !== "IFCWINDOW")) continue;
    const opening = writer.add(
      `IFCOPENINGELEMENT(${quoted(guid("opening", relation.elementId))},#${ownerHistory},${quoted(`Opening for ${relation.elementId}`)},'Persisted Revit host relationship',$,#${modelPlacement},$,$,.OPENING.)`,
    );
    writer.add(
      `IFCRELVOIDSELEMENT(${quoted(guid("void", relation.elementId))},#${ownerHistory},$,$,#${host},#${opening})`,
    );
    writer.add(
      `IFCRELFILLSELEMENT(${quoted(guid("fill", relation.elementId))},#${ownerHistory},$,$,#${opening},#${filling})`,
    );
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "");
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME(${quoted(outputName(result.fileName, "ifc"))},'${stamp}',('Reviter'),('Reviter'),'Reviter recovered-model IFC4 exporter','Reviter','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${writer.entities.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}

/** Preferred name for new callers. */
export const makeIfc = makeIfcCenterlines;
