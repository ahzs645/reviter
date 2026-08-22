/**
 * The stair assembly tree, in a shape that does not name a Revit release.
 *
 * Two decoded sources describe the same tree from different directions, and
 * neither is complete on its own:
 *
 * - every `StairsRun`/`StairsLanding` names its parent `stairsId` and its own
 *   stringers, and those frames are decoded for the whole model;
 * - the `Stairs` element frame lists its runs, landings, registered railings
 *   and supports, but it is only reassembled where the frame was split across
 *   compressed pages, so it is present for some stairs and not others.
 *
 * The runs are therefore the primary evidence — a parent link read off the
 * child is available wherever the child is — and the element frame enriches
 * it with the parts no child mentions. Building the union this way means a
 * partially captured element frame degrades to a smaller assembly rather than
 * to a missing one.
 *
 * Nothing here infers a relationship from geometry. An id reaches an assembly
 * only because the file put it there.
 */
import type {
  Revit2027StairsElementAggregate,
  Revit2027StairsRunAndLandingAggregate,
} from "./revit-2027-stairs-aggregate.ts";

export type NativeStairAssembly = {
  /** The Revit `Stairs` element that owns the assembly. */
  stairElementId: number;
  /** Runs and landings belonging to the stair. */
  runAndLandingIds: readonly number[];
  /** Stringers, from the runs that name them. */
  stringerIds: readonly number[];
  /** Railings registered on the stair; empty when the element frame was not read. */
  railingIds: readonly number[];
  /** Supports registered on the stair; empty when the element frame was not read. */
  supportIds: readonly number[];
  /** Which of the two sources contributed, so a consumer can see the difference. */
  evidence: "runs" | "element-frame" | "runs-and-element-frame";
};

function sortedUnique(values: Iterable<number>): number[] {
  // Sorted rather than insertion-ordered: the IFC exporter derives GUIDs and
  // entity order from this, and a re-run of the same file must produce the
  // same bytes.
  return [...new Set(values)].filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

export function buildStairAssemblies(
  stairsRuns: ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate> | undefined,
  stairsAggregates:
    | ReadonlyMap<number, Revit2027StairsElementAggregate>
    | undefined,
): NativeStairAssembly[] {
  const runsByStair = new Map<number, number[]>();
  const stringersByStair = new Map<number, number[]>();

  for (const run of stairsRuns?.values() ?? []) {
    // A run whose parent did not decode is not evidence of an assembly; it is
    // an orphan, and inventing a container for it would be the kind of guess
    // this file exists to avoid.
    if (!Number.isSafeInteger(run.stairsId) || run.stairsId <= 0) continue;
    const runs = runsByStair.get(run.stairsId) ?? [];
    runs.push(run.elementId);
    runsByStair.set(run.stairsId, runs);
    const stringers = stringersByStair.get(run.stairsId) ?? [];
    stringers.push(...run.stringerIds);
    stringersByStair.set(run.stairsId, stringers);
  }

  const stairIds = sortedUnique([
    ...runsByStair.keys(),
    ...(stairsAggregates?.keys() ?? []),
  ]);

  // IFC4 gives every object at most one aggregate
  // (`IfcObjectDefinition.Decomposes : SET [0:1]`), and the file can name one
  // id from two stairs -- a shared landing between flights, most obviously.
  // First claim wins, and because `stairIds` is sorted the winner is the same
  // on every run of the same model rather than whichever stair was scanned
  // first.
  const claimed = new Set<number>(stairIds);

  const claim = (ids: readonly number[]): number[] => {
    const kept: number[] = [];
    for (const id of sortedUnique(ids)) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      kept.push(id);
    }
    return kept;
  };

  const assemblies: NativeStairAssembly[] = [];
  for (const stairElementId of stairIds) {
    const frame = stairsAggregates?.get(stairElementId);
    const fromRuns = runsByStair.get(stairElementId) ?? [];
    const runAndLandingIds = claim([
      ...fromRuns,
      ...(frame?.runAndLandingIds ?? []),
    ]);
    const stringerIds = claim(stringersByStair.get(stairElementId) ?? []);
    const railingIds = claim(frame?.registeredRailingIds ?? []);
    const supportIds = claim(frame?.supportIds ?? []);

    // A stair with no parts at all is not an assembly. It can happen when an
    // element frame decodes but names nothing this scan reached.
    if (!runAndLandingIds.length && !stringerIds.length && !railingIds.length
        && !supportIds.length) {
      continue;
    }

    const evidence = fromRuns.length && frame
      ? "runs-and-element-frame"
      : fromRuns.length
        ? "runs"
        : "element-frame";

    assemblies.push({
      stairElementId,
      runAndLandingIds,
      stringerIds,
      railingIds,
      supportIds,
      evidence,
    });
  }
  return assemblies;
}

/**
 * Every part id in an assembly, sorted.
 *
 * The builder already guarantees these four lists are disjoint from each other
 * and from every other assembly, so this is a concatenation rather than a
 * merge -- but it still sorts and excludes the stair itself, because
 * `IfcRelAggregates` forbids an object from being its own part and a caller
 * should not have to know that the builder made it impossible.
 */
export function stairAssemblyParts(assembly: NativeStairAssembly): number[] {
  return sortedUnique([
    ...assembly.runAndLandingIds,
    ...assembly.stringerIds,
    ...assembly.railingIds,
    ...assembly.supportIds,
  ]).filter((id) => id !== assembly.stairElementId);
}
