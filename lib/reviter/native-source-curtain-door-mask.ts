/** Compare complete current source curtain-door material with an unchanged
 * supplied aperture mask. Comparison never makes that mask authoritative and
 * never proves door operation, source ownership, access or material absence. */
import { readSchema } from "./schema-reader.ts";
import { readOriginalCurtainInstanceTypedFifo } from "./native-source-curtain-instance.ts";
import { checkedOriginalCurtainFrame } from "./native-source-curtain-cell-bindings.ts";
import { inspectOriginalCurrentCurtainDoorDefinition } from "./native-source-curtain-door-definition.ts";
import type { OriginalCurtainMaterialContainer } from "./native-source-curtain-material-container.ts";
import {
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import { inspectPlacedTrimObstacleBranches } from "./native-source-placed-trim-obstacles.ts";
import { validateOriginalNamedCapReference } from "./native-source-floor-local-support.ts";
import {
  nativeRationalOverlay,
  rational,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
function replay(bytes: Uint8Array, owner: number) {
  const frame = checkedOriginalCurtainFrame(bytes, owner, 2246),
    root = decodeRevit2027FramedGRepRoot(bytes, frame, 2027);
  if (!root.ok) throw Error(root.error);
  if (root.value.objectType !== 3 || ![0, 2].includes(root.value.flags))
    throw Error("Unsupported original curtain-door graphics root role");
  const result = replayRevit2027GRepFifo(bytes, root.value);
  if (!result.ok) throw Error(result.error);
  if (result.value.endOffset !== root.value.dynamicPayloadEndOffset)
    throw Error("Unconsumed original curtain-door graphics bytes");
  return result.value;
}
/** Pure mathematics only. An enclosure outside a compared mask is a failed
 * containment proof, not permission to broaden that mask or erase a body. */
export function inspectCurtainDoorMaterialMask(
  occurrence: Revit2027GRepReplay,
  definition: Revit2027GRepReplay,
  comparedMaskFeet: NativeRationalParts,
) {
  if (
    comparedMaskFeet.length !== 1 ||
    comparedMaskFeet[0]!.length !== 1 ||
    comparedMaskFeet[0]![0]!.length !== 4
  )
    throw Error(
      "Compared curtain-door mask must retain one valid finite four-edge boundary",
    );
  validateOriginalNamedCapReference(comparedMaskFeet);
  const material = inspectPlacedTrimObstacleBranches(occurrence, definition);
  if (!material.ok) throw Error(material.blockers.join("; "));
  const components = material.components.map((c) => ({
    ...c,
    outsideComparedMaskResidualFeet: nativeRationalOverlay(
      "difference",
      c.outerPlanEnvelope,
      comparedMaskFeet,
    ),
  }));
  return {
    nativeDoorElementId: material.nativeElementId,
    nativeDefinitionElementId: material.nativeDefinitionId,
    components,
    savedMaterialEnclosuresEntirelyInsideComparedMask: components.every(
      (c) => c.outsideComparedMaskResidualFeet.length === 0,
    ),
    sourceFreeGraphicsTokens: material.originalFreeGraphicsTokens,
    sourceHatchTokens: material.originalHatchTokens,
    sourceFalseFilters: material.sourceFalseFilters,
    comparedMaskSuppliedForComparisonOnly: true as const,
    sourceApertureApproved: false as const,
    sourceLeafOperationApproved: false as const,
    sourceMaterialOmitted: false as const,
    routeApproved: false as const,
  };
}
/** Re-read both current native constructors and all original saved material.
 * Every affine operand must agree exactly; signed zero remains in the native
 * ledger, while its affine effect is zero. No tiny nonzero term is dropped. */
export function inspectOriginalCurrentCurtainDoorMask(
  census: OriginalNativeForeignEnvelopeCensus,
  container: OriginalCurtainMaterialContainer,
  nativeDoorElementId: number,
  comparedMaskFeet: NativeRationalParts,
) {
  const current = inspectOriginalCurrentCurtainDoorDefinition(
      census,
      container,
      nativeDoorElementId,
    ),
    native = readOriginalForeignEnvelopeScopedSemantic(
      census,
      nativeDoorElementId,
      2031,
    ),
    schema = readSchema(native.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const typed = readOriginalCurtainInstanceTypedFifo(
    native.originalFrameBytes,
    schema.schema,
  );
  if (!typed.ok) throw Error(typed.error);
  const info = typed.value.entries.filter(
    (e) => e.sourceClassName === "InstanceInfo",
  );
  if (info.length !== 1)
    throw Error("Ambiguous original door native placement");
  const occurrenceBytes = readOriginalForeignEnvelopeScopedFrame(
      census,
      nativeDoorElementId,
    ),
    definitionBytes = readOriginalForeignEnvelopeScopedFrame(
      census,
      current.nativeDefinitionElementId,
    ),
    occurrence = replay(occurrenceBytes, nativeDoorElementId),
    definition = replay(definitionBytes, current.nativeDefinitionElementId),
    bindings = collectRevit2027GInstanceBindings(occurrence);
  if (
    !bindings.ok ||
    bindings.value.length !== 1 ||
    bindings.value[0]!.kind !== "external"
  )
    throw Error(
      "Original current curtain door has no single source definition binding",
    );
  const trf = info[0]!.value.m_Trf as { m_3x3: number[][]; m_or: number[] },
    g = bindings.value[0]!.instance.transform;
  if (
    trf.m_3x3.length !== 3 ||
    trf.m_3x3.some((r) => r.length !== 3) ||
    trf.m_or.length !== 3
  )
    throw Error("Malformed native door affine");
  const actual = [g.xAxis, g.yAxis, g.zAxis, g.origin],
    expected = [0, 1, 2].map((i) => trf.m_3x3.map((r) => r[i]!));
  expected.push(trf.m_or);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const a = rational(expected[i]![j]!),
        b = rational(actual[i]![j]!);
      if (a.n * b.d !== b.n * a.d)
        throw Error(
          "Original native door affine differs from its saved source graphics",
        );
    }
  return {
    ...inspectCurtainDoorMaterialMask(occurrence, definition, comparedMaskFeet),
    sourceModelSha256: current.sourceModelSha256,
    sourceSchemaSha256: current.sourceSchemaSha256,
    originalOccurrenceGraphicsSha256: hash(occurrenceBytes),
    originalDefinitionGraphicsSha256: hash(definitionBytes),
    originalNativeInstanceSha256: current.originalNativeInstanceSha256,
    originalNativeDefinitionSha256: current.originalNativeDefinitionSha256,
    currentNativeDefinitionAndEveryAffineOperandRevalidated: true as const,
  };
}
export function inspectCurtainDoorMaterialMaskFrames(
  occurrenceBytes: Uint8Array,
  definitionBytes: Uint8Array,
  comparedMaskFeet: NativeRationalParts,
) {
  const owner = (b: Uint8Array) =>
    Number(
      new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(0, true),
    );
  return inspectCurtainDoorMaterialMask(
    replay(occurrenceBytes, owner(occurrenceBytes)),
    replay(definitionBytes, owner(definitionBytes)),
    comparedMaskFeet,
  );
}
