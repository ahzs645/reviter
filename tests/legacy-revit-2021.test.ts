import assert from "node:assert/strict";
import test from "node:test";

import { loadLegacyRevit2021Api } from "../lib/reviter/legacy-revit-2021.ts";
import {
  LEGACY_REVIT_2021_ENUMS,
  LEGACY_REVIT_2021_MAPS,
} from "../lib/reviter/legacy-revit-2021.data.ts";

test("loads the Revit 2021 compatibility data on demand", async () => {
  const api = await loadLegacyRevit2021Api();
  assert.equal(api.enumNames.length, 11);
  assert.equal(api.enumMembers("BuiltInCategory").length, 1_078);
  assert.equal(api.enumMembers("BuiltInParameter").length, 3_339);
  assert.equal(api.enumValue("MEPSystemClassification", "SupplyAir"), 1);
});

/**
 * The payload's own size, asserted.
 *
 * `legacy-revit-2021.data.ts` cannot be regenerated — its `src/Decompiled`
 * input is not in this repository — so nothing recomputes it and nothing else
 * would notice rows going missing. The spot checks below prove the *shape* of
 * the data survives; this proves the *whole* of it does. The counts are what
 * the file has held since it was committed, and they are what the compact
 * re-emission on 2026-08-12 was verified against by deep-comparing the parsed
 * data before and after.
 */
test("carries the whole payload: 8,075 rows across 11 enums and 12 maps", () => {
  const rows = (table: Record<string, readonly unknown[]>) =>
    Object.values(table).reduce((sum, entries) => sum + entries.length, 0);

  assert.equal(Object.keys(LEGACY_REVIT_2021_ENUMS).length, 11);
  assert.equal(Object.keys(LEGACY_REVIT_2021_MAPS).length, 12);
  assert.equal(rows(LEGACY_REVIT_2021_ENUMS), 5_426);
  assert.equal(rows(LEGACY_REVIT_2021_MAPS), 2_649);
  assert.equal(rows(LEGACY_REVIT_2021_ENUMS) + rows(LEGACY_REVIT_2021_MAPS), 8_075);
});

test("resolves legacy categories, parameters, and parameter groups", async () => {
  const api = await loadLegacyRevit2021Api();
  assert.deepEqual(api.category(-2_000_011), {
    value: -2_000_011,
    names: ["OST_Walls"],
    label: "Walls",
  });
  assert.deepEqual(api.parameter(-1_001_105), {
    value: -1_001_105,
    names: ["WALL_USER_HEIGHT_PARAM"],
  });
  assert.deepEqual(api.parameterGroup(-5_000_100), {
    value: -5_000_100,
    names: ["PG_IDENTITY_DATA"],
    label: "Identity Data",
  });
  assert.deepEqual(api.search("-2000011", 1), [{
    enumName: "BuiltInCategory",
    name: "OST_Walls",
    value: -2_000_011,
    label: "Walls",
  }]);
  assert.ok(api.search("supplyair").some((result) =>
    result.enumName === "MEPSystemClassification" && result.name === "SupplyAir"));
  assert.ok(api.search("identity data").some((result) =>
    result.enumName === "BuiltInParameterGroup" && result.name === "PG_IDENTITY_DATA"));
});

test("connects shared types, display units, symbols, and unit groups", async () => {
  const api = await loadLegacyRevit2021Api();
  assert.deepEqual(api.parameterType("Length"), {
    name: "Length",
    value: 4,
    sharedDataType: "LENGTH",
    unitType: { name: "UT_Length", value: 0 },
  });

  const millimetres = api.displayUnit("DUT_MILLIMETERS");
  assert.equal(millimetres?.value, 2);
  assert.equal(millimetres?.catalog, "MILLIMETERS");
  assert.deepEqual(millimetres?.symbols, [{ name: "UST_MM", value: 201, label: "mm" }]);
  assert.equal(
    millimetres?.parameterTypes.filter((item) => item.name === "Length").length,
    1,
  );
  assert.deepEqual(api.unitType("UT_Length"), {
    name: "UT_Length",
    value: 0,
    catalog: "LENGTH",
    group: { name: "Common", value: 0 },
    parameterType: { name: "Length", value: 4 },
  });
  assert.deepEqual(api.unitSymbol("UST_WATT"), {
    name: "UST_WATT",
    value: 3_901,
    label: "W",
  });
  assert.ok(api.mappedKeys("parameterTypeSharedData", "LENGTH").includes("Length"));
  assert.ok(api.mappedKeys("displayUnitCatalog", "MILLIMETERS").includes("DUT_MILLIMETERS"));
});
