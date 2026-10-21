/** Operation-local exact Boolean memo. This computes no support/owner/source
 * decision: its caller must still run every original guard and inspect union.
 * No global cache, model/door-ID key, IEEE geometry key or Rational.toJSON.
 */
import {
  Rational,
  nativeRationalOverlay,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";

type Limits = { maxEntries?: number; maxRetainedBytes?: number };
type Execute = (
  subject: NativeRationalParts,
  part: NativeRationalParts,
) => NativeRationalParts;
type Snapshot = {
  parts: NativeRationalParts;
  key: string;
  storageCharge: number;
};
const abort = Symbol("uncacheable exact operands");

/** All retained arrays, scalar integers, metadata and Map/string overhead receive
 * a conservative charge. This is a cache-retention budget, not a heap metric. */
function snapshot(
  parts: NativeRationalParts,
  limit: number,
): Snapshot | undefined {
  const chunks: string[] = [];
  let keyBytes = 0,
    storageCharge = 0;
  const charge = (bytes: number) => {
    storageCharge += bytes;
    if (storageCharge + keyBytes > limit) throw abort;
  };
  const put = (text: string) => {
    // ASCII integer/structure encoding; V8's possible UTF-16 storage is charged.
    keyBytes += text.length * 2;
    if (storageCharge + keyBytes > limit) throw abort;
    chunks.push(text);
  };
  const array = (value: unknown) => {
    if (!Array.isArray(value)) throw abort;
    charge(32 + value.length * 8);
    put(`[${value.length}:`);
    return value;
  };
  const scalar = (value: unknown): Rational => {
    if (!(value instanceof Rational)) throw abort;
    const nd = Object.getOwnPropertyDescriptor(value, "n"),
      dd = Object.getOwnPropertyDescriptor(value, "d"),
      od = Object.getOwnPropertyDescriptor(value, "original");
    if (
      !nd ||
      !dd ||
      !("value" in nd) ||
      !("value" in dd) ||
      typeof nd.value !== "bigint" ||
      typeof dd.value !== "bigint" ||
      dd.value <= 0n ||
      (od && !("value" in od))
    )
      throw abort;
    const n: bigint = nd.value,
      d: bigint = dd.value,
      ns = n.toString(),
      ds = d.toString(),
      original = od?.value;
    charge(128 + (ns.length + ds.length) * 2);
    put(`q${ns.length}:${ns}/${ds.length}:${ds}`);
    if (!od) put("o-");
    else if (original === undefined) put("ou");
    else {
      if (typeof original !== "number" || !Number.isFinite(original))
        throw abort;
      // Preserve the optional *source* IEEE bit ledger (including signed zero)
      // as an integer tag. Never convert exact n/d to IEEE to construct a key.
      const bits = new DataView(new ArrayBuffer(8));
      bits.setFloat64(0, original, false);
      put(`ob${bits.getBigUint64(0, false).toString(16).padStart(16, "0")}`);
    }
    const q = Object.create(Rational.prototype) as Rational;
    Object.defineProperties(q, {
      n: { value: n, enumerable: true },
      d: { value: d, enumerable: true },
      ...(od ? { original: { value: original, enumerable: true } } : {}),
    });
    return Object.freeze(q);
  };
  try {
    const copy = array(parts).map((part) => {
      const rings = array(part).map((ring) => {
        const points = array(ring).map((point) => {
          const coords = array(point);
          if (coords.length !== 2) throw abort;
          const q = coords.map(scalar) as [Rational, Rational];
          put("]");
          return Object.freeze(q);
        });
        put("]");
        return Object.freeze(points);
      });
      put("]");
      return Object.freeze(rings);
    }) as NativeRationalParts;
    put("]");
    return {
      parts: Object.freeze(copy) as NativeRationalParts,
      key: chunks.join(""),
      storageCharge,
    };
  } catch (error) {
    if (error === abort) return undefined;
    throw error;
  }
}

/** A cache entry never exposes its stored result. Every replay gets a fresh
 * deep immutable snapshot, including its Rational/source-bit metadata. */
function fresh(parts: NativeRationalParts): NativeRationalParts {
  const out = parts.map((part) => {
    const rings = part.map((ring) => {
      const points = ring.map((point) => {
        const coords = point.map((value) => {
          const q = Object.create(Rational.prototype);
          Object.defineProperty(q, "n", { value: value.n, enumerable: true });
          Object.defineProperty(q, "d", { value: value.d, enumerable: true });
          if (Object.hasOwn(value, "original"))
            Object.defineProperty(q, "original", {
              value: value.original,
              enumerable: true,
            });
          return Object.freeze(q);
        });
        return Object.freeze(coords);
      });
      return Object.freeze(points);
    });
    return Object.freeze(rings);
  });
  return Object.freeze(out) as NativeRationalParts;
}

export function createExactDoorApproachUnionMemo(
  options: Limits = {},
  execute: Execute = (subject, part) =>
    nativeRationalOverlay("union", subject, part),
) {
  const maxEntries = options.maxEntries ?? 64,
    maxRetainedBytes = options.maxRetainedBytes ?? 16 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    maxEntries > 256 ||
    !Number.isSafeInteger(maxRetainedBytes) ||
    maxRetainedBytes < 0 ||
    maxRetainedBytes > 64 * 1024 * 1024
  )
    throw Error("Invalid bounded exact-union memo limits");
  const entries = new Map<
    string,
    { result: NativeRationalParts; charge: number }
  >();
  let retainedBytes = 0,
    hits = 0,
    misses = 0,
    bypasses = 0,
    evictions = 0;
  return {
    union(
      subject: NativeRationalParts,
      part: NativeRationalParts,
    ): NativeRationalParts {
      if (!maxEntries || !maxRetainedBytes) {
        bypasses++;
        return execute(subject, part);
      }
      const left = snapshot(subject, maxRetainedBytes),
        right = snapshot(part, maxRetainedBytes);
      if (!left || !right) {
        bypasses++;
        return execute(subject, part);
      }
      // Structure, every exact scalar and operand order belong to the key.
      const key = `exact-door-union-v1:A${left.key}B${right.key}`,
        existing = entries.get(key);
      if (existing) {
        hits++;
        entries.delete(key);
        entries.set(key, existing);
        return fresh(existing.result);
      }
      misses++;
      // Exceptions/unknown results are never turned into cached positive roles.
      // The original Boolean still runs; no caller/host/floor guard is skipped.
      const result = execute(left.parts, right.parts),
        saved = snapshot(result, maxRetainedBytes);
      if (!saved) {
        bypasses++;
        return result;
      }
      const charge = 96 + key.length * 2 + saved.storageCharge;
      if (charge <= maxRetainedBytes) {
        while (
          entries.size >= maxEntries ||
          retainedBytes + charge > maxRetainedBytes
        ) {
          const oldest = entries.keys().next().value!;
          retainedBytes -= entries.get(oldest)!.charge;
          entries.delete(oldest);
          evictions++;
        }
        entries.set(key, { result: saved.parts, charge });
        retainedBytes += charge;
      } else bypasses++;
      return fresh(saved.parts);
    },
    stats() {
      return Object.freeze({
        entries: entries.size,
        retainedBytes,
        hits,
        misses,
        bypasses,
        evictions,
        maxEntries,
        maxRetainedBytes,
      });
    },
  };
}
