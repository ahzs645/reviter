import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";

export const REVIT_2026_ELEMENT_AND_GREP_SOURCE_CLASS = 1479;

export type Revit2026ElementAndGRepStatic = {
  elementId: bigint;
  elementDescriptor: CondInt16QueueEntry;
  gRepDescriptor: CondInt16QueueEntry;
};

export type Revit2026ElementAndGRepDecodeResult =
  | {
      ok: true;
      value: Revit2026ElementAndGRepStatic;
      endOffset: number;
    }
  | { ok: false; error: string };

function fits(data: Uint8Array, offset: number, byteLength: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(byteLength) &&
    offset >= 0 &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

/**
 * Decode the complete inline body of Revit 2026 source slot 1479,
 * `OdSmartPtr<OdBmElementAndGRep>`.
 *
 * The native reader stores the element id inline and queues both object
 * properties through `OdBmCondInt16Reader`. This function deliberately does
 * not claim an outer object boundary or replay either queued value.
 */
export function decodeRevit2026ElementAndGRepStatic(
  data: Uint8Array,
  bodyOffset: number,
): Revit2026ElementAndGRepDecodeResult {
  if (!fits(data, bodyOffset, 8)) {
    return {
      ok: false,
      error: "Revit 2026 ElementAndGRep element id is truncated",
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const elementId = view.getBigUint64(bodyOffset, true);

  const element = decodeCondInt16PropertyDescriptor(data, bodyOffset + 8);
  if (!element.ok) {
    return {
      ok: false,
      error: `ElementAndGRep element descriptor: ${element.error}`,
    };
  }
  const gRep = decodeCondInt16PropertyDescriptor(
    data,
    element.descriptor.endOffset,
  );
  if (!gRep.ok) {
    return {
      ok: false,
      error: `ElementAndGRep GRep descriptor: ${gRep.error}`,
    };
  }

  return {
    ok: true,
    value: {
      elementId,
      elementDescriptor: element.descriptor,
      gRepDescriptor: gRep.descriptor,
    },
    endOffset: gRep.descriptor.endOffset,
  };
}
