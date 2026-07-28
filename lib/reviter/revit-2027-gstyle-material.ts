import type { ElementObject } from "./element-objects.ts";
import { scanFramedElementObjects } from "./element-objects.ts";
import type { NativeMaterialDefinition } from "./material-records.ts";
import { decodeCondInt16PropertyDescriptor } from "./dynamic-geometry-queue.ts";

/**
 * Persisted Revit 2027 `GStyleElem` and its queued `GStyle` body.
 *
 * `Formats/Latest` places `GStyleElem` at source slot 2,292. Its first field,
 * `m_pGStyle`, is a CondInt16-owned object. The record writes the four static
 * `GStyleElem` fields first, then materializes the queued source-slot 2,288
 * `GStyle` body in the 16 late bytes before the object's echoed length.
 */
export const REVIT_2027_GSTYLE_ELEMENT_MARKER = 2292;
export const REVIT_2027_GSTYLE_SOURCE_CLASS_SLOT = 2288;
export const REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH = 156;

const REPEATED_ELEMENT_ID_OFFSET = 54;
const GSTYLE_DESCRIPTOR_OFFSET = 121;
const CATEGORY_ELEMENT_ID_OFFSET = 127;
const OWNER_ELEMENT_ID_OFFSET = 135;
const GRAPHICS_STYLE_TYPE_OFFSET = 143;
const LINE_PATTERN_ELEMENT_ID_OFFSET = 147;
const MATERIAL_ELEMENT_ID_OFFSET = 155;
const PEN_NUMBER_OFFSET = 163;
const COLOR_OFFSET = 167;
const SCREEN_SIZED_OFFSET = 171;
const LENGTH_ECHO_OFFSET = 172;

export type Revit2027GStyleElementRecord = {
  elementId: number;
  recordOffset: number;
  objectLength: typeof REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH;
  objectMarker: typeof REVIT_2027_GSTYLE_ELEMENT_MARKER;
  categoryElementId: bigint;
  ownerElementId: bigint;
  graphicsStyleType: number;
  linePatternElementId: bigint;
  materialElementId: bigint;
  penNumber: number;
  color: number;
  isScreenSized: boolean;
  evidence: "framed-gstyle-element-queued-gstyle";
};

export type Revit2027GStyleElementDecodeResult =
  | { ok: true; value: Revit2027GStyleElementRecord }
  | { ok: false; error: string };

export type Revit2027GStyleElementScan = {
  revitVersion: number;
  framedStyleElements: number;
  decodedStyleElements: number;
  records: Revit2027GStyleElementRecord[];
  failures: ReadonlyMap<string, number>;
};

function rangeFits(
  data: Uint8Array,
  offset: number,
  byteLength: number,
): boolean {
  return (
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    offset <= data.byteLength - byteLength
  );
}

/**
 * Decode one independently length/echo-framed `GStyleElem`.
 *
 * Longer 2027 layouts have a different/null `m_pGStyle` carrier and are
 * deliberately rejected. They are not needed to prove the queued layout.
 */
