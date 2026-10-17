import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Rational } from "../lib/reviter/native-rational-overlay.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalCurtainHostTypedFifo } from "../lib/reviter/native-source-curtain-host.ts";
import {
  inspectSimpleSystemPanelFrames,
  simplePanelAffinePadding,
  inspectOriginalNativeSimpleSystemPanelEnvelope,
  certifyOriginalSimpleSystemPanelSourceEnvelope,
  originalSimpleSystemPanelSourceEnvelopeFact,
  type NativeSimplePanelFrames,
} from "../lib/reviter/native-source-simple-system-panel.ts";
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/native-simple-panel-constructor-sources.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  cases: {
    nativeInstanceId: number;
    files: Record<string, { name: string }>;
  }[];
};
const fixture = (id: number): NativeSimplePanelFrames => {
  const c = manifest.cases.find((c) => c.nativeInstanceId === id)!;
  return {
    schema: readFileSync(
      new URL(
        "./fixtures/native-drawing-reference-source-schema.bin",
        import.meta.url,
      ),
    ),
    ...Object.fromEntries(
      Object.entries(c.files).map(([key, f]) => [
        key,
        readFileSync(new URL("./fixtures/" + f.name, import.meta.url)),
      ]),
    ),
  } as unknown as NativeSimplePanelFrames;
};
function rewriteChecksum(bytes: Buffer) {
  const n = bytes.readUInt32LE(12);
  let a = 1,
    b = 0;
  for (let i = 16; i < n + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  bytes.writeUInt32LE((b * 65536 + a) >>> 0, 8);
}
test("actual mode0 direct native current-cell reconstruction preserves source parameters without absence authority", () => {
  const r = inspectSimpleSystemPanelFrames(fixture(1514624));
  assert.ok(r.ok);
  assert.equal(r.originalSystemPanelMode, 0);
  assert.equal(r.profileDomainRecipe, "original-finite-cell-domain");
  assert.equal(r.originalSourceFaceTag, 59);
  assert.equal(r.sourceIssuedMaterialEnclosureApproved, false);
  assert.equal(r.sourceAuthorityGranted, false);
  assert.equal(r.originalSavedBodyControl.sourceFaceCount, 0);
  assert.equal(r.conservativeMaterialBoxesFeet.length, 1);
  assert.ok(r.worldAxisPaddingFeet.every((x) => x.n > 0n));
});
test("actual inverted native cell domain stays inverted while complete exact predecessor input bounds are retained", () => {
  const r = inspectSimpleSystemPanelFrames(fixture(2320983));
  assert.ok(r.ok);
  assert.equal(
    r.profileDomainRecipe,
    "complete-original-predecessor-grid-input",
  );
  assert.deepEqual(r.originalDeclaredCellDomain, {
    firstCorner: [1, 1],
    secondCorner: [0, 0],
  });
  assert.ok(r.retainedPredecessorProfileOperands.length > 0);
  assert.ok(r.retainedCurrentCellEdgeReferences.length > 0);
  assert.equal(r.sourceIssuedMaterialEnclosureApproved, false);
});
test("independent actual nonempty SAME-MODE body fits wholly in one convex constructor envelope", () => {
  const r = inspectSimpleSystemPanelFrames(fixture(1514626));
  assert.ok(r.ok);
  assert.equal(r.originalSystemPanelMode, 0);
  assert.equal(r.originalSavedBodyControl.sourceFaceCount, 6);
  assert.equal(r.originalSavedBodyControl.sourceEdgeCount, 12);
  assert.equal(r.originalSavedBodyControl.originalEndpointEmbeddingCount, 72);
  assert.equal(
    r.originalSavedBodyControl.retainedSavedBodyFillingAttributes.length,
    6,
  );
  assert.equal(
    r.originalSavedBodyControl.wholeSavedBodyInsideOneConvexConstructorBox,
    true,
  );
  assert.equal(r.routeApproved, false);
});
test("affine padding retains nonuniform scale, reflection and shear with exact row-absolute sums", () => {
  const r = simplePanelAffinePadding(
    [
      [-2, 0, 0],
      [0, 3, 0],
      [0, 0, 0.5],
    ],
    0.25,
    0.5,
  );
  assert.deepEqual(r.worldAxisPaddingFeet, [
    new Rational(3n, 2n),
    new Rational(9n, 4n),
    new Rational(3n, 8n),
  ]);
  const s = simplePanelAffinePadding(
    [
      [1, -2, 3],
      [0, 1, 0],
      [0, 0, 1],
    ],
    0.25,
    -0.5,
  );
  assert.deepEqual(s.worldAxisPaddingFeet[0], new Rational(9n, 2n));
  assert.throws(
    () =>
      simplePanelAffinePadding(
        [
          [0, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        0.1,
        0.2,
      ),
    /Singular/,
  );
});
test("a changed final subdivision version or extending source range refuses the sentinel fallback", () => {
  for (const defect of ["version", "extension"]) {
    const f = fixture(2320983),
      schema = readSchema(f.schema);
    assert.ok(schema.ok);
    const h = readOriginalCurtainHostTypedFifo(
      f.hostNative,
      schema.schema,
      "SWall",
    );
    assert.ok(h.ok);
    const divide = h.value.entries.find(
        (e) => e.sourceClassName === "CGridDivideFaceGStep",
      )!,
      field = divide.fields.find((f) =>
        defect === "version"
          ? f.path === "CGridDivideFaceGStep.m_version"
          : f.path.includes("m_originalToEdgeSegs") &&
            f.path.endsWith(".m_end"),
      )!;
    const input = Buffer.from(f.hostNative);
    if (defect === "version") input.writeInt32LE(17, field.start);
    else input.writeDoubleLE(1.25, field.start);
    rewriteChecksum(input);
    const r = inspectSimpleSystemPanelFrames({ ...f, hostNative: input });
    assert.equal(r.ok, false, defect);
  }
});
test("untrusted source context and arbitrary saved geometry never issue original panel authority", () => {
  const r = inspectOriginalNativeSimpleSystemPanelEnvelope(
    {} as never,
    1514624,
  );
  assert.equal(r.ok, false);
  const f = fixture(1514624),
    b = Buffer.from(f.instanceGElement);
  b[b.length - 5] ^= 1;
  const changed = inspectSimpleSystemPanelFrames({ ...f, instanceGElement: b });
  assert.equal(changed.ok, false);
});

test("missing native input role, missing tagged input Face and swapped output V/U cannot borrow a predecessor domain", () => {
  for (const defect of ["input-role", "missing-input", "output-uv"]) {
    const f = fixture(2320983),
      schema = readSchema(f.schema);
    assert.ok(schema.ok);
    const host = readOriginalCurtainHostTypedFifo(
      f.hostNative,
      schema.schema,
      "SWall",
    );
    assert.ok(host.ok);
    const previous = host.value.entries.find(
        (e) => e.sourceClassName === "CWallGridFaceGStep",
      )!,
      divide = host.value.entries.find(
        (e) => e.sourceClassName === "CGridDivideFaceGStep",
      )!,
      ih = previous.value.m_faceHistTable as {
        m_id: number;
        m_faceHist: { m_keys: number[] };
      }[],
      oh = divide.value.m_faceHistTable as {
        m_id: number;
        m_faceHist: { m_keys: number[] };
      }[],
      i = ih.findIndex(
        (x) => JSON.stringify(x.m_faceHist.m_keys) === "[14,-1,-1]",
      ),
      j = oh.findIndex((x) => x.m_id === 67),
      input = Buffer.from(f.hostNative);
    const field =
      defect === "input-role"
        ? previous.fields.find(
            (f) =>
              f.path ===
              `CWallGridFaceGStep.m_faceHistTable[${i}].m_faceHist.m_keys[0]`,
          )!
        : defect === "missing-input"
          ? previous.fields.find(
              (f) => f.path === `CWallGridFaceGStep.m_faceHistTable[${i}].m_id`,
            )!
          : divide.fields.find(
              (f) =>
                f.path ===
                `CGridDivideFaceGStep.m_faceHistTable[${j}].m_faceHist.m_keys[1]`,
            )!;
    input.writeInt32LE(
      defect === "input-role" ? 15 : defect === "missing-input" ? 987654 : 1,
      field.start,
    );
    rewriteChecksum(input);
    const r = inspectSimpleSystemPanelFrames({ ...f, hostNative: input });
    assert.equal(r.ok, false, defect);
  }
});

test("only private actual-census construction can issue or consume a panel material enclosure", () => {
  assert.equal(
    certifyOriginalSimpleSystemPanelSourceEnvelope({} as never, 1514624).ok,
    false,
  );
  const pure = inspectSimpleSystemPanelFrames(fixture(1514624));
  assert.ok(pure.ok);
  assert.throws(
    () =>
      originalSimpleSystemPanelSourceEnvelopeFact({} as never, pure as never),
    /census-bound/,
  );
});

test("checksummed changed native operator flags, parent reference and extra operand cannot issue a simple panel replay", () => {
  for (const sourceClass of ["CGridDivideFaceGStep", "CWallGridFaceGStep"])
    for (const defect of ["m_flags", "m_pElem", "m_oExtraDatas"]) {
      const f = fixture(2320983),
        schema = readSchema(f.schema);
      assert.ok(schema.ok);
      const parsed = readOriginalCurtainHostTypedFifo(
        f.hostNative,
        schema.schema,
        "SWall",
      );
      assert.ok(parsed.ok);
      const step = parsed.value.entries.find(
          (e) => e.sourceClassName === sourceClass,
        )!,
        field = step.fields.find((f) => f.path === `${sourceClass}.${defect}`)!;
      assert.ok(field);
      const b = Buffer.from(f.hostNative);
      b.writeInt32LE(
        defect === "m_flags" ? 761724 : defect === "m_pElem" ? 3 : 1,
        field.start,
      );
      rewriteChecksum(b);
      const r = inspectSimpleSystemPanelFrames({ ...f, hostNative: b });
      assert.equal(r.ok, false, `${sourceClass}.${defect}`);
    }
});

test("original GInstance selectors and native instancing consumer cannot be waived by equal affine values", async () => {
  const { decodeRevit2027FramedGRepRoot } = await import(
      "../lib/reviter/revit-2027-framed-grep-root.ts"
    ),
    { replayRevit2027GRepFifo } = await import(
      "../lib/reviter/revit-2027-grep-replay.ts"
    );
  const f = fixture(1514624),
    bytes = Buffer.from(f.instanceGElement),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: 1514624,
        marker: 2246,
        objectLength: bytes.length - 20,
        typeCode: bytes.readUInt32LE(18),
      },
      2027,
    );
  assert.ok(root.ok);
  const replay = replayRevit2027GRepFifo(bytes, root.value);
  assert.ok(replay.ok);
  const instance = replay.value.spans.find(
      (s) => s.readerId === "Revit2027GInstance",
    )!.value as { endOffset: number },
    info = replay.value.spans.find(
      (s) => s.readerId === "Revit2027InstanceInfo",
    )!.value as { endOffset: number };
  for (const defect of ["resolve", "scale", "forbidden", "cda"]) {
    const b = Buffer.from(bytes);
    if (defect === "resolve") b.writeUInt8(1, instance.endOffset - 2);
    else if (defect === "scale") b.writeUInt8(1, instance.endOffset - 1);
    else if (defect === "forbidden") b.writeInt32LE(1, instance.endOffset - 6);
    else b.writeInt32LE(2, info.endOffset - 4);
    rewriteChecksum(b);
    const result = inspectSimpleSystemPanelFrames({
      ...f,
      instanceGElement: b,
    });
    assert.equal(result.ok, false, defect);
    if (!result.ok)
      assert.match(result.blockers.join(" "), /occurrence branches/);
  }
});
