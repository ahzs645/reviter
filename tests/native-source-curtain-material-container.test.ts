import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  inspectOriginalCurtainHostTypeFrames,
  certifyOriginalCurtainMaterialContainer,
  originalCurtainMaterialContainerFact,
} from "../lib/reviter/native-source-curtain-material-container.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "../lib/reviter/native-source-foreign-envelope-census.ts";
import type { OriginalCurtainMaterialContainer } from "../lib/reviter/native-source-curtain-material-container.ts";
const file = (n: string) =>
  readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const schema = file("native-drawing-reference-source-schema.bin"),
  host = file("native-curtain-host-2315413.bin"),
  graphics = file("native-curtain-host-2315413-graphics.bin"),
  type = file("native-curtain-wall-type-29097.bin");
function checksum(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let a = 1,
    b = 0;
  for (let i = 16; i < bytes.length - 4; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  v.setUint32(8, (b * 65536 + a) >>> 0, true);
  return bytes;
}
test("actual native curtain type and full current graph select sixteen retained physical members", () => {
  const r = inspectOriginalCurtainHostTypeFrames(schema, host, graphics, type);
  assert.equal(
    createHash("sha256").update(type).digest("hex"),
    "5f0d46eb12b36967b4d7fe9f41ec3ee718d5f6e53ea341328d04b26cd877a6a6",
  );
  assert.equal(r.nativeHostElementId, 2315413);
  assert.equal(r.nativeWallTypeElementId, 29097);
  assert.equal(r.originalWallTypeClass, "NewCurtainWallType");
  assert.equal(r.currentMemberElementIds.length, 16);
  assert.ok(r.currentMemberElementIds.includes(2315416));
  assert.ok(r.currentMemberElementIds.includes(2315423));
  assert.equal(r.currentBindings.retainedFaceTokens.length, 23);
  assert.equal(r.sourceAuthorityGranted, false);
  assert.equal(r.physicalMemberMaterialOmitted, false);
  assert.equal(r.apertureApproved, false);
  assert.ok(r.sourceWallTypePrefix.unreadOriginalRootSuffixBytes > 0);
  assert.deepEqual(r.retainedOriginalWallTypeBytes, Uint8Array.from(type));
});
test("native basic type, wrong type owner, altered host type and checksum changes refuse", () => {
  const basic = Uint8Array.from(type);
  new DataView(basic.buffer).setUint16(16, 624, true);
  checksum(basic);
  assert.throws(
    () => inspectOriginalCurtainHostTypeFrames(schema, host, graphics, basic),
    /not an admitted curtain/,
  );
  const foreign = Uint8Array.from(type);
  new DataView(foreign.buffer).setBigInt64(0, 29098n, true);
  assert.throws(
    () => inspectOriginalCurtainHostTypeFrames(schema, host, graphics, foreign),
    /owner field differs|different native type/,
  );
  const bad = Uint8Array.from(type);
  bad[40] ^= 1;
  assert.throws(
    () => inspectOriginalCurtainHostTypeFrames(schema, host, graphics, bad),
    /checksum/,
  );
  const alternate = Uint8Array.from(host);
  new DataView(alternate.buffer).setBigInt64(216, 29098n, true);
  checksum(alternate);
  assert.throws(() =>
    inspectOriginalCurtainHostTypeFrames(schema, alternate, graphics, type),
  );
});
test("transport JSON and pure reports cannot manufacture a native container delegation", () => {
  const census = {} as OriginalNativeForeignEnvelopeCensus;
  assert.throws(
    () => certifyOriginalCurtainMaterialContainer(census, 2315413),
    /Untrusted/,
  );
  assert.throws(
    () =>
      originalCurtainMaterialContainerFact(
        census,
        {} as OriginalCurtainMaterialContainer,
      ),
    /Untrusted/,
  );
});
