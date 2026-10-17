import assert from "node:assert/strict";
import test from "node:test";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
import {
  originalRectangularMullionEnvelopeDependencies,
  certifyOriginalRectangularMullionSourceEnvelope,
  originalRectangularMullionSourceEnvelopeFact,
  type OriginalRectangularMullionSourceEnvelope,
} from "../lib/reviter/native-source-rectangular-mullion-envelope.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
} from "../lib/reviter/element-id-width.ts";
import { activeClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";

const matchingSource =
  "8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178";
test("a source hash and serialized original category/frame claims cannot manufacture a native constructor context", () => {
  for (const fake of [
    {},
    {
      sourceModelSha256: matchingSource,
      sourceSchemaSha256:
        "d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f",
      sourceCensusSha256: "a".repeat(64),
      nativeElementId: 2465315,
      originalCategoryDeclarations: [-2000171],
      completeOriginalNativeAndGraphicsRecipe: true,
    },
  ]) {
    const census = fake as unknown as OriginalNativeForeignEnvelopeCensus;
    const dependency = originalRectangularMullionEnvelopeDependencies(
        census,
        2465315,
      ),
      proof = certifyOriginalRectangularMullionSourceEnvelope(census, 2465315);
    assert.equal(dependency.ok, false);
    assert.equal(proof.ok, false);
    if (!proof.ok)
      assert.match(
        proof.blockers.join(";"),
        /Untrusted original foreign envelope census/,
      );
  }
});
test("cloned material receipts and certificates cannot supply an original source fact", () => {
  const census = {} as OriginalNativeForeignEnvelopeCensus;
  const forged = {
    nativeElementId: 2465315,
    sourceModelSha256: matchingSource,
    sourceRecipeSha256: "a".repeat(64),
    use: "foreign-material-envelope-only",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    sourceConstructionEnvelopeApproved: true,
  };
  assert.throws(
    () =>
      originalRectangularMullionSourceEnvelopeFact(
        census,
        forged as unknown as OriginalRectangularMullionSourceEnvelope,
      ),
    /Untrusted or foreign/,
  );
});
test("source refusal preserves another conversion's element-id layout and class translation", () => {
  const priorWidth = activeElementIdBytes(),
    priorTranslation = activeClassTagTranslation();
  try {
    setActiveElementIdBytes(4);
    assert.equal(
      certifyOriginalRectangularMullionSourceEnvelope(
        {} as OriginalNativeForeignEnvelopeCensus,
        2465315,
      ).ok,
      false,
    );
    assert.equal(activeElementIdBytes(), 4);
    assert.equal(activeClassTagTranslation(), priorTranslation);
  } finally {
    setActiveElementIdBytes(priorWidth);
  }
});
