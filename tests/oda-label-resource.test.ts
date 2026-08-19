import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  odaCategoryEnumName,
  odaCategoryLabel,
  parameterEnumName,
} from "../lib/reviter/oda-label-resource.ts";
import { parameterObjectBytes, writeParameterObject } from "./rich-rvt-fixture.ts";

type ExtractedRow = { id: number; enumName: string; label: string | null };
type ExtractedTables = { families: Record<string, ExtractedRow[]> };

type Descriptor = { id: number; storage: string; spec: string | null; label: string | null };
type Descriptors = { parameters: Descriptor[] };

let tableCache: ExtractedTables | undefined;
let descriptorCache: Descriptors | undefined;

/** The committed `g_Parameters` extraction. */
function parameterDescriptors(): Descriptors {
  descriptorCache ??= JSON.parse(
    readFileSync(new URL("../docs/generated/oda-parameter-descriptors.json", import.meta.url), "utf8"),
  ) as Descriptors;
  return descriptorCache;
}

/** The committed extraction the generated module is built from. */
function extractedTables(): ExtractedTables {
  tableCache ??= JSON.parse(
    readFileSync(new URL("../docs/generated/oda-label-resource-tables.json", import.meta.url), "utf8"),
  ) as ExtractedTables;
  return tableCache;
}

