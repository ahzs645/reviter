import type { ElementObject } from "./element-objects.ts";
import {
  decodeRevit2026GRepRoot,
  type Revit2026GRepRoot,
} from "./revit-2026-grep-root.ts";

/**
 * The exact Revit 2027 UNBC `GElement` frame marker. `Formats/Latest` defines
 * `GElement` at tag 2247; persisted frames carry the measured tag-minus-one
 * marker 2246.
 */
export const REVIT_2027_GELEMENT_OBJECT_MARKER = 2246;

export type Revit2027FramedGRepRoot = Revit2026GRepRoot;

export type Revit2027FramedGRepRootResult =
  | { ok: true; value: Revit2027FramedGRepRoot }
  | { ok: false; error: string };

/**
 * Release-gated adapter for the independently measured, release-neutral frame
 * bytes shared by the existing root implementation:
 *
 * - length/echo framing and marker 2246;
 * - GInfo primitives;
 * - counted CondInt16 `AllSubNodes` descriptors;
 * - two six-double extents;
 * - owner id, object type, and flags.
 *
 * The delegated implementation is reused only for that byte grammar. This
 * adapter assigns no Revit 2026 class names or 2026 source-class meanings to
 * the returned 2027 child descriptor numbers.
 */
export function decodeRevit2027FramedGRepRoot(
  data: Uint8Array,
  frame: ElementObject,
  revitVersion: number,
): Revit2027FramedGRepRootResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 framed GRep decoding requires release 2027",
    };
  }
  if (
    frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER
  ) {
    return { ok: false, error: "frame is not a Revit 2027 GElement" };
  }
  return decodeRevit2026GRepRoot(data, frame);
}
