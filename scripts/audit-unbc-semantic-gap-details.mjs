#!/usr/bin/env node

/**
 * Read-only, element-level detail behind the aggregate semantic parity ratios.
 *
 * This intentionally audits only the four native-semantic targets named by
 * the UNBC proof of concept: UniqueId, model-tree membership, family/type
 * naming, and exact material assignment. IFC is an oracle only.
 *
 * Usage:
 *   node scripts/audit-unbc-semantic-gap-details.mjs \
 *     --ifc "/path/to/reference.ifc" \
 *     --semantic outputs/unbc-parity.json \
 *     [--json /tmp/unbc-semantic-gap-details.json]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const argv = process.argv.slice(2);

function option(name, required = true) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  if (!required) return null;
  throw new Error(`Missing ${name}.`);
}

const paths = {
  rvt: option("--rvt", false),
  ifc: option("--ifc"),
  semantic: option("--semantic"),
  json: option("--json", false),
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scalar(value) {
  if (value == null) return null;
  return typeof value === "object" && "value" in value ? value.value : value;
}

function splitStepArgs(source) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'") {
      if (quoted && source[index + 1] === "'") index += 1;
      else quoted = !quoted;
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

function firstQuoted(source = "") {
  const match = /^'((?:''|[^'])*)'$/.exec(source.trim());
  return match ? decodeIfcString(match[1].replaceAll("''", "'")) : null;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function ranked(map, limit = 20) {
  return [...map]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function parseStep(text) {
  const materialNodes = new Map();
  const materialRelations = [];
  const typeRelations = [];
  const containmentRelations = [];
  const aggregateRelations = [];
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const id = Number(match[1]);
    const type = match[2];
    const args = match[3];
    const fields = splitStepArgs(args);
    if (type.startsWith("IFCMATERIAL")) {
      materialNodes.set(id, {
        type,
        refs: refs(args),
        name: type === "IFCMATERIAL" ? firstQuoted(fields[0]) : null,
      });
    } else if (type === "IFCRELASSOCIATESMATERIAL") {
      materialRelations.push({
        related: refs(fields[4]),
        material: refs(fields[5])[0] ?? 0,
      });
    } else if (type === "IFCRELDEFINESBYTYPE") {
      typeRelations.push({
        related: refs(fields[4]),
        typeObject: refs(fields[5])[0] ?? 0,
      });
    } else if (type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      containmentRelations.push({
        related: refs(fields[4]),
        container: refs(fields[5])[0] ?? 0,
      });
    } else if (type === "IFCRELAGGREGATES") {
      aggregateRelations.push({
        parent: refs(fields[4])[0] ?? 0,
        related: refs(fields[5]),
      });
    }
  }
  return {
    materialNodes,
    materialRelations,
    typeRelations,
    containmentRelations,
    aggregateRelations,
  };
}

function materialNames(root, nodes, memo = new Map(), visiting = new Set()) {
  if (!root || visiting.has(root)) return new Set();
  if (memo.has(root)) return memo.get(root);
  const node = nodes.get(root);
  if (!node) return new Set();
  visiting.add(root);
  const names = new Set(node.name ? [node.name] : []);
  for (const child of node.refs) {
    for (const name of materialNames(child, nodes, memo, visiting)) names.add(name);
  }
  visiting.delete(root);
  memo.set(root, names);
  return names;
}

function splitIfcTypeName(name) {
  if (typeof name !== "string" || !name) return { family: null, type: null };
  const separator = name.indexOf(":");
  return separator < 1
    ? { family: null, type: name }
    : { family: name.slice(0, separator), type: name.slice(separator + 1) };
}

function familyFromElementName(name, tag) {
  if (typeof name !== "string" || tag == null) return null;
  const suffix = `:${tag}`;
  if (!name.endsWith(suffix)) return null;
  const withoutTag = name.slice(0, -suffix.length);
  const separator = withoutTag.indexOf(":");
  return separator < 1 ? null : withoutTag.slice(0, separator);
}

const ifcBytes = readFileSync(paths.ifc);
const semanticBytes = readFileSync(paths.semantic);
const semantic = JSON.parse(semanticBytes.toString("utf8"));
const manifest = semantic.elementManifest?.elements ?? [];
const manifestById = new Map(manifest.map((element) => [element.elementId, element]));
const nativeIdentityIds = new Set(
  (semantic.modelTree?.elements ?? [])
    .filter((element) => typeof element.uniqueId === "string" && element.uniqueId)
    .map((element) => element.elementId),
);
const modelTreeMemberIds = new Set();
for (const element of semantic.modelTree?.elements ?? []) {
  if (
    element.owningElementId != null &&
    element.owningElementId !== element.elementId
  ) {
    modelTreeMemberIds.add(element.elementId);
  }
}
for (const relation of semantic.modelTree?.hostRelations ?? []) {
  modelTreeMemberIds.add(relation.elementId);
}
for (const relation of semantic.modelTree?.associatedLevelRelations ?? []) {
  modelTreeMemberIds.add(relation.elementId);
}

const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the IFC.");

const elements = new Map();
for (const typeCode of api.GetIfcEntityList(model)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const ifcClass = api.GetNameFromTypeCode(typeCode);
  const ids = api.GetLineIDsWithType(model, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const line = api.GetLine(model, expressId, false);
    const rawTag = scalar(line.Tag);
    const tag =
      typeof rawTag === "string" && /^\d+$/u.test(rawTag)
        ? Number(rawTag)
        : null;
    elements.set(expressId, {
      expressId,
      ifcClass,
      tag,
      name: scalar(line.Name),
    });
  }
}

const step = parseStep(ifcBytes.toString("latin1"));
const typeByElement = new Map();
for (const relation of step.typeRelations) {
  for (const related of relation.related) {
    if (elements.has(related)) typeByElement.set(related, relation.typeObject);
  }
}
const typeNames = new Map();
for (const typeObject of new Set(typeByElement.values())) {
  typeNames.set(typeObject, scalar(api.GetLine(model, typeObject, false)?.Name));
}

const directMaterialNames = new Map();
const materialMemo = new Map();
for (const relation of step.materialRelations) {
  const names = materialNames(
    relation.material,
    step.materialNodes,
    materialMemo,
  );
  for (const related of relation.related) {
    const assigned = directMaterialNames.get(related) ?? new Set();
    for (const name of names) assigned.add(name);
    directMaterialNames.set(related, assigned);
  }
}

const nativeMaterialNamesById = new Map(
  (semantic.nativeMaterialDefinitions ?? []).map((material) => [
    material.elementId,
    material.name,
  ]),
);
const nativeMaterialNamesByElement = new Map();
for (const element of manifest) {
  const names = new Set(
    (element.materialAssignments ?? [])
      .map((assignment) => assignment.name ?? nativeMaterialNamesById.get(assignment.materialId))
      .filter(Boolean),
  );
  if (names.size) nativeMaterialNamesByElement.set(element.elementId, names);
}

const treeMembership = new Map();
for (const relation of step.containmentRelations) {
  for (const related of relation.related) {
    if (!elements.has(related)) continue;
    const membership = treeMembership.get(related) ?? [];
    membership.push({ kind: "containment", parent: relation.container });
    treeMembership.set(related, membership);
  }
}
for (const relation of step.aggregateRelations) {
  for (const related of relation.related) {
    if (!elements.has(related)) continue;
    const membership = treeMembership.get(related) ?? [];
    membership.push({ kind: "aggregation", parent: relation.parent });
    treeMembership.set(related, membership);
  }
}

const identityMissingByTag = new Map();
const treeMissingByTag = new Map();
const familyMissingByTag = new Map();
const materialMissingByTag = new Map();
const treeByClass = new Map();
const treeByKind = new Map();
const treeByParentClass = new Map();
const familyByClass = new Map();
const familyByName = new Map();
const materialByClass = new Map();
const materialByName = new Map();
const materialBySource = new Map();
const numericTags = new Set();
const treeComparableTags = new Set();
const treeMatchedTags = new Set();
const familyComparableTags = new Set();
const familyExactTags = new Set();
const materialComparableTags = new Set();
const materialExactSubsetTags = new Set();

for (const [expressId, element] of elements) {
  if (element.tag != null) {
    numericTags.add(element.tag);
    if (!nativeIdentityIds.has(element.tag)) {
      identityMissingByTag.set(element.tag, element);
    }
  }

  const memberships = treeMembership.get(expressId) ?? [];
  if (element.tag != null && memberships.length > 0) {
    treeComparableTags.add(element.tag);
    if (modelTreeMemberIds.has(element.tag)) treeMatchedTags.add(element.tag);
  }
  if (
    element.tag != null &&
    memberships.length > 0 &&
    !modelTreeMemberIds.has(element.tag)
  ) {
    const row = {
      tag: element.tag,
      ifcClass: element.ifcClass,
      name: element.name,
      memberships: memberships.map((membership) => {
        const parent = elements.get(membership.parent);
        return {
          kind: membership.kind,
          parentExpressId: membership.parent,
          parentClass: parent?.ifcClass ?? null,
          parentTag: parent?.tag ?? null,
          parentName: parent?.name ?? null,
        };
      }),
      reviterRecordPresent: manifestById.has(element.tag),
    };
    if (!treeMissingByTag.has(element.tag)) {
      treeMissingByTag.set(element.tag, row);
      increment(treeByClass, element.ifcClass);
      for (const membership of row.memberships) {
        increment(treeByKind, membership.kind);
        increment(treeByParentClass, membership.parentClass ?? "<non-element parent>");
      }
    }
  }

  const typeObject = typeByElement.get(expressId);
  if (element.tag != null && typeObject != null) {
    const split = splitIfcTypeName(typeNames.get(typeObject));
    const ifcFamily = split.family ?? familyFromElementName(element.name, element.tag);
    if (ifcFamily) {
      familyComparableTags.add(element.tag);
      const reviterFamily = manifestById.get(element.tag)?.type?.familyName ?? null;
      if (reviterFamily === ifcFamily) {
        familyExactTags.add(element.tag);
      } else if (reviterFamily == null) {
        const row = {
          tag: element.tag,
          ifcClass: element.ifcClass,
          ifcFamily,
          ifcType: split.type,
          reviterRecordPresent: manifestById.has(element.tag),
          reviterTypeName: manifestById.get(element.tag)?.type?.name ?? null,
          reviterSymbolId: manifestById.get(element.tag)?.type?.symbolId ?? null,
        };
        if (!familyMissingByTag.has(element.tag)) {
          familyMissingByTag.set(element.tag, row);
          increment(familyByClass, element.ifcClass);
          increment(familyByName, ifcFamily);
        }
      }
    }
  }

  if (element.tag != null) {
    const assigned = new Set(directMaterialNames.get(expressId) ?? []);
    const typeObjectForMaterial = typeByElement.get(expressId);
    for (const name of directMaterialNames.get(typeObjectForMaterial) ?? []) {
      assigned.add(name);
    }
    if (assigned.size) {
      materialComparableTags.add(element.tag);
      const native = nativeMaterialNamesByElement.get(element.tag) ?? new Set();
      const exactSubset =
        native.size > 0 && [...native].every((name) => assigned.has(name));
      if (exactSubset) {
        materialExactSubsetTags.add(element.tag);
      } else if (native.size === 0) {
        const source =
          directMaterialNames.has(expressId) && directMaterialNames.has(typeObjectForMaterial)
            ? "direct-and-type"
            : directMaterialNames.has(expressId)
              ? "direct"
              : "type";
        const row = {
          tag: element.tag,
          ifcClass: element.ifcClass,
          ifcMaterials: [...assigned].sort(),
          assignmentSource: source,
          ifcFamily: splitIfcTypeName(typeNames.get(typeObjectForMaterial)).family,
          reviterRecordPresent: manifestById.has(element.tag),
        };
        if (!materialMissingByTag.has(element.tag)) {
          materialMissingByTag.set(element.tag, row);
          increment(materialByClass, element.ifcClass);
          increment(materialBySource, source);
          for (const name of assigned) increment(materialByName, name);
        }
      }
    }
  }
}

const result = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-unbc-semantic-gap-details.mjs",
  inputs: {
    ifc: {
      name: basename(paths.ifc),
      bytes: ifcBytes.length,
      sha256: sha256(ifcBytes),
    },
    semantic: {
      name: basename(paths.semantic),
      bytes: semanticBytes.length,
      sha256: sha256(semanticBytes),
    },
  },
  identity: {
    numericIfcTags: numericTags.size,
    nativeUniqueIdMatches: numericTags.size - identityMissingByTag.size,
    missing: [...identityMissingByTag.values()],
  },
  modelTree: {
    comparableNumericTags: treeComparableTags.size,
    matches: treeMatchedTags.size,
    missingCount: treeMissingByTag.size,
    missingByClass: ranked(treeByClass),
    missingByIfcRelationKind: ranked(treeByKind),
    missingByParentClass: ranked(treeByParentClass),
    missing: [...treeMissingByTag.values()],
  },
  family: {
    comparableNumericTags: familyComparableTags.size,
    exactMatches: familyExactTags.size,
    missingCount: familyMissingByTag.size,
    missingByClass: ranked(familyByClass),
    missingByIfcFamily: ranked(familyByName),
    missing: [...familyMissingByTag.values()],
  },
  material: {
    comparableNumericTags: materialComparableTags.size,
    exactNativeSubsetMatches: materialExactSubsetTags.size,
    missingCount: materialMissingByTag.size,
    missingByClass: ranked(materialByClass),
    missingByIfcMaterial: ranked(materialByName),
    missingByAssignmentSource: ranked(materialBySource),
    missing: [...materialMissingByTag.values()],
  },
};

if (paths.rvt) {
  const expectedByParent = new Map();
  const aliasedIfcTags = [];
  for (const row of treeMissingByTag.values()) {
    for (const membership of row.memberships) {
      if (membership.kind !== "aggregation" || membership.parentTag == null) {
        continue;
      }
      if (membership.parentTag === row.tag) {
        aliasedIfcTags.push({
          tag: row.tag,
          ifcClass: row.ifcClass,
          parentExpressId: membership.parentExpressId,
        });
        continue;
      }
      const children = expectedByParent.get(membership.parentTag) ?? [];
      children.push({ tag: row.tag, ifcClass: row.ifcClass });
      expectedByParent.set(membership.parentTag, children);
    }
  }

  const rvtBytes = readFileSync(paths.rvt);
  const container = CFB.read(rvtBytes, { type: "buffer" });
  const observed = new Map();
  const parentFrameCounts = new Map();
  for (let entryIndex = 0; entryIndex < container.FileIndex.length; entryIndex += 1) {
    const stream = container.FullPaths[entryIndex] ?? "";
    if (!/\/Partitions\/[^/]+$/iu.test(stream)) continue;
    const stored = stripRevitPageChecksums(
      asBytes(container.FileIndex[entryIndex].content),
    );
    const offsets = gzipOffsets(stored);
    let window = null;
    for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
      const read = inflateRevitChunk(
        stored,
        offsets[chunkIndex],
        offsets[chunkIndex + 1],
        window,
      );
      const inflated =
        read ??
        salvageRevitChunk(
          stored,
          offsets[chunkIndex],
          offsets[chunkIndex + 1],
          window,
        );
      if (!inflated) continue;
      if (read) window = revitWindowTail(read);
      const view = new DataView(
        inflated.buffer,
        inflated.byteOffset,
        inflated.byteLength,
      );
      for (const frame of scanFramedElementObjects(inflated)) {
        const expected = expectedByParent.get(frame.elementId);
        if (!expected) continue;
        increment(
          parentFrameCounts,
          `marker=${frame.marker} type=${frame.typeCode}`,
        );
        for (const child of expected) {
          const offsetsInFrame = [];
          for (
            let offset = frame.offset + 18;
            offset + 8 <= frame.offset + frame.objectLength;
            offset += 1
          ) {
            if (
              view.getUint32(offset, true) === child.tag &&
              view.getUint32(offset + 4, true) === 0
            ) {
              offsetsInFrame.push(offset - frame.offset);
            }
          }
          if (!offsetsInFrame.length) continue;
          const previous = observed.get(child.tag);
          const candidate = {
            tag: child.tag,
            ifcClass: child.ifcClass,
            parentTag: frame.elementId,
            parentMarker: frame.marker,
            parentTypeCode: frame.typeCode,
            parentObjectLength: frame.objectLength,
            offsets: offsetsInFrame,
          };
          if (
            previous == null ||
            (frame.marker === 4075 && previous.parentMarker !== 4075)
          ) {
            observed.set(child.tag, candidate);
          }
        }
      }
    }
  }

  const expected = [...expectedByParent.values()].flat();
  const observedInStairsCarrier = [...observed.values()].filter(
    (row) => row.parentMarker === 4075,
  );
  const carrierByClass = new Map();
  for (const row of observedInStairsCarrier) {
    increment(carrierByClass, row.ifcClass);
  }
  const fixedRailingOffset = observedInStairsCarrier.filter(
    (row) => row.ifcClass === "IfcRailing" && row.offsets.includes(131),
  ).length;
  result.modelTree.rvtAggregationCarrierAudit = {
    evidenceLevel:
      "candidate only: exact parent/child ids inside independently framed RVT objects; publish only after scoped collection readers certify the cursor",
    rvt: {
      name: basename(paths.rvt),
      bytes: rvtBytes.length,
      sha256: sha256(rvtBytes),
    },
    expectedNonAliasedAggregationTags: expected.length,
    ifcTagAliasCollisions: aliasedIfcTags,
    expectedTagsPresentInAnyParentFrame: observed.size,
    expectedTagsPresentInMarker4075Parent: observedInStairsCarrier.length,
    presentInMarker4075ParentByClass: ranked(carrierByClass),
    marker4075RailingTagsAtFixedOffset131: fixedRailingOffset,
    parentFrameKinds: ranked(parentFrameCounts),
    unresolvedTags: expected
      .filter((row) => !observed.has(row.tag))
      .sort((left, right) => left.tag - right.tag),
    candidates: observedInStairsCarrier.sort(
      (left, right) => left.tag - right.tag,
    ),
    nativeContracts: [
      "OdBmStairsElement::getRunsAndLandings",
      "OdBmStairsElement::getSupports",
      "OdBmStairsElement::getRegisteredRailings",
      "OdBmStairsRunAndLanding::getStairsId",
    ],
  };
}

api.CloseModel(model);
api.Dispose();

const summary = {
  identity: `${result.identity.nativeUniqueIdMatches}/${result.identity.numericIfcTags}`,
  modelTree: `${result.modelTree.matches}/${result.modelTree.comparableNumericTags}`,
  family: `${result.family.exactMatches}/${result.family.comparableNumericTags}`,
  material: `${result.material.exactNativeSubsetMatches}/${result.material.comparableNumericTags}`,
};
console.log(JSON.stringify(summary, null, 2));
console.log("Model-tree gaps by class:", result.modelTree.missingByClass);
console.log("Family gaps by class:", result.family.missingByClass);
console.log("Material gaps by class:", result.material.missingByClass);
if (paths.json) {
  writeFileSync(paths.json, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${paths.json}`);
}
