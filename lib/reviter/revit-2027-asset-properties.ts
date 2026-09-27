/**
 * Rendering assets inside a GRep: an `Asset` and the typed property tree it
 * holds.
 *
 * A light fixture's geometry names its lamp through a `GImposter`, which
 * queues an `Asset` (for the 2025 RAC sample's track lights, a
 * "GenericPhotometricLight" from `assetlibrary_base.fbx`), which in turn
 * queues one object per property: booleans, enums, floats, colours and so on.
 * None of it is geometry, but it sits in the same FIFO as the geometry after
 * it, so it has to be read exactly for the replay to reach the rest.
 *
 * Every class here shares `AProperty`'s three fields: a name, an optional
 * child, and a counted list of connected properties. A string is a u32
 * character count and that many UTF-16 code units. A pointer is a CondInt16
 * descriptor that queues its object behind every older sibling; a pointer
 * list is a u32 count and that many descriptors.
 */
import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

/** Exact Revit 2027 source-class slots of the asset property family. */
export const REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS = {
  AProperties: 42,
  AProperty: 43,
  APropertyBoolean: 44,
  APropertyDistance: 45,
  APropertyDouble1: 47,
  APropertyDouble2: 48,
  APropertyDouble3: 49,
  APropertyDouble4: 50,
  APropertyDouble44: 51,
  APropertyEnum: 52,
  APropertyFloat: 53,
  APropertyFloat3: 54,
  APropertyInteger: 55,
  APropertyList: 56,
  APropertyLonglong: 57,
  APropertyReference: 59,
  APropertyString: 60,
  APropertyTime: 61,
  APropertyULonglong: 62,
  Asset: 425,
} as const;

export type Revit2027AssetPropertyClass =
  keyof typeof REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS;

/** Longer strings and lists than any asset holds are treated as misreads. */
const MAX_STRING_UNITS = 4096;
const MAX_POINTERS = 4096;

export type Revit2027AssetProperty = {
  byteOffset: number;
  endOffset: number;
  className: Revit2027AssetPropertyClass;
  name: string;
  /** A scalar or fixed-size value, where the class holds one. */
  value?: boolean | number | string | readonly number[];
  /** Every object this one queues, in the order it queues them. */
  queued: readonly CondInt16QueueEntry[];
};

export type Revit2027AssetPropertyDecodeResult =
  | { ok: true; value: Revit2027AssetProperty }
  | { ok: false; error: string };

class Reader {
  readonly data: Uint8Array;
  readonly end: number;
  readonly view: DataView;
  at: number;
  readonly queued: CondInt16QueueEntry[] = [];

  constructor(data: Uint8Array, byteOffset: number, end: number) {
    this.data = data;
    this.end = end;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.at = byteOffset;
  }

  private need(bytes: number): void {
    if (this.at + bytes > this.end) throw new Error("body is truncated");
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.at, true);
    this.at += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.at, true);
    this.at += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.at, true);
    this.at += 8;
    if (!Number.isFinite(value)) throw new Error("contains a non-finite double");
    return value;
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.at, true);
    this.at += 4;
    if (!Number.isFinite(value)) throw new Error("contains a non-finite float");
    return value;
  }

  bool(): boolean {
    this.need(1);
    const value = this.data[this.at]!;
    this.at += 1;
    if (value !== 0 && value !== 1) throw new Error("contains a non-strict boolean");
    return value === 1;
  }

  string(): string {
    const units = this.u32();
    if (units > MAX_STRING_UNITS) throw new Error("string length is implausible");
    this.need(units * 2);
    let text = "";
    for (let index = 0; index < units; index += 1) {
      text += String.fromCharCode(this.view.getUint16(this.at + index * 2, true));
    }
    this.at += units * 2;
    return text;
  }

  pointer(): void {
    const decoded = decodeCondInt16PropertyDescriptor(this.data, this.at);
    if (!decoded.ok) throw new Error(decoded.error);
    if (decoded.descriptor.endOffset > this.end) throw new Error("pointer is truncated");
    this.at = decoded.descriptor.endOffset;
    this.queued.push(decoded.descriptor);
  }

  pointers(): void {
    const count = this.u32();
    if (count > MAX_POINTERS) throw new Error("pointer list length is implausible");
    for (let index = 0; index < count; index += 1) this.pointer();
  }

  doubles(count: number): number[] {
    return Array.from({ length: count }, () => this.f64());
  }
}

/** Each class's own fields after `AProperty`'s, as a value (or none). */
const OWN_FIELDS: Record<
  Revit2027AssetPropertyClass,
  (reader: Reader) => Revit2027AssetProperty["value"]
> = {
  AProperty: () => undefined,
  AProperties: (reader) => {
    reader.pointers();
    return undefined;
  },
  Asset: (reader) => {
    reader.pointers(); // AProperties.m_aAProperties
    const library = reader.string();
    reader.string(); // m_sScene
    reader.pointer(); // m_oImage
    reader.i32(); // m_eAssetType
    return library;
  },
  APropertyBoolean: (reader) => reader.bool(),
  APropertyDistance: (reader) => {
    reader.string(); // m_unitTypeId, an inline ForgeTypeId
    return reader.f64();
  },
  APropertyDouble1: (reader) => reader.f64(),
  APropertyDouble2: (reader) => reader.doubles(2),
  APropertyDouble3: (reader) => reader.doubles(3),
  APropertyDouble4: (reader) => reader.doubles(4),
  APropertyDouble44: (reader) => reader.doubles(16),
  APropertyEnum: (reader) => reader.i32(),
  APropertyFloat: (reader) => reader.f32(),
  APropertyFloat3: (reader) => [reader.f32(), reader.f32(), reader.f32()],
  APropertyInteger: (reader) => reader.i32(),
  APropertyList: (reader) => {
    reader.pointers();
    reader.i32(); // m_memberType
    return undefined;
  },
  APropertyLonglong: (reader) => {
    reader.i32();
    reader.i32();
    return undefined;
  },
  APropertyReference: (reader) => {
    reader.pointer();
    return undefined;
  },
  APropertyString: (reader) => reader.string(),
  APropertyTime: (reader) => reader.f64(),
  APropertyULonglong: (reader) => {
    reader.u32();
    reader.u32();
    return undefined;
  },
};

/**
 * Decode one asset-family object that starts at `byteOffset` and ends no
 * later than `enclosingEndOffset`. Its length is whatever its strings and
 * lists make it.
 */
export function decodeRevit2027AssetProperty(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  className: Revit2027AssetPropertyClass,
): Revit2027AssetPropertyDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return { ok: false, error: `Revit 2027 ${className} decoding requires release 2027` };
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    !Number.isSafeInteger(enclosingEndOffset) ||
    enclosingEndOffset > data.byteLength ||
    byteOffset >= enclosingEndOffset
  ) {
    return { ok: false, error: `Revit 2027 ${className} body is outside its owner` };
  }
  const reader = new Reader(data, byteOffset, enclosingEndOffset);
  try {
    const name = reader.string(); // m_sName
    reader.pointer(); // m_aChild
    reader.pointers(); // m_aConnected
    const value = OWN_FIELDS[className](reader);
    return {
      ok: true,
      value: {
        byteOffset,
        endOffset: reader.at,
        className,
        name,
        ...(value === undefined ? {} : { value }),
        queued: reader.queued,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Revit 2027 ${className} ${(error as Error).message}`,
    };
  }
}
