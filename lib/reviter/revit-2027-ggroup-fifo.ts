import type { CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GLine,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
} from "./revit-2027-gline.ts";
import {
  decodeRevit2027GArray,
  decodeRevit2027GGroupPrefix,
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  type Revit2027GGroupPrefix,
} from "./revit-2027-grep-prefixes.ts";

const GREP_INITIAL_TOKEN_COUNT = 3;

export type Revit2027GGroupStatic = Omit<
  Revit2027GGroupPrefix,
  "firstUnknownSuffixOffset"
> & {
  /** Complete static boundary; the 2027 schema declares no other GGroup field. */
  endOffset: number;
};

export type Revit2027GGroupStaticDecodeResult =
  | { ok: true; value: Revit2027GGroupStatic }
  | { ok: false; error: string };

export type Revit2027InitialSiblingSpan = {
  queueIndex: number;
  sourceClassSlot: number;
  startOffset: number;
  endOffset: number;
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027FirstGGroupNestedFifo = {
  firstGroup: Revit2027GGroupStatic;
  initialSiblingSpans: readonly Revit2027InitialSiblingSpan[];
  /** First byte read for the first group's first nested FIFO entry. */
  nestedFifoOffset: number | null;
  firstNestedEntry: CondInt16QueueEntry | null;
};

export type Revit2027FirstGGroupNestedFifoResult =
  | { ok: true; value: Revit2027FirstGGroupNestedFifo }
  | { ok: false; error: string };

/**
 * Decode the complete selector-free static body of a Revit 2027 GGroup.
 *
 * The exact file's embedded schema recursively defines GGroup with the sole
 * declared field `m_subNodes`. Its inherited GNode/GInfo bytes and that
 * counted CondInt16 collection are exactly the existing bounded prefix.
 * `GRep` bounds/owner/type/flags are fields of the derived GRep layer and
 * therefore are not consumed for a scoped source-slot 2248 GGroup.
 */
export function decodeRevit2027GGroupStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027GGroupStaticDecodeResult {
  const decoded = decodeRevit2027GGroupPrefix(
    data,
    byteOffset,
    enclosingEndOffset,
    revitVersion,
  );
  if (!decoded.ok) return decoded;
  const { firstUnknownSuffixOffset, ...prefix } = decoded.value;
  return {
    ok: true,
    value: {
      ...prefix,
      endOffset: firstUnknownSuffixOffset,
    },
  };
}

function requireAppendTokens(
  entries: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.sourceClassSlot == null) {
      return "Revit 2027 GGroup FIFO contains a null nested property";
    }
    if (entry.token !== firstToken + index) {
      return "Revit 2027 GGroup FIFO token is not the next append index";
    }
  }
  return null;
}

/**
 * Locate the first nested FIFO body enqueued by a first-position GGroup.
 *
 * Native queue inspection establishes tail insertion and front removal.
 * Consequently children enqueued while the first root child is read remain
 * behind every root sibling already in the queue. This locator consumes only
 * independently certified 2027 sibling bodies (GArray, GGroup, and GLine), validates
 * the shared append-token sequence, and returns the next byte without reading
 * or naming the nested child's class body.
 */
export function locateRevit2027FirstGGroupNestedFifo(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  revitVersion: number,
): Revit2027FirstGGroupNestedFifoResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GGroup FIFO positioning requires release 2027",
    };
  }
  const firstRootEntry = root.children[0];
  if (
    !firstRootEntry ||
    firstRootEntry.sourceClassSlot !== REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
  ) {
    return {
      ok: false,
      error: "first Revit 2027 GRep FIFO entry is not source slot 2248",
    };
  }
  const rootTokenError = requireAppendTokens(
    root.children,
    GREP_INITIAL_TOKEN_COUNT,
  );
  if (rootTokenError) return { ok: false, error: rootTokenError };

  const firstGroup = decodeRevit2027GGroupStatic(
    data,
    root.dynamicPayloadOffset,
    root.dynamicPayloadEndOffset,
    revitVersion,
  );
  if (!firstGroup.ok) return firstGroup;

  let nextAppendToken = GREP_INITIAL_TOKEN_COUNT + root.children.length;
  const firstGroupTokenError = requireAppendTokens(
    firstGroup.value.children,
    nextAppendToken,
  );
  if (firstGroupTokenError) {
    return { ok: false, error: firstGroupTokenError };
  }
  nextAppendToken += firstGroup.value.children.length;

  let offset = firstGroup.value.endOffset;
  const initialSiblingSpans: Revit2027InitialSiblingSpan[] = [];
  for (let queueIndex = 1; queueIndex < root.children.length; queueIndex += 1) {
    const sibling = root.children[queueIndex]!;
    const sourceClassSlot = sibling.sourceClassSlot!;
    const startOffset = offset;
    let queuedProperties: readonly CondInt16QueueEntry[] = [];

    if (sourceClassSlot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT) {
      const endOffset = startOffset + REVIT_2027_GLINE_BODY_BYTES;
      if (endOffset > root.dynamicPayloadEndOffset) {
        return {
          ok: false,
          error: "Revit 2027 GLine sibling exceeds the GRep replay boundary",
        };
      }
      const decoded = decodeRevit2027GLine(
        data,
        startOffset,
        endOffset,
        revitVersion,
      );
      if (!decoded.ok) return decoded;
      offset = decoded.value.endOffset;
    } else if (sourceClassSlot === REVIT_2027_GARRAY_SOURCE_CLASS_SLOT) {
      const endOffset = startOffset + REVIT_2027_GARRAY_BODY_BYTES;
      if (endOffset > root.dynamicPayloadEndOffset) {
        return {
          ok: false,
          error: "Revit 2027 GArray sibling exceeds the GRep replay boundary",
        };
      }
      const decoded = decodeRevit2027GArray(
        data,
        startOffset,
        endOffset,
        revitVersion,
      );
      if (!decoded.ok) return decoded;
      offset = decoded.value.endOffset;
      queuedProperties = [decoded.value.instanceInfo];
    } else if (sourceClassSlot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GGroupStatic(
        data,
        startOffset,
        root.dynamicPayloadEndOffset,
        revitVersion,
      );
      if (!decoded.ok) return decoded;
      const tokenError = requireAppendTokens(
        decoded.value.children,
        nextAppendToken,
      );
      if (tokenError) return { ok: false, error: tokenError };
      nextAppendToken += decoded.value.children.length;
      offset = decoded.value.endOffset;
      queuedProperties = decoded.value.children;
    } else {
      return {
        ok: false,
        error:
          `no certified Revit 2027 initial-sibling reader for source slot ` +
          `${sourceClassSlot}`,
      };
    }

    initialSiblingSpans.push({
      queueIndex,
      sourceClassSlot,
      startOffset,
      endOffset: offset,
      queuedProperties,
    });
  }

  const firstNestedEntry = firstGroup.value.children[0] ?? null;
  return {
    ok: true,
    value: {
      firstGroup: firstGroup.value,
      initialSiblingSpans,
      nestedFifoOffset: firstNestedEntry ? offset : null,
      firstNestedEntry,
    },
  };
}
