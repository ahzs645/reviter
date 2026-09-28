import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027AssetProperty,
  REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS,
} from "../lib/reviter/revit-2027-asset-properties.ts";
import {
  REVIT_2027_GBITMAP_SOURCE_CLASS_SLOT,
  REVIT_2027_GCONDITION_SELECTED_SOURCE_CLASS_SLOT,
  decodeRevit2027GBitmap,
  decodeRevit2027GConditionSelected,
  revit2027GBitmapBytes,
  revit2027GConditionSelectedBytes,
} from "../lib/reviter/revit-2027-gbitmap.ts";
import {
  decodeRevit2027GComponentRef,
  REVIT_2027_GCOMPONENT_REF_BODY_BYTES,
  REVIT_2027_GCOMPONENT_REF_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gcomponent-ref.ts";
import {
  decodeRevit2027GEllipse,
  REVIT_2027_GELLIPSE_BODY_BYTES,
  REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gellipse.ts";
import {
  decodeRevit2027GImposter,
  REVIT_2027_ASSET_SOURCE_CLASS_SLOT,
  REVIT_2027_GIMPOSTER_BODY_BYTES,
  REVIT_2027_GIMPOSTER_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gimposter.ts";
import { REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-ginstance.ts";
import { createRevit2027GRepReplayRegistry } from "../lib/reviter/revit-2027-grep-replay.ts";
import { setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";

/** A little-endian byte builder. */
class Bytes {
  private readonly parts: number[] = [];
  u8(value: number): this {
    this.parts.push(value & 0xff);
    return this;
  }
  i32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value, true);
    this.parts.push(...new Uint8Array(view.buffer));
    return this;
  }
  i16(value: number): this {
    const view = new DataView(new ArrayBuffer(2));
    view.setInt16(0, value, true);
    this.parts.push(...new Uint8Array(view.buffer));
    return this;
  }
  i64(value: bigint): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigInt64(0, value, true);
    this.parts.push(...new Uint8Array(view.buffer));
    return this;
  }
  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    this.parts.push(...new Uint8Array(view.buffer));
    return this;
  }
  f64(...values: number[]): this {
    for (const value of values) {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value, true);
      this.parts.push(...new Uint8Array(view.buffer));
    }
    return this;
  }
  gInfo(): this {
    return this.i64(-1n).i32(-1).i32(0).i32(0x00088004);
  }
  /** A queued pointer: token -1 and its class, or a null token. */
  pointer(slot: number | null): this {
    return slot == null ? this.i32(0) : this.i32(-1).i16(slot);
  }
  string(text: string): this {
    this.i32(text.length);
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      this.u8(unit).u8(unit >> 8);
    }
    return this;
  }
  build(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

test("the non-geometric nodes and asset classes have certified readers", () => {
  const registry = createRevit2027GRepReplayRegistry();
  assert.equal(registry.get(REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT)?.id, "Revit2027GEllipse");
  assert.equal(registry.get(REVIT_2027_GCOMPONENT_REF_SOURCE_CLASS_SLOT)?.id, "Revit2027GComponentRef");
  assert.equal(registry.get(REVIT_2027_GIMPOSTER_SOURCE_CLASS_SLOT)?.id, "Revit2027GImposter");
  for (const [className, slot] of Object.entries(REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS)) {
    assert.equal(registry.get(slot)?.id, `Revit2027${className}`);
  }
  assert.equal(REVIT_2027_ASSET_SOURCE_CLASS_SLOT, REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS.Asset);
});

test("a GEllipse is a 124-byte curve with a centre, two axes and two radii", () => {
  const data = new Bytes()
    .gInfo()
    .f64(0, Math.PI) // end parameters
    .f64(10, -4, 7) // centre
    .f64(1, 0, 0) // x axis
    .f64(0, 1, 0) // y axis
    .f64(2.5, 1.25)
    .build();
  assert.equal(data.length, REVIT_2027_GELLIPSE_BODY_BYTES);
  const decoded = decodeRevit2027GEllipse(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, 124);
  assert.deepEqual(decoded.value.center, [10, -4, 7]);
  assert.deepEqual(decoded.value.xDirection, [1, 0, 0]);
  assert.equal(decoded.value.xRadius, 2.5);
  assert.equal(decoded.value.yRadius, 1.25);
  assert.equal(decodeRevit2027GEllipse(data, 0, data.length - 1, 2027).ok, false);
  assert.equal(decodeRevit2027GEllipse(data, 0, data.length, 2023).ok, false);
});

test("a GEllipse with a negative radius is not read", () => {
  const data = new Bytes().gInfo().f64(0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 1).build();
  assert.equal(decodeRevit2027GEllipse(data, 0, data.length, 2027).ok, false);
});

test("a GComponentRef queues exactly the InstanceInfo of the component it names", () => {
  const data = new Bytes().gInfo().pointer(REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT).build();
  assert.equal(data.length, REVIT_2027_GCOMPONENT_REF_BODY_BYTES);
  const decoded = decodeRevit2027GComponentRef(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.instanceInfo, {
    byteOffset: 20,
    endOffset: 26,
    token: -1,
    sourceClassSlot: REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
  });
  // Anything but the InstanceInfo form is refused.
  const other = new Bytes().gInfo().pointer(2246).build();
  assert.equal(decodeRevit2027GComponentRef(other, 0, other.length, 2027).ok, false);
});

test("a GImposter is a transform and a queued Asset", () => {
  const data = new Bytes()
    .gInfo()
    .f64(1, 0, 0, 0, 1, 0, 0, 0, 1) // rotation rows
    .f64(3, 4, 5) // origin
    .pointer(REVIT_2027_ASSET_SOURCE_CLASS_SLOT)
    .build();
  assert.equal(data.length, REVIT_2027_GIMPOSTER_BODY_BYTES);
  const decoded = decodeRevit2027GImposter(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.transform.origin, [3, 4, 5]);
  assert.equal(decoded.value.asset.sourceClassSlot, REVIT_2027_ASSET_SOURCE_CLASS_SLOT);
  assert.equal(decoded.value.asset.endOffset, 122);
});

test("an Asset reads its name, its queued properties and its library", () => {
  // The shape of the 2025 RAC sample's track-light asset, with two of its
  // eighteen properties.
  const { APropertyBoolean, APropertyEnum } = REVIT_2027_ASSET_PROPERTY_CLASS_SLOTS;
  const data = new Bytes()
    .string("GenericPhotometricLight")
    .pointer(null) // m_aChild
    .i32(0) // m_aConnected
    .i32(2)
    .pointer(APropertyBoolean)
    .pointer(APropertyEnum)
    .string("assetlibrary_base.fbx")
    .string("") // m_sScene
    .pointer(null) // m_oImage
    .i32(3) // m_eAssetType
    .build();
  const decoded = decodeRevit2027AssetProperty(data, 0, data.length, 2027, "Asset");
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, data.length);
  assert.equal(decoded.value.name, "GenericPhotometricLight");
  assert.equal(decoded.value.value, "assetlibrary_base.fbx");
  // Every pointer, null ones included, in the order the body holds them.
  assert.deepEqual(
    decoded.value.queued.map(({ token, sourceClassSlot }) => [token, sourceClassSlot]),
    [[0, null], [-1, APropertyBoolean], [-1, APropertyEnum], [0, null]],
  );
});

