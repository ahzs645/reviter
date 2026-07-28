/**
 * Release-gated Revit material-element identity and name records.
 *
 * This decoder intentionally stops before color, appearance, or assignment.
 * The supplied 2027 file's embedded `Formats/Latest` schema identifies:
 *
 *   MaterialElem.m_pMaterial
 *   Material.m_name
 *   MaterialId.m_colorId / m_transparency / m_smoothness / ...
 *
 * but those nested objects still require the generic schema reader. The outer
 * material element is independently recoverable because it uses the same
 * length/echo framing as other partition objects, a release-specific class
 * marker, and a name string with its own stable field trailer.
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

const MIN_OBJECT_BYTES = 40;
const MAX_OBJECT_BYTES = 0xffff;
const OBJECT_TRAILER_BYTES = 20;
const OBJECT_LENGTH_ECHO_OFFSET = 16;
const MATERIAL_NAME_SEARCH_BYTES = 1_024;
const MIN_MATERIAL_NAME_CHARS = 3;
const MAX_MATERIAL_NAME_CHARS = 200;

export type NativeMaterialDefinition = {
  elementId: number;
  name: string;
  recordOffset: number;
  objectLength: number;
  objectMarker: typeof REVIT_2027_MATERIAL_ELEMENT_MARKER;
  evidence: "framed-material-element-name";
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

/**
 * Read the name field inside one verified Revit 2027 `MaterialElem`.
 *
 * A generic length-prefixed UTF-16 scan is not sufficient: appearance assets
 * in the same object carry many strings, including texture paths and schema
 * labels. Requiring the observed `ff ff ff ff e0 0c` field trailer selects the
 * element name rather than one of those nested strings.
 */
function readMaterialName(
  data: Uint8Array,
  view: DataView,
  objectOffset: number,
  objectLength: number,
): string | null {
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
    if (validMaterialName(name)) return name.normalize("NFC");
  }
  return null;
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
    const name = readMaterialName(data, view, offset, objectLength);
    if (!name) continue;
    definitions.push({
      elementId,
      name,
      recordOffset: offset,
      objectLength,
      objectMarker: REVIT_2027_MATERIAL_ELEMENT_MARKER,
      evidence: "framed-material-element-name",
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
