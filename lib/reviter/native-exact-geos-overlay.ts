import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import initialize, {
  type NativeModule,
} from "./vendor/native-exact-geos/native-exact-geos.mjs";
type Point = [number, number];
type Rings = Point[][];
type Geometry = {
  type: string;
  coordinates?: Rings | Rings[];
  geometries?: Geometry[];
};
export type NativeExactAdjustment = {
  kind: 1 | 2;
  operand: number;
  p: Point;
  q: Point;
  distance: number;
  bound: number;
  accepted: boolean;
};
export type NativeExactOverlayEvidence = {
  engine: "native-local4ulp-geos-v1";
  wasmSha256: string;
  operation: "difference" | "intersection" | "union";
  strategy?: "sequential-difference";
  maskOrder?: "reverse";
  originalOperandsSha256: string;
  adjustments: NativeExactAdjustment[];
  originalVertexClustersChecked: number;
  declined: number;
};
export type NativeExactOverlayInput = {
  binding: string;
  operation: NativeExactOverlayEvidence["operation"];
  subject: Rings[];
  operands: Rings[][];
  strategy?: "sequential-difference";
  maskOrder?: "reverse";
};
export const NATIVE_EXACT_GEOS_VERSION = "native-local4ulp-geos-v1";
const WASM_SHA =
  "2beb9e41b0d0efd6b9ab6dbb2dad62d96041f3fc1119c0360e855be10a63797a";
export const NATIVE_EXACT_GEOS_BINDING = `${NATIVE_EXACT_GEOS_VERSION}:${WASM_SHA}`;
let ready: NativeModule | undefined, preparation: Promise<void> | undefined;
let recorder: ((evidence: NativeExactOverlayEvidence) => void) | undefined;
let inputRecorder: ((input: NativeExactOverlayInput) => void) | undefined;
export function setNativeExactGeosOverlayRecorder(next: typeof recorder) {
  const previous = recorder;
  recorder = next;
  return previous;
}
/** Explicit diagnostics only. The callback receives an independent snapshot
 * before the engine runs, including operations which subsequently reject.
 * Editing or retaining that snapshot cannot mutate the original operands. */
export function setNativeExactGeosOverlayInputRecorder(next: typeof inputRecorder) {
  const previous = inputRecorder;
  inputRecorder = next;
  return previous;
}
/** One checked module per worker/compiler operation context. Failure remains
 * explicit; a synchronous geometry call never starts async initialization. */
export function initializeNativeExactGeosOverlay(): Promise<void> {
  return (preparation ??= (async () => {
    const url = new URL(
      "./vendor/native-exact-geos/native-exact-geos.wasm",
      import.meta.url,
    );
    const node = !!(
      globalThis as typeof globalThis & {
        process?: { versions?: { node?: string } };
      }
    ).process?.versions?.node;
    let bytes: Uint8Array;
    if (node) {
      const name = "node:fs/promises";
      const fs = (await import(/* @vite-ignore */ name)) as {
        readFile: (url: URL) => Promise<Uint8Array>;
      };
      bytes = new Uint8Array(await fs.readFile(url));
    } else {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("The checked native overlay engine could not load.");
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytesToHex(sha256(bytes)) !== WASM_SHA)
      throw new Error("The native overlay engine checksum does not match.");
    // The generated bootstrap does not consume its wasmBinary option. Bind
    // instantiation explicitly to the checked bytes, avoiding a second fetch.
    const compiledModule = await WebAssembly.compile(bytes as BufferSource);
    ready = await initialize({
      wasmBinary: bytes,
      locateFile: () => url.href,
      instantiateWasm: (imports, receive) => {
        const instance = new WebAssembly.Instance(compiledModule, imports);
        receive(instance);
        return instance.exports;
      },
    });
  })());
}
export const nativeExactGeosOverlayInitialized = () => !!ready;
const closed = (rings: Rings): Rings =>
  rings.map((r) =>
    r.length && (r[0][0] !== r.at(-1)![0] || r[0][1] !== r.at(-1)![1])
      ? [...r, r[0]]
      : r,
  );
