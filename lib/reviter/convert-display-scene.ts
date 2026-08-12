/**
 * The display scene: what the viewer receives, and what it is told was held
 * back.
 *
 * This is the last stage of the conversion, and by the time it runs every
 * element record is final — categories resolved, geometry attached, envelopes
 * reconciled. Nothing here decodes anything. It decides which of those records
 * are drawn, resolves the certified native meshes against them, batches both
 * into render meshes, and frames the result.
 *
 * Two decisions are threaded through the whole stage and are the reason it is
 * one function rather than several:
 *
 *  - **the origin**, which every mesh, opening and bound is expressed relative
 *    to, and which is not known until display selection has run; and
 *  - **which elements the native mesh scene covers**, which decides whether an
 *    element keeps its envelope proxy, and is revised three times as meshes are
 *    excluded (helpers, reconstructed door leaves, held wrappers, then wall
 *    proxy replacements).
 *
 * The records themselves are mutated in place — `renderGeometryProvenance` and
 * `inferredCurtainPanelGeometry` — because the same record objects are what the
 * result publishes as `elementBounds`.
 */
import { framingBoundsOfRecords } from "./bounds-records.ts";
import { inferCurtainPanelBoundaries } from "./curtain-panel-boundary.ts";
import { applyNativeMaterialIndices } from "./material-palette.ts";
import { cleanNativeMeshScene } from "./native-mesh-cleanup.ts";
import { buildRevit2027NativeMeshScene } from "./revit-2027-native-mesh-bridge.ts";
import {
  anonymousWallDuplicateProxyIds,
  boundsPlanSegments,
  buildBoundsMeshes,
  curtainAssemblyHelperProxyIds,
  excludeMeshElementIds,
  isStairOrRailingHelperProxy,
  levelsForBounds,
  levelsFromRelations,
  selectDisplayBounds,
  stairAssembliesWithRecoveredNativeRuns,
} from "./scene.ts";
import { nativeWallProxyReplacementIds } from "./wall-native-admission.ts";

import type { ConvertSceneReport } from "./convert-report.ts";
import type { ElementOwnershipDecode } from "./element-relations.ts";
import type { NativeHostRelation } from "./host-relations.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import type { NativeAssociatedLevelRelation } from "./level-relations.ts";
import type { Revit2027NativeMeshCollector } from "./revit-2027-native-mesh-bridge.ts";
import type { Revit2027StairsRunAndLandingAggregate } from "./revit-2027-stairs-aggregate.ts";
import type {
  Bounds3,
  ElementBoundsRecord,
  LevelBand,
  MeshData,
  Segment,
} from "./types.ts";

export type DisplaySceneInput = {
  /** Records worth drawing: a volume, a boundary ring, or a tread set. */
  boundedSolids: ElementBoundsRecord[];
  /** Every recovered record, drawable or not; mutated with its provenance. */
  elementBounds: ElementBoundsRecord[];
  stairsRuns: ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate>;
  sharedGeometryIds: Set<number>;
  instancePlacements: Map<number, InstancePlacement>;
  elementOwnership: ElementOwnershipDecode | undefined;
  nativeHostRelations: NativeHostRelation[];
  nativeAssociatedLevelRelations: NativeAssociatedLevelRelation[];
  markerByElement: Map<number, number>;
  /** Records that must not be drawn, and whose native meshes are declined. */
  nonSceneNativeMeshIds: Set<number>;
  /** Element ids of decoded native materials, for native mesh admission. */
  materialElementIds: Set<number>;
  nativeMaterialIndexById: Map<number, number>;
  proxyMaterialIndexByElement: Map<number, number>;
  preferredWallMaterialIdsByElement: Map<number, Set<number>>;
  nativeMeshCollector: Revit2027NativeMeshCollector;
};

