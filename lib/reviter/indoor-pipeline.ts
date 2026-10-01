import type { ConvertResult } from "./types.ts";
import {
  parseRoomDirectory,
  isHallway,
  isWalkable,
  roomBuilding,
  nativeRouteBlocker,
  type DirectoryRoom,
  type RoomDirectoryData,
  type RoomPoint,
  type RouteOpening,
} from "./room-directory.ts";
import {
  directoryDoors,
  directoryDoorReviews,
  directoryStairs,
} from "./directory-navigation.ts";
import { directoryOpenPassages } from "./directory-openings.ts";
import { localBuildingConnections } from "./building-transitions.ts";
import { architecturalPlanGeometry } from "./architectural-plan.ts";
import { campusFloors } from "./campus-floors.ts";
import { directoryModelFloor } from "../../app/studio/directory-model.ts";
import { fitGeoreference, modelPointToGeographic } from "./georeference.ts";
import { buildIndoorGrid, type GridTerminal } from "./indoor-grid.ts";
import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
  IndoorRecord,
} from "./indoor-contract.ts";

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
/** Compile evidence-backed geometry. Display grouping never creates graph adjacency. */
export async function prepareIndoorDataset(
  model: ConvertResult,
  input: RoomDirectoryData,
  modelSha256: string,
  progress: (message: string) => void = () => {},
): Promise<IndoorDataset> {
  const data = parseRoomDirectory(JSON.stringify(input));
  if (!data.georeference)
    throw new Error(
      "Save at least two GIS reference points before preparing an indoor project.",
    );
  if (
    data.georeference.modelFileName !== model.fileName ||
    !/^[a-f0-9]{64}$/.test(modelSha256)
  )
    throw new Error(
      "Model identity or source digest does not match this project.",
    );
  const fit = fitGeoreference(data.georeference),
    cell = 0.6;
  const sourceRooms = data.annotations
    .filter((r) => r.status !== "deleted")
    .sort((a, b) => a.key.localeCompare(b.key));
  const elevations = Object.assign(
    {},
    ...[...new Set(sourceRooms.map((r) => r.levelId))].map(
      (id) =>
        directoryModelFloor(model, sourceRooms, id, null)?.roomElevations ?? {},
    ),
  ) as Record<string, { elevation: number; evidence: string }>;
  const geo = (p: RoomPoint): [number, number] => {
    const q = modelPointToGeographic(p, fit);
    return [q.longitude, q.latitude];
  };
  const surface = (r: DirectoryRoom) =>
    `${roomBuilding(r)}:${r.levelId}:${(elevations[r.key]?.elevation ?? model.levels.find((l) => l.levelId === r.levelId)?.elevation ?? 0).toFixed(3)}`;
  const records: IndoorRecord[] = sourceRooms.map((r) => ({
    key: r.key,
    number: r.number ?? "",
    name: r.name ?? "Unnamed area",
    building: roomBuilding(r),
    levelId: r.levelId,
    elevationFeet: elevations[r.key]?.elevation ?? 0,
    elevationEvidence: elevations[r.key]?.evidence ?? "Unknown surface",
    surfaceId: surface(r),
    circulation: isHallway(r),
    stair:
      /\bstair(?:s|case|well)?\b/i.test(r.name ?? "") ||
      !!r.stairFlightIds?.length,
    access: r.access?.kind ?? "unknown",
    walkable: isWalkable(r),
    confidence: r.confidence,
    ringsFeet: [r.polygonFeet, ...(r.holesFeet ?? [])],
    properties: {
      dwg: r.dwg,
      spaceUse: r.spaceUse,
      access: r.access,
      stairAccess: r.stairAccess,
      modelSurface: r.modelSurface,
      notes: r.walkabilityNotes,
    },
  }));
  const byRoom = new Map(sourceRooms.map((r) => [r.key, r])),
    byRecord = new Map(records.map((r) => [r.key, r]));
  const dataset: IndoorDataset = {
    format: "reviter-indoor",
    version: 1,
    generator: "reviter/indoor-pipeline-1",
    source: {
      modelFileName: model.fileName,
      modelSha256,
      roomsSha256: await sha256Bytes(
        new TextEncoder().encode(JSON.stringify(data)),
      ),
    },
    alignment: {
      originFeet: [model.origin.x, model.origin.y, model.origin.z],
      originGeographic: geo([model.origin.x, model.origin.y]),
      projectionLatitude: fit.origin.latitude,
      rotationRadians: (fit.rotationDegrees * Math.PI) / 180,
      horizontalMetresPerFoot: fit.scaleMetresPerFoot,
      verticalMetresPerFoot: 0.3048,
      rmsMetres: fit.rmsMetres,
      referenceCount: data.georeference.points.length,
    },
    floors: campusFloors(sourceRooms, model.levels, data.campusStoreys).map(
      (f) => ({
        id: `storey:${f.levelIds.join("+")}`,
        name: f.name,
        levelIds: f.levelIds,
        elevationFeet: f.elevation,
      }),
    ),
    nativeLevels: model.levels
      .filter((l) => l.levelId != null)
      .map((l) => ({
        id: l.levelId!,
        name: l.name ?? `Level ${l.levelId}`,
        elevationFeet: l.elevation,
      })),
    records,
    nodes: [],
    edges: [],
    walls: [],
    doors: [],
    issues: [],
    report: {
      recordCount: data.annotations.length,
      routableArrivals: 0,
      components: 0,
      largestComponentArrivals: 0,
      unmatchedDoors: 0,
      cellSizeFeet: cell,
      omittedSourceLabels:
        data.sourceCoverage?.omittedSheets.reduce(
          (s, p) => s + p.labelCount,
          0,
        ) ?? 0,
    },
  };
  const issue = (
    code: string,
    message: string,
    roomKey?: string,
    nativeElementId?: number,
    levelId?: number,
  ) =>
    dataset.issues.push({
      id: `${code}:${roomKey ?? nativeElementId ?? dataset.issues.length}:${levelId ?? ""}`,
      code,
      severity: "review",
      message,
      roomKey,
      nativeElementId,
      levelId,
    });
  if (data.georeference.points.length < 3)
    issue(
      "alignment-check",
      "Two-point alignment needs an independent, well-spread survey check.",
    );
  if (dataset.report.omittedSourceLabels)
    issue(
      "source-coverage",
      `${dataset.report.omittedSourceLabels} drawing labels were not imported; see the preserved source coverage.`,
    );
  for (const pin of data.accessReviewLocations ?? [])
    issue(
      "staff-pin",
      "A staff restriction pin has no assigned boundary; review nearby circulation.",
      undefined,
      undefined,
      pin.levelId,
    );
  const terminals = new Map<string, GridTerminal[]>(),
    nodes = new Map<string, IndoorNode>();
  const addTerminal = (
    id: string,
    roomKey: string,
    point: RoomPoint,
    kind: IndoorNode["kind"],
    snap: number,
  ) => {
    const r = byRecord.get(roomKey);
    if (!r || !r.walkable || r.access === "staff") return;
    terminals.set(roomKey, [
      ...(terminals.get(roomKey) ?? []),
      { id, roomKey, point, maxSnapFeet: snap },
    ]);
    nodes.set(id, {
      id,
      roomKey,
      kind,
      levelId: r.levelId,
      building: r.building,
      surfaceId: r.surfaceId,
      pointFeet: [...point, r.elevationFeet],
      geographic: geo(point),
    });
  };
  for (const r of sourceRooms)
    addTerminal(
      `arrival:${r.key}`,
      r.key,
      r.routePointFeet ?? r.labelPointFeet,
      "arrival",
      cell * 2,
    );
  const geometries = new Map<
      number,
      ReturnType<typeof architecturalPlanGeometry>
    >(),
    openings = new Map<number, RouteOpening[]>(),
    pending: IndoorEdge[] = [];
  for (const levelId of [...new Set(sourceRooms.map((r) => r.levelId))]) {
    progress(`Checking native walls and doors · level #${levelId}`);
    const rooms = sourceRooms.filter((r) => r.levelId === levelId),
      geometry = architecturalPlanGeometry(model, levelId);
    geometries.set(levelId, geometry);
    dataset.walls.push(
      ...[...geometry.walls, ...geometry.columns]
        .filter((w) => w.polygon.length >= 3)
        .map((w) => ({
          levelId,
          nativeElementId: w.elementId,
          ringsFeet: [w.polygon],
        })),
    );
    const reviews = directoryDoorReviews(
        rooms,
        directoryDoors(model, levelId),
        data.navigation?.doorLinks,
      ),
      passages = directoryOpenPassages(
        rooms,
        data.navigation?.openLinks ?? [],
        data.boundaryReference,
        geometry,
      );
    dataset.doors!.push(...reviews.map(({ door, candidates, state, portal }) => ({
      id: `door:${levelId}:${door.id}`,
      levelId,
      nativeElementId: door.id,
      pointFeet: door.point,
      footprintFeet: door.footprint,
      roomKeys: portal?.rooms ?? candidates,
      state,
    })));
    const ports = [
      ...reviews.flatMap((d) =>
        d.portal
          ? [
              {
                ...d.portal,
                id: `door:${levelId}:${d.door.id}`,
                kind: "door" as const,
                evidence: d.portal.reviewed
                  ? "reviewed-native-door"
                  : "native-door",
                nativeElementId: d.door.id,
              },
            ]
          : [],
      ),
      ...passages.map((p) => ({
        ...p,
        id: `opening:${p.openingId}`,
        kind: "opening" as const,
        evidence: p.evidence,
        nativeElementId: undefined,
      })),
    ];
    openings.set(levelId, ports);
    for (const d of reviews)
      if (!d.portal) {
        dataset.report.unmatchedDoors++;
        issue(
          "door-unmatched",
          `${d.state} native door: ${d.candidates.length} candidate areas.`,
          undefined,
          d.door.id,
          levelId,
        );
      }
    for (const p of ports) {
      const a = byRecord.get(p.rooms[0])!,
        b = byRecord.get(p.rooms[1])!;
      if (!p.footprint) {
        issue(
          "door-footprint",
          "Opening has no precise footprint.",
          undefined,
          p.nativeElementId,
          levelId,
        );
        continue;
      }
      if (Math.abs(a.elevationFeet - b.elevationFeet) > 0.05) {
        issue(
          "door-height",
          "Door joins different surface heights; a supported transition is needed.",
          undefined,
          p.nativeElementId,
          levelId,
        );
        continue;
      }
      const ids = [`${p.id}:0`, `${p.id}:1`];
      addTerminal(ids[0]!, a.key, p.from, "portal", 2);
      addTerminal(ids[1]!, b.key, p.to, "portal", 2);
      pending.push({
        id: p.id,
        from: ids[0]!,
        to: ids[1]!,
        kind: p.kind,
        lengthMetres: 0,
        pointsFeet: [],
        roomKeys: p.rooms,
        evidence: p.evidence,
        nativeElementId: p.nativeElementId,
        accessible: "unknown",
        enabled: true,
      });
    }
  }
  for (const s of directoryStairs(
    model,
    sourceRooms,
    data.navigation?.stairLinks,
  )) {
    const ids = s.rooms.map((key, i) => `${s.id}:${i}`);
    s.rooms.forEach((key, i) => {
      const room = byRoom.get(key)!;
      addTerminal(
        ids[i]!,
        key,
        room.routePointFeet ?? room.labelPointFeet,
        "stair",
        cell * 2,
      );
    });
    pending.push({
      id: s.id,
      from: ids[0]!,
      to: ids[1]!,
      kind: "stairs",
      lengthMetres: s.distanceFeet * 0.3048,
      pointsFeet: [],
      roomKeys: s.rooms,
      evidence: s.evidence,
      nativeElementId: s.stairElementId,
      accessible: "no",
      enabled: true,
    });
  }
  // Local steps can land on a supported slab without a room label. Such landings
  // get their own explicit surface identity; proximity alone never attaches them.
  for (const c of localBuildingConnections(
    model,
    sourceRooms,
    data.buildingTransitions ?? [],
  )) {
    if (!c.surfaceSupported) {
      issue("local-transition", `${c.report.id}: ${c.warnings.join(" ")}`);
      continue;
    }
    const ids = c.endpoints.map((e, i) => {
      let key = e.roomKey;
      if (!key) {
        key = `landing:${c.report.id}:${i}`;
        const loops = c.surfaces[i]?.polygons.find((p) => p[0]?.length);
        if (!loops) return undefined;
        const room: DirectoryRoom = {
          key,
          building: e.building,
          levelId: e.levelId,
          name: "Native connection landing",
          polygonFeet: loops[0]!,
          holesFeet: loops.slice(1),
          labelPointFeet: e.point,
          confidence: 1,
          spaceUse: { kind: "hallway", evidence: "user-reported" },
        };
        sourceRooms.push(room);
        byRoom.set(key, room);
        elevations[key] = {
          elevation: e.elevation,
          evidence: `Native floor #${c.surfaces[i]!.elementId}`,
        };
        const record: IndoorRecord = {
          key,
          number: "",
          name: room.name!,
          building: e.building,
          levelId: e.levelId,
          elevationFeet: e.elevation,
          elevationEvidence: elevations[key]!.evidence,
          surfaceId: surface(room),
          circulation: true,
          stair: false,
          access: "unknown",
          walkable: true,
          confidence: 1,
          ringsFeet: loops,
          properties: { nativeFloorId: c.surfaces[i]!.elementId },
        };
        records.push(record);
        byRecord.set(key, record);
      }
      const id = `local:${c.report.id}:${i}`;
      addTerminal(id, key, e.point, "stair", 1.2);
      return id;
    });
    if (ids.some((x) => !x)) continue;
    pending.push({
      id: `local:${c.report.id}`,
      from: ids[0]!,
      to: ids[1]!,
      kind: "local-steps",
      lengthMetres: c.samples
        .slice(1)
        .reduce(
          (s, p, i) =>
            s +
            Math.hypot(
              p.point[0] - c.samples[i]!.point[0],
              p.point[1] - c.samples[i]!.point[1],
              p.elevation - c.samples[i]!.elevation,
            ) *
              0.3048,
          0,
        ),
      pointsFeet: c.samples.map((p) => [...p.point, p.elevation]),
      roomKeys: c.endpoints.map((_, i) => nodes.get(ids[i]!)!.roomKey),
      evidence: "user-reported + native-supported",
      nativeElementId: c.report.nativeStairId,
      accessible: "no",
      enabled: true,
    });
  }
  const scopes = new Map<string, DirectoryRoom[]>();
  for (const r of sourceRooms) {
    const record = byRecord.get(r.key)!;
    if (!record.walkable || record.access === "staff") continue;
    const id = record.circulation
      ? `circulation:${record.surfaceId}`
      : `room:${r.key}`;
    scopes.set(id, [...(scopes.get(id) ?? []), r]);
  }
  const connectedTerminals = new Set<string>();
  let index = 0;
  for (const [scopeId, rooms] of scopes) {
    progress(`Building walkable graph · region ${++index}/${scopes.size}`);
    const reference = byRecord.get(rooms[0]!.key)!,
      geometry = geometries.get(reference.levelId)!;
    const bounds = rooms.flatMap((r) => r.polygonFeet),
      minX = Math.min(...bounds.map((p) => p[0])),
      maxX = Math.max(...bounds.map((p) => p[0])),
      minY = Math.min(...bounds.map((p) => p[1])),
      maxY = Math.max(...bounds.map((p) => p[1]));
    const keys = new Set(rooms.map((r) => r.key));
    const masks = sourceRooms.filter(
      (r) =>
        !keys.has(r.key) &&
        r.levelId === reference.levelId &&
        roomBuilding(r) === reference.building &&
        (!isWalkable(r) || !isHallway(r)) &&
        Math.min(...r.polygonFeet.map((p) => p[0])) <= maxX &&
        Math.max(...r.polygonFeet.map((p) => p[0])) >= minX &&
        Math.min(...r.polygonFeet.map((p) => p[1])) <= maxY &&
        Math.max(...r.polygonFeet.map((p) => p[1])) >= minY,
    );
    const ts = rooms.flatMap((r) => terminals.get(r.key) ?? []),
      grid = buildIndoorGrid(
        rooms,
        masks,
        ts,
        geometry,
        openings.get(reference.levelId) ?? [],
        cell,
      );
    for (const id of grid.missing) {
      nodes.delete(id);
      issue(
        "arrival-or-portal",
        `No safe walkable anchor within the snap limit: ${id}.`,
        ts.find((t) => t.id === id)?.roomKey,
        undefined,
        reference.levelId,
      );
    }
    for (const [id, p] of grid.positions) {
      let node = nodes.get(id);
      if (!node) {
        node = {
          id,
          roomKey: rooms[0]!.key,
          kind: "junction",
          levelId: reference.levelId,
          building: reference.building,
          surfaceId: reference.surfaceId,
          pointFeet: [...p, reference.elevationFeet],
          geographic: geo(p),
        };
        nodes.set(id, node);
      }
      node.pointFeet = [...p, reference.elevationFeet];
      node.geographic = geo(p);
    }
    for (const b of grid.branches) {
      connectedTerminals.add(b.from);
      connectedTerminals.add(b.to);
      dataset.edges.push({
        id: `walk:${scopeId}:${[b.from, b.to].sort().join("|")}`,
        from: b.from,
        to: b.to,
        kind: "walk",
        lengthMetres: b.points
          .slice(1)
          .reduce(
            (s, p, k) =>
              s +
              Math.hypot(p[0] - b.points[k]![0], p[1] - b.points[k]![1]) *
                fit.scaleMetresPerFoot,
            0,
          ),
        pointsFeet: b.points.map((p) => [...p, reference.elevationFeet]),
        roomKeys: b.roomKeys,
        evidence: "boundary + native-barrier raster",
        accessible: "unknown",
        enabled: true,
      });
    }
  }
  for (const e of pending) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to);
    if (!a || !b) {
      issue(
        "connection-anchor",
        `Connection ${e.id} has an unsupported entrance.`,
        undefined,
        e.nativeElementId,
      );
      continue;
    }
    if (e.kind === "door" || e.kind === "opening") {
      const geometry = geometries.get(a.levelId)!;
      const blocked = nativeRouteBlocker(
        geometry,
        openings.get(a.levelId) ?? [],
      );
      if (
        blocked(
          [a.pointFeet[0], a.pointFeet[1]],
          [b.pointFeet[0], b.pointFeet[1]],
        )
      ) {
        issue(
          "connection-barrier",
          `Connection ${e.id} crosses a native barrier.`,
          undefined,
          e.nativeElementId,
        );
        continue;
      }
    }
    if (!e.pointsFeet.length) e.pointsFeet = [a.pointFeet, b.pointFeet];
    else e.pointsFeet = [a.pointFeet, ...e.pointsFeet, b.pointFeet];
    if (e.kind === "door" || e.kind === "opening")
      e.lengthMetres =
        Math.hypot(
          a.pointFeet[0] - b.pointFeet[0],
          a.pointFeet[1] - b.pointFeet[1],
        ) * fit.scaleMetresPerFoot;
    dataset.edges.push(e);
    connectedTerminals.add(e.from);
    connectedTerminals.add(e.to);
  }
  dataset.nodes = [...nodes.values()];
  for (const r of records) {
    const id = `arrival:${r.key}`;
    if (nodes.has(id) && connectedTerminals.has(id)) r.arrivalNodeId = id;
    else if (r.walkable && r.access !== "staff")
      issue(
        "isolated-arrival",
        "Area has no matched access to the routing graph.",
        r.key,
        undefined,
        r.levelId,
      );
    if (r.access === "unknown")
      issue(
        "access-review",
        "Public access has not been confirmed.",
        r.key,
        undefined,
        r.levelId,
      );
  }
  const savedReviews = data.indoorReviews as
    | {
        records?: Record<string, { name?: string; notes?: string }>;
        edges?: Record<
          string,
          {
            enabled?: boolean;
            accessible?: "yes" | "no" | "unknown";
            notes?: string;
            geometryKey?: string;
          }
        >;
      }
    | undefined;
  for (const record of records) {
    const review = savedReviews?.records?.[record.key];
    if (review?.name) record.name = review.name;
    if (review?.notes) record.properties.reviewNotes = review.notes;
  }
  for (const edge of dataset.edges) {
    const review = savedReviews?.edges?.[edge.id];
    if (!review) continue;
    if (review.enabled != null) edge.enabled = review.enabled;
    if (review.notes) edge.notes = review.notes;
    if (review.accessible) {
      const key = JSON.stringify([
        dataset.source.modelSha256,
        edge.from,
        edge.to,
        edge.roomKeys,
        edge.pointsFeet,
      ]);
      if (
        review.geometryKey === key &&
        (["stairs", "local-steps"].includes(edge.kind)
          ? review.accessible !== "yes"
          : true)
      )
        edge.accessible = review.accessible;
      else
        issue(
          "connection-review-stale",
          `Recheck accessibility after regeneration: ${edge.id}`,
          undefined,
          edge.nativeElementId,
        );
    }
  }
  const adjacency = new Map<string, string[]>();
  for (const e of dataset.edges) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
  }
  const arrivals = new Set(
      records.flatMap((r) => (r.arrivalNodeId ? [r.arrivalNodeId] : [])),
    ),
    seen = new Set<string>(),
    components: number[] = [];
  for (const id of adjacency.keys()) {
    if (seen.has(id)) continue;
    const q = [id];
    seen.add(id);
    let count = 0;
    for (let k = 0; k < q.length; k++) {
      if (arrivals.has(q[k]!)) count++;
      for (const next of adjacency.get(q[k]!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          q.push(next);
        }
    }
    components.push(count);
  }
  dataset.report.routableArrivals = arrivals.size;
  dataset.report.components = components.length;
  dataset.report.largestComponentArrivals = Math.max(0, ...components);
  return dataset;
}
