/** Original default 3D source selection. No geometry or graph admission. */
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";

/** Pinned rvt-rs 1c3d337 native_graphics_traversal::direction_condition applies
 * the normal 3D context rule to both GConditionDir and GConditionCut: source
 * comparisons 6/7/8 are false before the stored negation. No arbitrary view,
 * direction equality, detail-level or family parameter predicate is solved.
 *
 * The original replay remains intact. A condition-owned subtree can be omitted
 * only if no drawable pointer is reused outside that exact occurrence. This
 * mathematical selection result alone never establishes RVT source membership,
 * complete physical-body census, walking support or accessibility. */
export function originalDefault3dDirectionSelection(
  replay: Revit2027GRepReplay,
) {
  const result = {
    excludedReplayIndices: new Set<number>(),
    sourceFalseFilters: [] as {
      filterReplayIndex: number;
      conditionReplayIndex: number;
      sourceClassSlot: number;
      compareMode: number;
    }[],
    unresolvedAliasedFilters: 0,
    originalSourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
  const spans = replay.spans;
  if (
    spans.some(
      (span, index) =>
        span.replayIndex !== index ||
        span.ownerElementId !== replay.ownerElementId ||
        (span.parentReplayIndex !== null &&
          (!Number.isSafeInteger(span.parentReplayIndex) ||
            span.parentReplayIndex < 0 ||
            span.parentReplayIndex >= index)),
    )
  )
    return result;
  const drawable = new Set([
    "Revit2027Geometry",
    "Revit2027Face",
    "Revit2027GElement",
    "Revit2027GGroup",
    "Revit2027GFilter",
    "Revit2027GInstance",
    "Revit2027GPolyMesh",
    "Revit2027GLine",
    "Revit2027GArc",
    "Revit2027GBiFlipControl",
  ]);
  const filters = new Set<number>();
  for (const span of spans) {
    const slot =
      span.readerId === "Revit2027GConditionDir"
        ? 2235
        : span.readerId === "Revit2027GConditionCut"
          ? 2234
          : undefined;
    if (
      slot === undefined ||
      span.propertySourceClassSlot !== slot ||
      span.parentReplayIndex === null
    )
      continue;
    const value = span.value as {
      compareMode?: number;
      negateDirectionCondition?: boolean;
      direction?: readonly number[];
    };
    if (
      ![6, 7, 8].includes(value?.compareMode ?? NaN) ||
      value?.negateDirectionCondition !== false ||
      value.direction?.length !== 3 ||
      !value.direction.every(Number.isFinite) ||
      !value.direction.some((coordinate) => coordinate !== 0)
    )
      continue;
    const parent = spans[span.parentReplayIndex]!;
    if (parent.readerId !== "Revit2027GFilter") continue;
    const filter = parent.value as {
      conditions?: {
        token: number;
        sourceClassSlot: number;
        byteOffset: number;
        endOffset: number;
      }[];
    };
    if (
      !filter.conditions?.some(
        (descriptor) =>
          descriptor.token === span.propertyToken &&
          descriptor.sourceClassSlot === slot &&
          descriptor.byteOffset === span.descriptorOffset &&
          descriptor.endOffset === span.descriptorEndOffset,
      )
    )
      continue;
    if (filters.has(parent.replayIndex)) continue;
    filters.add(parent.replayIndex);
    const descendants = new Set<number>();
    for (const candidate of spans)
      if (
        candidate.replayIndex === parent.replayIndex ||
        (candidate.parentReplayIndex !== null &&
          descendants.has(candidate.parentReplayIndex))
      )
        descendants.add(candidate.replayIndex);
    const tokens = new Set(
      spans
        .filter(
          (candidate) =>
            descendants.has(candidate.replayIndex) &&
            candidate.propertyToken > 0 &&
            drawable.has(candidate.readerId),
        )
        .map((candidate) => candidate.propertyToken),
    );
    if (
      replay.descriptors.some(
        (descriptor) =>
          descriptor.state === "reused" &&
          tokens.has(descriptor.token) &&
          (descriptor.parentReplayIndex === null ||
            !descendants.has(descriptor.parentReplayIndex)),
      )
    ) {
      result.unresolvedAliasedFilters++;
      continue;
    }
    for (const index of descendants) result.excludedReplayIndices.add(index);
    result.sourceFalseFilters.push({
      filterReplayIndex: parent.replayIndex,
      conditionReplayIndex: span.replayIndex,
      sourceClassSlot: slot,
      compareMode: value.compareMode!,
    });
  }
  return result;
}
