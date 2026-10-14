import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { capabilityManifest } from "../lib/reviter/capabilities.ts";
import { decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { standardsReaderSupports } from "../lib/reviter/reader-support.ts";
import { setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";

const get = (release: number | null, id: string, narrow = false) => {
  const row = capabilityManifest(release, narrow).capabilities.find((entry) => entry.id === id);
  assert.ok(row, id);
  return row;
};

test("metadata cannot promote semantic or geometry support, including 2027 WASM", () => {
  for (const release of [null, 2014, 2016, 2018, 2028, NaN, 2026.5, Infinity]) {
    assert.equal(get(release, "reviter.container-schema").eligible, true);
    assert.equal(get(release, "reviter.native-geometry").status, "unsupported");
    assert.equal(get(release, "reviter.native-element-records").eligible, false);
  }
  assert.equal(get(2027, "vendored.schema-metadata").eligible, true);
  assert.equal(get(2027, "vendored.element-materials").eligible, false);
  assert.equal(get(2027, "reviter.native-geometry").eligible, true);
  for (const release of [2015, 2016, 2026, 2027, 2026.5, NaN, Infinity]) {
    assert.equal(get(release, "vendored.element-materials").eligible, standardsReaderSupports(release));
  }
});

test("release eligibility follows actual native plan including schema-confirmed narrow ids", () => {
  try {
    for (const width of [4, 8] as const) {
      setActiveElementIdBytes(width);
      for (let release = 2016; release <= 2028; release += 1) {
        const eligible = decoderPlanForVersion(release).elementBoundsDecoder != null;
        assert.equal(get(release, "reviter.native-element-records", width === 4).eligible, eligible, `${release}/${width}`);
      }
    }
  } finally {
    setActiveElementIdBytes(8);
  }
});

test("each contract carries checkable evidence and an explicit claim ceiling", () => {
  const manifest = capabilityManifest(2025);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(new Set(manifest.capabilities.map((row) => row.id)).size, manifest.capabilities.length);
  for (const row of manifest.capabilities) {
    assert.ok(row.scope.length > 0 && row.limitations.length > 0 && row.evidence.length > 0);
    assert.ok(["partial", "experimental", "unsupported"].includes(row.status));
    for (const path of row.evidence) {
      assert.ok(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), path);
    }
  }
  const roundTrip = JSON.parse(JSON.stringify(manifest));
  assert.deepEqual(roundTrip, manifest);
});

test("new semantic contracts require actual source inputs, not year or metadata success", () => {
  for (const release of [2016, 2023, 2024, 2025, 2026, 2027]) {
    const manifest = capabilityManifest(release, true);
    for (const row of manifest.capabilities.filter((entry) => [
      "reviter.ifc-revit-globalids", "reviter.ifc-export-overrides", "reviter.ifc-standard-properties",
      "reviter.native-phases", "reviter.native-design-options", "reviter.native-room-identities",
      "reviter.native-room-stored-outlines", "reviter.native-mep-membership-candidates",
      "reviter.native-mep-connector-packets", "reviter.native-mep-family-graphs",
    ].includes(entry.id))) assert.equal(row.eligible, false, `${release}/${row.id}`);
  }
});

test("identity and IFC mappings use validated recovered values independently of release guesses", () => {
  const row = (id: string, source: Parameters<typeof capabilityManifest>[2]) => {
    const entry = capabilityManifest(null, false, source).capabilities.find((value) => value.id === id);
    assert.ok(entry); return entry;
  };
  assert.equal(row("reviter.ifc-revit-globalids", { nativeUniqueIds: ["bad", "00000000-0000-0000-0000-000000000000-00000001"] }).eligible, false);
  assert.equal(row("reviter.ifc-revit-globalids", { nativeUniqueIds: ["00112233-4455-6677-8899-aabbccddeeff-00000001"] }).eligible, true);
  assert.equal(row("reviter.ifc-export-overrides", { ownedParameters: [{ parameterId: -1019014, name: "IFC export", value: "IfcWall" }] }).eligible, true);
  assert.equal(row("reviter.ifc-export-overrides", { ownedParameters: [{ parameterId: -1019014, name: "IFC export", value: "IfcWall" }, { parameterId: -1019014, name: "IFC export", value: "IfcSlab" }] }).eligible, false);
  assert.equal(row("reviter.ifc-export-overrides", { ownedParameters: [{ parameterId: -999, name: "unrecognized", value: "IfcWall" }] }).eligible, false);
  assert.equal(row("reviter.ifc-standard-properties", { ifcEntity: "IFCWALL", nativeTypeName: "Source wall type" }).eligible, true);
  assert.equal(row("reviter.ifc-standard-properties", { ifcEntity: "IFCWALL", ownedParameters: [{ parameterId: -999, name: "unrecognized", value: "Fire resistant" }] }).eligible, false);
});

test("design options use the actual release and schema gate", () => {
  const schema = {
    byteLength: 0, rejectedCandidates: 0, referencedClasses: [], taggedClasses: [
      { name: "ElementHeader", tag: 1439, parent: "", version: 24, declaredFieldCount: 12, offset: 0 },
      { name: "Outline", tag: 326, parent: "", offset: 0 },
      { name: "ElementParents", tag: 1451, parent: "", offset: 0 },
    ],
  };
  const enabled = (release: number) => capabilityManifest(release, false, { schema }).capabilities.find((row) => row.id === "reviter.native-design-options")!.eligible;
  assert.equal(enabled(2024), true);
  assert.equal(enabled(2025), false, "2024 tags cannot admit a 2025 file");
  assert.equal(enabled(2027), false);
  schema.taggedClasses[0]!.declaredFieldCount = 11;
  assert.equal(enabled(2024), false);
});

test("room identity cannot promote stored outlines or navigation, including boxless rooms", () => {
  const room = { elementId: 10, categoryId: -2000160, familyId: null, ownerViewId: null, unplacedOwnerId: null, designOptionId: null };
  const source = { roomHeaders: [room], roomBoundsElementIds: new Set([10]) };
  const eligible = (release: number, id: string, withBounds = true) => capabilityManifest(release, release < 2024,
    { ...source, roomBoundsElementIds: withBounds ? source.roomBoundsElementIds : undefined }).capabilities.find((row) => row.id === id)!.eligible;
  for (const release of [2023, 2024, 2025, 2026, 2027]) {
    assert.equal(eligible(release, "reviter.native-room-identities", false), true);
    assert.equal(eligible(release, "reviter.native-room-stored-outlines", false), false);
    assert.equal(eligible(release, "reviter.native-room-stored-outlines"), release <= 2025);
  }
  assert.equal(capabilityManifest(2025, false, { ...source, roomBoundsElementIds: new Set([11]) }).capabilities.find((row) => row.id === "reviter.native-room-stored-outlines")!.eligible, false);
  assert.ok(capabilityManifest(2025, false, source).capabilities.find((row) => row.id === "reviter.native-room-identities")!.limitations.some((note) => note.includes("navigation")));
});

test("MEP source gates preserve candidate and experimental ceilings", () => {
  const source = {
    schema: { byteLength: 0, rejectedCandidates: 0, referencedClasses: [], taggedClasses: [
      { name: "RbsHvacSystem", tag: 500, parent: "Element", offset: 0 },
      { name: "RbsCurveConnectorManager", tag: 503, parent: "Element", offset: 0 },
    ] },
    mepElementKinds: new Map([[10, "curve" as const]]),
  };
  for (const release of [2023, 2024, 2025, 2026, 2027]) {
    const rows = capabilityManifest(release, release === 2023, source).capabilities;
    const systems = rows.find((row) => row.id === "reviter.native-mep-membership-candidates")!;
    const connectors = rows.find((row) => row.id === "reviter.native-mep-connector-packets")!;
    const family = rows.find((row) => row.id === "reviter.native-mep-family-graphs")!;
    assert.equal(systems.eligible, release >= 2024);
    assert.equal(connectors.eligible, release === 2025);
    if (systems.eligible) assert.equal(systems.status, "experimental");
    assert.equal(family.status, "unsupported"); assert.equal(family.eligible, false);
  }
  for (const missing of [{ schema: source.schema }, { mepElementKinds: source.mepElementKinds }]) {
    const rows = capabilityManifest(2025, false, missing).capabilities;
    assert.equal(rows.find((row) => row.id === "reviter.native-mep-membership-candidates")!.eligible, false);
    assert.equal(rows.find((row) => row.id === "reviter.native-mep-connector-packets")!.eligible, false);
  }
});

test("phase class names alone cannot satisfy exact native field admission", () => {
  const schemaClasses = ["Element", "ProjectPhase", "CellList"].map((name, index) => ({
    name, index: index + 12, version: 1, parent: { kind: "none" as const },
    properties: [], propertyCount: 0, guids: [], unknownWord: 0, inline: false, offset: 0, endOffset: 0,
  }));
  for (const release of [2024, 2025, 2026, 2027]) {
    assert.equal(capabilityManifest(release, false, { schemaClasses }).capabilities.find((row) => row.id === "reviter.native-phases")!.eligible, false);
  }
});

test("phase references qualify for IFC properties only after source name resolution", () => {
  const source = { ifcEntity: "IFCWALL", ownedParameters: [{ parameterId: -1012100, name: "Phase Created", value: 100 }] };
  const get = (resolved: boolean) => capabilityManifest(2027, false, {
    ...source, nativePhaseNames: resolved ? new Map([[100, "Existing"]]) : undefined,
  }).capabilities.find((row) => row.id === "reviter.ifc-standard-properties")!.eligible;
  assert.equal(get(false), false);
  assert.equal(get(true), true);
});
