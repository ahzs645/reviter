import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";

const action = (code?: string) => {
  if (code === "unclosed-native-cell") return "Export Revit Finish boundary segments or repair missing native wall/jamb geometry; do not extend room outlines into free floor.";
  if (code === "multiple-room-labels") return "Verify the missing room partition or semantic room-separation line; one enclosure cannot represent two labelled rooms.";
  if (code === "insufficient-source-overlap") return "Review annotation-to-room identity, internal XY origin and native finish-face boundary; do not force a mismatched cell.";
  if (code === "no-native-walls") return "Recover native wall geometry or import a model-bound semantic room boundary for this level.";
  if (code === "empty-display-block") return "Review source corridor/aperture masks; protected floor subtraction consumed the room display.";
  if (code?.startsWith("semantic-")) return "Correct the semantic export according to the validation diagnostic and rerun; rejected imports do not replace source rooms.";
  return "Inspect native wall enclosure, label position and source holes; export a semantic Finish boundary when the room cannot be verified.";
};

const failureCategory=(diagnostic?:NonNullable<IndoorDataset["presentation"]>["diagnostics"][number])=>{
  if(!diagnostic)return "missing-presentation";
  if(diagnostic.code==="insufficient-source-overlap") {
    const labels=diagnostic.message.match(/other enclosed room labels: (.*?)\)\.?$/)?.[1];
    if(labels&&labels!=="none")return "shared-native-enclosure";
    const coverage=diagnostic.message.match(/best source coverage ([\d.]+)%, cell coverage ([\d.]+)%/);
    if(coverage&&Number(coverage[2])<65)return "native-cell-larger-than-annotation";
    return "annotation-crosses-native-cell";
  }
  if(diagnostic.code==="multiple-room-labels")return "shared-native-enclosure";
  if(diagnostic.code==="unclosed-native-cell")return "no-closed-native-enclosure";
  if(diagnostic.code==="empty-display-block"||diagnostic.code==="circulation-or-void-overlap")return "protected-floor-or-circulation-conflict";
  return diagnostic.code;
};

/** Every eligible room gets explicit coverage/provenance and a concrete source
 * correction action; aggregate counts cannot hide a failing wing or floor. */
export function auditRoomBoundaries(dataset: IndoorDataset, annotations: RoomDirectoryData["annotations"]) {
  const presentation = dataset.presentation;
  const prepared = new Map(presentation?.rooms.map(r => [r.roomKey, r]) ?? []);
  const source = new Map(annotations.map(r => [r.key, r]));
  const failures = new Map<string, NonNullable<IndoorDataset["presentation"]>["diagnostics"]>();
  for (const d of presentation?.diagnostics ?? []) failures.set(d.roomKey, [...failures.get(d.roomKey) ?? [], d]);
  const rooms = dataset.records.filter(r => r.walkable && !r.circulation).map(r => {
    const boundary = prepared.get(r.key), diagnostics = failures.get(r.key) ?? [];
    const label = source.get(r.key);
    return { roomKey: r.key, number: r.number, name: r.name, building: r.building, levelId: r.levelId,
      classification: r.stair ? "vertical-circulation" : "ordinary-room",
      status: boundary ? "prepared" : "source-fallback", boundarySource: boundary?.boundarySource ?? "annotation-source",
      boundaryElementIds: boundary?.boundaryElementIds ?? [], sourceCoverage: boundary?.sourceCoverage ?? null,
      cellCoverage: boundary?.cellCoverage ?? null, boundaryEvidence: boundary && "boundaryEvidence" in boundary ? boundary.boundaryEvidence : null,
      sourceMethod: label?.boundarySource ?? (label?.source as {polygon?: unknown} | undefined)?.polygon ?? null,
      sourceProvenance: label?.source ?? null, drawingProvenance: label?.dwg ?? null,
      sourceVertices: r.ringsFeet[0]?.length ?? 0,
      diagnostics,failureCategory:boundary?null:failureCategory(diagnostics[0]),
      nextAction: boundary ? null : failureCategory(diagnostics[0])==="shared-native-enclosure"
        ? "Verify whether these labels describe one open-plan destination or a missing native partition; do not split the enclosure between labels."
        : action(diagnostics[0]?.code) };
  });
  const groups = new Map<string, { building: string; levelId: number; eligible: number; prepared: number; fallback: number; reasons: Record<string, number> }>();
  for (const room of rooms) {
    const key = `${room.building}:${room.levelId}`;
    const group = groups.get(key) ?? { building: room.building, levelId: room.levelId, eligible: 0, prepared: 0, fallback: 0, reasons: {} };
    group.eligible++;
    if (room.status === "prepared") group.prepared++;
    else { group.fallback++; const code = room.diagnostics[0]?.code ?? "missing-presentation"; group.reasons[code] = (group.reasons[code] ?? 0) + 1; }
    groups.set(key, group);
  }
  const prioritizedScopes = [...groups.values()].map(g => ({ ...g, coveragePercent: Math.round(g.prepared / g.eligible * 1000) / 10 })).sort((a, b) => b.fallback - a.fallback || a.building.localeCompare(b.building) || a.levelId - b.levelId);
  const diagnosticCounts: Record<string, number> = {};
  for (const room of rooms.filter(r => r.status === "source-fallback")) { const code = room.diagnostics[0]?.code ?? "missing-presentation"; diagnosticCounts[code] = (diagnosticCounts[code] ?? 0) + 1; }
  const coverage=(items:typeof rooms)=>({eligible:items.length,prepared:items.filter(r=>r.status==="prepared").length,
    fallback:items.filter(r=>r.status==="source-fallback").length});
  return { version: 1, sourceModelSha256: dataset.source.modelSha256, eligibleRooms: rooms.length,
    ordinaryRoomCoverage:coverage(rooms.filter(r=>r.classification==="ordinary-room")),
    verticalCirculationCoverage:coverage(rooms.filter(r=>r.classification==="vertical-circulation")),
    preparedRooms: rooms.filter(r => r.status === "prepared").length, fallbackRooms: rooms.filter(r => r.status === "source-fallback").length,
    diagnosticCounts,
    ordinaryRoomFailureCategories:rooms.filter(r=>r.status==="source-fallback"&&r.classification==="ordinary-room")
      .reduce((counts,r)=>{const key=r.failureCategory??"missing-presentation";counts[key]=(counts[key]??0)+1;return counts;},{} as Record<string,number>),
    prioritizedScopes, rooms };
}
