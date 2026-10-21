import test from "node:test";
import assert from "node:assert/strict";
import {
  Rational,
  nativeRationalOverlay,
  type NativeRationalParts as Parts,
} from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalPointInParts } from "../lib/reviter/native-exact-planar-topology.ts";
import { createExactDoorApproachUnionMemo } from "../lib/reviter/native-door-approach-exact-union-memo.ts";
const q = (n: number | bigint, d = 1n) => new Rational(BigInt(n), d);
const rect = (x0: number, y0: number, x1: number, y1: number): Parts => [
  [
    [
      [q(x0), q(y0)],
      [q(x1), q(y0)],
      [q(x1), q(y1)],
      [q(x0), q(y1)],
    ],
  ],
];
const encode = (parts: Parts) =>
  parts.map((p) =>
    p.map((r) =>
      r.map((c) =>
        c.map((v) => [
          v.n.toString(),
          v.d.toString(),
          Object.hasOwn(v, "original")
            ? v.original === undefined
              ? "undefined"
              : Object.is(v.original, -0)
                ? "-0"
                : String(v.original)
            : "absent",
        ]),
      ),
    ),
  );
const same = (a: Parts, b: Parts) => assert.deepEqual(encode(a), encode(b));

test("a complete exact union retains a hole and receives fresh deeply immutable cache results", () => {
  const a = rect(0, 0, 10, 10),
    b = rect(9, 4, 12, 6);
  a[0]!.push(rect(3, 3, 7, 7)[0]![0]!);
  const expected = nativeRationalOverlay("union", a, b);
  let calls = 0;
  const memo = createExactDoorApproachUnionMemo({}, (x, y) => {
    calls++;
    return nativeRationalOverlay("union", x, y);
  });
  const first = memo.union(a, b),
    second = memo.union(a, b);
  same(first, expected);
  same(second, expected);
  assert.equal(calls, 1);
  assert.notEqual(first, second);
  assert.notEqual(first[0]![0]![0]![0], second[0]![0]![0]![0]);
  assert.equal(
    nativeRationalPointInParts([5, 5], second),
    false,
    "original enclosed void remains a refusal",
  );
  assert.equal(nativeRationalPointInParts([11, 5], second), true);
  assert.throws(() => ((first[0]![0]![0]![0] as { n: bigint }).n = 999n));
  assert.throws(() => first[0]![0]!.push([q(999), q(999)]));
  same(memo.union(a, b), expected);
});

test("both operands, ring order and optional source IEEE bit ledger belong to the content key", () => {
  const a = rect(0, 0, 4, 4),
    b = rect(4, 1, 6, 3);
  let calls = 0;
  const memo = createExactDoorApproachUnionMemo({}, (x, y) => {
    calls++;
    return nativeRationalOverlay("union", x, y);
  });
  same(memo.union(a, b), nativeRationalOverlay("union", a, b));
  same(memo.union(b, a), nativeRationalOverlay("union", b, a));
  const rotate = rect(0, 0, 4, 4);
  rotate[0]![0]!.push(rotate[0]![0]!.shift()!);
  same(memo.union(rotate, b), nativeRationalOverlay("union", rotate, b));
  Object.defineProperty(a[0]![0]![0]![0], "original", {
    value: -0,
    writable: true,
    enumerable: true,
  });
  same(memo.union(a, b), nativeRationalOverlay("union", a, b));
  (a[0]![0]![0]![0] as unknown as { original: number }).original = 0;
  same(memo.union(a, b), nativeRationalOverlay("union", a, b));
  assert.equal(calls, 5, "no operand-order/ring-order/source-bit alias");
});

