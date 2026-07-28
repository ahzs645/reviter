import assert from "node:assert/strict";
import test from "node:test";

import {
  isRevit2027BoundedTessellatorRoot,
  isRevit2027DirectGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";
import {
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-ginstance.ts";
import {
  REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gfilter.ts";
import {
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

const GGROUP = REVIT_2027_GGROUP_SOURCE_CLASS_SLOT;
const GEOMETRY = REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT;
const GFILTER = REVIT_2027_GFILTER_SOURCE_CLASS_SLOT;
const GINSTANCE = REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT;

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

test("accepts only the three measured tessellator candidate shapes", () => {
  const candidates = [
    root(GINSTANCE, GINSTANCE, GEOMETRY),
    root(
      GFILTER,
      GFILTER,
      GFILTER,
      GFILTER,
      GGROUP,
      GGROUP,
      GGROUP,
      GGROUP,
      GEOMETRY,
    ),
    root(GINSTANCE, GINSTANCE, GEOMETRY, GEOMETRY),
  ];
  for (const candidate of candidates) {
    assert.equal(isRevit2027BoundedTessellatorRoot(candidate), true);
    assert.equal(isRevit2027DirectGeometryRoot(candidate), true);
  }
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

test("rejects near misses outside the exact measured shapes", () => {
  assert.equal(
    isRevit2027DirectGeometryRoot(root(GFILTER, GGROUP, GEOMETRY)),
    false,
  );
  assert.equal(
    isRevit2027DirectGeometryRoot(
      root(
        GFILTER,
        GFILTER,
        GFILTER,
        GGROUP,
        GGROUP,
        GGROUP,
        GGROUP,
        GEOMETRY,
      ),
    ),
    false,
  );
  assert.equal(
    isRevit2027DirectGeometryRoot(root(GINSTANCE, GEOMETRY)),
    false,
  );
  assert.equal(
    isRevit2027DirectGeometryRoot(
      root(GINSTANCE, GINSTANCE, GGROUP, GEOMETRY),
    ),
    false,
  );
  assert.equal(
    isRevit2027DirectGeometryRoot(
      root(GINSTANCE, GINSTANCE, GEOMETRY, GEOMETRY, GEOMETRY),
    ),
    false,
  );
  assert.equal(isRevit2027DirectGeometryRoot(root(null, GEOMETRY)), false);
  assert.equal(
    isRevit2027BoundedTessellatorRoot(root(GGROUP, GEOMETRY)),
    false,
  );
});
