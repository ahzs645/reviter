/** Pure identity/proposal comparison only. These values grant no source,
 * current-cell, ownership, physical-route or pointer authority. The public
 * source API must supply them exclusively from its private live handle. */
import type {
  IndoorDataset,
  IndoorNode,
  IndoorEdge,
} from "./indoor-contract.ts";
import type { originalRecordedStairIntentDemandFacts } from "./native-source-stair-recorded-intent.ts";

export type OriginalStairBaseIdentityFields = {
  sourceModelSha256: string;
  sourceRoomsSha256?: string;
  room: IndoorDataset["records"][number];
  seed: IndoorNode;
  terminal: IndoorNode;
  heldEdge: IndoorEdge;
  nativeLevel?: IndoorDataset["nativeLevels"][number];
  approach?: {
    node: IndoorNode;
    room: IndoorDataset["records"][number];
  };
};
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function one<T>(values: T[], reason: string): T {
  if (values.length !== 1) throw new Error(reason);
  return values[0]!;
}
/** Selected identity only. The caller must separately establish the actual live
 * compiler input/dataset binding; this comparison cannot issue that binding. */
export function assertStairBaseCompilerInputIdentityPreserved(
  recorded: ReturnType<typeof originalRecordedStairIntentDemandFacts>,
  normalizedInputSnapshot: unknown,
) {
  if (!normalizedInputSnapshot || typeof normalizedInputSnapshot !== "object" ||
      Array.isArray(normalizedInputSnapshot))
    throw new Error("Normalized original stair compiler input required");
  const data = normalizedInputSnapshot as Record<string, unknown>;
  if (!Array.isArray(data.annotations) || !data.areaMetadata ||
      typeof data.areaMetadata !== "object" || Array.isArray(data.areaMetadata))
    throw new Error("Normalized original stair annotations/metadata required");
  const annotations = data.annotations as unknown[];
  for (const selected of [recorded.lowerRoom, recorded.upperRoom]) {
    const matches = annotations.filter(row => row && typeof row === "object" &&
      !Array.isArray(row) && (row as Record<string, unknown>).key === selected.key);
    if (matches.length !== 1 || !equal(matches[0], selected.originalAnnotation))
      throw new Error("Normalized compiler changed selected original stair annotation");
  }
  if (!equal({format: data.format, version: data.version,
      coordinateSystem: data.coordinateSystem, model: data.model},
      recorded.originalSourceHeader) ||
      !equal((data.areaMetadata as Record<string, unknown>)[recorded.originalAreaMetadataKey],
        recorded.originalRecordedAreaMetadata))
    throw new Error("Normalized compiler changed original stair header/recorded intent");
  return {selectedOriginalIdentityPreserved: true as const,
    sourceAuthorityGranted: false as const, routeApproved: false as const};
}

