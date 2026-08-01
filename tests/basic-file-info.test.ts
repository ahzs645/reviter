import assert from "node:assert/strict";
import test from "node:test";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
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
    },
  );
  assert.equal(
    parseExtractArguments(["model.rvt", "--out", "model.bin", "--format", "ifc"]).format,
    "ifc",
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