export type DisplayScene = {
  /** Model-space point every mesh and bound below is expressed relative to. */
  origin: { x: number; y: number; z: number };
  bbox: Bounds3;
  levels: LevelBand[];
  meshes: MeshData[];
  segments: Segment[];
  /** Records that survived display selection. */
  displayRecordCount: number;
  /** Records drawn as envelope proxies rather than as native geometry. */
  proxyRecordCount: number;
  /** Records drawn from a complete certified native mesh instead. */
  nativeCoveredRecordCount: number;
  /** Everything this stage contributes to the result's own account of itself. */
  report: ConvertSceneReport;
};

export function buildDisplayScene(input: DisplaySceneInput): DisplayScene {
  const {
    boundedSolids,
    elementBounds,
    stairsRuns,
    sharedGeometryIds,
    instancePlacements,
    elementOwnership,
    nativeHostRelations,
    nativeAssociatedLevelRelations,
    markerByElement,
    nonSceneNativeMeshIds,
    materialElementIds,
    nativeMaterialIndexById,
    proxyMaterialIndexByElement,
    preferredWallMaterialIdsByElement,
    nativeMeshCollector,
  } = input;
  const displaySelection = selectDisplayBounds(boundedSolids);
  const displayBounds = displaySelection.records;
  // Framed to the building rather than to the outermost record, so a few
  // misparsed envelopes cannot throw the camera off the model.
  const bounds = framingBoundsOfRecords(displayBounds);
  const origin = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: bounds.min.z,
  };
  const recordByElementId = new Map(
    elementBounds.map((record) => [record.elementId, record]),
  );
  const hostedOpeningsByWall = new Map<
    number,
    ElementBoundsRecord[]
  >();
  for (const relation of nativeHostRelations) {
    const opening = recordByElementId.get(relation.elementId);
    const host = recordByElementId.get(relation.hostId);
    if (
      !opening ||
      !host ||
      host.categoryId !== -2000011 ||
      (opening.categoryId !== -2000023 && opening.categoryId !== -2000014)
    ) {
      continue;
    }
    const openings = hostedOpeningsByWall.get(host.elementId) ?? [];
    openings.push(opening);
    hostedOpeningsByWall.set(host.elementId, openings);
  }
  const relativeHostedOpeningsByWall = new Map(
    [...hostedOpeningsByWall].map(([hostId, openings]) => [
      hostId,
      openings.map(({ boundsFeet }) => ({
        min: {
          x: boundsFeet.min.x - origin.x,
          y: boundsFeet.min.y - origin.y,
          z: boundsFeet.min.z - origin.z,
        },
        max: {
          x: boundsFeet.max.x - origin.x,
          y: boundsFeet.max.y - origin.y,
          z: boundsFeet.max.z - origin.z,
        },
      })),
    ]),
  );
  // Only definitions proven to be referenced by persisted placements may
  // leave the collector as reusable local geometry. The collector composes
  // their exact nested GInstance closure atomically and never publishes
  // unrelated non-scene definitions.
  const nativeMeshCollection =
    nativeMeshCollector.snapshot(
      sharedGeometryIds,
      stairsRuns,
      new Map(
        (elementOwnership?.relations ?? []).map((relation) => [
          relation.elementId,
          relation.ownerId,
        ]),
      ),
    );
  const nativeMeshScene = buildRevit2027NativeMeshScene(
    nativeMeshCollection,
    instancePlacements.values(),
    origin,
    {
      materialElementIds,
      sharedOwnerIds: sharedGeometryIds,
      // Cross-check native geometry against the element's **own** decoded
      // envelope, which is `boundedSolids` — not `displayBounds`, the
      // subset left after display selection.
      //
      // The two were conflated, and the consequence was circular: an
      // element held back from the proxy scene as a curtain-wall wrapper, a
      // sheet, or a stair/railing drawing aid was absent from
      // `displayBounds`, so its complete native BRep mesh failed the
      // "is there an envelope to check against" test and was discarded —
      // leaving the element with no proxy *and* no mesh, drawn as nothing
      // at all. On the supplied model that silently dropped 3,720 complete
      // native items, most of them railing top rails and balusters.
      //
      // Holding back a crude box is a statement about the box. It is not a
      // statement about the element's real geometry, and it should not
      // decide whether that geometry is admitted. The check itself is
      // unchanged: a native mesh whose transformed AABB escapes the
      // element's own envelope is still declined.
      expectedBoundsByElement: new Map(
        boundedSolids.map((record) => [
          record.elementId,
          record.boundsFeet,
        ]),
      ),
      // A certified owner without any decoded element-table record is a
      // reusable definition, not evidence of a placed object. Zero-volume
      // records remain known and may still use their exact native mesh.
      knownElementIds: new Set(elementBounds.map((record) => record.elementId)),
    },
  );
  // A door family's complete native object can be the swept-open family
  // geometry rather than the closed leaf the scene needs. Those meshes
  // were admitted after `doorLeafFromShape` had reconstructed the leaf and
  // therefore silently won display precedence over the better result. On
  // the UNBC pair the admitted native door meshes score 88.6% on centre
  // and size, while the independently reconstructed leaf boxes score
  // 100.0% / 99.9%. Prefer the reconstruction only where its own persisted
  // shape or host-wall evidence actually produced a leaf; unresolved doors
  // continue through normal native admission.
  const reconstructedDoorLeafIds = new Set(
    elementBounds
      .filter((record) => record.doorLeafSource != null)
      .map((record) => record.elementId),
  );
  // A curtain-wall assembly wrapper is held back only after decoded facade
  // children are found inside it. Apply that same decision to native mesh
  // admission: otherwise a complete BRep tagged to the parent puts the
  // aggregate envelope straight back over its plate and mullions. UNBC
  // object 2422391 is the concrete case — its 20 parent triangles span the
  // full 10.57 × 8.33 × 13.78 ft wrapper while the IFC parent has no body;
  // panel 2422392 and mullions 2422394–2422397 carry the real geometry.
  const heldWrapperNativeMeshIds = new Set(
    displaySelection.openingWrappers.map((record) => record.elementId),
  );
  const excludedNativeMeshIds = new Set([
    ...nonSceneNativeMeshIds,
    ...reconstructedDoorLeafIds,
    ...heldWrapperNativeMeshIds,
  ]);
  nativeMeshScene.meshes = excludeMeshElementIds(
    nativeMeshScene.meshes,
    excludedNativeMeshIds,
  );
  nativeMeshScene.coveredElementIds = new Set(
    [...nativeMeshScene.coveredElementIds].filter(
      (elementId) => !excludedNativeMeshIds.has(elementId),
    ),
  );
  nativeMeshScene.reconstructedElementIds = new Set(
    [...nativeMeshScene.reconstructedElementIds].filter(
      (elementId) => !excludedNativeMeshIds.has(elementId),
    ),
  );
  nativeMeshScene.triangles = nativeMeshScene.meshes.reduce(
    (total, mesh) => total + mesh.indices.length / 3,
    0,
  );
  const nativeMeshCleanup = cleanNativeMeshScene(
    nativeMeshScene.meshes,
    {
      hostedOpeningsByWall: relativeHostedOpeningsByWall,
      preferredMaterialIdsByElement:
        preferredWallMaterialIdsByElement,
      wallElementIds: new Set(
        elementBounds
          .filter((record) => record.categoryId === -2_000_011)
          .map((record) => record.elementId),
      ),
    },
  );
  nativeMeshScene.meshes = nativeMeshCleanup.meshes;
  nativeMeshScene.triangles = nativeMeshCleanup.outputTriangles;
  // Compare against the proxy *after* persisted hosted openings are cut.
  // The uncut location-line solid can look better by span while an opening
  // at an end removes its entire cap and changes the geometry the viewer
  // would actually receive. Previewing the same builder used below keeps
  // this admission decision about rendered geometry, not an idealised box.
  const renderedWallProxyPreview = buildBoundsMeshes(
    elementBounds.filter((record) =>
      record.categoryId === -2_000_011 &&
      Boolean(record.solids?.length || record.solid)),
    origin,
    [],
    proxyMaterialIndexByElement,
    hostedOpeningsByWall,
  );
  const nativeWallProxyReplacements = nativeWallProxyReplacementIds(
    nativeMeshScene.meshes,
    origin,
    elementBounds,
    renderedWallProxyPreview,
  );
  if (nativeWallProxyReplacements.size) {
    nativeMeshScene.meshes = excludeMeshElementIds(
      nativeMeshScene.meshes,
      nativeWallProxyReplacements,
    );
    nativeMeshScene.coveredElementIds = new Set(
      [...nativeMeshScene.coveredElementIds].filter(
        (elementId) => !nativeWallProxyReplacements.has(elementId),
      ),
    );
    nativeMeshScene.reconstructedElementIds = new Set(
      [...nativeMeshScene.reconstructedElementIds].filter(
        (elementId) => !nativeWallProxyReplacements.has(elementId),
      ),
    );
    nativeMeshScene.triangles = nativeMeshScene.meshes.reduce(
      (total, mesh) => total + mesh.indices.length / 3,
      0,
    );
  }
  applyNativeMaterialIndices(
    nativeMeshScene.meshes,
    nativeMaterialIndexById,
  );
  const inferredCurtainPanels = inferCurtainPanelBoundaries(displayBounds);
  let inferredCurtainPanelCount = 0;
  for (const record of displayBounds) {
    if (nativeMeshScene.coveredElementIds.has(record.elementId)) continue;
    const geometry = inferredCurtainPanels.get(record.elementId);
    if (geometry) {
      record.inferredCurtainPanelGeometry = geometry;
      inferredCurtainPanelCount += 1;
    }
  }
  // A proxy is removed only after the complete native element was admitted
  // under the output cap. Incomplete and truncated owners keep their
  // independently recovered envelope/solid. Drawing-aid records are the
  // exception: an unresolved helper must not become a building-sized box.
  // Resolved geometry for the same id remains in `nativeMeshScene.meshes`.
  // Counted directly rather than by subtraction: the native admission set
  // is not a subset of the display set, so the old difference of totals
  // could go negative and once reported "-3,547 records not rendered".
  const proxyDisplayBounds: typeof displayBounds = [];
  let omittedHelperProxyCount = nonSceneNativeMeshIds.size;
  let omittedCurtainAssemblyProxyCount = 0;
  const displayRecordById = new Map(
    displayBounds.map((record) => [record.elementId, record]),
  );
  const elementRecordById = new Map(
    elementBounds.map((record) => [record.elementId, record]),
  );
  const stairAssembliesWithRecoveredChildren =
    stairAssembliesWithRecoveredNativeRuns(
      elementBounds,
      stairsRuns.values(),
      nativeMeshScene.coveredElementIds,
      nativeMeshScene.reconstructedElementIds,
    );
  // The native run aggregate above is authoritative. ElemTable also covers
  // legacy cases that place a stairs container beneath its top rail.
  for (const relation of elementOwnership?.relations ?? []) {
    const owner = elementRecordById.get(relation.ownerId);
    const child = displayRecordById.get(relation.elementId);
    if (
      child?.categoryId === -2000120 &&
      owner &&
      (
        nativeMeshScene.coveredElementIds.has(owner.elementId) ||
        nativeMeshScene.reconstructedElementIds.has(owner.elementId) ||
        owner.orientedBox ||
        owner.railPath ||
        owner.solids?.length ||
        owner.solid ||
        owner.arcs?.length
      )
    ) {
      // Legacy stair/railing aggregates can be persisted beneath the exact
      // top-rail instance that replaces their common envelope. Object
      // 1500238 in the supplied file is this shape: its only descendants
      // are rail-path drawing aids, while owner 1500236 is admitted native.
      stairAssembliesWithRecoveredChildren.add(child.elementId);
    }
    if (
      owner?.categoryId === -2000120 &&
      child &&
      child.elementId !== owner.elementId &&
      (
        nativeMeshScene.coveredElementIds.has(child.elementId) ||
        nativeMeshScene.reconstructedElementIds.has(child.elementId) ||
        !isStairOrRailingHelperProxy(
          child,
          markerByElement.get(child.elementId),
        )
      )
    ) {
      stairAssembliesWithRecoveredChildren.add(owner.elementId);
    }
  }
  const curtainAssemblyHelpers = curtainAssemblyHelperProxyIds(
    elementBounds,
    elementOwnership?.relations ?? [],
    nativeMeshScene.coveredElementIds,
  );
  const anonymousWallDuplicates = anonymousWallDuplicateProxyIds(displayBounds);
  for (const record of displayBounds) {
    if (nativeMeshScene.coveredElementIds.has(record.elementId)) continue;
    if (curtainAssemblyHelpers.has(record.elementId)) {
      omittedCurtainAssemblyProxyCount += 1;
      continue;
    }
    const recoveredStairAssembly =
      record.categoryId === -2000120 &&
      stairAssembliesWithRecoveredChildren.has(record.elementId);
    if (
      recoveredStairAssembly ||
      (
        record.categoryId !== -2000120 &&
        (
          anonymousWallDuplicates.has(record.elementId) ||
          isStairOrRailingHelperProxy(
            record,
            markerByElement.get(record.elementId),
          )
        )
      )
    ) {
      omittedHelperProxyCount += 1;
      continue;
    }
    proxyDisplayBounds.push(record);
  }
  const proxyIds = new Set(
    proxyDisplayBounds.map((record) => record.elementId),
  );
  for (const record of displayBounds) {
    if (nativeMeshScene.reconstructedElementIds.has(record.elementId)) {
      record.renderGeometryProvenance = "reconstructed";
    } else if (nativeMeshScene.coveredElementIds.has(record.elementId)) {
      record.renderGeometryProvenance = "native";
    } else if (!proxyIds.has(record.elementId)) {
      record.renderGeometryProvenance = "not-rendered-helper";
    } else if (record.inferredCurtainPanelGeometry) {
      record.renderGeometryProvenance = "boundary-clipped-proxy";
    } else if (
      record.stairTreads?.length ||
      record.railPath ||
      record.loops?.length ||
      record.orientedBox ||
      record.solids?.length ||
      record.solid ||
      record.arcs?.length ||
      record.curtainPanelSurfaceQuads?.length
    ) {
      record.renderGeometryProvenance = "reconstructed";
    } else {
      record.renderGeometryProvenance = "bounds-fallback";
    }
  }
  const meshes = [
    ...buildBoundsMeshes(
      proxyDisplayBounds,
      origin,
      displaySelection.openingWrappers,
      proxyMaterialIndexByElement,
      hostedOpeningsByWall,
    ),
    ...nativeMeshScene.meshes,
  ];
  const segments = boundsPlanSegments(displayBounds);
  const relativeBounds = {
    min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
    max: {
      x: bounds.max.x - origin.x,
      y: bounds.max.y - origin.y,
      z: bounds.max.z - origin.z,
    },
  };
  return {
    origin,
    bbox: relativeBounds,
    // Prefer the storeys the file states over storeys inferred from a pile
    // of elevations. `levelsFromRelations` is given every recovered record
    // rather than only the drawn ones, because an element held back from
    // the scene still says which level it sits on.
    levels: nativeAssociatedLevelRelations.length
      ? levelsFromRelations(elementBounds, nativeAssociatedLevelRelations)
      : levelsForBounds(displayBounds),
    meshes,
    segments,
    displayRecordCount: displayBounds.length,
    proxyRecordCount: proxyDisplayBounds.length,
    nativeCoveredRecordCount: nativeMeshScene.coveredElementIds.size,
    report: {
      kind: "scene",
      drawableRecords: boundedSolids.length,
      displaySelection,
      meshScene: nativeMeshScene,
      meshCollection: nativeMeshCollection,
      meshCleanup: nativeMeshCleanup,
      wallProxyReplacements: nativeWallProxyReplacements.size,
      inferredCurtainPanels: inferredCurtainPanelCount,
      omittedHelperProxies: omittedHelperProxyCount,
      omittedCurtainAssemblyProxies: omittedCurtainAssemblyProxyCount,
    },
  };
}
