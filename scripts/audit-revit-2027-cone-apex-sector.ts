/**
 * Exercise the browser-only exact cone-apex-sector tessellator against the
 * detailed cone payload emitted by audit-revit-2027-cylinder-cone-trims.ts.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-cone-apex-sector.ts cone-trims.json
 */
import { readFileSync } from "node:fs";

import {
  tessellateRevit2027ConeApexSectors,
  type Revit2027ConeApexSectorFace,
} from "../lib/reviter/revit-2027-cone-apex-sector.ts";

type ConeDetail = {
  elementId: number;
  faceToken: number;
  faceFlags: number;
  surface: {
    center: readonly [number, number, number];
    xVector: readonly [number, number, number];
    yVector: readonly [number, number, number];
    zVector: readonly [number, number, number];
    halfAngle: number;
    orientFlag: boolean;
    envelope: {
      firstCorner: readonly [number, number];
      secondCorner: readonly [number, number];
    };
  };
  graphStatus: string;
  edges: {
    token: number;
    direction: 1 | -1;
    samples: readonly (readonly [number, number])[];
  }[];
};

type ConeTrimAudit = {
  modelPath: string;
  release: number;
  coneDetails: ConeDetail[];
};

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedEntries(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map].sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/audit-revit-2027-cone-apex-sector.ts cone-trims.json",
  );
}
const audit = JSON.parse(
  readFileSync(inputPath, "utf8"),
) as ConeTrimAudit;
if (
  audit.release !== 2027 ||
  !Array.isArray(audit.coneDetails)
) {
  throw new Error(
    "input must be a Revit 2027 cylinder/cone trim audit with coneDetails",
  );
}

const classifications = new Map<string, number>();
const rows = [];
const acceptedOwners = new Set<number>();
let acceptedFaces = 0;
let triangles = 0;
let vertices = 0;
for (const detail of audit.coneDetails) {
  const provenance = {
    decoderId: "revit-2027-cone-apex-sector-audit",
    elementId: detail.elementId,
  };
  const face: Revit2027ConeApexSectorFace = {
    faceToken: detail.faceToken,
    surface: {
      kind: "cone",
      center: detail.surface.center,
      xVector: detail.surface.xVector,
      yVector: detail.surface.yVector,
      zVector: detail.surface.zVector,
      halfAngle: detail.surface.halfAngle,
      surface: {
        envelope: detail.surface.envelope,
        orientFlag: detail.surface.orientFlag,
      },
    },
    loops: [{
      loopToken: 1,
      role: "outer",
      edges: detail.edges.map((edge) => ({
        edgeToken: edge.token,
        samples: edge.samples,
      })),
    }],
    provenance,
  };
  const result =
    detail.graphStatus === "closed"
      ? tessellateRevit2027ConeApexSectors({
          id: `revit-2027-owner-${detail.elementId}-face-${detail.faceToken}`,
          faces: [face],
          provenance,
        })
      : null;
  const classification =
    result == null
      ? `topology-${detail.graphStatus}`
      : result.ok
        ? "exact-apex-sector-tessellated"
        : result.issues[0]?.code ?? "unknown-rejection";
  increment(classifications, classification);
  const triangleCount =
    result?.ok ? result.mesh.indices.length / 3 : null;
  const vertexCount =
    result?.ok ? result.mesh.positions.length / 3 : null;
  if (result?.ok) {
    acceptedFaces += 1;
    acceptedOwners.add(detail.elementId);
    triangles += triangleCount!;
    vertices += vertexCount!;
  }
  rows.push({
    elementId: detail.elementId,
    faceToken: detail.faceToken,
    faceFlags: detail.faceFlags,
    inputEdges: detail.edges.length,
    inputSamples: detail.edges.reduce(
      (total, edge) => total + edge.samples.length,
      0,
    ),
    classification,
    triangleCount,
    vertexCount,
  });
}

console.log(JSON.stringify({
  inputPath,
  modelPath: audit.modelPath,
  release: audit.release,
  scope: {
    coneFaces: audit.coneDetails.length,
    exactApexSectorFaces: acceptedFaces,
    exactApexSectorOwners: acceptedOwners.size,
    faceRatio:
      audit.coneDetails.length === 0
        ? null
        : acceptedFaces / audit.coneDetails.length,
  },
  classification: sortedEntries(classifications),
  mesh: {
    triangles,
    vertices,
    policy:
      "one triangle per adjacent persisted outer-arc sample pair; " +
      "generator edges are exact straight cone rulings",
  },
  rows,
}, null, 2));
