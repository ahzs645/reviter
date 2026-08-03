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

import type { ConvertResult, ElementBoundsRecord, MaterialData } from "./types";

const METRES_PER_FOOT = 0.3048;
const IFC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

type ManifestElement = ReturnType<typeof elementManifest>[number];

type GeometryFragment = {
  name?: string;
  positions: number[];
  indices: number[];
  materialIndex: number;
  source: "native-brep" | "display-proxy" | undefined;
};

type IfcClass = {
  entity: string;
  typeEntity: string;
  predefinedType: string;
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

function ifcNumber(value: number): string {
  if (!Number.isFinite(value)) return "0.";
  const rounded = Math.abs(value) < 5e-12 ? 0 : Number(value.toPrecision(12));
  const text = String(rounded);
  if (/[.Ee]/.test(text)) return text.replace("e", "E");
  return `${text}.`;
}

function feet(value: number): string {
  return ifcNumber(value * METRES_PER_FOOT);
}

function optionalPositiveFeet(value: number): string {
  return Number.isFinite(value) && value > 0 ? feet(value) : "$";
}

function ifcClassFor(element: ManifestElement): IfcClass {
  const category = element.category?.name?.trim().toLowerCase() ?? "";
  const common = (entity: string, predefinedType = ".NOTDEFINED."): IfcClass => ({
    entity,
    typeEntity: `${entity}TYPE`,
    predefinedType,
  });
  switch (category) {
    case "walls": return common("IFCWALL");
    case "floors": return common("IFCSLAB", ".FLOOR.");
    case "roofs": return common("IFCROOF");
    case "ceilings":
    case "coverings": return common("IFCCOVERING", ".CEILING.");
    case "doors": return common("IFCDOOR", ".DOOR.");
    case "windows": return common("IFCWINDOW", ".WINDOW.");
    case "columns":
    case "structural columns": return common("IFCCOLUMN");
    case "beams": return common("IFCBEAM");
    case "members":
    case "structural framing":
    case "curtain wall mullions": return common("IFCMEMBER");
    case "plates":
    case "curtain wall panels": return common("IFCPLATE");
    case "stairs": return common("IFCSTAIR");
    case "stairs runs": return common("IFCSTAIRFLIGHT");
    case "railings":
    case "stairs railing": return common("IFCRAILING");
    case "stairs landings": return common("IFCSLAB", ".LANDING.");
    case "railing top rail":
    case "stairs railing baluster":
    case "stairs stringer carriage": return common("IFCMEMBER");
    case "furniture":
    case "furniture systems": return common("IFCFURNITURE");
    case "foundations":
    case "structural foundations": return common("IFCFOOTING");
    case "ramps": return common("IFCRAMP");
    default: return common("IFCBUILDINGELEMENTPROXY");
  }
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
  worldAxis: number,
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

function emitProduct(
  writer: StepWriter,
  ifcClass: IfcClass,
  guid: string,
  ownerHistory: number,
  element: ManifestElement,
  placement: number,
  shape: number | null,
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
    const planar = Math.max(dimensions.width, dimensions.depth);
    return writer.add(
      `IFCDOOR(${[...common, optionalPositiveFeet(dimensions.height), optionalPositiveFeet(planar), ".DOOR.", ".NOTDEFINED.", "$"].join(",")})`,
    );
  }
  if (ifcClass.entity === "IFCWINDOW") {
    const planar = Math.max(dimensions.width, dimensions.depth);
    return writer.add(
      `IFCWINDOW(${[...common, optionalPositiveFeet(dimensions.height), optionalPositiveFeet(planar), ".WINDOW.", ".NOTDEFINED.", "$"].join(",")})`,
    );
  }
  if (ifcClass.entity === "IFCSTAIRFLIGHT") {
    return writer.add(
      `IFCSTAIRFLIGHT(${[...common, "$", "$", "$", "$", ".NOTDEFINED."].join(",")})`,
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
  const parameterProperties = element.parameters.map((parameter) =>
    realProperty(writer, `${parameter.name} [${parameter.id}]`, parameter.value));
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
export function makeIfcCenterlines(result: ConvertResult): string {
  const writer = new StepWriter();
  const namespace = guidNamespace(result);
  const guid = (kind: string, key: string | number) => guidFor(namespace, kind, key);
  const manifest = elementManifest(result);
  const { byElement: fragmentsByElement, unowned: unownedFragments } = collectGeometry(result);
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
  const metre = writer.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const units = writer.add(`IFCUNITASSIGNMENT((#${metre}))`);
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
  const productsByStorey = new Map<number, number[]>();
  const typeGroups = new Map<string, { type: number; products: number[] }>();
  const typeObjectByElement = new Map<number, number>();
  const noMeshScene = result.meshes.length === 0;

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
        ? emitBoundsShape(writer, bodyContext, worldAxis, extrusionDirection, element, result.origin)
        : null;
    const identity = identityByElement.get(element.elementId) ?? element.uniqueId ?? element.elementId;
    const product = emitProduct(
      writer,
      ifcClass,
      guid("element", identity),
      ownerHistory,
      element,
      modelPlacement,
      shape,
    );
    productByElement.set(element.elementId, product);
    classByElement.set(element.elementId, ifcClass);
    const storey = nearestStorey(element);
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
      const typeKey = [
        ifcClass.typeEntity,
        element.type.elementId ?? "",
        element.type.symbolId ?? "",
        element.type.familyId ?? "",
        element.type.familyName ?? "",
        element.type.name ?? "",
      ].join(":");
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
    const recoveryProperties = [
      integerProperty(writer, "RevitElementId", elementId),
      textProperty(writer, "GeometrySource", "triangle-owned-without-semantic-record"),
      textProperty(writer, "GeometryProvenance", fragments.every((fragment) => fragment.source === "native-brep") ? "native" : "reconstructed"),
      booleanProperty(writer, "GeometryExact", fragments.every((fragment) => fragment.source === "native-brep")),
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
