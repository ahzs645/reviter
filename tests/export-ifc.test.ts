import assert from "node:assert/strict";
import test from "node:test";

import { IfcAPI } from "web-ifc";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { isReviewedRoom } from "../lib/reviter/room-review.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { ReviewedRoom } from "../lib/reviter/room-review.ts";

/** ISO 10303-21: `[SIGN] DIGIT {DIGIT} "." {DIGIT} [ "E" [SIGN] DIGIT {DIGIT} ]`. */
const STEP_REAL = /^[-+]?\d+\.\d*(?:E[-+]?\d+)?$/;
const STEP_INTEGER = /^[-+]?\d+$/;

/**
 * Numeric tokens in the DATA section that a conforming STEP reader may refuse.
 *
 * `web-ifc` accepts malformed REALs — `1E-9` with no decimal point parses there
 * exactly as `1.E-9` does — so the round-trip below is blind to this whole class
 * of defect. The emitted text has to be read on its own terms instead.
 */
function nonConformingNumbers(source: string): string[] {
  const data = source.slice(source.indexOf("\nDATA;"), source.lastIndexOf("ENDSEC;"));
  const withoutStrings = data.replace(/'(?:[^']|'')*'/g, "''");
  const tokens = withoutStrings.match(/[-+]?(?:\d[\d.]*|\.\d[\d.]*)(?:[Ee][-+]?\d+)?/g) ?? [];
  return [...new Set(tokens.filter((token) => !STEP_REAL.test(token) && !STEP_INTEGER.test(token)))];
}

