import type { ConvertResult } from "./types.ts";

export type ModelTreeReport = {
  evidence: "persisted";
  source: "Global/ElemTable.OwningElementId";
  format: "revit-2024-2027-elem-table";
  declaredRecordCount: number;
  recordCount: number;
  membershipCount: number;
  rootRecordCount: number;
  selfOwnedRecordCount: number;
  danglingOwnerCount: number;
  elements: NonNullable<ConvertResult["elementOwnership"]>["records"];
};

export function modelTreeReport(result: ConvertResult): ModelTreeReport | null {
  const ownership = result.elementOwnership;
  if (!ownership) return null;
  return {
    evidence: "persisted",
    source: "Global/ElemTable.OwningElementId",
    format: ownership.format,
    declaredRecordCount: ownership.declaredRecordCount,
    recordCount: ownership.decodedRecordCount,
    membershipCount: ownership.relations.length,
    rootRecordCount: ownership.rootRecordCount,
    selfOwnedRecordCount: ownership.selfOwnedRecordCount,
    danglingOwnerCount: ownership.danglingOwnerCount,
    elements: ownership.records,
  };
}

export function modelTreeFidelity(result: ConvertResult) {
  const tree = modelTreeReport(result);
  return {
    modelTree: tree ? "native-revit-owning-element" : "unavailable",
    modelTreeRecords: tree?.recordCount ?? 0,
    modelTreeMemberships: tree?.membershipCount ?? 0,
  };
}

export function bimSemanticFidelity(result: ConvertResult): string {
  const hasCategories = result.decoderCoverage.nativeCategorisedElements > 0;
  const hasOwnership = Boolean(result.elementOwnership);
  if (hasCategories && hasOwnership) return "native-revit-categories-and-owning-element";
  if (hasCategories) return "native-revit-categories";
  if (hasOwnership) return "native-revit-owning-element";
  return "unavailable";
}