/** Every category id either published source names. */
function knownCategoryIds(): number[] {
  const source = readFileSync(new URL("../lib/reviter/built-in-categories.ts", import.meta.url), "utf8");
  const block = /const PACKED_CATEGORIES[^=]*=\s*\[([\s\S]*?)\]\.join\("\|"\)/.exec(source);
  assert.ok(block, "packed category table not found");
  const packed = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`) as string)
    .join("|");
  const ids = new Set<number>();
  for (const entry of packed.split("|")) ids.add(Number(entry.slice(0, entry.indexOf(":"))));
  for (const row of extractedTables().families.BuiltInCategory) ids.add(row.id);
  return [...ids];
}

test("Revit labels replace the humanised enumerator where they differ", () => {
  assert.equal(humaniseCategoryName("CurtainWallPanels"), "Curtain Wall Panels");
  assert.equal(categoryDisplayName(-2_000_170), "Curtain Panels");

  assert.equal(humaniseCategoryName("StairsRailingBaluster"), "Stairs Railing Baluster");
  assert.equal(categoryDisplayName(-2_000_127), "Balusters");

  assert.equal(humaniseCategoryName("StairsLandings"), "Stairs Landings");
  assert.equal(categoryDisplayName(-2_000_920), "Landings");
});

test("a label that collides with another category's enumerator is not adopted", () => {
  // Revit calls `OST_StairsRailing` "Railings", but `OST_Railings` is a
  // different id whose enumerator already reads that way. Adopting the label
  // would put two categories under one name, so the enumerator name stands.
  assert.equal(odaCategoryLabel(-2_000_126), "Railings");
  assert.equal(categoryDisplayName(-2_000_175), "Railings");
  assert.ok(isAmbiguousCategoryLabel(-2_000_126));
  assert.equal(categoryDisplayName(-2_000_126), "Stairs Railing");
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
  // `OST_AdaptivePoints_Lines` and `OST_AnalyticalNodes_Lines` are both "Lines"
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

test("an id no source names at all is still reported by number", () => {
  // `-1005051` and `-1006800` have a descriptor but no Forge type id and no
  // label, so there is nothing to call them. Guessing is worse than a number.
  for (const id of [-1_005_051, -1_006_800]) {
    assert.equal(parameterEnumName(id), undefined);
    assert.equal(parameterDisplayName(id), `Parameter ${id}`);
  }
});

test("a real label replaces the humanised-enumerator placeholder", () => {
  assert.equal(builtInParameterEnumName(-1_010_024), "RGB_B_PARAM");
  assert.notEqual(parameterDisplayName(-1_010_024), "Rgb B Param");
  assert.equal(
    parameterDisplayName(-1_010_024),
    "Blue value for RGB color spec. (for Use with XAML Data Template example)",
  );
});

test("the transcribed table's literal backslash-n artifact is repaired", () => {
  const label = parameterDisplayName(-1_006_703);
  assert.equal(label, "Bubble Weight Number");
  assert.ok(!label.includes("\\"), "no literal escape should reach a display name");
});

test("decoded parameters carry their enumerator", () => {
  const elementId = 424_242;
  const parameterId = -1_001_105;
  const value = 12.5;

  const data = new Uint8Array(parameterObjectBytes(1));
  writeParameterObject(data, new DataView(data.buffer), 0, {
    elementId,
    parameters: [[parameterId, value]],
  });

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

test("every known category id maps to a distinct display name", () => {
  // The rule this guards is that a display name identifies one category. It is
  // what stops a flat object list showing two unrelated rows under one name,
  // and it is not implied by the labels being unique among themselves: a label
  // can collide with an enumerator-derived name that some other id keeps.
  const ids = new Set<number>(knownCategoryIds());
  const owners = new Map<string, number[]>();
  for (const id of ids) {
    const name = categoryDisplayName(id);
    const seen = owners.get(name);
    if (seen) seen.push(id);
    else owners.set(name, [id]);
  }
  const collisions = [...owners].filter(([, sharing]) => sharing.length > 1);
  assert.deepEqual(collisions, [], `display names shared by several categories: ${
    collisions.map(([name, sharing]) => `${name} <- ${sharing.join(", ")}`).join("; ")
  }`);
  assert.equal(owners.size, ids.size);
});

test("the generated module still agrees with the committed extraction", () => {
  // `oda-label-resource.ts` is generated from this JSON and says "do not edit".
  // Without this, an edit to either one drifts silently: the extraction needs a
  // binary that is not in the repository, so no other check compares them.
  const tables = extractedTables();
  let categoryLabels = 0;
  let parameterEnums = 0;

  for (const row of tables.families.BuiltInCategory) {
    assert.equal(odaCategoryEnumName(row.id) ?? builtInCategoryName(row.id),
      row.enumName.replace(/^OST_/, ""), `enumerator for category ${row.id}`);
    if (row.label === null) {
      assert.equal(odaCategoryLabel(row.id), undefined, `category ${row.id} has no label`);
      continue;
    }
    assert.equal(odaCategoryLabel(row.id), row.label, `label for category ${row.id}`);
    categoryLabels += 1;
  }

  for (const row of tables.families.BuiltInParameter) {
    assert.equal(parameterEnumName(row.id), row.enumName, `enumerator for parameter ${row.id}`);
    if (row.label !== null) {
      assert.equal(parameterDisplayName(row.id), row.label, `label for parameter ${row.id}`);
    }
    parameterEnums += 1;
  }

  assert.equal(categoryLabels, 1_075);
  assert.equal(parameterEnums, 3_703);
});

test("a label is withheld only when adopting it would collide", () => {
  // Checked as a property of the result rather than by reimplementing the
  // generator's fixpoint: an adopted label must be the id's display name, and
  // a withheld one must be a name some other category already answers to.
  const tables = extractedTables();
  const labelled = tables.families.BuiltInCategory.filter((row) => row.label !== null);
  const displayed = new Map<string, number>();
  for (const id of knownCategoryIds()) displayed.set(categoryDisplayName(id), id);
  const sharedLabels = new Map<string, number>();
  for (const row of labelled) sharedLabels.set(row.label!, (sharedLabels.get(row.label!) ?? 0) + 1);

  let adopted = 0;
  let withheld = 0;
  for (const row of labelled) {
    if (isAmbiguousCategoryLabel(row.id)) {
      // Either several categories carry this label — in which case they all
      // withdraw and nothing displays it — or one other category already
      // answers to it under its enumerator-derived name.
      const claimant = displayed.get(row.label!);
      assert.ok(
        sharedLabels.get(row.label!)! > 1 || (claimant !== undefined && claimant !== row.id),
        `${row.id} withholds "${row.label}" but adopting it would not have collided`,
      );
      assert.equal(categoryDisplayName(row.id), humaniseCategoryName(builtInCategoryName(row.id)!));
      withheld += 1;
      continue;
    }
    assert.equal(categoryDisplayName(row.id), row.label, `adopted label for ${row.id}`);
    adopted += 1;
  }
  assert.equal(adopted, 723);
  assert.equal(withheld, 352);
});

test("no packed value can be corrupted by the table separator", () => {
  // The tables are `id:value` pairs joined by `|`, so a `|` in any value would
  // silently split one entry into two. Values containing `:` are fine and do
  // occur — `Scale Value 1:` ends with one — because only the first is a
  // separator. This is the invariant the generator asserts at build time, held
  // here against the shipped tables, which build time never sees again.
  const tables = extractedTables();
  const values = [
    ...tables.families.BuiltInCategory.flatMap((row) => [row.enumName, row.label ?? ""]),
    ...tables.families.BuiltInParameter.flatMap((row) => [row.enumName, row.label ?? ""]),
  ];
  assert.deepEqual(values.filter((value) => value.includes("|")), []);

  const withColons = tables.families.BuiltInParameter.filter((row) => row.label?.includes(":"));
  assert.ok(withColons.length >= 20, `expected colon-bearing labels, saw ${withColons.length}`);
  for (const row of withColons) {
    assert.equal(parameterDisplayName(row.id), row.label, `colon label for ${row.id}`);
  }
});

test("the parameters no label table names are still named", () => {
  // `-1001101` is the id whose stored value reproduces the paired IFC export's
  // wall extrusion depth. Neither label table carries it, because Revit shows
  // it no label, but Autodesk's own schema names and types it.
  assert.equal(parameterDisplayName(-1_001_101), "wallHeightParam");
  assert.equal(parameterDisplayName(-1_001_111), "wallBaseOffsetComputed");
  assert.equal(builtInParameterEnumName(-1_001_101), undefined);

  const descriptors = parameterDescriptors();
  const wallHeight = descriptors.parameters.find((row) => row.id === -1_001_101);
  assert.equal(wallHeight?.storage, "Double");
  assert.equal(wallHeight?.spec, "autodesk.spec.aec:length");
});

test("the descriptor table agrees with the label table on every shared id", () => {
  // The descriptors are a strict superset read from a different binary. If the
  // two ever disagreed, one of the two extractions would be misreading bytes.
  const labelled = new Map(
    extractedTables().families.BuiltInParameter.map((row) => [row.id, row.label]),
  );
  let shared = 0;
  for (const row of parameterDescriptors().parameters) {
    const label = labelled.get(row.id);
    if (label === undefined) continue;
    shared += 1;
    if (label !== null && row.label !== null) assert.equal(row.label, label, `label for ${row.id}`);
  }
  assert.equal(shared, 3_703);
  assert.equal(parameterDescriptors().parameters.length, 3_723);
});
