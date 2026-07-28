/**
 * Certified Revit 2026 source-representation dispatch records.
 *
 * These records describe the two-stage dispatch used by ODA's format modules:
 * a release-specific source slot is first mapped to a target runtime class,
 * then either a release-specific or common reader loads that target.
 *
 * Addresses are ELF-relative virtual addresses (RVAs), not process addresses.
 */
export type Revit2026SourceRepresentationTarget = {
  sourceSlot: number;
  targetClass: string;
  registrationRva: number;
  readerModule: "TB_Format2026Readers.tx" | "TB_FormatCommonReaders.tx";
  readerSlot: number;
  readerRva: number;
  readerFactoryRegistrationRva: number;
  payloadRole:
    | "connector-modifier-base"
    | "transparency-int32"
    | "marker"
    | "geom-generator-history-and-next-tag"
    | "brep-face-queue"
    | "fake-brep"
    | "poly-mesh";
  persistedDrawableGeometry: boolean;
};

export const REVIT_2026_SOURCE_REPRESENTATION_TARGETS = [
  {
    sourceSlot: 1973,
    targetClass: "OdBmFamilyConnectorPosition",
    registrationRva: 0x67f45c,
    readerModule: "TB_FormatCommonReaders.tx",
    readerSlot: 5290,
    readerRva: 0x6c04b0,
    readerFactoryRegistrationRva: 0x6f0ddf,
    payloadRole: "connector-modifier-base",
    persistedDrawableGeometry: false,
  },
  {
    sourceSlot: 2177,
    targetClass: "OdBmGBrep",
    registrationRva: 0x680d7f,
    readerModule: "TB_Format2026Readers.tx",
    readerSlot: 2177,
    readerRva: 0x10ca5b6,
    readerFactoryRegistrationRva: 0x15f166a,
    payloadRole: "brep-face-queue",
    persistedDrawableGeometry: true,
  },
  {
    sourceSlot: 2210,
    targetClass: "OdBmGFakeBRep",
    registrationRva: 0x68119f,
    readerModule: "TB_Format2026Readers.tx",
    readerSlot: 2210,
    readerRva: 0x10c20da,
    readerFactoryRegistrationRva: 0x15f1b06,
    payloadRole: "fake-brep",
    persistedDrawableGeometry: true,
  },
  {
    sourceSlot: 2237,
    targetClass: "OdBmGPolyMesh",
    registrationRva: 0x6814f9,
    readerModule: "TB_Format2026Readers.tx",
    readerSlot: 2237,
    readerRva: 0x10e128c,
    readerFactoryRegistrationRva: 0x15f1fdd,
    payloadRole: "poly-mesh",
    persistedDrawableGeometry: true,
  },
  {
    sourceSlot: 2254,
    targetClass: "OdBmGSurfacesTransparencyOverrider",
    registrationRva: 0x68172a,
    readerModule: "TB_FormatCommonReaders.tx",
    readerSlot: 5391,
    readerRva: 0x52a980,
    readerFactoryRegistrationRva: 0x6f23ff,
    payloadRole: "transparency-int32",
    persistedDrawableGeometry: false,
  },
  {
    sourceSlot: 2259,
    targetClass: "OdBmGTagomizingFamSymHistoryDriver",
    registrationRva: 0x6817cf,
    readerModule: "TB_FormatCommonReaders.tx",
    readerSlot: 5393,
    readerRva: 0x52d2d6,
    readerFactoryRegistrationRva: 0x6f2475,
    payloadRole: "marker",
    persistedDrawableGeometry: false,
  },
  {
    sourceSlot: 2276,
    targetClass: "OdBmGeomGeneratorData",
    registrationRva: 0x681a00,
    readerModule: "TB_FormatCommonReaders.tx",
    readerSlot: 5406,
    readerRva: 0x544752,
    readerFactoryRegistrationRva: 0x6f2774,
    payloadRole: "geom-generator-history-and-next-tag",
    persistedDrawableGeometry: false,
  },
] as const satisfies readonly Revit2026SourceRepresentationTarget[];

export const REVIT_COMMON_FACETED_TOPOLOGY8_READER = {
  targetClass: "OdBmFacetedTopology8",
  readerModule: "TB_FormatCommonReaders.tx",
  readerSlot: 5255,
  readerRva: 0x6c8d8c,
  readerFactoryRegistrationRva: 0x6f0609,
} as const;

const targetsBySourceSlot = new Map<
  number,
  (typeof REVIT_2026_SOURCE_REPRESENTATION_TARGETS)[number]
>(
  REVIT_2026_SOURCE_REPRESENTATION_TARGETS.map((target) => [
    target.sourceSlot,
    target,
  ]),
);

export function resolveRevit2026SourceRepresentation(
  sourceSlot: number,
): (typeof REVIT_2026_SOURCE_REPRESENTATION_TARGETS)[number] | undefined {
  return targetsBySourceSlot.get(sourceSlot);
}
