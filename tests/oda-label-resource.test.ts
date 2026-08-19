import assert from "node:assert/strict";
import test from "node:test";

import {
  builtInCategoryLabel,
  builtInCategoryName,
  humaniseCategoryName,
} from "../lib/reviter/built-in-categories.ts";
import {
  builtInParameterEnumName,
  parameterDisplayName,
} from "../lib/reviter/built-in-parameters.ts";
import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import { categoryDisplayName } from "../lib/reviter/native-categories.ts";
import {
  isAmbiguousCategoryLabel,
  odaCategoryLabel,
  parameterEnumName,
} from "../lib/reviter/oda-label-resource.ts";

test("Revit labels replace the humanised enumerator where they differ", () => {
  // The three largest recovered categories in the supplied 2027 project whose
  // Revit label is not the humanised enumerator.
  assert.equal(humaniseCategoryName("CurtainWallPanels"), "Curtain Wall Panels");
  assert.equal(categoryDisplayName(-2_000_170), "Curtain Panels");

  assert.equal(humaniseCategoryName("StairsRailing"), "Stairs Railing");
  assert.equal(categoryDisplayName(-2_000_126), "Railings");

  assert.equal(humaniseCategoryName("StairsRailingBaluster"), "Stairs Railing Baluster");
  assert.equal(categoryDisplayName(-2_000_127), "Balusters");
});

test("categories whose label already matches the enumerator are unchanged", () => {
  for (const [id, name] of [
    [-2_000_011, "Walls"],
    [-2_000_032, "Floors"],
    [-2_000_023, "Doors"],
    [-2_000_014, "Windows"],
    [-2_000_180, "Ramps"],
    [-2_000_120, "Stairs"],
  ] as const) {
    assert.equal(categoryDisplayName(id), name);
  }
});

test("a label shared between sibling categories does not name either of them", () => {
  // `OST_AdaptivePointsLines` and `OST_AnalyticalNodesLines` are both "Lines"
  // in Revit, shown nested under different parents.
  assert.equal(odaCategoryLabel(-2_000_903), "Lines");
  assert.equal(odaCategoryLabel(-2_009_648), "Lines");
  assert.ok(isAmbiguousCategoryLabel(-2_000_903));
  assert.equal(builtInCategoryLabel(-2_000_903), undefined);
  assert.equal(categoryDisplayName(-2_000_903), "Adaptive Points Lines");
  assert.equal(categoryDisplayName(-2_009_648), "Analytical Nodes Lines");
});

test("the resource names categories the published documentation omits", () => {
  assert.equal(builtInCategoryName(-2_001_242), "HiddenBuildingUnitLines_REMOVED_Deprecated");
  assert.notEqual(categoryDisplayName(-2_001_242), "Revit category -2001242");
});

test("an unknown category id still reports as a number", () => {
  assert.equal(categoryDisplayName(-2_999_999), "Revit category -2999999");
});

test("parameter enumerators resolve for the verified wall-height ids", () => {
  assert.equal(builtInParameterEnumName(-1_001_105), "WALL_USER_HEIGHT_PARAM");
  assert.equal(builtInParameterEnumName(-1_001_108), "WALL_BASE_OFFSET");
  assert.equal(builtInParameterEnumName(-1_001_109), "WALL_TOP_OFFSET");
  assert.equal(parameterDisplayName(-1_001_105), "Unconnected Height");
});

test("the ids absent from the published enum are absent from the resource too", () => {
  // A second, independently produced table of the same enumeration agreeing
  // that these are not public parameters.
  for (const id of [-1_001_101, -1_001_111]) {
    assert.equal(parameterEnumName(id), undefined);
    assert.equal(parameterDisplayName(id), `Parameter ${id}`);
  }
});

test("a real label replaces the humanised-enumerator placeholder", () => {
  assert.equal(builtInParameterEnumName(-1_010_024), "RGB_B_PARAM");
  assert.notEqual(parameterDisplayName(-1_010_024), "Rgb B Param");
  assert.match(parameterDisplayName(-1_010_024), /^Blue value for RGB color spec\./);
});

test("decoded parameters carry their enumerator", () => {
  const elementId = 424_242;
  const parameterId = -1_001_105;
  const value = 12.5;

  const anchor = [0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00];
  const data = new Uint8Array(anchor.length + 8 + 4 + 16);
  const view = new DataView(data.buffer);
  data.set(anchor, 0);
  view.setBigUint64(anchor.length, BigInt(elementId), true);
  const table = anchor.length + 8;
  view.setUint32(table, 1, true);
  view.setUint32(table + 4, parameterId + 0x1_0000_0000, true);
  view.setUint32(table + 8, 0xffff_ffff, true);
  view.setFloat64(table + 12, value, true);

  const tables = collectElementParameters(data);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].elementId, elementId);
  assert.deepEqual(tables[0].parameters, [
    {
      parameterId,
      name: "Unconnected Height",
      enumName: "WALL_USER_HEIGHT_PARAM",
      value,
    },
  ]);
});
