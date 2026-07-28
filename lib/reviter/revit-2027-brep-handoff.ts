/**
 * Fail-closed readiness gate between decoded Revit 2027 geometry records and
 * a browser-side BRep/tessellation implementation.
 *
 * This is a clean-room semantic contract. It does not model, load, or call the
 * native ODA ABI. The stages mirror only observable exported interfaces:
 *
 *   face(surface, direction) -> loop(face) -> edge(curve3d)
 *   -> coedge(loop, edge, direction, pcurve?) -> finish -> face mesh
 *
 * IFC evidence is deliberately excluded from RVT decoding readiness. The
 * supplied IFC is an output oracle and may only validate a mesh after the RVT
 * graph has independently reached the renderer-ready stage.
 */

export const REVIT_2027_BREP_HANDOFF_SOURCE_SLOTS = {
  geometry: 2343,
  face: 1825,
  gEdge: 1423,
  edgeLoop: 1434,
  edgeLoopWithChainEnvelopes: 1437,
  plane: 634,
  cone: 900,
  cylinder: 1144,
  surfaceOfRevolution: 4283,
  surfaceOfRevolutionProfileArc: 2213,
} as const;

export type Revit2027BrepEvidenceLevel =
  | "exact-rvt"
  | "sampled-rvt"
  | "inferred"
  | "ifc-oracle"
  | "missing";

export type Revit2027BrepHandoffCapability =
  | "geometry-owner"
  | "faces"
  | "analytic-surfaces"
  | "face-orientation"
  | "face-regions"
  | "ordered-loops"
  | "ordered-coedges"
  | "coedge-direction"
  | "edge-curves-3d"
  | "surface-pcurves-2d"
  | "body-transform"
  | "face-markers"
  | "face-materials"
  | "surface-evaluators"
  | "trimmed-surface-tessellator";

export type Revit2027BrepHandoffEvidence = Readonly<
  Record<Revit2027BrepHandoffCapability, Revit2027BrepEvidenceLevel>
>;

export type Revit2027BrepHandoffStage =
  | "persisted-graph"
  | "native-builder-equivalent"
  | "browser-renderer"
  | "exact-material-output";

export type Revit2027BrepHandoffIssueCode =
  | "missing"
  | "sampled-only"
  | "inferred-only"
  | "ifc-is-not-rvt-evidence";

export type Revit2027BrepHandoffIssue = {
  stage: Revit2027BrepHandoffStage;
  capability: Revit2027BrepHandoffCapability;
  evidence: Revit2027BrepEvidenceLevel;
  code: Revit2027BrepHandoffIssueCode;
};

export type Revit2027BrepHandoffAssessment = {
  highestReadyStage: Revit2027BrepHandoffStage | null;
  ready: Readonly<Record<Revit2027BrepHandoffStage, boolean>>;
  issues: readonly Revit2027BrepHandoffIssue[];
  /**
   * True only when a browser mesh was independently produced from sufficient
   * RVT evidence. IFC comparison must remain disabled before this point.
   */
  ifcParityEligible: boolean;
};

const STAGE_REQUIREMENTS: Readonly<
  Record<
    Revit2027BrepHandoffStage,
    readonly {
      capability: Revit2027BrepHandoffCapability;
      accepted: readonly Revit2027BrepEvidenceLevel[];
    }[]
  >
