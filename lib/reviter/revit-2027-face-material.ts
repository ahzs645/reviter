import type { NativeMaterialDefinition } from "./material-records.ts";

/**
 * Exact browser-safe interpretation of persisted `GFace.m_renderStyleId`.
 *
 * Native `OdBmGeometryImpl::updateMaterialsForIndividualFaces` copies each
 * `OdBmGeomMaterialMarker::getMaterialId()` directly into
 * `OdBmGFaceInternalImpl::setRenderStyleId()`. Therefore a positive face value
 * may be promoted to a MaterialElem only when the same numeric element ID was
 * independently decoded as a framed MaterialElem. The field name alone is not
 * enough, and negative/system IDs are never reinterpreted as materials.
 */

export type Revit2027FaceMaterialBinding =
  | {
      status: "exact-material";
      renderStyleElementId: bigint;
      materialElementId: number;
      definition: NativeMaterialDefinition;
    }
  | {
      status: "unassigned";
      renderStyleElementId: -1n;
    }
  | {
      status: "negative-system-id";
      renderStyleElementId: bigint;
    }
  | {
      status: "unresolved-positive-id";
      renderStyleElementId: bigint;
      reason: "outside-safe-integer-range" | "no-decoded-material-element";
    };

export type Revit2027MaterialDefinitions =
  | ReadonlyMap<number, NativeMaterialDefinition>
  | readonly NativeMaterialDefinition[];

function definitionMap(
  definitions: Revit2027MaterialDefinitions,
): ReadonlyMap<number, NativeMaterialDefinition> {
  if (!Array.isArray(definitions)) {
    return definitions as ReadonlyMap<number, NativeMaterialDefinition>;
  }
  return new Map(
    definitions.map((definition: NativeMaterialDefinition) => [
      definition.elementId,
      definition,
    ]),
  );
}

export function bindRevit2027FaceMaterial(
  renderStyleElementId: bigint,
  definitions: Revit2027MaterialDefinitions,
): Revit2027FaceMaterialBinding {
  if (renderStyleElementId === -1n) {
    return { status: "unassigned", renderStyleElementId };
  }
  if (renderStyleElementId < 0n) {
    return { status: "negative-system-id", renderStyleElementId };
  }
  if (renderStyleElementId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      status: "unresolved-positive-id",
      renderStyleElementId,
      reason: "outside-safe-integer-range",
    };
  }
  const materialElementId = Number(renderStyleElementId);
  const definition = definitionMap(definitions).get(materialElementId);
  if (!definition) {
    return {
      status: "unresolved-positive-id",
      renderStyleElementId,
      reason: "no-decoded-material-element",
    };
  }
  return {
    status: "exact-material",
    renderStyleElementId,
    materialElementId,
    definition,
  };
}
