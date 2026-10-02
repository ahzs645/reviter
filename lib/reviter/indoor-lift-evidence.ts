import type { ConvertResult, ElementBoundsRecord } from "./types.ts";
import { roomBuilding, type DirectoryRoom } from "./room-directory.ts";

const liftWords =
  /\belevator\b|\bescalator\b|\blift\b|\bhoistway\b|\bascenseur\b|\bfahrstuhl\b|\baufzug\b|лифт|эскалатор/i;
/** A drawing label or placed family name is a review candidate, never a stop. */
export function liftLabelDisposition(label: string) {
  if (!liftWords.test(label)) return "unrelated" as const;
  if (/machine|control|equipment|machinery|mécani|maschin|машин/i.test(label))
    return "equipment-room-not-entrance" as const;
  if (/lobby|vestibule|hall|landing/i.test(label))
    return "lobby-needs-assembly-and-threshold" as const;
  return "lift-area-needs-assembly-and-served-floors" as const;
}

/** Inventory actual placed records separately from unplaced family metadata.
 * XY proximity is exported only as an inspection aid; it creates no graph link. */
export function inspectNativeLiftEvidence(
  model: ConvertResult,
  rooms: readonly DirectoryRoom[],
) {
  const identities = new Map(
    model.nativeIdentity?.identities.map((v) => [v.elementId, v.uniqueId]),
  );
  const hosts = new Map(
    model.nativeHostRelations?.map((v) => [v.elementId, v.hostId]),
  );
  const owners = new Map(
    model.elementOwnership?.records.map((v) => [
      v.elementId,
      v.owningElementId,
    ]),
  );
  const levels = new Map<number, number[]>();
  for (const v of model.nativeAssociatedLevelRelations ?? [])
    levels.set(v.elementId, [
      ...new Set([...(levels.get(v.elementId) ?? []), v.levelId]),
    ]);
  const identify = (e: ElementBoundsRecord) => ({
    nativeElementId: e.elementId,
    nativeUniqueId: identities.get(e.elementId) ?? null,
    nativeHostId: hosts.get(e.elementId) ?? null,
    nativeOwnerId: owners.get(e.elementId) ?? null,
    category: e.categoryName ?? null,
    family: e.familyName ?? null,
    type: e.typeName ?? null,
    familyId: e.familyId ?? null,
    familySymbolId: e.familySymbolId ?? null,
    associatedLevelIds: levels.get(e.elementId) ?? [],
    boundsFeet: e.boundsFeet,
    parameters: e.parameters ?? [],
  });
  const placedCandidates = model.elementBounds
    .filter((e) =>
      liftWords.test(
        [
          e.familyName,
          e.typeName,
          e.categoryName,
          JSON.stringify(e.parameters ?? []),
        ].join(" "),
      ),
    )
    .map((e) => ({
      ...identify(e),
      disposition: "named-placed-candidate-not-a-verified-assembly",
    }));
  const familyMetadataCandidates = (model.nativeFamilyDefinitions ?? [])
    .filter((v) => liftWords.test(v.name))
    .map((v) => ({
      familyId: v.familyId,
      name: v.name,
      disposition: "family-definition-does-not-prove-placement",
    }));
  const generic = model.elementBounds
    .filter(
      (e) => e.categoryName === "Generic Models" || e.categoryId === -2000151,
    )
    .map(identify);
  const annotations = rooms
    .filter(
      (r) =>
        r.status !== "deleted" &&
        liftWords.test([r.name, r.number, r.walkabilityNotes].join(" ")),
    )
    .map((r) => {
      const xs = r.polygonFeet.map((p) => p[0]),
        ys = r.polygonFeet.map((p) => p[1]);
      const box = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
      const overlapsXY = (e: ElementBoundsRecord) =>
        e.boundsFeet.min.x <= box.maxX + 2 &&
        e.boundsFeet.max.x >= box.minX - 2 &&
        e.boundsFeet.min.y <= box.maxY + 2 &&
        e.boundsFeet.max.y >= box.minY - 2;
      // Inspect every floor separately; repeated coordinates do not imply one shaft.
      const nearbyDoors = model.elementBounds
        .filter(
          (e) =>
            (e.categoryId === -2000023 || e.categoryName === "Doors") &&
            overlapsXY(e),
        )
        .map((e) => ({
          ...identify(e),
          sameDecodedLevel: (levels.get(e.elementId) ?? []).includes(r.levelId),
        }));
      const unknown = model.elementBounds
        .filter((e) => !e.categoryName && overlapsXY(e))
        .map(identify);
      return {
        roomKey: r.key,
        number: r.number,
        name: r.name,
        building: roomBuilding(r),
        levelId: r.levelId,
        labelPointFeet: r.labelPointFeet,
        ringsFeet: [r.polygonFeet, ...(r.holesFeet ?? [])],
        disposition: liftLabelDisposition(r.name ?? ""),
        sourceDrawing: r.dwg ?? null,
        nearbyDoorsForInspectionOnly: nearbyDoors,
        nearbyUnclassifiedNativeCarriersForInspectionOnly: unknown,
        verifiedAssemblyId: null,
        verifiedServedFloorIds: [],
        nextAction:
          "Inspect the native model and building source; export the actual lift assembly ElementId/UniqueId, ordered served native levels, per-floor landing-door ElementId/UniqueId and inside-lobby anchor, direction, operational access and separately verified step-free suitability. Machine/control rooms are not landing entrances.",
      };
    });
  return {
    decodedInventory: {
      placedGeometryRecords: model.elementBounds.length,
      nativeIdentityRecords: model.nativeIdentity?.decodedIdentityCount ?? 0,
      namedPlacedLiftCandidates: placedCandidates.length,
      namedFamilyDefinitions: familyMetadataCandidates.length,
      genericModelRecords: generic.length,
      unclassifiedGeometryRecords: model.elementBounds.filter(
        (e) => !e.categoryName,
      ).length,
      decodedParameterRecords: model.elementBounds.filter(
        (e) => e.parameters?.length,
      ).length,
      annotationCandidates: annotations.length,
    },
    placedCandidates,
    familyMetadataCandidates,
    genericModelRecords: generic,
    annotations,
    verifiedAssemblyCount: 0,
    verifiedStopCount: 0,
    limitation:
      "This decoder inventories geometry, identities, ownership, families and available instance parameters. It does not decode a verified lift-to-served-floor assembly relation. Zero named/verified assemblies is not evidence that physical elevators are absent. Schema class names and family definitions alone do not establish placed equipment, stops, public access or accessibility.",
    repairPolicy:
      "No elevator/escalator routing edges or stop records are generated by this inventory. Do not join vertically aligned annotation rooms or ordinary nearby doors as inferred lift stops.",
  };
}
