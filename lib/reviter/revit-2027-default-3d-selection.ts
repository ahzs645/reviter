/** Narrow normal-3D cut predicates measured by the pinned upstream reader. */
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { Revit2027GFilter } from "./revit-2027-gfilter.ts";
import type { Revit2027GConditionCut } from "./revit-2027-gcondition-cut.ts";

const CUT_SLOT = 2234;
const ALIASED_DRAWABLE_READERS = new Set([
  "Revit2027Geometry", "Revit2027Face", "Revit2027GElement", "Revit2027GGroup",
  "Revit2027GFilter", "Revit2027GInstance", "Revit2027GPolyMesh",
]);

/**
 * Source: rvt-rs 1c3d337, native_graphics_traversal::direction_condition:
 * normal 3D comparisons 6/7/8 return the persisted negation boolean. This
 * selects the uncut representation; it never subtracts geometry or evaluates
 * family formulas, general view conditions or arbitrary direction predicates.
 *
 * Filters are conjunctions, so one resolved false cut condition excludes its
 * owned subtree. A reused drawable pointer outside that subtree makes the
 * selection unresolved: one FIFO definition does not describe its several
 * render occurrences. Keep that branch instead of globally hiding an alias.
 */
export function default3dCutSelection(replay: Revit2027GRepReplay): {
  excludedReplayIndices: ReadonlySet<number>;
  excludedFilters: number;
  unresolvedAliasedFilters: number;
} {
  const spans = replay.spans;
  const result = { excludedReplayIndices: new Set<number>(), excludedFilters: 0, unresolvedAliasedFilters: 0 };
  if (spans.some((span, index) => span.replayIndex !== index ||
    (span.parentReplayIndex != null && (!Number.isSafeInteger(span.parentReplayIndex) || span.parentReplayIndex < 0 || span.parentReplayIndex >= index)))) return result;
  const filters = new Set<number>();
  for (const span of spans) {
    if (span.readerId !== "Revit2027GConditionCut" || span.propertySourceClassSlot !== CUT_SLOT || span.parentReplayIndex == null) continue;
    const condition = span.value as Revit2027GConditionCut | undefined;
    if (!condition || ![6, 7, 8].includes(condition.compareMode) || condition.negateDirectionCondition !== false) continue;
    const parent = spans[span.parentReplayIndex]!;
    if (parent.readerId !== "Revit2027GFilter") continue;
    const filter = parent.value as Revit2027GFilter | undefined;
    if (!filter?.conditions.some(descriptor => descriptor.token === span.propertyToken && descriptor.sourceClassSlot === CUT_SLOT)) continue;
    filters.add(parent.replayIndex);
  }
  for (const filter of filters) {
    const descendants = new Set<number>();
    for (const span of spans) if (span.replayIndex === filter || (span.parentReplayIndex != null && descendants.has(span.parentReplayIndex))) descendants.add(span.replayIndex);
    const drawableTokens = new Set(spans.filter(span => descendants.has(span.replayIndex) && span.propertyToken > 0 && ALIASED_DRAWABLE_READERS.has(span.readerId)).map(span => span.propertyToken));
    const externalAlias = replay.descriptors.some(descriptor => descriptor.state === "reused" && drawableTokens.has(descriptor.token) &&
      (descriptor.parentReplayIndex == null || !descendants.has(descriptor.parentReplayIndex)));
    if (externalAlias) { result.unresolvedAliasedFilters++; continue; }
    for (const index of descendants) result.excludedReplayIndices.add(index);
    result.excludedFilters++;
  }
  return result;
}

/** Merge only occurrence-owned selection with the existing saved visibility. */
export function mergeDefault3dCutSelection(replay: Revit2027GRepReplay, undrawn: ReadonlySet<number>): ReadonlySet<number> {
  const cuts = default3dCutSelection(replay);
  return new Set([...undrawn, ...cuts.excludedReplayIndices]);
}
