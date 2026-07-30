/**
 * Release-gated Revit material-element identity and name records.
 *
 * This decoder recovers material identity, name, and the packed render colour.
 * It intentionally stops before transparency, texture/appearance assets, or
 * assignment.
 * The supplied 2027 file's embedded `Formats/Latest` schema identifies:
 *
 *   MaterialElem.m_pMaterial
 *   Material.m_name
 *   MaterialId.m_colorId / m_transparency / m_smoothness / ...
 *
 * The remaining nested properties still require the generic schema reader. The
 * outer material element and its packed colour are independently recoverable
 * because they use the same length/echo framing as other partition objects, a
 * release-specific class marker, a name string with its own stable field
 * trailer, and the bounded colour layouts documented below.
 */

/** `MaterialElem` object marker measured in the supplied Revit 2027 file. */
export const REVIT_2027_MATERIAL_ELEMENT_MARKER = 0x0ad3;

/** Marker immediately following the material element's UTF-16 name field. */
const REVIT_2027_MATERIAL_NAME_TRAILER = [
  0xff,
  0xff,
  0xff,
  0xff,
  0xe0,
  0x0c,
] as const;
const REVIT_2027_NESTED_NAME_SEPARATOR = [
  0x0d,
  0xb9,
  0xf0,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0x00,
  0x00,
  0x00,
  0x00,
] as const;
const ZERO_U64 = [0, 0, 0, 0, 0, 0, 0, 0] as const;

const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;
const OBJECT_TRAILER_BYTES = 20;
const OBJECT_LENGTH_ECHO_OFFSET = 16;
const MATERIAL_NAME_SEARCH_BYTES = 1_024;
const MIN_MATERIAL_NAME_CHARS = 3;
const MAX_MATERIAL_NAME_CHARS = 200;
const NESTED_DESCRIPTION_OFFSET = 231;
const MIN_APPEARANCE_RECORD_BYTES = 1_024;
const DIRECT_COLOR_SEARCH_START = 48;
const DIRECT_COLOR_SEARCH_END = 104;
const DIRECT_COLOR_EXPECTED_OFFSET = 84;
const NESTED_RENDER_COLOR_OFFSET = 72;

export type NativeMaterialAppearance = {
  /** Packed little-endian 0x00BBGGRR value persisted by Revit. */
  colorPacked: number;
  baseColorSrgb: [number, number, number];
  colorFieldOffset: number;
  evidence:
    | "framed-material-color-packed-direct"
    | "framed-material-color-packed-nested";
  /**
   * Persisted `MaterialId.m_transparency`, `0` opaque through `1` invisible.
   *
   * In the direct layout the field is an `f32` 24 bytes before the packed
   * colour, paired with a second ratio at 20 and preceded by an eight-byte
   * `ff` run. Measured against the paired IFC export's surface styles the
   * value agrees exactly on every named material: the three glasses read
   * 0.75, 0.70 and 0.90 against the export's transparencies, and all 14
   * export-matched opaque materials read 0.0. The nested appearance-backed
   * layout stores `ff` bytes at the same relative position, so no value is
   * reported there — every nested record the export names is opaque.
   */
  transparency?: number;
};

export type NativeMaterialDefinition = {
  elementId: number;
  name: string;
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_MATERIAL_ELEMENT_MARKER;
  evidence:
    | "framed-material-element-name"
    | "framed-nested-material-name";
  appearance?: NativeMaterialAppearance;
};

export type MaterialRecordScan = {
  revitVersion: number;
  framedMaterialElements: number;
  namedMaterialElements: number;
  definitions: NativeMaterialDefinition[];
};