export function assertStairBaseIdentityFieldsPreserved(
  original: OriginalStairBaseIdentityFields,
  current: IndoorDataset,
  expectedCurrentCompilerRoomsSha256: string,
) {
  const record = one(
      current.records.filter((r) => r.key === original.room.key),
      "Current original stair place missing/duplicated",
    ),
    unchangedRecord =
      record.arrivalNodeId === undefined &&
      original.room.arrivalNodeId === original.seed.id
        ? { ...record, arrivalNodeId: original.seed.id }
        : record,
    approachRecord = original.approach
      ? one(
          current.records.filter((r) => r.key === original.approach!.room.key),
          "Original corridor place missing/duplicated",
        )
      : undefined,
    // Arrival pointers are derived after ordinary physical walking replay.
    // Compare only a missing exact original corridor pointer transiently;
    // never insert it or accept a changed pointer, node, owner or policy.
    unchangedApproachRecord =
      original.approach &&
      approachRecord &&
      approachRecord.arrivalNodeId === undefined &&
      original.approach.room.arrivalNodeId === original.approach.node.id
        ? { ...approachRecord, arrivalNodeId: original.approach.node.id }
        : approachRecord;
  if (
    current.source.modelSha256 !== original.sourceModelSha256 ||
    !/^[a-f0-9]{64}$/.test(expectedCurrentCompilerRoomsSha256) ||
    current.source.roomsSha256 !== expectedCurrentCompilerRoomsSha256 ||
    !equal(unchangedRecord, original.room) ||
    !equal(
      one(
        current.edges.filter((e) => e.id === original.heldEdge.id),
        "Original held stair edge missing/duplicated",
      ),
      original.heldEdge,
    ) ||
    [
      original.seed,
      original.terminal,
      ...(original.approach ? [original.approach.node] : []),
    ].some(
      (n) =>
        !equal(
          one(
            current.nodes.filter((c) => c.id === n.id),
            "Original stair/corridor node missing/duplicated",
          ),
          n,
        ),
    ) ||
    (original.nativeLevel !== undefined &&
      !equal(
        one(
          current.nativeLevels.filter((l) => l.id === original.nativeLevel!.id),
          "Original stair level missing/duplicated",
        ),
        original.nativeLevel,
      )) ||
    (original.approach !== undefined &&
      !equal(unchangedApproachRecord, original.approach.room))
  )
    throw new Error(
      "Current compilation changed original stair/place/corridor/level/access identity",
    );
  return {
    originalIdentityPreserved: true as const,
    sourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}

export type OriginalStairBaseProposalFields = {
  original: OriginalStairBaseIdentityFields;
  nativeFloorElementId: number;
  proposedNode: Omit<IndoorNode, "geographic">;
  proposedApproach: Pick<
    IndoorEdge,
    "id" | "from" | "to" | "kind" | "pointsFeet" | "accessible" | "enabled"
  >;
};
export function assertStairBaseProposalFieldsPreserved(
  proof: OriginalStairBaseProposalFields,
  current: IndoorDataset,
  expectedCurrentCompilerRoomsSha256: string,
) {
  assertStairBaseIdentityFieldsPreserved(proof.original, current, expectedCurrentCompilerRoomsSha256);
  const originalApproach = proof.original.approach;
  if (!originalApproach || !proof.original.nativeLevel)
    throw new Error("Complete original stair/corridor/level demand required");
  const proposal = proof.proposedNode,
    approach = proof.proposedApproach,
    node = one(
      current.nodes.filter((n) => n.id === proposal.id),
      "Derived stair base node absent/duplicated",
    ),
    edge = one(
      current.edges.filter((e) => e.id === approach.id),
      "Derived stair base approach absent/duplicated",
    );
  if (
    [
      "id",
      "roomKey",
      "kind",
      "levelId",
      "surfaceId",
      "building",
      "pointFeet",
    ].some(
      (k) =>
        !equal(
          node[k as keyof IndoorNode],
          proposal[k as keyof typeof proposal],
        ),
    ) ||
    !node.geographic.every(Number.isFinite) ||
    node.geographic.length !== 2 ||
    edge.kind !== approach.kind ||
    edge.from !== approach.from ||
    edge.to !== approach.to ||
    !equal(edge.pointsFeet, approach.pointsFeet) ||
    edge.accessible !== "unknown" ||
    (edge.direction ?? "both") !== "both" ||
    !edge.enabled ||
    edge.nativeElementId !== undefined ||
    edge.nativeSourceStair !== undefined ||
    edge.nativeRampSurface !== undefined ||
    edge.nativeSteppedStairV2 !== undefined
  )
    throw new Error(
      "Derived stair base proposal differs from exact source-qualified point/path",
    );
  const geometry = current.circulationGeometry;
  if (
    !edge.nativeCellId ||
    geometry?.sourceModelSha256 !== proof.original.sourceModelSha256
  )
    throw new Error(
      "Derived stair base approach requires its current original-model native cell",
    );
  const cell = one(
      geometry.cells.filter((c) => c.id === edge.nativeCellId),
      "Derived stair base native cell absent/duplicated",
    ),
    owners = [...new Set([...cell.roomKeys, proof.original.room.key])].sort();
  if (
    !cell.roomKeys.length ||
    new Set(cell.roomKeys).size !== cell.roomKeys.length ||
    !cell.levelIds.includes(proposal.levelId) ||
    cell.elevationFeet !== proposal.pointFeet[2] ||
    !cell.nativeFloorIds.includes(proof.nativeFloorElementId) ||
    !equal(edge.roomKeys, owners) ||
    !current.edges.some(
      (e) =>
        e.id !== edge.id &&
        e.kind === "walk" &&
        e.enabled &&
        [e.from, e.to].includes(originalApproach.node.id),
    )
  )
    throw new Error(
      "Derived stair base approach must retain every cell owner plus original stair demand and an independently current enabled corridor incident",
    );
  return {
    exactSourceProposalIdentityPreserved: true as const,
    cellOwnersNotChangedByThisGuard: true as const,
    sourceRoomNativeOwnershipAsserted: false as const,
    currentCellOrPhysicalRouteApproved: false as const,
    arrivalPointerApplied: false as const,
    routeApproved: false as const,
  };
}
