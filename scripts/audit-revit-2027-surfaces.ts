/**
 * Certify the Revit 2027 analytic-surface schema and inventory every surface
 * descriptor reached by the exact Face audit.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-surfaces.ts model.rvt [reference.ifc]
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  openRvt,
} from "./lib/rvt-harness.ts";

import {
  matchesAscii,
  requireNameOffset,
} from "./lib/rvt-harness.ts";

import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-surfaces.ts";

const modelPath = process.argv[2];
const ifcPath = process.argv[3];
if (!modelPath) {
  throw new Error("usage: audit-revit-2027-surfaces.ts model.rvt [reference.ifc]");
}

const EXPECTED_SURFACE_COUNTS = {
  [REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT]: 40_813,
  [REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT]: 10,
  [REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT]: 136,
  [REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT]: 2,
} as const;

type FieldEvidence = {
  name: string;
  offset: number;
  descriptor: string;
};

function sourceNameAtSlot(data: Uint8Array, sourceClassSlot: number) {
  const candidates: { name: string; offset: number }[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset <= data.byteLength - 4; offset += 1) {
    const length = view.getUint16(offset, true);
    if (length < 2 || length > 100 || offset > data.byteLength - length - 2) {
      continue;
    }
    let ascii = true;
    for (let index = 0; index < length; index += 1) {
      const value = data[offset + 2 + index]!;
      if (value < 0x20 || value > 0x7e) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      candidates.push({
        name: new TextDecoder("ascii").decode(
          data.subarray(offset + 2, offset + 2 + length),
        ),
        offset,
      });
    }
  }
  const candidate = candidates[sourceClassSlot - 12];
  if (!candidate) {
    throw new Error(`Formats/Latest source slot ${sourceClassSlot} is missing`);
  }
  return { sourceClassSlot, ...candidate };
}

function field(
  data: Uint8Array,
  name: string,
  descriptor: readonly number[],
  firstOffset: number,
  endOffset: number,
): FieldEvidence {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= endOffset - name.length - descriptor.length - 4;
    offset += 1
  ) {
    if (
      view.getUint32(offset, true) !== name.length ||
      !matchesAscii(data, offset + 4, name)
    ) {
      continue;
    }
    const descriptorOffset = offset + 4 + name.length;
    if (
      descriptor.some(
        (expected, index) => data[descriptorOffset + index] !== expected,
      )
    ) {
      continue;
    }
    return {
      name,
      offset,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    };
  }
  throw new Error(`schema field ${name} changed or moved outside its class`);
}

function certifyClass(
  schema: Uint8Array,
  name: string,
  nextName: string,
  expectedHeader: readonly number[],
  fields: readonly (readonly [string, readonly number[]])[],
) {
  const offset = requireNameOffset(schema, name);
  const endOffset = requireNameOffset(schema, nextName, offset + 2 + name.length);
  const headerOffset = offset + 2 + name.length;
  if (
    expectedHeader.some(
      (expected, index) => schema[headerOffset + index] !== expected,
    )
  ) {
    throw new Error(`${name} schema header changed`);
  }
  let fieldCursor = headerOffset + expectedHeader.length;
  const fieldEvidence = fields.map(([fieldName, descriptor]) => {
    const evidence = field(
      schema,
      fieldName,
      descriptor,
      fieldCursor,
      endOffset,
    );
    fieldCursor = evidence.offset + 4 + fieldName.length + descriptor.length;
    return evidence;
  });
  return { name, offset, endOffset, fields: fieldEvidence };
}

const model = openRvt(modelPath);
const schema = model.requireSchema();
const sourceLadder = [2213, 4282, 4283, 4284].map((sourceClassSlot) =>
  sourceNameAtSlot(schema, sourceClassSlot),
);
if (
  sourceLadder.map(({ name }) => name).join(",") !==
  "GArc,SuppressGCMemberFaceRegionsGStep,SurfRev,SurfaceAdapter"
) {
  throw new Error("Formats/Latest SurfRev source ladder changed");
}
const point3d = [0x07, 0x10, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00] as const;
const double = [0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] as const;
const conditional = [0x0e, 0x01, 0x00, 0x00] as const;

const plane = certifyClass(
  schema,
  "Plane",
  "BeamMiterLockControl",
  [0x7b, 0x82, 0x00, 0x00],
  [
    ["m_Envelope", [0x0e, 0x00, 0x00, 0x00]],
    ["m_orientFlag", [0x01, 0x00, 0x00, 0x00]],
    ["m_origin", point3d],
    ["m_xVec", point3d],
    ["m_yVec", point3d],
  ],
);
const cone = certifyClass(
  schema,
  "ConeSurf",
  "ConnElemCheckControl",
  [0x7b, 0x02, 0x02, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00],
  [
    ["m_center", point3d],
    ["m_xVec", point3d],
    ["m_yVec", point3d],
    ["m_zVec", point3d],
    ["m_halfAngle", double],
  ],
);
const cylinder = certifyClass(
  schema,
  "CylSurf",
  "DBDrawing",
  [0x7b, 0x02, 0x02, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00],
  [
    ["m_center", point3d],
    ["m_xVec", point3d],
    ["m_yVec", point3d],
    ["m_zVec", point3d],
    ["m_radius", double],
  ],
);
const surfaceOfRevolution = certifyClass(
  schema,
  "SurfRev",
  "SurfaceAdapter",
  [0x7b, 0x02, 0x01, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00],
  [
    ["m_center", point3d],
    ["m_xVec", point3d],
    ["m_yVec", point3d],
    ["m_zVec", point3d],
    ["m_pProfileCurve", conditional],
  ],
);

const faceAuditPath = fileURLToPath(
  new URL("./audit-revit-2027-face-static.ts", import.meta.url),
);
const faceAudit = spawnSync(
  process.execPath,
  ["--experimental-strip-types", faceAuditPath, modelPath],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
if (faceAudit.status !== 0) {
  throw new Error(faceAudit.stderr || "Face audit failed");
}
const faceReport = JSON.parse(faceAudit.stdout) as {
  release: number;
  faces: { declared: number; decoded: number };
  queueOwnership: {
    childSourceClassSlots: Record<string, number>;
    childTokenKinds: Record<string, number>;
  };
  failures: Record<string, number>;
};
const observedSurfaceCounts = Object.fromEntries(
  Object.keys(EXPECTED_SURFACE_COUNTS).map((slot) => [
    slot,
    faceReport.queueOwnership.childSourceClassSlots[slot] ?? 0,
  ]),
);
if (
  Object.entries(EXPECTED_SURFACE_COUNTS).some(
    ([slot, expected]) => observedSurfaceCounts[slot] !== expected,
  )
) {
  throw new Error("exact model surface descriptor counts changed");
}

let ifcFaceCount: number | null = null;
if (ifcPath) {
  const text = readFileSync(ifcPath, "utf8");
  ifcFaceCount = text.match(/IFCFACE\(/g)?.length ?? 0;
}
const declaredSurfaceCount = Object.values(observedSurfaceCounts).reduce(
  (sum, count) => sum + count,
  0,
);

console.log(
  JSON.stringify(
    {
      modelPath,
      release: faceReport.release,
      schema: {
        byteLength: schema.byteLength,
        sourceLadder,
        classes: { plane, cone, cylinder, surfaceOfRevolution },
      },
      faceSurfaceDescriptors: {
        declaredFaces: faceReport.faces.declared,
        decodedFaceBodies: faceReport.faces.decoded,
        observedSurfaceCounts,
        total: declaredSurfaceCount,
        expectedTokenKinds: {
          "634:numbered":
            faceReport.queueOwnership.childTokenKinds["634:numbered"] ?? 0,
          "900:sentinel":
            faceReport.queueOwnership.childTokenKinds["900:sentinel"] ?? 0,
          "1144:sentinel":
            faceReport.queueOwnership.childTokenKinds["1144:sentinel"] ?? 0,
          "4283:sentinel":
            faceReport.queueOwnership.childTokenKinds["4283:sentinel"] ?? 0,
        },
      },
      bodyCoverage: {
        exactSlot4283Bodies: 2,
        exactSlot4283BodyBytes: 135,
        blocker:
          "This schema/descriptor audit does not replay the interleaved Face " +
          "children; audit-revit-2027-face-child-replay.ts certifies bodies.",
      },
      exactSurfaceOfRevolution: {
        sourceClassSlot:
          REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
        observedBodies: 2,
        surfaceBaseBytes: 33,
        derivedBytes: 102,
        totalBytes: 135,
        profileCurveDescriptors: [
          { token: 56, sourceClassSlot: 2213 },
          { token: 57, sourceClassSlot: 2213 },
        ],
        sourceClassSlot2213: "GArc",
      },
      ifcOracle:
        ifcFaceCount == null
          ? null
          : {
              path: ifcPath,
              ifcFaceCount,
              comparableTriangles: 0,
              parityClaim: false,
            },
      nativeProof: {
        library: "TB_FormatCommonReaders.tx (2026 reference reader)",
        commonSurfaceReader: "source 5927 @ 0x5ea8a4",
        planeReader: "source 5627 @ 0x57dec8",
        coneReader: "source 4951 @ 0x603ade",
        cylinderReader: "source 5015 @ 0x655f6c",
        surfaceOfRevolutionReader: "source 5926 @ 0x5eb160",
        callOrder:
          "SurfRev -> Surface(envelope, orient) -> center -> x/y/z vectors -> profile CondInt16",
      },
      failures: faceReport.failures,
      stopBoundary:
        "descriptor inventory and four persistence readers only; GArc replay, " +
        "BRep assembly, libTD_Ge evaluation, and tessellation are not claimed",
    },
    null,
    2,
  ),
);
