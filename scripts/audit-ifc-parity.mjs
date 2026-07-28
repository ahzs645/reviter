#!/usr/bin/env node

/**
 * Establish a measurable acceptance baseline between a reference IFC export
 * and Reviter's current semantic JSON + GLB output.
 *
 * This is deliberately read-only. The IFC is parsed locally with the same
 * browser-capable web-ifc dependency used by the application; no Revit or ODA
 * runtime is required.
 *
 * Usage:
 *   node scripts/audit-ifc-parity.mjs \
 *     --ifc model.ifc \
 *     --semantic outputs/model-semantic.json \
 *     --glb outputs/model.glb \
 *     --json docs/generated/model-ifc-parity.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { IfcAPI } from "web-ifc";

const argv = process.argv.slice(2);

function option(name, required = true) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  if (!required) return null;
  throw new Error(`Missing ${name}. Run with --ifc, --semantic, --glb, and --json.`);
}

const paths = {
  ifc: option("--ifc"),
  semantic: option("--semantic"),
  glb: option("--glb"),
  json: option("--json"),
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scalar(value) {
  if (value == null) return null;
  return typeof value === "object" && "value" in value ? value.value : value;
}

function referenceId(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    if (typeof value.value === "number") return value.value;
    if (typeof value.expressID === "number") return value.expressID;
  }
  return null;
}

function splitStepArgs(source) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'") {
      if (quoted && source[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        result.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  result.push(source.slice(start).trim());
  return result;
}

function refs(source = "") {
  return [...source.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

function firstQuoted(source = "") {
  const match = /^'((?:''|[^'])*)'$/.exec(source.trim());
  return match ? decodeIfcString(match[1].replaceAll("''", "'")) : null;
}

function decodeIfcString(source) {
  return source
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_match, hex) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16));
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedRecord(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function finiteBounds(bounds) {
  return bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite);
}

function spans(bounds) {
  return bounds.min.map((minimum, axis) => bounds.max[axis] - minimum);
}

function parseGlb(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "glTF") throw new Error("Expected a binary glTF (GLB) file.");
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).replace(/\0+$/u, ""));
  const byCategory = new Map();
  const boundsFeet = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  let triangles = 0;
  let vertices = 0;

  for (const mesh of json.meshes ?? []) {
    const category = (mesh.name ?? "Uncategorised").replace(/ \d+$/u, "");
    const row = byCategory.get(category) ?? { batches: 0, triangles: 0, vertices: 0 };
    row.batches += 1;
    for (const primitive of mesh.primitives ?? []) {
      const indexAccessor = json.accessors?.[primitive.indices];
      const positionAccessor = json.accessors?.[primitive.attributes?.POSITION];
      const primitiveTriangles = (indexAccessor?.count ?? 0) / 3;
      const primitiveVertices = positionAccessor?.count ?? 0;
      triangles += primitiveTriangles;
      vertices += primitiveVertices;
      row.triangles += primitiveTriangles;
      row.vertices += primitiveVertices;
      if (positionAccessor?.min && positionAccessor?.max) {
        for (let axis = 0; axis < 3; axis += 1) {
          boundsFeet.min[axis] = Math.min(boundsFeet.min[axis], positionAccessor.min[axis]);
          boundsFeet.max[axis] = Math.max(boundsFeet.max[axis], positionAccessor.max[axis]);
        }
      }
    }
    byCategory.set(category, row);
  }

  return {
    triangles,
    vertices,
    batches: json.meshes?.length ?? 0,
    materials: json.materials?.length ?? 0,
    materialAssignmentsClaimed:
      json.materials?.reduce((sum, material) => sum + (material.extras?.assignedElements ?? 0), 0) ?? 0,
    boundsFeet: finiteBounds(boundsFeet) ? boundsFeet : null,
    spansFeet: finiteBounds(boundsFeet) ? spans(boundsFeet) : null,
    byCategory: Object.fromEntries(
      [...byCategory.entries()].sort((a, b) => b[1].triangles - a[1].triangles),
    ),
    declaredFidelity: json.extras?.decoderCoverage ?? null,
  };
}

function parseSemantic(bytes) {
  const semantic = JSON.parse(bytes.toString("utf8"));
  const elements = semantic.elementManifest?.elements ?? [];
  const byCategory = new Map();
  const ids = new Set();
  const displayedIds = new Set();
  let categorized = 0;
  let typed = 0;
  let withParameters = 0;
  let parameterValues = 0;
  for (const element of elements) {
    ids.add(element.elementId);
    if (element.displayed) displayedIds.add(element.elementId);
    if (element.category?.name) {
      categorized += 1;
      increment(byCategory, element.category.name);
    }
    if (element.type?.name) typed += 1;
    if (element.parameters?.length) {
      withParameters += 1;
      parameterValues += element.parameters.length;
    }
  }
  return {
    raw: semantic,
    ids,
    displayedIds,
    summary: {
      records: elements.length,
      displayed: displayedIds.size,
      categorized,
      typed,
      withParameters,
      parameterValues,
      uniqueIds: 0,
      modelTreeMemberships: 0,
      nativeMaterialDefinitions: semantic.fidelity?.materialDefinitions ?? 0,
      nativeMaterialAssignments: semantic.fidelity?.materialAssignments ?? 0,
      boundsLocalFeet: semantic.boundsLocalFeet ?? null,
      byCategory: sortedRecord(byCategory),
      unavailableFields: semantic.elementManifest?.unavailableFields ?? [],
      declaredFidelity: semantic.fidelity ?? null,
    },
  };
}

function parseInterestingStepEntities(text) {
  const typeCounts = new Map();
  const materialNodes = new Map();
  const materialRelations = [];
  const propertyRelations = [];
  const typeRelations = [];
  const containmentRelations = [];
  const aggregateRelations = [];
  const propertySetNodes = new Map();
  let entityCount = 0;
  let propertyValueCount = 0;

  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    entityCount += 1;
    const id = Number(match[1]);
    const type = match[2];
    const args = match[3];
    increment(typeCounts, type);

    if (type.startsWith("IFCMATERIAL")) {
      const fields = splitStepArgs(args);
      materialNodes.set(id, {
        type,
        refs: refs(args),
        name: type === "IFCMATERIAL" ? firstQuoted(fields[0]) : null,
      });
    } else if (type === "IFCRELASSOCIATESMATERIAL") {
      const fields = splitStepArgs(args);
      materialRelations.push({ related: refs(fields[4]), material: refs(fields[5])[0] ?? 0 });
    } else if (type === "IFCRELDEFINESBYPROPERTIES") {
      const fields = splitStepArgs(args);
      propertyRelations.push({ related: refs(fields[4]), propertySet: refs(fields[5])[0] ?? 0 });
    } else if (type === "IFCRELDEFINESBYTYPE") {
      const fields = splitStepArgs(args);
      typeRelations.push({ related: refs(fields[4]), typeObject: refs(fields[5])[0] ?? 0 });
    } else if (type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      const fields = splitStepArgs(args);
      containmentRelations.push({ related: refs(fields[4]), container: refs(fields[5])[0] ?? 0 });
    } else if (type === "IFCRELAGGREGATES") {
      const fields = splitStepArgs(args);
      aggregateRelations.push({ parent: refs(fields[4])[0] ?? 0, related: refs(fields[5]) });
    } else if (type === "IFCPROPERTYSET") {
      const fields = splitStepArgs(args);
      propertySetNodes.set(id, { name: firstQuoted(fields[2]), properties: refs(fields[4]) });
    } else if (type.startsWith("IFCPROPERTY") && type !== "IFCPROPERTYSET") {
      propertyValueCount += 1;
    }
  }

  return {
    entityCount,
    typeCounts,
    materialNodes,
    materialRelations,
    propertyRelations,
    typeRelations,
    containmentRelations,
    aggregateRelations,
    propertySetNodes,
    propertyValueCount,
  };
}

function materialNames(root, materialNodes, memo = new Map(), visiting = new Set()) {
  if (!root || visiting.has(root)) return new Set();
  if (memo.has(root)) return memo.get(root);
  const node = materialNodes.get(root);
  if (!node) return new Set();
  visiting.add(root);
  const names = new Set();
  if (node.name) names.add(node.name);
  for (const child of node.refs) {
    for (const name of materialNames(child, materialNodes, memo, visiting)) names.add(name);
  }
  visiting.delete(root);
  memo.set(root, names);
  return names;
}

async function analyzeIfc(ifcBytes, semantic) {
  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
  if (model < 0) throw new Error("web-ifc could not open the reference IFC.");

  const elementIds = new Set();
  const elements = new Map();
  const byClass = new Map();
  const numericTagsByClass = new Map();
  const seenTagsByClass = new Map();
  const drawnTagsByClass = new Map();
  const geometryTagsByClass = new Map();
  const seenGeometryTagsByClass = new Map();
  const drawnGeometryTagsByClass = new Map();
  const typeCodes = api.GetIfcEntityList(model);
  for (const typeCode of typeCodes) {
    if (!api.IsIfcElement(typeCode)) continue;
    const type = api.GetNameFromTypeCode(typeCode);
    const ids = api.GetLineIDsWithType(model, typeCode, false);
    const row = byClass.get(type) ?? {
      elements: 0,
      productsWithGeometry: 0,
      geometryPlacements: 0,
      triangles: 0,
      vertexReferences: 0,
      withGlobalId: 0,
      withName: 0,
      withObjectType: 0,
      withTag: 0,
      withPlacement: 0,
      represented: 0,
      reviterSeenByTag: 0,
      reviterDrawnByTag: 0,
    };
    for (let index = 0; index < ids.size(); index += 1) {
      const id = ids.get(index);
      const line = api.GetLine(model, id, false);
      const tag = scalar(line.Tag);
      const numericTag = typeof tag === "string" && /^\d+$/u.test(tag) ? Number(tag) : null;
      const detail = {
        type,
        globalId: scalar(line.GlobalId),
        name: scalar(line.Name),
        objectType: scalar(line.ObjectType),
        tag,
        numericTag,
        placement: referenceId(line.ObjectPlacement),
        representation: referenceId(line.Representation),
      };
      elementIds.add(id);
      elements.set(id, detail);
      row.elements += 1;
      if (detail.globalId) row.withGlobalId += 1;
      if (detail.name) row.withName += 1;
      if (detail.objectType) row.withObjectType += 1;
      if (detail.tag) row.withTag += 1;
      if (line.ObjectPlacement) row.withPlacement += 1;
      if (line.Representation) row.represented += 1;
      if (numericTag != null && semantic.ids.has(numericTag)) row.reviterSeenByTag += 1;
      if (numericTag != null && semantic.displayedIds.has(numericTag)) row.reviterDrawnByTag += 1;
      if (numericTag != null) {
        const tags = numericTagsByClass.get(type) ?? new Set();
        tags.add(numericTag);
        numericTagsByClass.set(type, tags);
        if (semantic.ids.has(numericTag)) {
          const seen = seenTagsByClass.get(type) ?? new Set();
          seen.add(numericTag);
          seenTagsByClass.set(type, seen);
        }
        if (semantic.displayedIds.has(numericTag)) {
          const drawn = drawnTagsByClass.get(type) ?? new Set();
          drawn.add(numericTag);
          drawnTagsByClass.set(type, drawn);
        }
      }
    }
    byClass.set(type, row);
  }

  const geometryProductIds = new Set();
  const geometryDefinitions = new Set();
  const geometryColors = new Map();
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  let geometryPlacements = 0;
  let triangles = 0;
  let vertexReferences = 0;
  api.StreamAllMeshes(model, (mesh) => {
    geometryProductIds.add(mesh.expressID);
    const detail = elements.get(mesh.expressID);
    const type = detail?.type ?? "Unknown";
    const row = byClass.get(type);
    if (row) row.productsWithGeometry += 1;
    if (detail?.numericTag != null) {
      const tags = geometryTagsByClass.get(type) ?? new Set();
      tags.add(detail.numericTag);
      geometryTagsByClass.set(type, tags);
      if (semantic.ids.has(detail.numericTag)) {
        const seen = seenGeometryTagsByClass.get(type) ?? new Set();
        seen.add(detail.numericTag);
        seenGeometryTagsByClass.set(type, seen);
      }
      if (semantic.displayedIds.has(detail.numericTag)) {
        const drawn = drawnGeometryTagsByClass.get(type) ?? new Set();
        drawn.add(detail.numericTag);
        drawnGeometryTagsByClass.set(type, drawn);
      }
    }

    for (let index = 0; index < mesh.geometries.size(); index += 1) {
      const placed = mesh.geometries.get(index);
      geometryPlacements += 1;
      geometryDefinitions.add(placed.geometryExpressID);
      const color = [placed.color.x, placed.color.y, placed.color.z, placed.color.w]
        .map((value) => value.toFixed(5))
        .join(",");
      increment(geometryColors, color);

      const geometry = api.GetGeometry(model, placed.geometryExpressID);
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      const triangleCount = indices.length / 3;
      const vertexCount = vertices.length / 6;
      triangles += triangleCount;
      vertexReferences += vertexCount;
      if (row) {
        row.geometryPlacements += 1;
        row.triangles += triangleCount;
        row.vertexReferences += vertexCount;
      }

      const matrix = placed.flatTransformation;
      for (let vertex = 0; vertex < vertices.length; vertex += 6) {
        const x = vertices[vertex];
        const y = vertices[vertex + 1];
        const z = vertices[vertex + 2];
        const world = [
          matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
          matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
          matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        ];
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis], world[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], world[axis]);
        }
      }
      geometry.delete();
    }
  });

  const step = parseInterestingStepEntities(ifcBytes.toString("latin1"));
  const typeByElement = new Map();
  const typeMembers = new Set();
  for (const relation of step.typeRelations) {
    for (const related of relation.related) {
      if (elementIds.has(related)) {
        typeByElement.set(related, relation.typeObject);
        typeMembers.add(related);
      }
    }
  }

  const directMaterialObjects = new Map();
  const materials = new Set();
  const materialMemo = new Map();
  for (const relation of step.materialRelations) {
    const names = materialNames(relation.material, step.materialNodes, materialMemo);
    for (const name of names) materials.add(name);
    for (const related of relation.related) {
      const assigned = directMaterialObjects.get(related) ?? new Set();
      for (const name of names) assigned.add(name);
      directMaterialObjects.set(related, assigned);
    }
  }
  const materialElements = new Set();
  const directMaterialElements = new Set();
  for (const elementId of elementIds) {
    if (directMaterialObjects.has(elementId)) {
      directMaterialElements.add(elementId);
      materialElements.add(elementId);
    }
    const typeObject = typeByElement.get(elementId);
    if (typeObject && directMaterialObjects.has(typeObject)) materialElements.add(elementId);
  }

  const propertyElements = new Set();
  const propertySetNames = new Set();
  for (const relation of step.propertyRelations) {
    const propertySet = step.propertySetNodes.get(relation.propertySet);
    if (propertySet?.name) propertySetNames.add(propertySet.name);
    for (const related of relation.related) {
      if (elementIds.has(related)) propertyElements.add(related);
    }
  }

  const containedElements = new Set();
  for (const relation of step.containmentRelations) {
    for (const related of relation.related) if (elementIds.has(related)) containedElements.add(related);
  }
  const aggregatedElements = new Set();
  for (const relation of step.aggregateRelations) {
    for (const related of relation.related) if (elementIds.has(related)) aggregatedElements.add(related);
  }
  const treeElements = new Set([...containedElements, ...aggregatedElements]);

  for (const [type, row] of byClass) {
    row.uniqueNumericTags = numericTagsByClass.get(type)?.size ?? 0;
    row.uniqueTagsSeenByReviter = seenTagsByClass.get(type)?.size ?? 0;
    row.uniqueTagsDrawnByReviter = drawnTagsByClass.get(type)?.size ?? 0;
    row.geometryNumericTags = geometryTagsByClass.get(type)?.size ?? 0;
    row.geometryTagsSeenByReviter = seenGeometryTagsByClass.get(type)?.size ?? 0;
    row.geometryTagsDrawnByReviter = drawnGeometryTagsByClass.get(type)?.size ?? 0;
  }

  const classRows = Object.fromEntries(
    [...byClass.entries()]
      .filter((entry) => entry[1].elements > 0)
      .sort((a, b) => b[1].triangles - a[1].triangles || b[1].elements - a[1].elements)
      .map(([type, row]) => [type, row]),
  );
  const globalIds = new Set([...elements.values()].map((element) => element.globalId).filter(Boolean));
  const numericTags = new Set(
    [...elements.values()].map((element) => element.numericTag).filter((tag) => tag != null),
  );
  const geometryNumericTags = new Set(
    [...geometryProductIds]
      .map((elementId) => elements.get(elementId)?.numericTag)
      .filter((tag) => tag != null),
  );
  const numericTagsSeenByReviter = new Set([...numericTags].filter((tag) => semantic.ids.has(tag)));
  const numericTagsDrawnByReviter = new Set(
    [...numericTags].filter((tag) => semantic.displayedIds.has(tag)),
  );
  const geometryTagsSeenByReviter = new Set(
    [...geometryNumericTags].filter((tag) => semantic.ids.has(tag)),
  );
  const geometryTagsDrawnByReviter = new Set(
    [...geometryNumericTags].filter((tag) => semantic.displayedIds.has(tag)),
  );
  const missingGeometryTags = [...geometryNumericTags]
    .filter((tag) => !semantic.displayedIds.has(tag))
    .sort((a, b) => a - b);
  const missingGeometryTagsByClass = Object.fromEntries(
    [...geometryTagsByClass.entries()]
      .map(([type, tags]) => [
        type,
        [...tags].filter((tag) => !semantic.displayedIds.has(tag)).sort((a, b) => a - b),
      ])
      .filter(([, tags]) => tags.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  const result = {
    schema: api.GetModelSchema(model),
    entityCount: step.entityCount,
    entityTypes: step.typeCounts.size,
    elements: elementIds.size,
    representedElements: [...elements.values()].filter((element) => element.representation != null).length,
    productsWithGeometry: geometryProductIds.size,
    geometryPlacements,
    uniqueGeometryDefinitions: geometryDefinitions.size,
    triangles,
    vertexReferences,
    boundsWebIfcAxesMetres: finiteBounds(bounds) ? bounds : null,
    spansWebIfcAxesMetres: finiteBounds(bounds) ? spans(bounds) : null,
    geometryColors: geometryColors.size,
    globalIds: globalIds.size,
    numericRevitTags: numericTags.size,
    numericTagsSeenByReviter: numericTagsSeenByReviter.size,
    numericTagsDrawnByReviter: numericTagsDrawnByReviter.size,
    geometryNumericTags: geometryNumericTags.size,
    geometryTagsSeenByReviter: geometryTagsSeenByReviter.size,
    geometryTagsDrawnByReviter: geometryTagsDrawnByReviter.size,
    missingGeometryTags,
    missingGeometryTagsByClass,
    namedElements: [...elements.values()].filter((element) => element.name).length,
    objectTypedElements: [...elements.values()].filter((element) => element.objectType).length,
    placedElements: [...elements.values()].filter((element) => element.placement != null).length,
    typeAssignedElements: typeMembers.size,
    propertySets: step.propertySetNodes.size,
    propertySetNames: propertySetNames.size,
    propertyValues: step.propertyValueCount,
    propertyAssignedElements: propertyElements.size,
    materialDefinitions: step.typeCounts.get("IFCMATERIAL") ?? 0,
    uniqueMaterialNames: materials.size,
    materialAssociationRelations: step.materialRelations.length,
    directMaterialAssignedElements: directMaterialElements.size,
    materialAssignedElementsIncludingTypes: materialElements.size,
    spatiallyContainedElements: containedElements.size,
    aggregatedElements: aggregatedElements.size,
    modelTreeElements: treeElements.size,
    byClass: classRows,
    topEntityTypes: Object.fromEntries([...step.typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)),
    materialNames: [...materials].sort(),
    geometryColorPlacements: sortedRecord(geometryColors),
  };

  api.CloseModel(model);
  api.Dispose();
  return result;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

const ifcBytes = readFileSync(paths.ifc);
const semanticBytes = readFileSync(paths.semantic);
const glbBytes = readFileSync(paths.glb);
const semantic = parseSemantic(semanticBytes);
const glb = parseGlb(glbBytes);
const ifc = await analyzeIfc(ifcBytes, semantic);

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-ifc-parity.mjs",
  inputs: {
    ifc: { name: basename(paths.ifc), bytes: ifcBytes.length, sha256: sha256(ifcBytes) },
    semantic: {
      name: basename(paths.semantic),
      bytes: semanticBytes.length,
      sha256: sha256(semanticBytes),
    },
    glb: { name: basename(paths.glb), bytes: glbBytes.length, sha256: sha256(glbBytes) },
  },
  ifc,
  reviter: {
    semantic: semantic.summary,
    glb,
  },
  parity: {
    ifcElementsRecoveredByNumericTag: ifc.numericTagsSeenByReviter,
    ifcElementsDrawnByNumericTag: ifc.numericTagsDrawnByReviter,
    geometryElementsRecoveredByNumericTag: ifc.geometryTagsSeenByReviter,
    geometryElementsDrawnByNumericTag: ifc.geometryTagsDrawnByReviter,
    productGeometryCoverage: ratio(ifc.geometryTagsDrawnByReviter, ifc.geometryNumericTags),
    triangleRatio: ratio(glb.triangles, ifc.triangles),
    vertexReferenceRatio: ratio(glb.vertices, ifc.vertexReferences),
    uniqueIdRatio: ratio(semantic.summary.uniqueIds, ifc.globalIds),
    modelTreeRatio: ratio(semantic.summary.modelTreeMemberships, ifc.modelTreeElements),
    typeNameRatio: ratio(semantic.summary.typed, ifc.typeAssignedElements),
    propertyElementRatio: ratio(semantic.summary.withParameters, ifc.propertyAssignedElements),
    materialDefinitionRatio: ratio(
      semantic.summary.nativeMaterialDefinitions,
      ifc.materialDefinitions,
    ),
    materialAssignmentRatio: ratio(
      semantic.summary.nativeMaterialAssignments,
      ifc.materialAssignedElementsIncludingTypes,
    ),
    dimensionSpans: {
      ifcWebIfcAxesMetres: ifc.spansWebIfcAxesMetres,
      reviterAxesMetres: glb.spansFeet?.map((value) => value * 0.3048) ?? null,
      sortedIfcMetres: [...(ifc.spansWebIfcAxesMetres ?? [])].sort((a, b) => a - b),
      sortedReviterMetres: [...(glb.spansFeet ?? [])].map((value) => value * 0.3048).sort((a, b) => a - b),
    },
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);

console.log(`IFC: ${ifc.elements.toLocaleString()} elements; ${ifc.productsWithGeometry.toLocaleString()} with geometry; ${ifc.triangles.toLocaleString()} triangles`);
console.log(`Reviter: ${semantic.summary.displayed.toLocaleString()} displayed records; ${glb.triangles.toLocaleString()} triangles`);
console.log(`Triangle parity: ${(report.parity.triangleRatio * 100).toFixed(1)}%`);
console.log(`Native materials: ${semantic.summary.nativeMaterialAssignments.toLocaleString()} / ${ifc.materialAssignedElementsIncludingTypes.toLocaleString()} assigned elements`);
console.log(`Wrote ${paths.json}`);