export function decodeRevit2027GStyleElementRecord(
  data: Uint8Array,
  object: ElementObject,
  revitVersion: number,
): Revit2027GStyleElementDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GStyleElem decoding requires release 2027",
    };
  }
  if (
    object.marker !== REVIT_2027_GSTYLE_ELEMENT_MARKER ||
    object.typeCode !== 0
  ) {
    return {
      ok: false,
      error: "object is not a Revit 2027 GStyleElem frame",
    };
  }
  if (object.objectLength !== REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH) {
    return {
      ok: false,
      error: "GStyleElem is not the certified 156-byte queued-GStyle layout",
    };
  }
  if (!rangeFits(data, object.offset, LENGTH_ECHO_OFFSET + 4)) {
    return { ok: false, error: "GStyleElem frame is truncated" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    view.getUint32(object.offset, true) !== object.elementId ||
    view.getUint32(object.offset + 4, true) !== 0 ||
    view.getUint32(object.offset + 12, true) !== object.objectLength ||
    view.getUint16(object.offset + 16, true) !== object.marker ||
    view.getUint32(object.offset + 18, true) !== object.typeCode ||
    view.getBigUint64(
      object.offset + REPEATED_ELEMENT_ID_OFFSET,
      true,
    ) !== BigInt(object.elementId) ||
    view.getUint32(object.offset + LENGTH_ECHO_OFFSET, true) !==
      object.objectLength
  ) {
    return {
      ok: false,
      error: "GStyleElem frame invariants do not match its supplied envelope",
    };
  }

  const descriptor = decodeCondInt16PropertyDescriptor(
    data,
    object.offset + GSTYLE_DESCRIPTOR_OFFSET,
  );
  if (
    !descriptor.ok ||
    descriptor.descriptor.token !== -1 ||
    descriptor.descriptor.sourceClassSlot !==
      REVIT_2027_GSTYLE_SOURCE_CLASS_SLOT ||
    descriptor.descriptor.endOffset !==
      object.offset + CATEGORY_ELEMENT_ID_OFFSET
  ) {
    return {
      ok: false,
      error:
        "GStyleElem m_pGStyle is not the certified token -1/source-slot 2288 descriptor",
    };
  }

  const screenSized = data[object.offset + SCREEN_SIZED_OFFSET];
  if (screenSized !== 0 && screenSized !== 1) {
    return { ok: false, error: "GStyle contains an invalid screen-sized flag" };
  }

  return {
    ok: true,
    value: {
      elementId: object.elementId,
      recordOffset: object.offset,
      objectLength: REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH,
      objectMarker: REVIT_2027_GSTYLE_ELEMENT_MARKER,
      categoryElementId: view.getBigInt64(
        object.offset + CATEGORY_ELEMENT_ID_OFFSET,
        true,
      ),
      ownerElementId: view.getBigInt64(
        object.offset + OWNER_ELEMENT_ID_OFFSET,
        true,
      ),
      graphicsStyleType: view.getInt32(
        object.offset + GRAPHICS_STYLE_TYPE_OFFSET,
        true,
      ),
      linePatternElementId: view.getBigInt64(
        object.offset + LINE_PATTERN_ELEMENT_ID_OFFSET,
        true,
      ),
      materialElementId: view.getBigInt64(
        object.offset + MATERIAL_ELEMENT_ID_OFFSET,
        true,
      ),
      penNumber: view.getInt32(object.offset + PEN_NUMBER_OFFSET, true),
      color: view.getUint32(object.offset + COLOR_OFFSET, true),
      isScreenSized: screenSized === 1,
      evidence: "framed-gstyle-element-queued-gstyle",
    },
  };
}

/** Scan one inflated partition chunk for certified queued-GStyle records. */
export function scanRevit2027GStyleElementRecords(
  data: Uint8Array,
  revitVersion: number,
): Revit2027GStyleElementScan {
  const records: Revit2027GStyleElementRecord[] = [];
  const failures = new Map<string, number>();
  let framedStyleElements = 0;

  if (revitVersion !== 2027) {
    return {
      revitVersion,
      framedStyleElements,
      decodedStyleElements: 0,
      records,
      failures,
    };
  }

  for (const object of scanFramedElementObjects(data)) {
    if (object.marker !== REVIT_2027_GSTYLE_ELEMENT_MARKER) continue;
    framedStyleElements += 1;
    const decoded = decodeRevit2027GStyleElementRecord(
      data,
      object,
      revitVersion,
    );
    if (decoded.ok) {
      records.push(decoded.value);
    } else {
      failures.set(
        decoded.error,
        (failures.get(decoded.error) ?? 0) + 1,
      );
    }
  }

  return {
    revitVersion,
    framedStyleElements,
    decodedStyleElements: records.length,
    records,
    failures,
  };
}

export type Revit2027GStyleMaterialBinding =
  | {
      status: "exact-material";
      gStyleElementId: bigint;
      source: "face-gstyle" | "geometry-gstyle";
      materialElementId: number;
      style: Revit2027GStyleElementRecord;
      definition: NativeMaterialDefinition;
    }
  | {
      status: "not-applicable";
      reason:
        | "face-render-style-does-not-enter-node-gstyle-fallback"
        | "no-positive-face-or-geometry-gstyle";
    }
  | {
      status: "unresolved-gstyle";
      source: "face-gstyle" | "geometry-gstyle";
      gStyleElementId: bigint;
      reason: "outside-safe-integer-range" | "no-decoded-gstyle-element";
    }
  | {
      status: "gstyle-has-no-material";
      source: "face-gstyle" | "geometry-gstyle";
      gStyleElementId: bigint;
      style: Revit2027GStyleElementRecord;
      materialElementId: bigint;
    }
  | {
      status: "unresolved-material";
      source: "face-gstyle" | "geometry-gstyle";
      gStyleElementId: bigint;
      style: Revit2027GStyleElementRecord;
      materialElementId: bigint;
      reason: "outside-safe-integer-range" | "no-decoded-material-element";
    };