test("typed asset properties read their values and fail closed", () => {
  const prefix = (bytes: Bytes, name: string) => bytes.string(name).pointer(null).i32(0);
  const read = (data: Uint8Array, className: Parameters<typeof decodeRevit2027AssetProperty>[4]) =>
    decodeRevit2027AssetProperty(data, 0, data.length, 2027, className);

  const boolean = read(prefix(new Bytes(), "on").u8(1).build(), "APropertyBoolean");
  assert.equal(boolean.ok && boolean.value.value, true);
  assert.equal(read(prefix(new Bytes(), "on").u8(2).build(), "APropertyBoolean").ok, false);

  const colour = read(prefix(new Bytes(), "tint").f64(0.5, 0.25, 1).build(), "APropertyDouble3");
  assert.deepEqual(colour.ok && colour.value.value, [0.5, 0.25, 1]);

  const float = read(prefix(new Bytes(), "power").f32(1.5).build(), "APropertyFloat");
  assert.equal(float.ok && float.value.value, 1.5);

  const distance = read(
    prefix(new Bytes(), "width").string("autodesk.unit.unit:feet-1.0.1").f64(2).build(),
    "APropertyDistance",
  );
  assert.equal(distance.ok && distance.value.value, 2);

  // A string longer than the object is refused rather than read past it.
  const truncated = prefix(new Bytes(), "label").i32(40).string("short").build();
  assert.equal(read(truncated, "APropertyString").ok, false);
});

test("a GBitmap is a marker point with a pixel size, 60 bytes with 64-bit ids", () => {
  const data = new Bytes().gInfo().f64(12.5, -3, 40).i32(16).i32(24).i32(3).i32(1).build();
  assert.equal(data.length, revit2027GBitmapBytes());
  assert.equal(data.length, 60);
  const decoded = decodeRevit2027GBitmap(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.point, [12.5, -3, 40]);
  assert.deepEqual(decoded.value.sizePixels, [16, 24]);
  assert.equal(decoded.value.bitmapType, 3);
  assert.equal(decoded.value.alignment, 1);
  assert.equal(decodeRevit2027GBitmap(data, 0, data.length - 1, 2027).ok, false);
  const notFinite = new Bytes().gInfo().f64(Number.NaN, 0, 0).i32(16).i32(16).i32(0).i32(0).build();
  assert.equal(decodeRevit2027GBitmap(notFinite, 0, notFinite.length, 2027).ok, false);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(REVIT_2027_GBITMAP_SOURCE_CLASS_SLOT)?.id,
    "Revit2027GBitmap",
  );
});

test("a GConditionSelected is a comparison and a view id", () => {
  const data = new Bytes().i32(-1).i64(-1n).build();
  assert.equal(data.length, revit2027GConditionSelectedBytes());
  const decoded = decodeRevit2027GConditionSelected(data, 0, data.length, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.compareMode, -1);
  assert.equal(decoded.value.viewElementId, -1);
  assert.equal(decodeRevit2027GConditionSelected(data, 0, 8, 2027).ok, false);
  setActiveElementIdBytes(4);
  try {
    const narrow = new Bytes().i32(0).i32(812345).build();
    assert.equal(revit2027GConditionSelectedBytes(), 8);
    const read = decodeRevit2027GConditionSelected(narrow, 0, narrow.length, 2027);
    assert.equal(read.ok && read.value.viewElementId, 812345);
  } finally {
    setActiveElementIdBytes(null);
  }
  assert.equal(
    createRevit2027GRepReplayRegistry().get(REVIT_2027_GCONDITION_SELECTED_SOURCE_CLASS_SLOT)?.id,
    "Revit2027GConditionSelected",
  );
});