/** DATA lines that are not a single `#id=ENTITY(...);` instance. */
function malformedDataLines(source: string): string[] {
  const data = source.slice(source.indexOf("\nDATA;") + 6, source.lastIndexOf("ENDSEC;"));
  return data.split("\n").filter((line) => line.trim() && !/^#\d+=[A-Z0-9]+\(.*\);$/.test(line));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixture(): ConvertResult {
  return {
    ok: true,
    fileName: "ifc-export-fixture.rvt",
    byteLength: 64,
    meshes: [{
      name: "Recovered elements",
      positions: new Float32Array([
        0, 0, 0, 4, 0, 0, 0, 0, 3,
        1, 0, 0, 2, 0, 0, 1, 0, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array(18),
      elementIds: new Uint32Array([10, 11]),
      materialIndex: 0,
      source: "native-brep",
    }],
    materials: [{
      name: "Concrete",
      baseColorLinear: [0.5, 0.5, 0.5, 1],
      metallic: 0,
      roughness: 0.8,
      doubleSided: false,
      source: "rvt-material",
      assignedElements: 1,
    }],
    segments: [],
    elementBounds: [{
      elementId: 10,
      stream: "Partitions/1",
      chunkIndex: 2,
      rawOffset: 10,
      recordOffset: 20,
      categoryId: -2_000_011,
      categoryName: "Walls",
      categorySource: "native-token",
      typeId: 20,
      typeName: "Exterior Wall - 200mm",
      parameters: [{ parameterId: -1_001_105, name: "Unconnected Height", value: 3 }],
      renderGeometryProvenance: "native",
      boundsFeet: { min: { x: 100, y: 200, z: 10 }, max: { x: 104, y: 201, z: 13 } },
    }, {
      elementId: 11,
      stream: "Partitions/1",
      chunkIndex: 2,
      rawOffset: 40,
      recordOffset: 50,
      categoryId: -2_000_023,
      categoryName: "Doors",
      categorySource: "native-object",
      typeId: 21,
      typeName: "0915 x 2134 mm",
      familyId: 22,
      familyName: "Single Flush",
      renderGeometryProvenance: "reconstructed",
      boundsFeet: { min: { x: 101, y: 200, z: 10 }, max: { x: 104, y: 200.5, z: 12 } },
    }],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027,
      activeDecoders: [],
      nativeCurves: 0,
      nativeProfiles: 0,
      nativeMeshes: 1,
      nativeMaterialDefinitions: 0,
      nativeMaterialAssignments: 1,
      approximateSolids: 1,
      nativeCategorisedElements: 2,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned",
      semanticFidelity: "native-categories",
    },
    origin: { x: 100, y: 200, z: 10 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 1, z: 3 } },
    levels: [{ elevation: 10, candidates: 2, levelId: 30, source: "assoc-level-id" }],
    stats: {
      streamCount: 1,
      partitionStreams: 1,
      gzipChunks: 1,
      inflatedBytes: 1,
      candidatesFound: 2,
      candidatesFocused: 2,
      candidatesUsed: 2,
      vertexCount: 6,
      triangleCount: 2,
      meshCount: 1,
      boundsRecordsFound: 2,
      solidBoundsRecords: 2,
      durationMs: 1,
    },
    warnings: [],
    method: "partition-bounds-recovery",
    nativeIdentity: {
      format: "revit-2027-native-identity",
      declaredRecordCount: 3,
      decodedIdentityCount: 2,
      skippedLeadingRecordCount: 1,
      identities: [10, 11].map((elementId, index) => ({
        elementId,
        originalElementId: elementId,
        creationEpisodeId: 0,
        lastModificationEpisodeId: 0,
        lastUserModificationEpisodeId: null,
        episodeGuid: "11111111-2222-3333-4444-555555555555",
        uniqueId: `11111111-2222-3333-4444-555555555555-0000000${index === 0 ? "a" : "b"}`,
        byteOffset: 34 + index * 40,
        provenance: "Global/ElemTable.ElementHistory+Global/History.Episode" as const,
      })),
    },
    nativeElementMaterialAssignments: [{
      elementId: 10,
      geometryId: 50,
      materialId: 40,
      evidence: "persisted-instance-shared-geometry-material",
    }],
    nativeCompoundLayerMaterialAssignments: [{
      elementId: 10,
      typeId: 20,
      layerIndex: 0,
      materialId: 40,
      widthFeet: 0.5,
      function: 1,
      evidence: "persisted-element-type-compound-layer-material",
    }, {
      elementId: 10,
      typeId: 20,
      layerIndex: 1,
      materialId: 41,
      widthFeet: 0.25,
      function: 2,
      evidence: "persisted-element-type-compound-layer-material",
    }],
    nativeHostRelations: [{
      elementId: 11,
      hostId: 10,
      fieldOffset: 151,
      recordOffset: 50,
      objectLength: 200,
      objectMarker: 0x07ef,
      kind: "host",
      source: "Partitions/InsertableInst.m_hostId",
      evidence: "persisted",
    }],
    nativeAssociatedLevelRelations: [10, 11].map((elementId) => ({
      elementId,
      levelId: 30,
      fieldOffset: 64 as const,
      recordOffset: elementId * 2,
      objectLength: 200,
      objectMarker: 1,
      kind: "associated-level" as const,
      source: "Partitions/Element.m_assocLevelId" as const,
      evidence: "persisted" as const,
    })),
  };
}

test("exports a schema-readable IFC4 population with typed tessellated elements", async () => {
  const source = makeIfc(fixture());
  for (const pattern of [
    /IFCTRIANGULATEDFACESET/,
    /IFCWALL\(/,
    /IFCDOOR\(/,
    /IFCRELVOIDSELEMENT/,
    /IFCRELFILLSELEMENT/,
    /IFCRELDEFINESBYTYPE/,
    /IFCRELASSOCIATESMATERIAL/,
    /IFCMATERIALLAYERSETUSAGE/,
    /IFCMATERIALLAYERSET/,
    /'GeometryExact',\$,IFCBOOLEAN\(\.T\.\)/,
    /'GeometryExact',\$,IFCBOOLEAN\(\.F\.\)/,
  ]) assert.match(source, pattern);

  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  assert.ok(model >= 0);
  try {
    assert.equal(api.GetModelSchema(model), "IFC4");
    const types = api.GetAllTypesOfModel(model);
    const count = (name: string) => {
      const type = types.find((candidate) => candidate.typeName.toUpperCase() === name);
      return type ? api.GetLineIDsWithType(model, type.typeID).size() : 0;
    };
    assert.equal(count("IFCWALL"), 1);
    assert.equal(count("IFCDOOR"), 1);
    assert.equal(count("IFCBUILDINGSTOREY"), 1);

    let products = 0;
    let triangles = 0;
    api.StreamAllMeshes(model, (mesh) => {
      products += 1;
      for (let index = 0; index < mesh.geometries.size(); index += 1) {
        const placed = mesh.geometries.get(index);
        const geometry = api.GetGeometry(model, placed.geometryExpressID);
        triangles += api.GetIndexArray(
          geometry.GetIndexData(),
          geometry.GetIndexDataSize(),
        ).length / 3;
        geometry.delete();
      }
      if (typeof mesh.delete === "function") mesh.delete();
    });
    assert.equal(products, 2);
    assert.equal(triangles, 2);
  } finally {
    api.CloseModel(model);
    api.Dispose();
  }
});

const REVIEW_TIMESTAMP = "2026-08-04T12:00:00.000Z";

function reviewedRoom(
  disposition: ReviewedRoom["disposition"],
  roomId: string,
  overrides: Partial<ReviewedRoom> = {},
): ReviewedRoom {
  return {
    roomId,
    candidateKey: `candidate-${roomId}`,
    levelId: 30,
    closure: "closed",
    disposition,
    geometry: {
      areaSquareFeet: 12,
      centroidFeet: [102, 202],
      loopsFeet: [[[101, 201], [103, 201], [103, 203], [101, 203]]],
    },
    gapIds: [],
    details: {
      number: "101", name: "Seminar", longName: "Seminar room 101", description: "Reviewed room",
      department: "Teaching", occupancyType: "Assembly", accessibility: "Accessible", notes: "", heightFeet: 9,
    },
    ifc: { export: true, predefinedType: "INTERNAL" },
    createdAt: REVIEW_TIMESTAMP,
    updatedAt: REVIEW_TIMESTAMP,
    ...overrides,
  };
}

test("exports only approved room reviews as IfcSpace on their exact storey", () => {
  const source = makeIfc(fixture(), {
    rooms: [reviewedRoom("accepted", "accepted"), reviewedRoom("unreviewed", "pending")],
  });
  assert.equal((source.match(/IFCSPACE\(/g) ?? []).length, 1);
  assert.match(source, /IFCSPACE\([^\n]+Seminar/);
  assert.match(source, /'Reviter_RoomReview'/);
  assert.match(source, /IFCARBITRARYCLOSEDPROFILEDEF/);
  assert.doesNotMatch(source, /candidate-pending/);
});

test("spells every REAL with the decimal point ISO 10303-21 requires", () => {
  // `realProperty` emits raw Revit parameter doubles unfiltered, so this table
  // is a real emission path, not a peek at a private helper.
  const expected: Array<[string, number, string]> = [
    ["Whole", 3, "3."],
    ["Fractional", 1234.5, "1234.5"],
    ["RoundedToTwelveDigits", Math.PI, "3.14159265359"],
    ["Negative", -7.25, "-7.25"],
    ["Zero", 0, "0."],
    // A REAL has no spelling for these, and a reader that meets one stops.
    ["NegativeZero", -0, "0."],
    ["Denormal", Number.MIN_VALUE, "0."],
    // Sub-picometre magnitudes collapse to a plain zero rather than riding out
    // as an exponent literal; 5e-12 is the smallest magnitude that survives.
    ["JustBelowFlushThreshold", 4.9e-12, "0."],
    ["SmallestKeptMagnitude", 5e-12, "5.E-12"],
    ["NotANumber", Number.NaN, "0."],
    ["Infinite", Number.POSITIVE_INFINITY, "0."],
    ["NegativeInfinite", Number.NEGATIVE_INFINITY, "0."],
    // Below 1e-6 and at or above 1e21 JavaScript switches to exponent notation
    // and normalises the mantissa to one leading digit. STEP permits the
    // exponent; it does not permit the missing point that comes with it.
    ["TinyExponent", 1e-9, "1.E-9"],
    ["TinyNegativeExponent", -2.5e-8, "-2.5E-8"],
    ["HugeExponent", 1e21, "1.E+21"],
    ["HugeNegativeExponent", -1e21, "-1.E+21"],
    ["ExtremeExponent", 1.5e300, "1.5E+300"],
    ["JustInsidePlainNotation", 1e-6, "0.000001"],
    ["JustOutsidePlainNotation", 9.999999e-7, "9.999999E-7"],
  ];
  const result = fixture();
  result.elementBounds[0]!.parameters = expected.map(([name, value], index) => ({
    parameterId: -1_000_000 - index,
    name,
    value,
  }));

  const source = makeIfc(result);
  for (const [name, , literal] of expected) {
    assert.match(
      source,
      new RegExp(`'${name} \\[-\\d+\\]',\\$,IFCREAL\\(${escapeForRegExp(literal)}\\),`),
      `${name} should be emitted as ${literal}`,
    );
  }
  assert.deepEqual(nonConformingNumbers(source), []);
});

test("keeps a coordinate a nanometre off the local origin conforming and readable", async () => {
  // Coordinates are written relative to `result.origin`, so a vertex that all
  // but coincides with it lands in the exponent range after the subtraction.
  // The two feet values below are the ones that convert to exactly 1 and 2
  // nanometres, the magnitudes whose single-digit mantissa loses its point.
  const result = fixture();
  result.origin = { x: 0, y: 0, z: 0 };
  const room = reviewedRoom("accepted", "near-origin", {
    geometry: {
      areaSquareFeet: 12,
      centroidFeet: [2, 2],
      loopsFeet: [[[1e-9 / 0.3048, 2e-9 / 0.3048], [3, 0], [3, 3], [0, 3]]],
    },
  });
  const source = makeIfc(result, { rooms: [room] });

  assert.match(source, /IFCCARTESIANPOINT\(\(1\.E-9,2\.E-9\)\)/);
  assert.deepEqual(nonConformingNumbers(source), []);
  assert.deepEqual(malformedDataLines(source), []);

  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  assert.ok(model >= 0);
  try {
    assert.equal(api.GetModelSchema(model), "IFC4");
    const types = api.GetAllTypesOfModel(model);
    const space = types.find((candidate) => candidate.typeName.toUpperCase() === "IFCSPACE");
    assert.ok(space, "the near-origin room should survive the round trip as an IfcSpace");
    assert.equal(api.GetLineIDsWithType(model, space.typeID).size(), 1);
  } finally {
    api.CloseModel(model);
    api.Dispose();
  }
});

test("refuses a room predefined type that is not an IFC4 IfcSpaceTypeEnum item", () => {
  // A review sidecar is user-supplied JSON, and `IfcSpace.PredefinedType`
  // reaches STEP as a bare `.ENUM.` token that no escaping can make safe.
  const injection = "INTERNAL.,$); INJECTED";
  const hostile = reviewedRoom("accepted", "hostile", {
    ifc: { export: true, predefinedType: injection as ReviewedRoom["ifc"]["predefinedType"] },
  });

  assert.equal(isReviewedRoom(hostile), false, "the import boundary should reject it");
  assert.equal(isReviewedRoom(reviewedRoom("accepted", "clean")), true);
  for (const permitted of ["INTERNAL", "EXTERNAL", "NOTDEFINED"] as const) {
    assert.equal(isReviewedRoom(reviewedRoom("accepted", permitted, {
      ifc: { export: true, predefinedType: permitted },
    })), true);
  }
  // IfcSpaceTypeEnum has these too, but Reviter never writes them, and
  // IfcInternalOrExternalEnum's items are not this attribute's vocabulary.
  for (const rejected of ["SPACE", "USERDEFINED", "EXTERNAL_EARTH", "internal", ""]) {
    assert.equal(isReviewedRoom(reviewedRoom("accepted", "other", {
      ifc: { export: true, predefinedType: rejected as ReviewedRoom["ifc"]["predefinedType"] },
    })), false, `${rejected || "(empty)"} should not be accepted`);
  }

  const source = makeIfc(fixture(), { rooms: [hostile] });
  assert.match(source, /IFCSPACE\([^\n]+,\.ELEMENT\.,\.NOTDEFINED\.,\$\);$/m);
  assert.doesNotMatch(source, /INJECTED/);
  assert.deepEqual(malformedDataLines(source), []);
});

test("declares the units IfcProject needs, not length alone", () => {
  const source = makeIfc(fixture());
  const assignment = /IFCUNITASSIGNMENT\(\(([^)]*)\)\)/.exec(source)?.[1];
  assert.ok(assignment);
  const declared = assignment.split(",").map((reference) => {
    const unit = new RegExp(`^${escapeForRegExp(reference)}=IFCSIUNIT\\(\\*,\\.(\\w+)\\.,`, "m").exec(source);
    return unit?.[1];
  });
  assert.deepEqual(declared, ["LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT", "PLANEANGLEUNIT"]);
});

test("keeps two types apart when their recovered names contain the key separator", () => {
  // `familyName` and `typeName` come out of a binary recovery, so neither is
  // guaranteed free of the character used to join the type-group key.
  const result = fixture();
  const [first, second] = result.elementBounds;
  for (const record of [first!, second!]) {
    record.categoryId = -2_000_011;
    record.categoryName = "Walls";
    record.categorySource = "native-token";
    delete record.typeId;
    delete record.familyId;
    delete record.familySymbolId;
  }
  first!.familyName = "Basic Wall";
  first!.typeName = "Exterior:200mm";
  second!.familyName = "Basic Wall:Exterior";
  second!.typeName = "200mm";

  const source = makeIfc(result);
  const typeGuids = [...source.matchAll(/IFCWALLTYPE\('([^']+)'/g)].map((match) => match[1]);
  assert.equal(typeGuids.length, 2, "two distinct Revit types must not collapse into one");
  assert.equal(new Set(typeGuids).size, 2, "and must not share a GUID");
});

test("keeps element IFC GUIDs stable when the same native model is renamed", () => {
  const first = fixture();
  const second = fixture();
  second.fileName = "renamed-copy.rvt";
  const firstGuid = /IFCWALL\('([^']+)'/.exec(makeIfc(first))?.[1];
  const secondGuid = /IFCWALL\('([^']+)'/.exec(makeIfc(second))?.[1];
  assert.ok(firstGuid);
  assert.equal(secondGuid, firstGuid);
  assert.match(firstGuid, /^[0-3][0-9A-Za-z_$]{21}$/);
});
