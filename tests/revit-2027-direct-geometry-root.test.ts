import assert from "node:assert/strict";
import test from "node:test";

import {
  isRevit2027DirectGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";
import {
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

const GGROUP = REVIT_2027_GGROUP_SOURCE_CLASS_SLOT;
const GEOMETRY = REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT;
const GFILTER = 2254;

function root(...sourceClassSlots: Array<number | null>) {
  return {
    children: sourceClassSlots.map((sourceClassSlot) => ({
      sourceClassSlot,
    })),
  };
}

test("accepts one direct Geometry descriptor", () => {
  assert.equal(isRevit2027DirectGeometryRoot(root(GEOMETRY)), true);
});

test("accepts leading GGroups followed by one terminal Geometry", () => {
  assert.equal(isRevit2027DirectGeometryRoot(root(GGROUP, GEOMETRY)), true);
  assert.equal(
    isRevit2027DirectGeometryRoot(
      root(GGROUP, GGROUP, GGROUP, GGROUP, GEOMETRY),
    ),
    true,
  );
});

test("rejects missing or non-terminal Geometry descriptors", () => {
  assert.equal(isRevit2027DirectGeometryRoot(root()), false);
  assert.equal(isRevit2027DirectGeometryRoot(root(GGROUP)), false);
  assert.equal(isRevit2027DirectGeometryRoot(root(GEOMETRY, GGROUP)), false);
  assert.equal(
    isRevit2027DirectGeometryRoot(root(GGROUP, GEOMETRY, GEOMETRY)),
    false,
  );
});

test("rejects every other leading source class including GFilter", () => {
  assert.equal(
    isRevit2027DirectGeometryRoot(root(GFILTER, GGROUP, GEOMETRY)),
    false,
  );
  assert.equal(isRevit2027DirectGeometryRoot(root(2215, GEOMETRY)), false);
  assert.equal(isRevit2027DirectGeometryRoot(root(null, GEOMETRY)), false);
});
