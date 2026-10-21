import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createOriginalNativeForeignEnvelopeCensus,
  originalNativeForeignEnvelopeFacts,
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
} from "../lib/reviter/native-source-foreign-envelope-census.ts";
const scope = {
  min: { x: -15, y: -328, z: 23 },
  max: { x: 6, y: -300, z: 42 },
};
test("forged census/copies and invalid diagnostic retention requests cannot create source authority", () => {
  for (const action of [
    () => originalNativeForeignEnvelopeFacts({} as never),
    () => readOriginalForeignEnvelopeScopedFrame({} as never, 2465236),
    () => readOriginalForeignEnvelopeScopedSemantic({} as never, 2465236, 3899),
  ])
    assert.throws(action, /Untrusted/);
  for (const ids of [
    [0],
    [-1],
    [0.5],
    [Infinity],
    [0x80000000],
    Array(4097).fill(1),
  ])
    assert.throws(
      () =>
        createOriginalNativeForeignEnvelopeCensus(
          new Uint8Array(0),
          "0".repeat(64),
          scope,
          undefined,
          ids,
        ),
      /requested original source frame/,
    );
});
const rvt = process.env.NATIVE_SLAB_SOURCE_RVT,
  reviewPath = process.env.NATIVE_DRAWING_SOURCE_REVIEW;
test(
  "complete actual-RVT census preserves physical materials and excludes only a fully qualified original view grid",
  { skip: !rvt || !reviewPath },
  () => {
    const bytes = readFileSync(rvt!),
      sha = createHash("sha256").update(bytes).digest("hex"),
      review = JSON.parse(readFileSync(reviewPath!, "utf8")),
      result = createOriginalNativeForeignEnvelopeCensus(
        bytes,
        sha,
        scope,
        review,
        [2465236, 1514623],
      ),
      cert = result.certificate,
      facts = originalNativeForeignEnvelopeFacts(cert);
    // Historical39798/c6787390… included the original virtual SketchGrid24930.
    // Fresh165-module exact-row audit preserves every other physical row;
    // EVIDENCE-028 retains the old census and complete source-role proof.
    assert.deepEqual(
      result.summary.originalViewGridNonPhysicalProofs.map(
        (p) => p.nativeElementId,
      ),
      [24930],
    );
    const grid = result.summary.originalViewGridNonPhysicalProofs[0]!;
    assert.equal(grid.originalViewId, 695);
    assert.equal(grid.originalNativeParentId, 316);
    assert.equal(
      grid.originalGElementSha256,
      "0f88252f46625a13370c7b7eef40268219cc4cfbeccc4125200cebdf217ecad3",
    );
    assert.equal(grid.drawingControlCommandQualified, false);
    assert.equal(grid.drawingUsedForPhysicalClearance, false);
    assert.equal(facts.rows.length, 39797);
    assert.equal(facts.unboundedSourceRecordCount, 68);
    // The full census receipt also hashes parser diagnostics. Bind the actual
    // physical rows and delegations independently so a data-retention request
    // cannot alter the preserved material population or authority.
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    assert.equal(
      digest(facts.rows),
      "e59852dd7c6885636064cb55b5f20b978f3557dbaa63755099e34f3f31c1ef9c",
    );
    assert.equal(
      digest(facts.delegatedOriginalContainers),
      "e11e5edf391c00d1b9dc2aabf0d7cbb64a513e6daa6b4d81d1268cd8d11882ef",
    );
    for (const [id, marker, expected] of [
      [
        2465236,
        3899,
        "c9e5e6cbc06f639a4d070af7346510cd7f433e250f9ae37e5a8cab2b7b3824a0",
      ],
      [1514623, 1049, undefined],
    ] as const) {
      const semantic = readOriginalForeignEnvelopeScopedSemantic(
        cert,
        id,
        marker,
      );
      assert.equal(semantic.nativeElementId, id);
      assert.equal(semantic.marker, marker);
      assert.equal(semantic.sourceModelSha256, sha);
      if (expected) assert.equal(semantic.originalFrameSha256, expected);
      const first = semantic.originalFrameBytes[0];
      semantic.originalFrameBytes[0] ^= 255;
      assert.equal(
        readOriginalForeignEnvelopeScopedSemantic(cert, id, marker)
          .originalFrameBytes[0],
        first,
      );
      const geometry = readOriginalForeignEnvelopeScopedFrame(cert, id);
      assert.ok(geometry.length > 40);
    }
    const originalId = facts.rows[0]!.nativeElementId;
    facts.rows[0]!.nativeElementId = 1;
    assert.equal(
      originalNativeForeignEnvelopeFacts(cert).rows[0]!.nativeElementId,
      originalId,
    );
    assert.throws(
      () => originalNativeForeignEnvelopeFacts({ ...cert } as never),
      /Untrusted/,
    );
  },
);