> = {
  "persisted-graph": [
    { capability: "geometry-owner", accepted: ["exact-rvt"] },
    { capability: "faces", accepted: ["exact-rvt"] },
    { capability: "analytic-surfaces", accepted: ["exact-rvt"] },
    { capability: "face-orientation", accepted: ["exact-rvt"] },
    { capability: "ordered-loops", accepted: ["exact-rvt"] },
    { capability: "ordered-coedges", accepted: ["exact-rvt"] },
    { capability: "coedge-direction", accepted: ["exact-rvt"] },
  ],
  "native-builder-equivalent": [
    { capability: "face-regions", accepted: ["exact-rvt"] },
    { capability: "edge-curves-3d", accepted: ["exact-rvt"] },
    { capability: "surface-pcurves-2d", accepted: ["exact-rvt"] },
    { capability: "body-transform", accepted: ["exact-rvt"] },
    { capability: "face-markers", accepted: ["exact-rvt"] },
  ],
  "browser-renderer": [
    {
      capability: "surface-evaluators",
      accepted: ["exact-rvt"],
    },
    {
      capability: "trimmed-surface-tessellator",
      accepted: ["exact-rvt"],
    },
  ],
  "exact-material-output": [
    { capability: "face-materials", accepted: ["exact-rvt"] },
  ],
};

const STAGE_ORDER: readonly Revit2027BrepHandoffStage[] = [
  "persisted-graph",
  "native-builder-equivalent",
  "browser-renderer",
  "exact-material-output",
];

function issueCode(
  evidence: Revit2027BrepEvidenceLevel,
): Revit2027BrepHandoffIssueCode {
  switch (evidence) {
    case "sampled-rvt":
      return "sampled-only";
    case "inferred":
      return "inferred-only";
    case "ifc-oracle":
      return "ifc-is-not-rvt-evidence";
    case "missing":
      return "missing";
    case "exact-rvt":
      throw new Error("exact RVT evidence does not produce an issue");
  }
}

/**
 * Assess a decoded body's readiness for the general BRep handoff.
 *
 * Stages are cumulative: a later stage cannot be ready when an earlier stage
 * is blocked, even if its own local capabilities are present.
 */
export function assessRevit2027BrepHandoff(
  evidence: Revit2027BrepHandoffEvidence,
): Revit2027BrepHandoffAssessment {
  const issues: Revit2027BrepHandoffIssue[] = [];
  const ready = {
    "persisted-graph": false,
    "native-builder-equivalent": false,
    "browser-renderer": false,
    "exact-material-output": false,
  };

  let previousReady = true;
  let highestReadyStage: Revit2027BrepHandoffStage | null = null;
  for (const stage of STAGE_ORDER) {
    let localReady = true;
    for (const requirement of STAGE_REQUIREMENTS[stage]) {
      const level = evidence[requirement.capability];
      if (!requirement.accepted.includes(level)) {
        localReady = false;
        issues.push({
          stage,
          capability: requirement.capability,
          evidence: level,
          code: issueCode(level),
        });
      }
    }
    ready[stage] = previousReady && localReady;
    if (ready[stage]) highestReadyStage = stage;
    previousReady = ready[stage];
  }

  return {
    highestReadyStage,
    ready,
    issues,
    ifcParityEligible: ready["browser-renderer"],
  };
}

/**
 * Current independently decoded coverage in the exact supplied Revit 2027
 * corpus. This records decoder capability, not an assertion that every model
 * object selects every listed class.
 *
 * GEdge UV samples are exact persisted values, but they are samples rather
 * than decoded analytic p-curves. Existing planar meshing can lawfully consume
 * that narrower sampled path; it does not make the general native-equivalent
 * handoff complete.
 */
export const CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE:
  Revit2027BrepHandoffEvidence = {
    "geometry-owner": "exact-rvt",
    faces: "exact-rvt",
    "analytic-surfaces": "exact-rvt",
    "face-orientation": "exact-rvt",
    "face-regions": "missing",
    "ordered-loops": "exact-rvt",
    "ordered-coedges": "inferred",
    "coedge-direction": "inferred",
    "edge-curves-3d": "missing",
    "surface-pcurves-2d": "sampled-rvt",
    "body-transform": "missing",
    "face-markers": "exact-rvt",
    "face-materials": "missing",
    "surface-evaluators": "missing",
    "trimmed-surface-tessellator": "missing",
  };

export const CURRENT_REVIT_2027_BREP_HANDOFF_ASSESSMENT =
  assessRevit2027BrepHandoff(CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE);

