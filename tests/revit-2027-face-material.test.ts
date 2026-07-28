import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRevit2027FaceMaterial,
} from "../lib/reviter/revit-2027-face-material.ts";
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";

function material(elementId: number, name: string): NativeMaterialDefinition {
  return {
    elementId,
    name,
    recordOffset: 100,
    objectLength: 200,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
  };
}

test("binds a positive face ID only through an exact MaterialElem identity", () => {
  const definition = material(182549, "Алюминий");
  assert.deepEqual(bindRevit2027FaceMaterial(182549n, [definition]), {
    status: "exact-material",
    renderStyleElementId: 182549n,
    materialElementId: 182549,
    definition,
  });
});

test("does not promote invalid, negative system, or unknown positive IDs", () => {
  const definitions = [material(26, "Стекло")];
  assert.deepEqual(bindRevit2027FaceMaterial(-1n, definitions), {
    status: "unassigned",
    renderStyleElementId: -1n,
  });
  assert.deepEqual(bindRevit2027FaceMaterial(-4000010n, definitions), {
    status: "negative-system-id",
    renderStyleElementId: -4000010n,
  });
  assert.deepEqual(bindRevit2027FaceMaterial(27n, definitions), {
    status: "unresolved-positive-id",
    renderStyleElementId: 27n,
    reason: "no-decoded-material-element",
  });
  assert.deepEqual(
    bindRevit2027FaceMaterial(BigInt(Number.MAX_SAFE_INTEGER) + 1n, definitions),
    {
      status: "unresolved-positive-id",
      renderStyleElementId: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      reason: "outside-safe-integer-range",
    },
  );
});

