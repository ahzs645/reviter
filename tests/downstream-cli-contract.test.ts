/**
 * The surface a downstream consumer is pinned to.
 *
 * Reviter is consumed as a git submodule by a voxel pipeline that runs the
 * extractor as a subprocess and never imports these modules — the coupling
 * between the two projects is deliberately a file-level IFC contract rather
 * than code, so that the decoders here stay free to change.
 *
 * That freedom has one price: the *invocation* has to hold still. A consumer
 * that shells out cannot be caught by a type error, so the three facts it
 * depends on are asserted here instead. None of them constrains what the
 * decoders do; they constrain only how the door is opened.
 *
 * `tests/basic-file-info.test.ts` already covers argument parsing in general.
 * This file is narrower on purpose: it pins the exact call an outside project
 * makes, so that renaming the entry point or dropping the engines declaration
 * fails here with an explanation rather than in someone else's build.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseExtractArguments } from "../scripts/extract-geometry.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("the entry point keeps the path a consumer invokes by", () => {
  // Invoked as: node --experimental-strip-types scripts/extract-geometry.ts
  assert.ok(
    existsSync(new URL("../scripts/extract-geometry.ts", import.meta.url)),
    "scripts/extract-geometry.ts is the path downstream projects run; moving it " +
      "breaks them silently, because a subprocess call cannot be type-checked.",
  );
});

test("an RVT converts to IFC through the plain --out form", () => {
  // The consumer builds exactly this: the input first, then an absolute --out
  // whose extension selects the format. It passes no --format flag.
  const parsed = parseExtractArguments([
    "/models/unbc.rvt",
    "--out",
    "/tmp/out/unbc.ifc",
  ]);

  assert.equal(parsed.input, "/models/unbc.rvt");
  assert.equal(parsed.output, "/tmp/out/unbc.ifc");
  assert.equal(parsed.format, "ifc", "the .ifc extension must keep selecting the IFC exporter");
  assert.equal(parsed.revitVersion, undefined, "the release is read from the file by default");
});

test("--revit-version stays accepted alongside an IFC output", () => {
  // The consumer exposes this as an override for a file whose BasicFileInfo
  // release is not what the decoders should be selected on.
  const parsed = parseExtractArguments([
    "/models/unbc.rvt",
    "--out",
    "/tmp/out/unbc.ifc",
    "--revit-version",
    "2027",
  ]);

  assert.equal(parsed.format, "ifc");
  assert.equal(parsed.revitVersion, 2027);
});

test("package.json declares the node floor a consumer preflights against", () => {
  const manifest = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
  const declared = manifest.engines?.node;

  assert.equal(
    typeof declared,
    "string",
    "engines.node is read by the consumer's preflight rather than duplicated there. " +
      "Removing it turns a clear version message into a stack trace from inside a decoder.",
  );
  assert.match(declared, /\d+/, `engines.node should carry a version, got ${declared}`);
});
