import type { Bounds3, MaterialData } from "./types";

const ARC_WALL_2023_TAG = 0x0191;
const ARC_WALL_2023_VARIANT = 0x07fa;
const ARC_WALL_2023_FAMILY = 0x0008_8004;
const ARC_WALL_2023_RECORD_BYTES = 0x73;

export type ArcWall2023BoundsRecord = {
  decoderId: "revit-2023-arcwall-standard-v1";
  revitVersion: 2023;
  recordOffset: number;
  tag: number;
  variant: number;
  boundsFeet: Bounds3;
  duplicateMatches: boolean;
  confidence: "bounds-hypothesis";
};

export type DecoderPlan = {
  revitVersion: number | null;
  nativeProfileDecoder: "revit-2023-arcwall-standard-v1" | null;
  elementBoundsDecoder: "revit-2027-duplicated-bounds-v1" | null;
  diagnosticCoordinateScanner: true;
};

export type RvtMaterialRecord = {
  name?: string;
  color_packed?: number | null;
  transparency?: number | null;
};

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

/** Convert typed rvt-rs Material fields into glTF-compatible linear PBR data. */
export function decodeRvtMaterialDefinitions(source: RvtMaterialRecord[]): MaterialData[] {
  return source.flatMap((material) => {
    if (!material.name) return [];
    const packed = material.color_packed;
    const rgb = packed == null
      ? [0.522, 0.522, 0.522]
      : [
          srgbToLinear((packed & 0xff) / 255),
          srgbToLinear(((packed >> 8) & 0xff) / 255),
          srgbToLinear(((packed >> 16) & 0xff) / 255),
        ];
    return [{
      name: material.name,
      baseColorLinear: [
        rgb[0]!,
        rgb[1]!,
        rgb[2]!,
        1 - Math.max(0, Math.min(1, material.transparency ?? 0)),
      ] as [number, number, number, number],
      metallic: /metal|steel|alum|iron|chrome/i.test(material.name) ? 0.8 : 0,
      roughness: /glass|polish|chrome/i.test(material.name) ? 0.2 : 0.7,
      doubleSided: true,
      source: "rvt-material" as const,
      assignedElements: 0,
    }];
  });
}

function getU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function getU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function finiteModelCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 50_000;
}

export function decoderPlanForVersion(revitVersion?: number): DecoderPlan {
  const version = Number.isInteger(revitVersion) ? revitVersion! : null;
  return {
    revitVersion: version,
    // The 2023 envelope is decodable, but its six-double geometry semantics
    // remain unresolved in the source corpus. Do not promote it to profiles.
    nativeProfileDecoder: null,
    elementBoundsDecoder: version === 2027 ? "revit-2027-duplicated-bounds-v1" : null,
    diagnosticCoordinateScanner: true,
  };
}

/**
 * Strict, release-gated decoder for the standard ArcWall record documented by
 * the supplied clean-room rvt-rs corpus. The six doubles strongly resemble an
 * AABB, but the upstream report leaves their semantics unresolved; expose the
 * values as bounds-hypothesis evidence and do not emit typed wall geometry.
 */
export function decodeArcWall2023Record(
  data: Uint8Array,
  offset = 0,
  revitVersion = 2023,
): ArcWall2023BoundsRecord | null {
  if (revitVersion !== 2023 || offset < 0 || offset + ARC_WALL_2023_RECORD_BYTES > data.length) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    getU16(view, offset) !== ARC_WALL_2023_TAG ||
    getU16(view, offset + 0x02) !== 0 ||
    getU32(view, offset + 0x04) !== ARC_WALL_2023_FAMILY ||
    getU32(view, offset + 0x08) !== 1 ||
    getU32(view, offset + 0x0c) !== 3 ||
    getU16(view, offset + 0x10) !== ARC_WALL_2023_VARIANT ||
    data[offset + 0x72] !== 0x03
  ) {
    return null;
  }

  const primary = Array.from({ length: 6 }, (_, index) =>
    view.getFloat64(offset + 0x12 + index * 8, true),
  );
  const duplicate = Array.from({ length: 6 }, (_, index) =>
    view.getFloat64(offset + 0x42 + index * 8, true),
  );
  if (!primary.every(finiteModelCoordinate) || !duplicate.every(finiteModelCoordinate)) return null;

  const [minX, minY, minZ, maxX, maxY, maxZ] = primary as [number, number, number, number, number, number];
  const spans = [maxX - minX, maxY - minY, maxZ - minZ];
  if (spans.some((span) => span < -1e-8 || span > 5_000) || spans.filter((span) => span > 0.001).length < 2) return null;

  return {
    decoderId: "revit-2023-arcwall-standard-v1",
    revitVersion: 2023,
    recordOffset: offset,
    tag: ARC_WALL_2023_TAG,
    variant: ARC_WALL_2023_VARIANT,
    boundsFeet: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    duplicateMatches: primary.every((value, index) => value === duplicate[index]),
    confidence: "bounds-hypothesis",
  };
}

export function scanArcWall2023Records(
  data: Uint8Array,
  revitVersion?: number,
): ArcWall2023BoundsRecord[] {
  if (revitVersion !== 2023 || data.length < ARC_WALL_2023_RECORD_BYTES) return [];
  const records: ArcWall2023BoundsRecord[] = [];
  for (let offset = 0; offset <= data.length - ARC_WALL_2023_RECORD_BYTES; offset += 1) {
    if (data[offset] !== 0x91 || data[offset + 1] !== 0x01) continue;
    const record = decodeArcWall2023Record(data, offset, revitVersion);
    if (!record) continue;
    records.push(record);
    offset += ARC_WALL_2023_RECORD_BYTES - 1;
  }
  return records;
}