function matchesAt(data: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (offset < 0 || offset + pattern.length > data.byteLength) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (data[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function validMaterialName(value: string): boolean {
  if (!value.trim() || !/[\p{L}\p{N}]/u.test(value)) return false;
  return !/[\u0000-\u001f\u007f\ufffd]/u.test(value);
}

function readUtf16Field(
  data: Uint8Array,
  view: DataView,
  offset: number,
  limit: number,
  minimumCharacters: number,
): { value: string; end: number } | null {
  if (offset < 0 || offset + 4 > limit) return null;
  const characters = view.getUint32(offset, true);
  const start = offset + 4;
  const end = start + characters * 2;
  if (
    characters < minimumCharacters ||
    characters > MAX_MATERIAL_NAME_CHARS ||
    end > limit
  ) {
    return null;
  }
  const value = new TextDecoder("utf-16le")
    .decode(data.subarray(start, end))
    .normalize("NFC");
  return validMaterialName(value) ? { value, end } : null;
}

/**
 * Read the name field inside one verified Revit 2027 `MaterialElem`.
 *
 * A generic length-prefixed UTF-16 scan is not sufficient: appearance assets
 * in the same object carry many strings, including texture paths and schema
 * labels. Requiring the observed `ff ff ff ff e0 0c` field trailer selects the
 * element name rather than one of those nested strings.
 */
type MaterialNameField = {
  value: string;
  end: number;
};

function readMaterialName(
  data: Uint8Array,
  view: DataView,
  objectOffset: number,
  objectLength: number,
): MaterialNameField | null {
  const limit = Math.min(
    data.byteLength,
    objectOffset + objectLength,
    objectOffset + MATERIAL_NAME_SEARCH_BYTES,
  );
  for (let offset = objectOffset + 20; offset + 10 <= limit; offset += 1) {
    const characters = view.getUint32(offset, true);
    if (
      characters < MIN_MATERIAL_NAME_CHARS ||
      characters > MAX_MATERIAL_NAME_CHARS
    ) {
      continue;
    }
    const start = offset + 4;
    const end = start + characters * 2;
    if (
      end + REVIT_2027_MATERIAL_NAME_TRAILER.length > limit ||
      !matchesAt(data, end, REVIT_2027_MATERIAL_NAME_TRAILER)
    ) {
      continue;
    }
    const name = new TextDecoder("utf-16le").decode(data.subarray(start, end));
    if (validMaterialName(name)) {
      return { value: name.normalize("NFC"), end };
    }
  }
  return null;
}

/**
 * Read the second persisted material-name layout.
 *
 * Larger appearance-backed `MaterialElem` records place a source description
 * at `+231`, followed by a fixed field separator, then `Material.m_name`.
 * Eight zero bytes and a nonzero 64-bit object reference close the field.
 * Requiring the entire chain avoids selecting schema labels or asset paths
 * from the same nested object.
 */
function readNestedMaterialName(
  data: Uint8Array,
  view: DataView,
  objectOffset: number,
  objectLength: number,
): MaterialNameField | null {
  const limit = Math.min(data.byteLength, objectOffset + objectLength);
  const description = readUtf16Field(
    data,
    view,
    objectOffset + NESTED_DESCRIPTION_OFFSET,
    limit,
    3,
  );
  if (
    !description ||
    !matchesAt(data, description.end, REVIT_2027_NESTED_NAME_SEPARATOR)
  ) {
    return null;
  }
  const name = readUtf16Field(
    data,
    view,
    description.end + REVIT_2027_NESTED_NAME_SEPARATOR.length,
    limit,
    MIN_MATERIAL_NAME_CHARS,
  );
  if (
    !name ||
    name.end + 16 > limit ||
    !matchesAt(data, name.end, ZERO_U64) ||
    view.getUint32(name.end + 8, true) === 0 ||
    view.getUint32(name.end + 12, true) !== 0
  ) {
    return null;
  }
  return name;
}

function zeroBytes(
  data: Uint8Array,
  offset: number,
  length: number,
): boolean {
  if (offset < 0 || offset + length > data.byteLength) return false;
  for (let index = 0; index < length; index += 1) {
    if (data[offset + index] !== 0) return false;
  }
  return true;
}

/** Bytes between the persisted transparency `f32` and the packed colour. */
const TRANSPARENCY_BEFORE_COLOR_BYTES = 24;

/**
 * Read `MaterialId.m_transparency` behind a proven direct-layout colour.
 *
 * Three requirements, all measured on the supplied file and each one cheap to
 * check: an eight-byte `ff` run immediately before the field, the field itself
 * a finite ratio in `[0, 1]`, and the companion ratio beside it also in
 * `[0, 1]`. The nested layout keeps `ff` bytes here, so it fails the first
 * check and reports nothing rather than a guess.
 */
function readTransparency(
  data: Uint8Array,
  view: DataView,
  colorFieldOffset: number,
): number | undefined {
  const fieldOffset = colorFieldOffset - TRANSPARENCY_BEFORE_COLOR_BYTES;
  if (fieldOffset < 8) return undefined;
  for (let index = fieldOffset - 8; index < fieldOffset; index += 1) {
    if (data[index] !== 0xff) return undefined;
  }
  const transparency = view.getFloat32(fieldOffset, true);
  const companion = view.getFloat32(fieldOffset + 4, true);
  if (!Number.isFinite(transparency) || transparency < 0 || transparency > 1) return undefined;
  if (!Number.isFinite(companion) || companion < 0 || companion > 1) return undefined;
  return transparency;
}

function appearanceAt(
  data: Uint8Array,
  view: DataView,
  objectOffset: number,
  colorFieldOffset: number,
  evidence: NativeMaterialAppearance["evidence"],
): NativeMaterialAppearance {
  const colorPacked = view.getUint32(colorFieldOffset, true);
  const transparency = evidence === "framed-material-color-packed-direct"
    ? readTransparency(data, view, colorFieldOffset)
    : undefined;
  return {
    colorPacked,
    baseColorSrgb: [
      colorPacked & 0xff,
      (colorPacked >>> 8) & 0xff,
      (colorPacked >>> 16) & 0xff,
    ],
    colorFieldOffset: colorFieldOffset - objectOffset,
    evidence,
    ...(transparency != null ? { transparency } : {}),
  };
}

/**
 * Locate the persisted packed render colour following a proven material name.
 *
 * Direct-name records put the packed value after a zeroed MaterialId prefix and
 * before a one-byte-range descriptor plus an eight-byte zero suffix. The five
 * system/legacy variants that omit that suffix retain the same +84 field slot.
 * The separately bounded nested layout stores three graphic/render colours at
 * eight-byte intervals; the middle (+72) value is the render colour that agrees
 * with the Autodesk derivative palette (the wood record is the discriminating
 * case because its first colour is grey and its middle colour is wood).
 */
function readMaterialAppearance(
  data: Uint8Array,
  view: DataView,
  objectOffset: number,
  objectLength: number,
  name: MaterialNameField,
  nested: boolean,
): NativeMaterialAppearance | null {
  if (objectLength < MIN_APPEARANCE_RECORD_BYTES) return null;
  const objectEnd = Math.min(data.byteLength, objectOffset + objectLength);
  if (nested) {
    const colorFieldOffset = name.end + NESTED_RENDER_COLOR_OFFSET;
    if (
      colorFieldOffset + 4 > objectEnd ||
      data[colorFieldOffset + 3] !== 0
    ) {
      return null;
    }
    return appearanceAt(
      data,
      view,
      objectOffset,
      colorFieldOffset,
      "framed-material-color-packed-nested",
    );
  }

  const structuralCandidates: number[] = [];
  for (
    let colorFieldOffset = name.end + DIRECT_COLOR_SEARCH_START;
    colorFieldOffset + 16 <= Math.min(objectEnd, name.end + DIRECT_COLOR_SEARCH_END);
    colorFieldOffset += 1
  ) {
    if (
      !zeroBytes(data, colorFieldOffset - 12, 12) ||
      data[colorFieldOffset + 3] !== 0
    ) {
      continue;
    }
    const descriptor = view.getUint32(colorFieldOffset + 4, true);
    if (
      descriptor === 0 ||
      descriptor > 0xff ||
      !zeroBytes(data, colorFieldOffset + 8, 8)
    ) {
      continue;
    }
    structuralCandidates.push(colorFieldOffset);
  }
  structuralCandidates.sort((left, right) =>
    Math.abs(left - (name.end + DIRECT_COLOR_EXPECTED_OFFSET)) -
    Math.abs(right - (name.end + DIRECT_COLOR_EXPECTED_OFFSET)));
  if (structuralCandidates[0] != null) {
    return appearanceAt(
      data,
      view,
      objectOffset,
      structuralCandidates[0],
      "framed-material-color-packed-direct",
    );
  }

  const fallback = name.end + DIRECT_COLOR_EXPECTED_OFFSET;
  if (
    fallback + 4 > objectEnd ||
    data[fallback + 3] !== 0 ||
    view.getUint32(fallback, true) === 0
  ) {
    return null;
  }
  return appearanceAt(
    data,
    view,
    objectOffset,
    fallback,
    "framed-material-color-packed-direct",
  );
}

/**
 * Scan one inflated partition chunk for proven material element definitions.
 *
 * Safety gates:
 *
 * - disabled outside Revit 2027;
 * - nonzero 32-bit element id;
 * - object length in the established partition range;
 * - trailer echoes the exact object length;
 * - exact 2027 `MaterialElem` class marker;
 * - UTF-16 name followed by its material-specific field trailer.
 *
 * `framedMaterialElements` includes records whose framing and class are proven
 * but whose name layout has not yet been decoded. They remain diagnostics and
 * are not returned as definitions.
 */
export function scanMaterialElementRecords(
  data: Uint8Array,
  revitVersion: number,
): MaterialRecordScan {
  const definitions: NativeMaterialDefinition[] = [];
  if (revitVersion !== 2027 || data.byteLength < 64) {
    return {
      revitVersion,
      framedMaterialElements: 0,
      namedMaterialElements: 0,
      definitions,
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let framedMaterialElements = 0;
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    if (!elementId) continue;
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < MIN_OBJECT_BYTES || objectLength > MAX_OBJECT_BYTES) continue;
    const echo = offset + objectLength + OBJECT_LENGTH_ECHO_OFFSET;
    if (
      echo + 4 > data.byteLength ||
      view.getUint32(echo, true) !== objectLength ||
      view.getUint16(offset + 16, true) !== REVIT_2027_MATERIAL_ELEMENT_MARKER
    ) {
      continue;
    }

    framedMaterialElements += 1;
    const directName = readMaterialName(data, view, offset, objectLength);
    const nestedName = directName
      ? null
      : readNestedMaterialName(data, view, offset, objectLength);
    const nameField = directName ?? nestedName;
    if (!nameField) continue;
    const appearance = readMaterialAppearance(
      data,
      view,
      offset,
      objectLength,
      nameField,
      nestedName != null,
    );
    definitions.push({
      elementId,
      name: nameField.value,
      recordOffset: offset,
      objectLength,
      objectMarker: REVIT_2027_MATERIAL_ELEMENT_MARKER,
      evidence: directName
        ? "framed-material-element-name"
        : "framed-nested-material-name",
      ...(appearance ? { appearance } : {}),
    });
    offset += objectLength + OBJECT_TRAILER_BYTES - 1;
  }

  return {
    revitVersion,
    framedMaterialElements,
    namedMaterialElements: definitions.length,
    definitions,
  };
}
