import type {
  GateStatus,
  IfcReferenceManifest,
  PairedRegressionResult,
  RegressionGate,
  RvtRegressionInput,
} from "./types";

const FEET_TO_METRES = 0.3048;

function dimensions(bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) {
  return [
    Math.max(0, bounds.max.x - bounds.min.x),
    Math.max(0, bounds.max.y - bounds.min.y),
    Math.max(0, bounds.max.z - bounds.min.z),
  ].sort((a, b) => a - b) as [number, number, number];
}

function ratioStatus(ratios: number[]): GateStatus {
  const worstError = Math.max(...ratios.map((ratio) => Math.abs(1 - ratio)));
  if (worstError <= 0.1) return "pass";
  if (worstError <= 0.25) return "warn";
  return "fail";
}

function overallStatus(gates: RegressionGate[]): GateStatus {
  if (gates.some((gate) => gate.status === "fail")) return "fail";
  return gates.some((gate) => gate.status === "warn") ? "warn" : "pass";
}

export function compareRvtToIfc(
  rvt: RvtRegressionInput,
  reference: IfcReferenceManifest,
): PairedRegressionResult {
  const identityCoverage = reference.taggedElementCount
    ? reference.matchedElementCount / reference.taggedElementCount
    : 0;
  const rvtEvidenceIds = new Set<number>([
    ...rvt.elemTableIds,
    ...rvt.partitionRecordIds,
  ]);
  const rvtIndexCoverage = rvtEvidenceIds.size
    ? reference.matchedElementCount / rvtEvidenceIds.size
    : 0;
  const sortedRvtDimensionsMetres = dimensions(rvt.boundsFeet).map(
    (value) => value * FEET_TO_METRES,
  ) as [number, number, number];
  const sortedIfcDimensionsMetres = dimensions(reference.boundsMetres);
  const dimensionRatios = sortedRvtDimensionsMetres.map((value, index) =>
    sortedIfcDimensionsMetres[index] ? value / sortedIfcDimensionsMetres[index]! : 0,
  ) as [number, number, number];
  const triangleRatio = reference.triangleCount
    ? rvt.triangleCount / reference.triangleCount
    : 0;
  const semanticCoverage = reference.elementCount
    ? rvt.productionElements / reference.elementCount
    : 0;

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const gates: RegressionGate[] = [
    {
      id: "identity",
      label: "Element identity",
      status: identityCoverage >= 0.95 ? "pass" : identityCoverage >= 0.5 ? "warn" : "fail",
      value: percent(identityCoverage),
      detail: `${reference.matchedElementCount.toLocaleString()} of ${reference.taggedElementCount.toLocaleString()} IFC element tags resolve to RVT index or partition records.`,
    },
    {
      id: "extents",
      label: "Model extents",
      status: ratioStatus(dimensionRatios),
      value: dimensionRatios.map((ratio) => `${ratio.toFixed(2)}×`).join(" / "),
      detail: "Orientation-independent height, short-span, and long-span ratios; 1.00× is the target.",
    },
    {
      id: "topology",
      label: "Triangle density",
      status: triangleRatio >= 0.5 && triangleRatio <= 2 ? "pass" : triangleRatio >= 0.25 ? "warn" : "fail",
      value: `${triangleRatio.toFixed(2)}×`,
      detail: `${rvt.triangleCount.toLocaleString()} recovered triangles versus ${reference.triangleCount.toLocaleString()} reference triangles.`,
    },
    {
      id: "semantics",
      label: "Typed semantics",
      status: semanticCoverage >= 0.9 ? "pass" : semanticCoverage > 0 ? "warn" : "fail",
      value: percent(semanticCoverage),
      detail: `${rvt.productionElements.toLocaleString()} validated RVT elements versus ${reference.elementCount.toLocaleString()} typed IFC elements.`,
    },
  ];
  const status = overallStatus(gates);

  return {
    reference,
    status,
    identityCoverage,
    rvtIndexCoverage,
    sortedRvtDimensionsMetres,
    sortedIfcDimensionsMetres,
    dimensionRatios,
    triangleRatio,
    semanticCoverage,
    gates,
    conclusion:
      status === "pass"
        ? "The recovered model meets every current reference gate."
        : status === "warn"
          ? "The pair is linked, but one or more recovery metrics need review."
          : "The IFC is linked to RVT records, but the recovered geometry is rejected by the reference gates.",
  };
}
