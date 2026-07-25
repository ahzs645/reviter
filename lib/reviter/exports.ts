import type { ConvertResult, Segment } from "./types";

function cleanName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "reviter-model";
}

export function outputName(sourceName: string, extension: string): string {
  return `${cleanName(sourceName)}-recovered.${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function vectorExtents(values: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[index + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return { min, max };
}

function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const ia = indices[index]! * 3;
    const ib = indices[index + 1]! * 3;
    const ic = indices[index + 2]! * 3;
    const abx = positions[ib]! - positions[ia]!;
    const aby = positions[ib + 1]! - positions[ia + 1]!;
    const abz = positions[ib + 2]! - positions[ia + 2]!;
    const acx = positions[ic]! - positions[ia]!;
    const acy = positions[ic + 1]! - positions[ia + 1]!;
    const acz = positions[ic + 2]! - positions[ia + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [ia, ib, ic]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!) || 1;
    normals[index] /= length;
    normals[index + 1] /= length;
    normals[index + 2] /= length;
  }
  return normals;
}

export function makeGlb(result: ConvertResult): ArrayBuffer {
  const binaryParts: Uint8Array[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  let binaryLength = 0;

  const addView = (array: Float32Array | Uint32Array, target: number): number => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.byteLength, target });
    binaryParts.push(bytes);
    binaryLength += bytes.byteLength;
    return index;
  };

  for (const mesh of result.meshes) {
    if (!mesh.positions.length || !mesh.indices.length) continue;
    const positionView = addView(mesh.positions, 34_962);
    const normalView = addView(vertexNormals(mesh.positions, mesh.indices), 34_962);
    const indexView = addView(mesh.indices, 34_963);
    const extents = vectorExtents(mesh.positions);
    const positionAccessor = accessors.push({
      bufferView: positionView,
      componentType: 5_126,
      count: mesh.positions.length / 3,
      type: "VEC3",
      min: extents.min,
      max: extents.max,
    }) - 1;
    const indexAccessor = accessors.push({
      bufferView: indexView,
      componentType: 5_125,
      count: mesh.indices.length,
      type: "SCALAR",
    }) - 1;
    const normalAccessor = accessors.push({
      bufferView: normalView,
      componentType: 5_126,
      count: mesh.positions.length / 3,
      type: "VEC3",
    }) - 1;
    const meshIndex = meshes.push({
      name: mesh.name,
      primitives: [{
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: indexAccessor,
        material: Math.min(mesh.materialIndex, Math.max(0, result.materials.length - 1)),
      }],
    }) - 1;
    nodes.push({ name: mesh.name, mesh: meshIndex });
  }
  const meshNodes = nodes.map((_, index) => index);
  const rootNode = nodes.push({
    name: "Revit Z-up to glTF Y-up",
    rotation: [-0.7071067811865476, 0, 0, 0.7071067811865476],
    children: meshNodes,
  }) - 1;

  const binary = new Uint8Array(binaryLength);
  let binaryOffset = 0;
  for (const part of binaryParts) {
    binary.set(part, binaryOffset);
    binaryOffset += part.byteLength;
  }
  const document = {
    asset: { version: "2.0", generator: "Reviter client-only RVT converter" },
    scene: 0,
    scenes: [{ name: result.fileName, nodes: [rootNode] }],
    nodes,
    meshes,
    materials: result.materials.map((material) => ({
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColorLinear,
        metallicFactor: material.metallic,
        roughnessFactor: material.roughness,
      },
      doubleSided: material.doubleSided,
      ...(material.baseColorLinear[3] < 1 ? { alphaMode: "BLEND" } : {}),
      extras: {
        source: material.source,
        assignedElements: material.assignedElements,
      },
    })),
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
    accessors,
    extras: {
      sourceFile: result.fileName,
      method: result.method,
      originFeet: result.origin,
      sourceUpAxis: "Z",
      gltfUpAxis: "Y",
      warnings: result.warnings,
      decoderCoverage: result.decoderCoverage,
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binLength = Math.ceil(binary.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(json, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  output.set(binary, binHeader + 8);
  return output.buffer;
}

export function makeObj(result: ConvertResult): string {
  const lines = [
    "# Reviter experimental recovered geometry",
    "# Coordinates are local to the model origin recorded below.",
    `# origin_feet ${result.origin.x} ${result.origin.y} ${result.origin.z}`,
  ];
  let vertexOffset = 1;
  for (const mesh of result.meshes) {
    lines.push(`o ${mesh.name.replace(/\s+/g, "_")}`);
    for (let index = 0; index < mesh.positions.length; index += 3) {
      lines.push(
        `v ${mesh.positions[index]} ${mesh.positions[index + 1]} ${mesh.positions[index + 2]}`,
      );
    }
    for (let index = 0; index < mesh.indices.length; index += 3) {
      lines.push(
        `f ${mesh.indices[index]! + vertexOffset} ${mesh.indices[index + 1]! + vertexOffset} ${mesh.indices[index + 2]! + vertexOffset}`,
      );
    }
    vertexOffset += mesh.positions.length / 3;
  }
  return `${lines.join("\n")}\n`;
}

