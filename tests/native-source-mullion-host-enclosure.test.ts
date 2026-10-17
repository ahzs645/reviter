import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { readOriginalMullionSymbolTypedFifo } from "../lib/reviter/native-source-mullion-symbol.ts";
import { readOriginalCurtainHostTypedFifo } from "../lib/reviter/native-source-curtain-host.ts";
import { diagnoseOriginalHostedMullionEnclosure } from "../lib/reviter/native-source-mullion-host-enclosure.ts";

function setup() {
  const fixture = (name: string) =>
    readFileSync(new URL(`./fixtures/${name}.bin`, import.meta.url));
  const schema = readSchema(fixture("native-drawing-reference-source-schema"));
  assert.ok(schema.ok);
  return {
    schema: schema.schema,
    nativeInstance: fixture("native-original-mullion-instance-2465315"),
    nativeSymbol: fixture("native-original-mullion-symbol-1071725"),
    occurrenceGraphics: fixture(
      "native-original-mullion-instance-2465315-graphics",
    ),
    definitionGraphics: fixture(
      "native-original-mullion-symbol-1071725-graphics",
    ),
    nativeHost: fixture("native-original-mullion-host-2465236"),
    hostGraphics: fixture("native-original-mullion-host-2465236-graphics"),
  };
}
function checksum(frame: Buffer) {
  const n = frame.readUInt32LE(12);
  let a = 1,
    b = 0;
  for (let k = 16; k < n + 16; k++) {
    a = (a + frame[k]!) % 65521;
    b = (b + a) % 65521;
  }
  frame.writeUInt32LE((b * 65536 + a) >>> 0, 8);
}
test("a complete original hosted mullion produces only a non-authoritative, broad construction diagnostic", () => {
  const input = setup(),
    before = Buffer.from(input.nativeSymbol);
  const r = diagnoseOriginalHostedMullionEnclosure(input);
  assert.equal(
    r.status,
    "candidate",
    r.status === "refused" ? r.blockers.join("; ") : undefined,
  );
  if (r.status !== "candidate") return;
  assert.equal(r.nativeElementId, 2465315);
  assert.equal(r.nativeDefinitionId, 1071725);
  assert.equal(r.nativeHostId, 2465236);
  assert.equal(r.sourceEdgeTag, 252);
  assert.equal(r.sourceGeneratorContainmentApproved, false);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.physicalAbsenceApproved, false);
  assert.equal(r.routeApproved, false);
  assert.equal("boundsFeet" in r, false);
  // The entire host is padded, rather than only a cap at the instance origin.
  for (const [axis, key] of [
    [0, "x"],
    [1, "y"],
    [2, "z"],
  ] as const) {
    assert.ok(
      r.candidateBoundsFeet.min[key] < r.originalWholeHostBounds.minimum[axis]!,
    );
    assert.ok(
      r.candidateBoundsFeet.max[key] > r.originalWholeHostBounds.maximum[axis]!,
    );
  }
  assert.deepEqual(input.nativeSymbol, before);
});
test("a valid checksum cannot hide changed generator, trim, flip or host edge operands", () => {
  for (const [root, path, value] of [
    ["symbol", "MullionSymFamRef.m_flip", 2],
    ["symbol", "MullionSymFamRef.m_rotationAngle", 1],
    ["symbol", "SysMullionFamSym.m_stretchCount", 1],
    ["instance", "MullionFamRef.m_edgeTag", 999999],
    ["instance", "MullionFamRef.m_driverId", 42],
  ] as const) {
    const input = setup(),
      bytes = root === "symbol" ? input.nativeSymbol : input.nativeInstance;
    const replay = readOriginalMullionSymbolTypedFifo(
      bytes,
      input.schema,
      root === "symbol" ? "SysMullionFamSym" : "FamilyInstance",
    );
    assert.ok(replay.ok);
    const field = [
      ...replay.value.rootFields,
      ...replay.value.entries.flatMap((e) => e.fields),
    ].find((f) => f.path === path)!;
    assert.ok(field, path);
    if (field.end - field.start === 1) bytes.writeInt8(value, field.start);
    else if (field.end - field.start === 4)
      bytes.writeInt32LE(value, field.start);
    else if (field.end - field.start === 8)
      bytes.writeDoubleLE(value, field.start);
    else assert.fail("Unsupported test mutation width");
    checksum(bytes);
    assert.equal(
      diagnoseOriginalHostedMullionEnclosure(input).status,
      "refused",
      path,
    );
  }
});
test("both Boolean profile flips stay enclosed by the same symmetric diagnostic without granting generator authority", () => {
  const input = setup(),
    before = diagnoseOriginalHostedMullionEnclosure(input);
  assert.equal(before.status, "candidate");
  const replay = readOriginalMullionSymbolTypedFifo(
    input.nativeSymbol,
    input.schema,
  );
  assert.ok(replay.ok);
  const field = replay.value.entries
    .flatMap((e) => e.fields)
    .find((f) => f.path === "MullionSymFamRef.m_flip")!;
  input.nativeSymbol.writeInt8(1, field.start);
  checksum(input.nativeSymbol);
  const after = diagnoseOriginalHostedMullionEnclosure(input);
  assert.equal(after.status, "candidate");
  if (before.status !== "candidate" || after.status !== "candidate") return;
  assert.deepEqual(after.candidateBoundsFeet, before.candidateBoundsFeet);
  assert.equal(after.originalProfileFlip, 1);
  assert.equal(after.originalSourceAuthorityGranted, false);
  assert.equal(after.sourceGeneratorContainmentApproved, false);
});
test("foreign hosts, source corruption and truncated or additional persisted graphics refuse", () => {
  for (const change of [
    (i: ReturnType<typeof setup>) => {
      i.nativeHost.writeBigInt64LE(123n, 0);
      checksum(i.nativeHost);
    },
    (i: ReturnType<typeof setup>) => {
      i.nativeSymbol[200] ^= 1;
    },
    (i: ReturnType<typeof setup>) => {
      i.definitionGraphics = i.definitionGraphics.subarray(0, -1);
    },
    (i: ReturnType<typeof setup>) => {
      i.occurrenceGraphics = Buffer.concat([
        i.occurrenceGraphics,
        Buffer.from([0]),
      ]);
    },
  ]) {
    const input = setup();
    change(input);
    assert.equal(
      diagnoseOriginalHostedMullionEnclosure(input).status,
      "refused",
    );
  }
});
test("a changed native host range, current membership or join record keeps the original foreign material unresolved", () => {
  for (const [path, value, width] of [
    [
      "CGridDivideFaceGStep.m_originalToEdgeSegs[4].second.m_edgeSegs[0].m_end",
      2,
      8,
    ],
    ["CGDriverMullionData.m_mullionsById[2].m_mullionId.m_id.m_id64", 123, 8],
    ["WallCGDriver.m_mullionJoinId", 1, 4],
  ] as const) {
    const input = setup(),
      replay = readOriginalCurtainHostTypedFifo(
        input.nativeHost,
        input.schema,
        "SWall",
      );
    assert.ok(replay.ok);
    const field = [
      ...replay.value.rootFields,
      ...replay.value.entries.flatMap((e) => e.fields),
    ].find((f) => f.path === path);
    assert.ok(field, path);
    assert.equal(field.end - field.start, width);
    if (path.endsWith("m_id64"))
      input.nativeHost.writeBigInt64LE(BigInt(value), field.start);
    else if (width === 8) input.nativeHost.writeDoubleLE(value, field.start);
    else input.nativeHost.writeInt32LE(value, field.start);
    checksum(input.nativeHost);
    const result = diagnoseOriginalHostedMullionEnclosure(input);
    assert.equal(result.status, "refused", path);
    assert.equal(result.originalSourceAuthorityGranted, false);
  }
});
test("matching mutations of both native version fields cannot approve an unsupported constructor", () => {
  const input = setup(),
    symbol = readOriginalMullionSymbolTypedFifo(
      input.nativeSymbol,
      input.schema,
    ),
    host = readOriginalCurtainHostTypedFifo(
      input.nativeHost,
      input.schema,
      "SWall",
    );
  assert.ok(symbol.ok);
  assert.ok(host.ok);
  for (const [replay, bytes, path] of [
    [symbol.value, input.nativeSymbol, "MullionSymFamRef.m_hostVersion"],
    [host.value, input.nativeHost, "CGridDivideFaceGStep.m_version"],
  ] as const) {
    const field = replay.entries
      .flatMap((e) => e.fields)
      .find((f) => f.path === path)!;
    assert.ok(field, path);
    assert.equal(field.end - field.start, 4);
    bytes.writeInt32LE(17, field.start);
    checksum(bytes);
  }
  const result = diagnoseOriginalHostedMullionEnclosure(input);
  assert.equal(result.status, "refused");
  if (result.status === "refused")
    assert.match(result.blockers.join(";"), /version/);
});
test("a checksum-correct change to original native division flags refuses", () => {
  const input = setup();
  const replay = readOriginalCurtainHostTypedFifo(
    input.nativeHost,
    input.schema,
    "SWall",
  );
  assert.ok(replay.ok);
  const field = replay.value.entries.flatMap((entry) => entry.fields).find(
    (entry) => entry.path === "CGridDivideFaceGStep.m_flags",
  );
  assert.ok(field);
  assert.equal(field.end - field.start, 4);
  assert.equal(input.nativeHost.readUInt32LE(field.start), 761725);
  input.nativeHost.writeUInt32LE(761724, field.start);
  checksum(input.nativeHost);
  const result = diagnoseOriginalHostedMullionEnclosure(input);
  assert.equal(result.status, "refused");
  assert.equal(result.originalSourceAuthorityGranted, false);
  if (result.status === "refused")
    assert.match(result.blockers.join(";"), /division flags/);
});
test("nonfinite orientation, unsupported direction and unknown curtain construction flags refuse", () => {
  for (const which of ["normal", "direction", "host-flags"] as const) {
    const input = setup();
    if (which === "host-flags") {
      const replay = readOriginalCurtainHostTypedFifo(
        input.nativeHost,
        input.schema,
        "SWall",
      );
      assert.ok(replay.ok);
      const field = replay.value.rootFields.find((f) =>
        f.path.endsWith(".m_mullionTdFlags"),
      )!;
      assert.ok(field);
      assert.equal(field.end - field.start, 4);
      input.nativeHost.writeUInt32LE(248, field.start);
      checksum(input.nativeHost);
    } else {
      const replay = readOriginalMullionSymbolTypedFifo(
        input.nativeSymbol,
        input.schema,
      );
      assert.ok(replay.ok);
      const field = replay.value.entries
        .flatMap((e) => e.fields)
        .find(
          (f) =>
            f.path ===
            (which === "normal"
              ? "MullionSymFamRef.m_pathNorm[0]"
              : "MullionSymFamRef.m_direction"),
        )!;
      assert.ok(field);
      if (which === "normal")
        input.nativeSymbol.writeDoubleLE(Number.NaN, field.start);
      else input.nativeSymbol.writeInt8(2, field.start);
      checksum(input.nativeSymbol);
    }
    assert.equal(
      diagnoseOriginalHostedMullionEnclosure(input).status,
      "refused",
      which,
    );
  }
});
