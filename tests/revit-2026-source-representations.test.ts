import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRevit2026SourceRepresentation,
  REVIT_2026_SOURCE_REPRESENTATION_TARGETS,
  REVIT_COMMON_FACETED_TOPOLOGY8_READER,
} from "../lib/reviter/revit-2026-source-representations.ts";

test("resolves the four formerly unresolved UNBC GRep source slots", () => {
  assert.deepEqual(
    [1973, 2254, 2259, 2276].map((slot) => {
      const target = resolveRevit2026SourceRepresentation(slot);
      return [
        slot,
        target?.targetClass,
        target?.readerModule,
        target?.readerSlot,
      ];
    }),
    [
      [1973, "OdBmFamilyConnectorPosition", "TB_FormatCommonReaders.tx", 5290],
      [
        2254,
        "OdBmGSurfacesTransparencyOverrider",
        "TB_FormatCommonReaders.tx",
        5391,
      ],
      [
        2259,
        "OdBmGTagomizingFamSymHistoryDriver",
        "TB_FormatCommonReaders.tx",
        5393,
      ],
      [2276, "OdBmGeomGeneratorData", "TB_FormatCommonReaders.tx", 5406],
    ],
  );
});

test("keeps regeneration metadata separate from persisted drawable geometry", () => {
  const persistedGeometrySlots = REVIT_2026_SOURCE_REPRESENTATION_TARGETS
    .filter((target) => target.persistedDrawableGeometry)
    .map((target) => target.sourceSlot);

  assert.deepEqual(persistedGeometrySlots, [2177, 2210, 2237]);
  assert.equal(
    resolveRevit2026SourceRepresentation(2276)?.payloadRole,
    "geom-generator-history-and-next-tag",
  );
  assert.equal(REVIT_COMMON_FACETED_TOPOLOGY8_READER.readerSlot, 5255);
});

test("does not manufacture targets for unknown source slots", () => {
  assert.equal(resolveRevit2026SourceRepresentation(0), undefined);
  assert.equal(resolveRevit2026SourceRepresentation(999_999), undefined);
});