const polygon = (rings: Rings): Geometry => ({
  type: "Polygon",
  coordinates: closed(rings),
});
const multi = (parts: Rings[]): Geometry => ({
  type: "MultiPolygon",
  coordinates: parts.map(closed),
});
const polygons = (g: Geometry): Rings[] => {
  if (g.type === "Polygon")
    return (g.coordinates as Rings)[0]?.length ? [g.coordinates as Rings] : [];
  if (g.type === "MultiPolygon")
    return (g.coordinates as Rings[]).filter((p) => p[0]?.length);
  if (g.type === "GeometryCollection")
    return (g.geometries ?? []).flatMap(polygons);
  if (["Point", "MultiPoint", "LineString", "MultiLineString"].includes(g.type))
    return [];
  throw new Error("Unclassifiable checked native overlay result.");
};
const bound = (p: Point, q: Point) =>
  4 * Number.EPSILON * Math.max(1, ...p.map(Math.abs), ...q.map(Math.abs));
/** Every original pair in a cumulative snap cluster is checked, preventing
 * a sequence of individually small changes from drifting distinct source vertices. */
function checkClusters(
  originals: Set<string>,
  changes: NativeExactAdjustment[],
) {
  const parent = new Map<string, string>(),
    key = (p: Point) => JSON.stringify(p);
  const root = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    const p = parent.get(k)!;
    if (p === k) return k;
    const r = root(p);
    parent.set(k, r);
    return r;
  };
  for (const r of changes) {
    if (
      r.accepted &&
      (r.distance > bound(r.p, r.q) ||
        Math.hypot(r.p[0] - r.q[0], r.p[1] - r.q[1]) > bound(r.p, r.q))
    )
      throw new Error(
        "A native overlay adjustment exceeded its original numerical contact bound.",
      );
    if (r.accepted && r.kind === 1) parent.set(root(key(r.p)), root(key(r.q)));
  }
  const clusters = new Map<string, string[]>();
  for (const k of parent.keys())
    if (originals.has(k)) {
      const r = root(k),
        group = clusters.get(r) ?? [];
      group.push(k);
      clusters.set(r, group);
    }
  for (const group of clusters.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const p = JSON.parse(group[i]) as Point,
          q = JSON.parse(group[j]) as Point;
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > bound(p, q))
          throw new Error(
            "Cumulative native overlay contacts collapse distinct original vertices.",
          );
      }
  return clusters.size;
}
/** Scoped fallback after an independent raw sweep failed. GEOS raw FLOATING
 * runs first. Its only numerical retry uses the audited custom noder: out-of-
 * bound contacts are declined, not snapped; validated output keeps every
 * finite component and original hole. No stock robust API, grid or buffer. */
