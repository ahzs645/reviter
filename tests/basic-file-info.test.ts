import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
} from "../lib/reviter/basic-file-info.ts";
import { parseExtractArguments } from "../scripts/extract-geometry.ts";

const utf16 = (value: string) => Buffer.from(value, "utf16le");

test("reads a Revit release from BasicFileInfo versions 13 and 14", () => {
  for (const fileInfoVersion of [13, 14]) {
    const data = new Uint8Array(40);
    const view = new DataView(data.buffer);
    view.setUint32(0, fileInfoVersion, true);
    data.set([0x04, 0, 0, 0], 9);
    data.set(utf16("2027"), 13);
    assert.equal(revitVersionFromBasicFileInfo(data), 2027);
  }
});

test("reads the legacy length-prefixed BasicFileInfo release", () => {
  for (const [fileInfoVersion, revitVersion] of [[6, 2014], [10, 2023]]) {
    const label = `Autodesk Revit ${revitVersion} (Build)`;
    const encoded = utf16(label);
    const data = new Uint8Array(18 + encoded.byteLength);
    const view = new DataView(data.buffer);
    view.setUint32(0, fileInfoVersion, true);
    view.setInt32(14, label.length, true);
    data.set(encoded, 18);
    assert.equal(revitVersionFromBasicFileInfo(data), revitVersion);
  }
});

test("repairs the 8-bit boolean Revit 2024-2025 writes into the wide property bag", () => {
  // The bytes as they appear in the Revit 2025 RAC basic sample: a wide key, a
  // wide ": ", then the ASCII bytes `False` and a NUL, then a wide CRLF.
  const bag = (value: Buffer) => Buffer.concat([
    Buffer.from([0x0e, 0, 0, 0, 0x0d, 0x0a]),
    utf16("Worksharing: Not enabled\r\nIsSingleUserCloudModel: "),
    value,
    utf16("\r\nAuthor: 中文\r\n"),
  ]);
  const narrow = parseBasicFileInfoProperties(
    new Uint8Array(bag(Buffer.from([0x46, 0x61, 0x6c, 0x73, 0x65, 0x00]))),
  );
  assert.equal(narrow.properties.IsSingleUserCloudModel, "False");
  assert.equal(narrow.isSingleUserCloudModel, false);
  // A genuine CJK value is never re-read: its bytes are printable ASCII too.
  assert.equal(narrow.author, "中文");

  const wide = parseBasicFileInfoProperties(new Uint8Array(bag(utf16("True"))));
  assert.equal(wide.properties.IsSingleUserCloudModel, "True");
  assert.equal(wide.isSingleUserCloudModel, true);
});

test("declines malformed or unsupported BasicFileInfo", () => {
  assert.equal(revitVersionFromBasicFileInfo(new Uint8Array(4)), null);
  const data = new Uint8Array(32);
  new DataView(data.buffer).setUint32(0, 99, true);
  assert.equal(revitVersionFromBasicFileInfo(data), null);
});

test("the extraction command infers format from its output", () => {
  assert.deepEqual(
    parseExtractArguments(["model.rvt", "--out", "model.glb"]),
    {
      input: "model.rvt",
      output: "model.glb",
      format: "glb",
      revitVersion: undefined,
      planLevelId: undefined,
      floorPlates: false,
      extras: undefined,
      mirrorPlan: undefined,
    },
  );
  assert.equal(
    parseExtractArguments(["model.rvt", "--out", "model.bin", "--format", "ifc"]).format,
    "ifc",
  );
});

test("the extraction command reads a Pascal scene off its compound suffix", () => {
  // `model.pascal.json` and `model.json` share a last extension, so the Pascal
  // build format is selected by the whole suffix rather than by `extname`.
  assert.equal(parseExtractArguments(["model.rvt", "--out", "model.pascal.json"]).format, "pascal");
  assert.equal(parseExtractArguments(["model.rvt", "--out", "audit.json"]).format, "json");
  assert.equal(
    parseExtractArguments([
      "model.rvt", "--out", "model.pascal.json", "--extras", "all", "--mirror-plan",
    ]).extras,
    "all",
  );
  assert.equal(
    parseExtractArguments(["model.rvt", "--out", "model.pascal.json", "--mirror-plan"]).mirrorPlan,
    true,
  );
  assert.throws(
    () => parseExtractArguments(["model.rvt", "--out", "model.pascal.json", "--extras", "some"]),
    /Invalid --extras/u,
  );
  assert.throws(
    () => parseExtractArguments(["model.rvt", "--out", "model.glb", "--extras", "all"]),
    /only for Pascal/u,
  );
});

test("the extraction command accepts an exact Revit level only for SVG", () => {
  assert.equal(
    parseExtractArguments(["model.rvt", "--out", "floor.svg", "--level-id", "311"]).planLevelId,
    311,
  );
  assert.throws(
    () => parseExtractArguments(["model.rvt", "--out", "model.glb", "--level-id", "311"]),
    /only for SVG/u,
  );
  assert.equal(
    parseExtractArguments([
      "model.rvt", "--out", "floors.svg", "--level-id", "311", "--floor-plates",
    ]).floorPlates,
    true,
  );
});