test("a real sub-ULP gap and later subject/operand mutations cannot inherit the old joined result", () => {
  const a = rect(0, 0, 4, 4),
    b = rect(4, 1, 6, 3);
  const memo = createExactDoorApproachUnionMemo();
  assert.equal(memo.union(a, b).length, 1);
  const den = 1n << 120n;
  b[0]![0]![0]![0] = q(4n * den + 1n, den);
  b[0]![0]![3]![0] = q(4n * den + 1n, den);
  const separated = memo.union(a, b);
  same(separated, nativeRationalOverlay("union", a, b));
  assert.equal(
    separated.length,
    2,
    "a gap smaller than IEEE resolution remains a disconnected union",
  );
  a[0]![0]![1]![0] = q(5);
  a[0]![0]![2]![0] = q(5);
  const joined = memo.union(a, b);
  same(joined, nativeRationalOverlay("union", a, b));
  assert.equal(joined.length, 1);
  assert.equal(memo.stats().hits, 0);
});

test("disconnected/refused results and exceptions preserve ordinary refusal behavior", () => {
  const a = rect(0, 0, 1, 1),
    b = rect(2, 0, 3, 1),
    memo = createExactDoorApproachUnionMemo();
  for (let i = 0; i < 2; i++)
    assert.equal(memo.union(a, b).length === 1, false);
  assert.equal(
    memo.stats().hits,
    1,
    "a cached disconnected union stays disconnected",
  );
  let calls = 0;
  const failed = createExactDoorApproachUnionMemo({}, () => {
    calls++;
    throw Error("unknown original Face/target");
  });
  for (let i = 0; i < 2; i++)
    assert.throws(() => failed.union(a, b), /unknown original Face\/target/);
  assert.equal(calls, 2);
  assert.equal(failed.stats().entries, 0);
  const floats = [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ],
  ] as unknown as Parts;
  same(memo.union(floats, b), nativeRationalOverlay("union", floats, b));
  assert.equal(
    memo.stats().bypasses,
    1,
    "floats never form a memo key; original operation still decides",
  );
});

test("cache entry and retention charges stay bounded, with unchanged ordinary bypass", () => {
  const a = rect(0, 0, 1, 1),
    memo = createExactDoorApproachUnionMemo({
      maxEntries: 2,
      maxRetainedBytes: 20000,
    });
  for (let i = 0; i < 5; i++) {
    const b = rect(i + 2, 0, i + 3, 1);
    same(memo.union(a, b), nativeRationalOverlay("union", a, b));
  }
  assert.equal(memo.stats().entries, 2);
  assert.equal(memo.stats().evictions, 3);
  assert(memo.stats().retainedBytes <= 20000);
  const tiny = createExactDoorApproachUnionMemo({ maxRetainedBytes: 64 });
  same(
    tiny.union(a, rect(1, 0, 2, 1)),
    nativeRationalOverlay("union", a, rect(1, 0, 2, 1)),
  );
  assert.equal(tiny.stats().entries, 0);
  assert.equal(tiny.stats().bypasses, 1);
  const bytes = createExactDoorApproachUnionMemo({
    maxEntries: 64,
    maxRetainedBytes: 4000,
  });
  for (let i = 0; i < 5; i++) bytes.union(a, rect(i + 2, 0, i + 3, 1));
  assert(bytes.stats().retainedBytes <= 4000);
  assert(bytes.stats().evictions > 0 || bytes.stats().bypasses > 0);
});

test("input snapshots and stored results cannot be polluted by the operation or a returned result", () => {
  const a = rect(0, 0, 2, 2),
    b = rect(2, 0, 4, 2),
    expected = nativeRationalOverlay("union", a, b);
  let raw: Parts | undefined;
  const memo = createExactDoorApproachUnionMemo({}, (x, y) => {
    assert.throws(() => x[0]![0]!.push([q(9), q(9)]));
    assert.throws(() => ((y[0]![0]![0]![0] as { n: bigint }).n = 999n));
    raw = nativeRationalOverlay("union", x, y);
    return raw;
  });
  same(memo.union(a, b), expected);
  // The original operation's retained mutable output has no access to cache.
  raw![0]![0]!.push([q(999), q(999)]);
  same(memo.union(a, b), expected);
  assert.equal(memo.stats().hits, 1);
  for (const p of [...a, ...b])
    for (const ring of p)
      for (const c of ring)
        for (const v of c)
          v.toJSON = () => {
            throw Error("toJSON must not run");
          };
  same(memo.union(a, b), expected);
  assert.equal(memo.stats().hits, 2);
});
