import type { ConvertResult } from "./types.ts";

export type ModelTreeReport = {
  evidence: "persisted";
  source: "Global/ElemTable.OwningElementId";
  hostSource?: "Partitions/InsertableInst.m_hostId";
  format: "revit-2024-2027-elem-table";
  declaredRecordCount: number;
  recordCount: number;
  membershipCount: number;
  ownershipMembershipCount: number;
  hostMembershipCount: number;
  uniqueMemberCount: number;
  rootRecordCount: number;
  selfOwnedRecordCount: number;
  danglingOwnerCount: number;
  elements: Array<
    NonNullable<ConvertResult["elementOwnership"]>["records"][number] & {
      uniqueId?: string;
    }
  >;
  hostRelations: Array<
    NonNullable<ConvertResult["nativeHostRelations"]>[number] & {
      uniqueId?: string;
    }
  >;
};

export function modelTreeReport(result: ConvertResult): ModelTreeReport | null {
  const ownership = result.elementOwnership;
  if (!ownership) return null;
  const hostRelations = result.nativeHostRelations ?? [];
  const uniqueIdByElement = new Map(
    result.nativeIdentity?.identities.map((identity) => [
      identity.elementId,
      identity.uniqueId,
    ]) ?? [],
  );
  return {
    evidence: "persisted",
    source: "Global/ElemTable.OwningElementId",
    ...(hostRelations.length
      ? { hostSource: "Partitions/InsertableInst.m_hostId" as const }
      : {}),
    format: ownership.format,
    declaredRecordCount: ownership.declaredRecordCount,
    recordCount: ownership.decodedRecordCount,
    membershipCount: ownership.relations.length + hostRelations.length,
    ownershipMembershipCount: ownership.relations.length,
    hostMembershipCount: hostRelations.length,
    uniqueMemberCount: new Set([
      ...ownership.relations.map((relation) => relation.elementId),
      ...hostRelations.map((relation) => relation.elementId),
    ]).size,
    rootRecordCount: ownership.rootRecordCount,
    selfOwnedRecordCount: ownership.selfOwnedRecordCount,
    danglingOwnerCount: ownership.danglingOwnerCount,
    elements: ownership.records.map((record) => {
      const uniqueId = uniqueIdByElement.get(record.elementId);
      return uniqueId ? { ...record, uniqueId } : record;
    }),
    hostRelations: hostRelations.map((relation) => {
      const uniqueId = uniqueIdByElement.get(relation.elementId);
      return uniqueId ? { ...relation, uniqueId } : relation;
    }),
  };
}

export function modelTreeFidelity(result: ConvertResult) {
  const tree = modelTreeReport(result);
  return {
    modelTree: tree
      ? tree.hostMembershipCount
        ? "native-revit-owning-element-and-host"
        : "native-revit-owning-element"
      : "unavailable",
    modelTreeRecords: tree?.recordCount ?? 0,
    modelTreeMemberships: tree?.membershipCount ?? 0,
    modelTreeUniqueMembers: tree?.uniqueMemberCount ?? 0,
    modelTreeHostMemberships: tree?.hostMembershipCount ?? 0,
  };
}

export function bimSemanticFidelity(result: ConvertResult): string {
  const hasCategories = result.decoderCoverage.nativeCategorisedElements > 0;
  const hasOwnership = Boolean(result.elementOwnership);
  const hasHosts = Boolean(result.nativeHostRelations?.length);
  if (hasCategories && hasOwnership && hasHosts) {
    return "native-revit-categories-owning-element-and-host";
  }
  if (hasCategories && hasOwnership) return "native-revit-categories-and-owning-element";
  if (hasCategories) return "native-revit-categories";
  if (hasOwnership && hasHosts) return "native-revit-owning-element-and-host";
  if (hasOwnership) return "native-revit-owning-element";
  return "unavailable";
}
