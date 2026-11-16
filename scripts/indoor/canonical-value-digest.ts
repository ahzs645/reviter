/** Representation-independent SHA-256 of a structured-clone value (CLI only).
 *
 * Checkpoint reuse used to bind the bytes of node:v8 serialize(). Those bytes
 * depend on how V8 happens to store a value, not only on the value: the same
 * number 1 is written as a small integer (tag 'I') when it came from
 * JSON.parse and as a heap double (tag 'N') when it came from arithmetic. The
 * November 2026 campus runs had identical inputs whose snapshots differed only
 * this way, so 1148 landing pairs and 9 planes were recomputed from scratch.
 *
 * This digest encodes the value that a structured clone (and so a worker that
 * deserializes the snapshot) can observe:
 * - every number as its IEEE-754 binary64 bits, so 1 and 1.0 are equal while
 *   0 and -0 differ; every NaN is one value (JS cannot tell NaNs apart);
 * - strings by their UTF-16 code units, booleans, null, undefined, BigInt;
 * - arrays by length, holes and elements; plain objects by own enumerable
 *   string keys in their observable order (Object.keys order);
 * - Map/Set in insertion order, Date, ArrayBuffer and typed arrays by bytes;
 * - shared references and cycles as back-references, so aliasing (observable
 *   with ===) is part of the identity.
 * Anything else (functions, symbols, class instances, accessors, extra array
 * properties) throws: the caller then keeps the byte binding, which is never
 * less strict than this one.
 */
import { createHash, type Hash } from "node:crypto";

const Tag = {Undefined: 0, Null: 1, False: 2, True: 3, Number: 4, String: 5, BigInt: 6, Array: 7, Hole: 8, Object: 9, Map: 10, Set: 11, Date: 12, ArrayBuffer: 13, TypedArray: 14, Reference: 15, NaN: 16} as const;
type Tag = (typeof Tag)[keyof typeof Tag];
const CHUNK = 1 << 20;
/** Private stack markers: an object key and an array hole. */
class KeyMarker { readonly key: string; constructor(key: string) { this.key = key; } }
const HOLE = Symbol("hole");

class Writer {
  private buffer = Buffer.allocUnsafe(CHUNK);
  private offset = 0;
  private readonly hash: Hash;
  constructor(hash: Hash) { this.hash = hash; }
  private room(bytes: number) {
    if (this.offset + bytes <= CHUNK) return;
    this.flush();
  }
  flush() {
    if (this.offset) this.hash.update(this.buffer.subarray(0, this.offset));
    this.offset = 0;
  }
  tag(tag: Tag) {
    this.room(1);
    this.buffer[this.offset++] = tag;
  }
  u32(value: number) {
    this.room(4);
    this.buffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }
  f64(value: number) {
    this.room(8);
    this.buffer.writeDoubleLE(value, this.offset);
    this.offset += 8;
  }
  /** UTF-16 code units, so lone surrogates are not merged by UTF-8 repair. */
  string(value: string) {
    this.u32(value.length);
    for (let start = 0; start < value.length; start += CHUNK >> 2) {
      const part = value.slice(start, start + (CHUNK >> 2));
      this.room(part.length * 2);
      this.offset += this.buffer.write(part, this.offset, "utf16le");
    }
  }
  bytes(view: Uint8Array) {
    this.u32(view.byteLength);
    this.flush();
    this.hash.update(view);
  }
}

const typedArrayNames = new Set([
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "DataView",
]);

function own(value: object, key: string) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
  if (!("value" in descriptor)) throw Error("Canonical digest cannot read accessor property " + key);
  return descriptor.value as unknown;
}

/** Hex SHA-256 of the canonical encoding (format "reviter-canonical-value-v1"). */
export function canonicalValueSha256(value: unknown): string {
  const hash = createHash("sha256");
  const out = new Writer(hash);
  out.string("reviter-canonical-value-v1");
  const seen = new Map<object, number>();
  // Explicit stack: campus snapshots nest deeply enough to risk recursion limits.
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === HOLE) { out.tag(Tag.Hole); continue; }
    if (v instanceof KeyMarker) { out.string(v.key); continue; }
    if (v === undefined) { out.tag(Tag.Undefined); continue; }
    if (v === null) { out.tag(Tag.Null); continue; }
    switch (typeof v) {
      case "boolean": out.tag(v ? Tag.True : Tag.False); continue;
      case "number":
        if (Number.isNaN(v)) out.tag(Tag.NaN);
        else { out.tag(Tag.Number); out.f64(v); }
        continue;
      case "string": out.tag(Tag.String); out.string(v); continue;
      case "bigint": out.tag(Tag.BigInt); out.string(v.toString(16)); continue;
      case "object": break;
      default: throw Error("Canonical digest cannot encode " + typeof v);
    }
    const object = v as object;
    const previous = seen.get(object);
    if (previous !== undefined) { out.tag(Tag.Reference); out.u32(previous); continue; }
    seen.set(object, seen.size);
    const children: unknown[] = [];
    if (Array.isArray(object)) {
      if (Object.getPrototypeOf(object) !== Array.prototype) throw Error("Canonical digest requires plain arrays");
      const keys = Object.keys(object);
      let present = 0;
      out.tag(Tag.Array); out.u32(object.length);
      for (let i = 0; i < object.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(object, i)) { children.push(HOLE); continue; }
        present++;
        children.push(own(object, String(i)));
      }
      if (keys.length !== present) throw Error("Canonical digest cannot encode extra array properties");
    } else if (object instanceof Map) {
      if (Object.getPrototypeOf(object) !== Map.prototype) throw Error("Canonical digest requires plain Map");
      out.tag(Tag.Map); out.u32(object.size);
      for (const [k, x] of object) children.push(k, x);
    } else if (object instanceof Set) {
      if (Object.getPrototypeOf(object) !== Set.prototype) throw Error("Canonical digest requires plain Set");
      out.tag(Tag.Set); out.u32(object.size);
      for (const x of object) children.push(x);
    } else if (object instanceof Date) {
      out.tag(Tag.Date); out.f64(object.getTime()); continue;
    } else if (object instanceof ArrayBuffer) {
      out.tag(Tag.ArrayBuffer); out.bytes(new Uint8Array(object)); continue;
    } else if (ArrayBuffer.isView(object)) {
      const name = Object.getPrototypeOf(object)?.constructor?.name as string;
      if (!typedArrayNames.has(name)) throw Error("Canonical digest cannot encode view " + name);
      out.tag(Tag.TypedArray); out.string(name);
      out.bytes(new Uint8Array(object.buffer, object.byteOffset, object.byteLength)); continue;
    } else {
      const prototype = Object.getPrototypeOf(object);
      if (prototype !== Object.prototype && prototype !== null) throw Error("Canonical digest requires plain objects");
      if (Object.getOwnPropertySymbols(object).length) throw Error("Canonical digest cannot encode symbol keys");
      const keys = Object.keys(object);
      out.tag(Tag.Object); out.u32(keys.length);
      for (const key of keys) children.push(new KeyMarker(key), own(object, key));
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  out.flush();
  return hash.digest("hex");
}