export function makeDxf(result: ConvertResult): string {
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "0", "ENDSEC"];
  lines.push("0", "SECTION", "2", "ENTITIES");
  for (const segment of result.segments) {
    lines.push(
      "0", "LINE", "8", "REVITER_RECOVERED",
      "10", String(segment.x0), "20", String(segment.y0), "30", String(segment.z0),
      "11", String(segment.x1), "21", String(segment.y1), "31", String(segment.z1),
    );
  }
  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function segmentBounds(segments: Segment[]) {
  const xs = segments.flatMap((segment) => [segment.x0, segment.x1]);
  const ys = segments.flatMap((segment) => [segment.y0, segment.y1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function makePlanSvg(result: ConvertResult): string {
  const { minX, maxX, minY, maxY } = segmentBounds(result.segments);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const strokeWidth = Math.max(width, height) / 1_200;
  const paths = result.segments
    .map(
      (segment) =>
        `<path d="M ${segment.x0 - minX} ${maxY - segment.y0} L ${segment.x1 - minX} ${maxY - segment.y1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recovered RVT plan centerlines">
  <rect width="100%" height="100%" fill="#f4f1e9"/>
  <g fill="none" stroke="#143e46" stroke-width="${strokeWidth}" stroke-linecap="round" vector-effect="non-scaling-stroke">${paths}</g>
</svg>`;
}

const ifcAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

function ifcGuid(index: number, salt = 0): string {
  let value = (Math.imul(index + 1, 2_654_435_761) + salt + 31) >>> 0;
  let body = "";
  for (let i = 0; i < 21; i += 1) {
    value = (Math.imul(value ^ (value >>> 15), 2_246_822_519) + i * 3_266_489_917) >>> 0;
    body += ifcAlphabet[value & 63];
  }
  return `2${body}`;
}

function ifcText(value: string): string {
  return value.replace(/'/g, "''").replace(/[\r\n]+/g, " ");
}

export function makeIfcCenterlines(result: ConvertResult): string {
  const entities: string[] = [];
  const add = (expression: string) => {
    const id = entities.length + 1;
    entities.push(`#${id}=${expression};`);
    return id;
  };
  const ownerPerson = add("IFCPERSON($,$,'Reviter',$,$,$,$,$)");
  const organization = add("IFCORGANIZATION($,'Reviter',$,$,$)");
  const personOrg = add(`IFCPERSONANDORGANIZATION(#${ownerPerson},#${organization},$)`);
  const application = add(`IFCAPPLICATION(#${organization},'1.0','Reviter browser converter','REVITER')`);
  const ownerHistory = add(`IFCOWNERHISTORY(#${personOrg},#${application},$,.ADDED.,$,#${personOrg},#${application},0)`);
  const metre = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const units = add(`IFCUNITASSIGNMENT((#${metre}))`);
  const worldPoint = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const worldAxis = add(`IFCAXIS2PLACEMENT3D(#${worldPoint},$,$)`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldAxis},$)`);
  const project = add(`IFCPROJECT('${ifcGuid(1)}',#${ownerHistory},'${ifcText(result.fileName)}',$,$,$,$,(#${context}),#${units})`);
  const placement = add(`IFCLOCALPLACEMENT($,#${worldAxis})`);
  const site = add(`IFCSITE('${ifcGuid(2)}',#${ownerHistory},'Recovered site',$,$,#${placement},$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = add(`IFCBUILDING('${ifcGuid(3)}',#${ownerHistory},'Recovered building',$,$,#${placement},$,$,.ELEMENT.,$,$,$)`);
  const storey = add(`IFCBUILDINGSTOREY('${ifcGuid(4)}',#${ownerHistory},'Recovered centerlines',$,$,#${placement},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES('${ifcGuid(5)}',#${ownerHistory},$,$,#${project},(#${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid(6)}',#${ownerHistory},$,$,#${site},(#${building}))`);
  add(`IFCRELAGGREGATES('${ifcGuid(7)}',#${ownerHistory},$,$,#${building},(#${storey}))`);
  for (const material of result.materials.filter((entry) => entry.source === "rvt-material")) {
    add(`IFCMATERIAL('${ifcText(material.name)}',$,'Decoded RVT material definition; element assignment unavailable')`);
  }

  const proxies: number[] = [];
  const toMetres = (value: number) => Number((value * 0.3048).toFixed(6));
  const solidRecords = result.elementBounds.filter(({ boundsFeet: { min, max } }) =>
    max.x - min.x > 0.001 && max.y - min.y > 0.001 && max.z - min.z > 0.001,
  );
  if (solidRecords.length) {
    const extrusionDirection = add("IFCDIRECTION((0.,0.,1.))");
    const profileOrigin = add("IFCCARTESIANPOINT((0.,0.))");
    const profilePosition = add(`IFCAXIS2PLACEMENT2D(#${profileOrigin},$)`);
    for (let index = 0; index < solidRecords.length; index += 1) {
      const record = solidRecords[index]!;
      const { min, max } = record.boundsFeet;
      const width = toMetres(max.x - min.x);
      const depth = toMetres(max.y - min.y);
      const height = toMetres(max.z - min.z);
      const location = add(
        `IFCCARTESIANPOINT((${toMetres((min.x + max.x) / 2)},${toMetres((min.y + max.y) / 2)},${toMetres(min.z)}))`,
      );
      const axis = add(`IFCAXIS2PLACEMENT3D(#${location},$,$)`);
      const objectPlacement = add(`IFCLOCALPLACEMENT(#${placement},#${axis})`);
      const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,#${profilePosition},${width},${depth})`);
      const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${worldAxis},#${extrusionDirection},${height})`);
      const representation = add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
      const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      // The category is decoded, but the geometry is still only an envelope, so
      // the proxy keeps its honest type and carries the category as text.
      const label = record.categoryName
        ? `${record.categoryName} ${record.elementId}`
        : `Revit element ${record.elementId}`;
      const description = record.categoryName
        ? `RVT partition duplicated-bounds record; exact axis-aligned envelope. Native Revit category ${record.categoryId} (${record.categoryName}), evidence: ${record.categorySource}.`
        : "RVT partition duplicated-bounds record; exact axis-aligned envelope";
      proxies.push(
        add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(record.elementId, 17)}',#${ownerHistory},'${ifcText(label)}','${ifcText(description)}',$,#${objectPlacement},#${shape},'${record.elementId}',.ELEMENT.)`),
      );
    }
  } else {
    for (let index = 0; index < result.segments.length; index += 1) {
      const segment = result.segments[index]!;
      const start = add(`IFCCARTESIANPOINT((${toMetres(segment.x0)},${toMetres(segment.y0)},${toMetres(segment.z0)}))`);
      const end = add(`IFCCARTESIANPOINT((${toMetres(segment.x1)},${toMetres(segment.y1)},${toMetres(segment.z1)}))`);
      const line = add(`IFCPOLYLINE((#${start},#${end}))`);
      const representation = add(`IFCSHAPEREPRESENTATION(#${context},'Axis','Curve3D',(#${line}))`);
      const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${representation}))`);
      proxies.push(
        add(`IFCBUILDINGELEMENTPROXY('${ifcGuid(index + 20, 17)}',#${ownerHistory},'Recovered segment ${index + 1}','Heuristic centerline; not a decoded Revit element',$,#${placement},#${shape},$,.ELEMENT.)`),
      );
    }
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid(8)}',#${ownerHistory},$,$,(${proxies.map((id) => `#${id}`).join(",")}),#${storey})`);

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "");
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('${ifcText(outputName(result.fileName, "ifc"))}','${stamp}',('Reviter'),('Reviter'),'Reviter browser converter','Reviter','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${entities.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;
}

export function makeReport(
  result: ConvertResult,
  metadata: Record<string, unknown> | null,
): string {
  const safeMetadata = metadata
    ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "path" && key !== "content"))
    : null;
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedBy: "Reviter",
      fidelity: {
        metadata: "verified",
        container: "verified",
        geometry: result.method === "partition-bounds-recovery"
          ? "validated-rvt-element-bounds"
          : "experimental-coordinate-recovery",
        bimSemantics: result.decoderCoverage.nativeCategorisedElements
          ? "native-revit-categories"
          : "unavailable",
        nativeProfiles: result.decoderCoverage.nativeProfiles,
        nativeMeshes: result.decoderCoverage.nativeMeshes,
        materialDefinitions: result.decoderCoverage.nativeMaterialDefinitions,
        materialAssignments: result.decoderCoverage.nativeMaterialAssignments,
      },
      file: { name: result.fileName, byteLength: result.byteLength, metadata: safeMetadata },
      originFeet: result.origin,
      boundsLocalFeet: result.bbox,
      levels: result.levels,
      stats: result.stats,
      decoderCoverage: result.decoderCoverage,
      nativeCategories: result.nativeCategories ?? null,
      nativeProfiles: result.nativeProfiles,
      materials: result.materials,
      standardsAwareReader: result.readerDiagnostics ?? null,
      warnings: result.warnings,
    },
    null,
    2,
  );
}