export function nativeExactGeosOverlay(
  operation: NativeExactOverlayEvidence["operation"],
  subject: Rings[],
  operands: Rings[][],
  options?: { strategy: "sequential-difference"; maskOrder?: "reverse" },
): Rings[] {
  if (options && operation !== "difference")
    throw new Error("Sequential native overlay is only defined for difference.");
  if (!ready)
    throw new Error("The checked native overlay engine is not initialized.");
  const m = ready,
    adjustments: NativeExactAdjustment[] = [],
    originals = new Set<string>();
  for (const part of [...subject, ...operands.flat()])
    for (const ring of part)
      for (const p of ring) {
        if (p.length !== 2 || p.some((x) => !Number.isFinite(x)))
          throw new Error("Non-finite original native overlay coordinate.");
        originals.add(JSON.stringify(p));
      }
  inputRecorder?.({
    binding: NATIVE_EXACT_GEOS_BINDING,
    operation,
    subject: structuredClone(subject),
    operands: structuredClone(operands),
    ...(options ? { strategy: options.strategy, ...(options.maskOrder ? { maskOrder: options.maskOrder } : {}) } : {}),
  });
  const put = (g: Geometry) => {
    const text = JSON.stringify(g),
      size = m.lengthBytesUTF8(text) + 1,
      p = m._malloc(size);
    if (!p) throw new Error("Native overlay allocation failed.");
    m.stringToUTF8(text, p, size);
    return p;
  };
  const read = (ptr: number) => {
    try {
      return JSON.parse(m.UTF8ToString(ptr));
    } finally {
      m._free(ptr);
    }
  };
  const call = (
    kind: "union" | "difference" | "intersection",
    a: Geometry,
    b?: Geometry,
  ): Geometry => {
    const left = put(a);
    let right = 0,
      result = 0;
    try {
      if (b) right = put(b);
      result =
        kind === "union"
          ? m._native_union(left)
          : m._native_overlay(left, right, kind === "difference" ? 3 : 1);
      if (!result) {
        const error = m.UTF8ToString(m._native_last_error());
        if (!/TopologyException/.test(error)) throw new Error(error);
        result =
          kind === "union"
            ? m._native_bounded_snap_union(left, 1e-13)
            : m._native_bounded_snap_overlay(
                left,
                right,
                kind === "difference" ? 3 : 1,
                1e-13,
              );
        for (const adjustment of read(
          m._native_snap_records(),
        ) as NativeExactAdjustment[])
          adjustments.push(adjustment);
        if (!result) throw new Error(m.UTF8ToString(m._native_last_error()));
      }
      return read(result) as Geometry;
    } finally {
      m._free(left);
      if (right) m._free(right);
    }
  };
  const union = (parts: Rings[]): Geometry =>
    !parts.length
      ? multi([])
      : parts.length === 1
        ? polygon(parts[0])
        : call("union", multi(parts));
  let output: Geometry;
  if (operation === "union") output = union([...subject, ...operands.flat()]);
  else {
    output = union(subject);
    if (operation === "difference") {
      if (options?.strategy === "sequential-difference") {
        // Equivalent original-source set algebra when a combined obstacle
        // union cannot be classified. Keep every finite polygon remnant;
        // point/line contacts are outside this floor-only geometry contract.
        // All original input vertices remain in one cumulative cluster guard.
        for (const mask of options.maskOrder === "reverse"
          ? operands.flat().slice().reverse()
          : operands.flat()) {
          const parts = polygons(output);
          if (!parts.length) break;
          output = call("difference", multi(parts), polygon(mask));
        }
        if (subject.length === 1) {
          // Preserve the original single-floor hole postcondition explicitly.
          // Subtract each unchanged hole once; no buffer, ring repair, area
          // cutoff or repeated convergence loop. Reject any remaining polygon
          // overlap with an original hole rather than grant walking support.
          for (const hole of subject[0].slice(1)) {
            const parts = polygons(output);
            if (!parts.length) break;
            output = call("difference", multi(parts), polygon([hole]));
          }
          for (const hole of subject[0].slice(1))
            if (polygons(call("intersection", output, polygon([hole]))).length)
              throw new Error("Sequential native overlay did not preserve an original floor hole.");
        }
      } else if (operands.flat().length)
        output = call("difference", output, union(operands.flat()));
    } else
      for (const group of operands)
        output = call("intersection", output, union(group));
  }
  const originalVertexClustersChecked = checkClusters(originals, adjustments),
    result = polygons(output);
  for (const part of result)
    for (const ring of part)
      if (
        ring.some((p) => p.some((x) => !Number.isFinite(x))) ||
        new Set(ring.map((p) => JSON.stringify(p))).size < 3
      )
        throw new Error("Invalid finite native overlay ring.");
  recorder?.({
    engine: NATIVE_EXACT_GEOS_VERSION,
    wasmSha256: WASM_SHA,
    operation,
    ...(options ? { strategy: options.strategy, ...(options.maskOrder ? { maskOrder: options.maskOrder } : {}) } : {}),
    originalOperandsSha256: bytesToHex(
      sha256(new TextEncoder().encode(JSON.stringify([subject, operands]))),
    ),
    adjustments,
    originalVertexClustersChecked,
    declined: adjustments.filter((r) => !r.accepted).length,
  });
  return result;
}