type RecordCollection =
  | ReadonlyMap<number, Revit2027GStyleElementRecord>
  | readonly Revit2027GStyleElementRecord[];

type DefinitionCollection =
  | ReadonlyMap<number, NativeMaterialDefinition>
  | readonly NativeMaterialDefinition[];

function recordMap(
  records: RecordCollection,
): ReadonlyMap<number, Revit2027GStyleElementRecord> {
  return Array.isArray(records)
    ? new Map(records.map((record) => [record.elementId, record]))
    : records as ReadonlyMap<number, Revit2027GStyleElementRecord>;
}

function definitionMap(
  definitions: DefinitionCollection,
): ReadonlyMap<number, NativeMaterialDefinition> {
  return Array.isArray(definitions)
    ? new Map(definitions.map((definition) => [
        definition.elementId,
        definition,
      ]))
    : definitions as ReadonlyMap<number, NativeMaterialDefinition>;
}

/**
 * Apply the native node-style precedence that is safe without view/category
 * state: an unassigned (`-1`) Face render-style, and the release-2027
 * non-category system value `-4000010`, may fall back to the Face GStyle, then
 * the owning Geometry GStyle.
 *
 * The native Revit 2027 BuiltInCategory array contains 1,224 exact ids and does
 * not contain `-4000010`; no framed element can carry that negative id either.
 * Other render-style IDs are not admitted because native
 * `OdBmBrFace::getMaterial` may resolve them through direct MaterialElem or
 * BuiltInCategory/view paths before it consults `OdBm::Details::getGStyle`.
 */
export function bindRevit2027FaceGStyleMaterialFallback(
  input: {
    renderStyleElementId: bigint;
    faceGStyleElementId: bigint;
    geometryGStyleElementId: bigint;
  },
  styles: RecordCollection,
  definitions: DefinitionCollection,
): Revit2027GStyleMaterialBinding {
  if (
    input.renderStyleElementId !== -1n &&
    input.renderStyleElementId !== -4000010n
  ) {
    return {
      status: "not-applicable",
      reason: "face-render-style-does-not-enter-node-gstyle-fallback",
    };
  }

  const selected = input.faceGStyleElementId > 0n
    ? {
      source: "face-gstyle" as const,
      id: input.faceGStyleElementId,
    }
    : input.geometryGStyleElementId > 0n
    ? {
      source: "geometry-gstyle" as const,
      id: input.geometryGStyleElementId,
    }
    : null;
  if (!selected) {
    return {
      status: "not-applicable",
      reason: "no-positive-face-or-geometry-gstyle",
    };
  }

  if (selected.id > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      status: "unresolved-gstyle",
      source: selected.source,
      gStyleElementId: selected.id,
      reason: "outside-safe-integer-range",
    };
  }
  const style = recordMap(styles).get(Number(selected.id));
  if (!style) {
    return {
      status: "unresolved-gstyle",
      source: selected.source,
      gStyleElementId: selected.id,
      reason: "no-decoded-gstyle-element",
    };
  }

  if (style.materialElementId <= 0n) {
    return {
      status: "gstyle-has-no-material",
      source: selected.source,
      gStyleElementId: selected.id,
      style,
      materialElementId: style.materialElementId,
    };
  }
  if (style.materialElementId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      status: "unresolved-material",
      source: selected.source,
      gStyleElementId: selected.id,
      style,
      materialElementId: style.materialElementId,
      reason: "outside-safe-integer-range",
    };
  }

  const materialElementId = Number(style.materialElementId);
  const definition = definitionMap(definitions).get(materialElementId);
  if (!definition) {
    return {
      status: "unresolved-material",
      source: selected.source,
      gStyleElementId: selected.id,
      style,
      materialElementId: style.materialElementId,
      reason: "no-decoded-material-element",
    };
  }
  return {
    status: "exact-material",
    source: selected.source,
    gStyleElementId: selected.id,
    materialElementId,
    style,
    definition,
  };
}
