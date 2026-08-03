"use client";

/** The WebGL viewport: scene assembly, camera presets, picking, and disposal. */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  boundsDimensions,
  cameraPoseForPreset,
  DEFAULT_CAMERA_PRESET,
  type ConvertResult,
  type NavigationMode,
  type PairedRegressionResult,
  type RenderMode,
} from "../../lib/reviter";
import {
  referenceHomePose,
  referenceIsYUp,
  referenceModelBounds,
  referencePoseForPreset,
  styleReferenceModel,
} from "./reference-model.ts";
import { batchReferenceScene, setReferenceOutlineMode } from "./reference-scene.ts";
import {
  applyNavigationMode,
  disposeGroup,
  meshGroup,
  overlayMeshGroup,
  referenceMeshGroup,
} from "./three-scene.ts";
import {
  addPendingMeasurementPoint,
  applyClippingPlanes,
  applyExplode,
  clearMeasurements,
  clearPendingMeasurement,
  collectExplodeParts,
  commitMeasurement,
  createMeasurementScene,
  createSectionHelper,
  deleteLastMeasurement,
  disposeMeasurementScene,
  sectionPlanes,
  updateMeasurementPreview,
  type ExplodePart,
  type MeasurementScene,
} from "./scene-tools.ts";
import {
  createWalkControls,
  WALK_EYE_HEIGHT,
  WALK_MAX_STEP_UP,
  type WalkControls,
  type WalkSpeed,
} from "./walk-controls.ts";
import {
  geometryTriangleCount,
  WalkCollisionIndex,
  WalkSurfaceIndex,
} from "./walk-surface.ts";
import { SourceAssetCache } from "./source-asset-cache.ts";
import {
  ExplodeToolPanel,
  FirstPersonPanel,
  MeasureToolPanel,
  SectionToolPanel,
} from "./ViewerToolPanels.tsx";
import { ModelCommentLayer, type CommentProjection } from "./ModelCommentLayer.tsx";
import { MarkupLayer, type MarkupProjection, type ScreenPoint } from "./MarkupLayer.tsx";
import type {
  CameraRequest,
  CanvasMenuRequest,
  GeometrySource,
  ReferenceLoadState,
  WalkStartRequest,
} from "./types.ts";
import {
  createElementSelection,
  createFaceSelection,
  createRecoveredElementSelection,
  firstTriangleHit,
  hitWorldNormal,
  type ViewerIntersection,
} from "./viewer-picking.ts";
import {
  formatMeasuredLength,
  measuredAngleDegrees,
  modelFeetToScenePoint,
  selectedStairWalkStart,
  sceneUnitsPerPixel,
  scenePointToModelFeet,
  type MarkupStroke,
  type MarkupTool,
  type ModelComment,
  type MeasureMode,
  type MeasureUnit,
  type NewMarkupStroke,
  type NewModelComment,
  type Point3Tuple,
  type SectionMode,
} from "./viewer-tools.ts";

function tuple(point: THREE.Vector3): Point3Tuple {
  return [point.x, point.y, point.z];
}

// Large enough to amortize one idle callback without monopolizing a frame on
// the million-triangle UNBC model (typically a few milliseconds of CPU work).
const WALK_INDEX_CHUNK_TRIANGLES = 8_192;

/**
 * Native categories whose horizontal caps must not become gravity floors.
 *
 * These objects remain in the optional Solid collision index. Only their top
 * faces are excluded from Ghost's floor follower, preventing a walker from
 * stepping onto a wall, mullion, door, column, railing or drawing helper when
 * its cap happens to fall inside the 1.5 ft step-up band.
 */
const NON_WALKABLE_SURFACE_CATEGORIES = new Set([
  -2000011, // Walls
  -2000014, // Windows
  -2000023, // Doors
  -2000038, // Ceilings
  -2000045, // Sketch Lines
  -2000067, // Stairs Sketch Boundary Lines
  -2000100, // Columns
  -2000123, // Stairs Stringer Carriage
  -2000126, // Stairs Railing
  -2000127, // Stairs Railing Baluster
  -2000120, // Stairs assembly containers
  -2000170, // Curtain Wall Panels
  -2000171, // Curtain Wall Mullions
  -2000321, // Curtain Grids Wall
  -2000938, // Stairs Paths
  -2000946, // Railing Top Rail
  -2000954, // Railing Rail Path Extension Lines
]);

type NormalizedCameraPose = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
};

type ReferenceBounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

type CachedSourceAssets = {
  root: THREE.Group;
  disposed: boolean;
  walkSurface: WalkSurfaceIndex | null;
  walkCollision: WalkCollisionIndex | null;
  walkIndexDirty: boolean;
  walkSurfaceBuildMs: number | null;
  walkCollisionBuildMs: number | null;
  referenceBounds: ReferenceBounds | null;
  referenceState: ReferenceLoadState;
  referenceLoad: Promise<void> | null;
};

/** Convert a scene vector into the recovery's canonical z-up axes. */
function canonicalCameraVector(vector: THREE.Vector3, up: "y" | "z"): THREE.Vector3 {
  return up === "y"
    ? new THREE.Vector3(vector.x, -vector.z, vector.y)
    : vector.clone();
}

/** Convert a canonical z-up vector into a scene's declared axes. */
function sceneCameraVector(vector: THREE.Vector3, up: "y" | "z"): THREE.Vector3 {
  return up === "y"
    ? new THREE.Vector3(vector.x, vector.z, -vector.y)
    : vector.clone();
}

function commentScenePoint(
  comment: ModelComment,
  source: GeometrySource,
  result: ConvertResult,
): THREE.Vector3 | null {
  if (comment.modelPositionFeet && source !== "reference-model") {
    const position = modelFeetToScenePoint(
      comment.modelPositionFeet,
      source,
      [result.origin.x, result.origin.y, result.origin.z],
    );
    return position ? new THREE.Vector3(...position) : null;
  }
  return comment.source === source ? new THREE.Vector3(...comment.scenePosition) : null;
}

/**
 * A stroke's anchors in the coordinates the current source is drawn in.
 *
 * Registered feet are preferred for the same reason comments prefer them: a
 * redline put on the recovery is about the building, so it belongs over the
 * paired export too. A stroke that cannot be registered shows only on the
 * source it was drawn on.
 */
function markupScenePoints(
  stroke: MarkupStroke,
  source: GeometrySource,
  result: ConvertResult,
): THREE.Vector3[] | null {
  if (stroke.pointsFeet && source !== "reference-model") {
    const origin: Point3Tuple = [result.origin.x, result.origin.y, result.origin.z];
    const placed: THREE.Vector3[] = [];
    for (const pointFeet of stroke.pointsFeet) {
      const position = modelFeetToScenePoint(pointFeet, source, origin);
      if (!position) return null;
      placed.push(new THREE.Vector3(...position));
    }
    return placed;
  }
  if (stroke.source !== source) return null;
  return stroke.points.map((point) => new THREE.Vector3(...point));
}

export type MarkupSettings = {
  /** Null when no markup tool is armed. */
  tool: MarkupTool | null;
  color: string;
  weight: number;
  text: string;
};

export function ModelCanvas({
  result,
  comparison,
  source,
  renderMode,
  navigationMode,
  cameraRequest,
  measuring,
  sectioning,
  onSectionClear,
  exploding,
  commenting,
  comments,
  visibleCommentIds,
  activeCommentId,
  onActiveComment,
  onCreateComment,
  viewpointRequest,
  markup,
  markupSettings,
  onCreateMarkup,
  onDeleteMarkup,
  walking,
  onWalkingChange,
  walkStartRequest,
  selectedElementId,
  onSelectElement,
  hiddenElementIds,
  onHoverElement,
  onCanvasMenu,
  focusRequest,
  referenceModelUrl,
}: {
  result: ConvertResult;
  comparison: PairedRegressionResult | null;
  source: GeometrySource;
  /** Object URL of a paired GLB/glTF reference, when the user has supplied one. */
  referenceModelUrl: string | null;
  renderMode: RenderMode;
  navigationMode: NavigationMode;
  cameraRequest: CameraRequest;
  measuring: boolean;
  sectioning: boolean;
  onSectionClear: () => void;
  exploding: boolean;
  commenting: boolean;
  comments: readonly ModelComment[];
  /** The ids the Comments filter is showing, or null when it is showing all. */
  visibleCommentIds: ReadonlySet<string> | null;
  activeCommentId: string | null;
  onActiveComment: (id: string | null) => void;
  onCreateComment: (comment: NewModelComment) => string;
  /**
   * "Restore the camera this comment was written from." The sequence number is
   * what makes asking for the same viewpoint twice a new request rather than a
   * no-op, exactly as `focusRequest` does for framing an object.
   */
  viewpointRequest: { commentId: string | null; sequence: number };
  /** Strokes already committed to this model, in scene coordinates. */
  markup: readonly MarkupStroke[];
  markupSettings: MarkupSettings;
  onCreateMarkup: (stroke: NewMarkupStroke) => void;
  onDeleteMarkup: (id: string) => void;
  walking: boolean;
  onWalkingChange: (walking: boolean) => void;
  walkStartRequest: WalkStartRequest;
  selectedElementId: number | null;
  onSelectElement: (elementId: number | null) => void;
  hiddenElementIds: ReadonlySet<number>;
  onHoverElement: (elementId: number | null) => void;
  onCanvasMenu: (request: CanvasMenuRequest | null) => void;
  focusRequest: { elementId: number | null; sequence: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sourceCache] = useState(() =>
    // One entry for each source in the active visual style. Keeping both
    // Shaded and X-ray copies of every million-triangle root would trade the
    // switch delay for an avoidable GPU-memory spike; changing style therefore
    // ages the least-recently-used source out instead of retaining eight roots.
    new SourceAssetCache<CachedSourceAssets>(4, (assets) => {
      assets.disposed = true;
      disposeGroup(assets.root);
    }),
  );
  const runtimeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    root: THREE.Group;
    center: THREE.Vector3;
    radius: number;
    bounds: THREE.Box3;
    floor: number;
    up: "y" | "z";
    sceneUnitsPerFoot: number;
    surfaceFloorAt: (eyePosition: THREE.Vector3, maxDrop?: number) => number | null;
    resolveMovement: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3;
    /**
     * Build (or rebuild, after `walkIndexDirty`) the spatial walk indexes for a
     * recovered-geometry scene. Called on walk entry, so a session that never
     * walks never pays for it.
     */
    prepareWalkIndexes: () => Promise<void>;
    walkIndexDirty: boolean;
    invalidateWalkIndexes: () => void;
    /** Floor picked before entering Walk, consumed by the next walk session. */
    walkStart: { point: THREE.Vector3; normal: THREE.Vector3 } | null;
    selectionOverlay: THREE.Group | null;
    measurement: MeasurementScene;
    sectionHelper: THREE.Group | null;
    explodeParts: ExplodePart[];
    invalidate: () => void;
  } | null>(null);
  const walkRef = useRef<WalkControls | null>(null);
  const walkingRef = useRef(walking);
  useEffect(() => {
    walkingRef.current = walking;
  }, [walking]);
  // Measured from the reference once it loads; null until then.
  const referenceBoundsRef = useRef<
    { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null
  >(null);
  const [referenceLoadState, setReferenceLoadState] = useState<ReferenceLoadState>("idle");
  const [walkSpeed, setWalkSpeed] = useState<WalkSpeed>("normal");
  const [walkGravity, setWalkGravity] = useState(true);
  // Off by default: the walkthrough is for reading the building, and gliding
  // through a closed door beats hunting for an opening. The paired reference
  // model walks this way too — it has no collision representation at all.
  const [walkCollision, setWalkCollision] = useState(false);
  const [walkLooking, setWalkLooking] = useState(false);
  const [walkPreparing, setWalkPreparing] = useState(false);
  const [walkGuideOpen, setWalkGuideOpen] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("distance");
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>("feet");
  const [measureCalibration, setMeasureCalibration] = useState(1);
  const [calibrationSample, setCalibrationSample] = useState<number | null>(null);
  const [knownCalibrationLength, setKnownCalibrationLength] = useState("10");
  const [measurementReadings, setMeasurementReadings] = useState<Array<{ id: number; label: string }>>([]);
  const [measureSettingsOpen, setMeasureSettingsOpen] = useState(false);
  const [sectionMode, setSectionMode] = useState<SectionMode>("z");
  const [sectionOffset, setSectionOffset] = useState(0.5);
  const [sectionReverse, setSectionReverse] = useState(false);
  const [explodeAmount, setExplodeAmount] = useState(0);
  const [explodePartCount, setExplodePartCount] = useState(0);
  /**
   * The stroke under the cursor right now. Held as state so the layer renders a
   * node for it, but its `points` array is grown in place while the pointer
   * moves — the layer reads the array every frame, so a re-render per sample
   * would buy nothing and cost a lot on a 40,000-object scene.
   */
  const [markupDraft, setMarkupDraft] = useState<MarkupStroke | null>(null);
  const markupDraftRef = useRef<MarkupStroke | null>(null);
  // Pinning a comment activates it, and the scene effect that owns the pointer
  // handler is rebuilt only when the model or the source changes. The callback
  // rides on a ref so a new function identity from the shell does not tear the
  // WebGL scene down and build it again.
  const activateCommentRef = useRef(onActiveComment);
  // Markup settings and sinks ride on refs for the same reason: the pointer
  // handlers live in the scene effect, and rebuilding that effect tears down
  // the WebGL scene.
  const markupSettingsRef = useRef(markupSettings);
  const createMarkupRef = useRef(onCreateMarkup);
  const walkSpeedRef = useRef<WalkSpeed>("normal");
  const walkGravityRef = useRef(true);
  const walkCollisionRef = useRef(false);
  const selectedElementIdRef = useRef(selectedElementId);
  const matchedCameraRef = useRef<NormalizedCameraPose | null>(null);
  // A source rebuild while Walk owns the camera must resume from the eye, not
  // from OrbitControls' target in front of it. Ordinary Orbit -> Walk entry
  // still uses that target as the convenient default floor location.
  const walkCameraHandoffPendingRef = useRef(false);
  const appliedCameraRequestRef = useRef(cameraRequest.sequence);
  const measuringRef = useRef(false);
  const commentingRef = useRef(false);
  const measureModeRef = useRef<MeasureMode>("distance");
  const measureUnitRef = useRef<MeasureUnit>("feet");
  const measureCalibrationRef = useRef(1);
  const measurementIdRef = useRef(1);
  const appliedWalkStartRequestRef = useRef(walkStartRequest.sequence);

  useEffect(() => {
    selectedElementIdRef.current = selectedElementId;
  }, [selectedElementId]);

  useEffect(() => () => {
    sourceCache.clear();
  }, [sourceCache]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("reviter.first-person-guide") === "hidden") {
        queueMicrotask(() => setWalkGuideOpen(false));
      }
    } catch {
      // Private browsing or a storage policy can deny access; the guide still works.
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const navigationTest = new URLSearchParams(window.location.search).has("navigation-test");

    const technical = renderMode === "technical";
    const isReferenceModel = source === "reference-model";
    const scene = new THREE.Scene();
    scene.background = isReferenceModel && technical
      ? null
      : new THREE.Color(technical ? 0xeaf1f8 : 0x081419);
    scene.fog = new THREE.FogExp2(
      technical ? 0xeaf1f8 : 0x081419,
      technical ? 0.00015 : 0.00045,
    );

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: isReferenceModel && technical,
      powerPreference: "high-performance",
      // First-person uses a close near plane across a campus-scale model.
      // Reverse-Z keeps substantially more precision at the wall distances
      // where recovered faces differ by only a few millionths of a foot.
      reversedDepthBuffer: true,
    });
    // The recovered path used to run at 2x device pixels against the reference
    // path's 1.5 — a constant fill-rate penalty on exactly the heavier scene,
    // for a difference MSAA already papers over.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = technical ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = technical ? 0.95 : 1.08;
    // Autodesk derivatives are intentionally shadow-free in this viewer.
    // Recovered meshes need the same policy: their unwelded, double-sided wall
    // faces self-shadow into a stippled pattern that shimmers during movement.
    // Keeping shadows disabled in every navigation mode also avoids making an
    // orbit/first-person switch change the building's material appearance.
    renderer.shadowMap.enabled = false;
    renderer.localClippingEnabled = false;
    if (isReferenceModel && technical) renderer.setClearColor(0xffffff, 0);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    applyNavigationMode(controls, "orbit");

    const useReference = source === "reference" && comparison?.referenceMeshes.length;
    // The overlay is drawn in the recovered model's own frame, so it keeps that
    // model's bounds and stays pickable.
    const useOverlay = source === "overlay" && comparison?.referenceMeshes.length;
    const sceneUnitsPerFoot = isReferenceModel || useReference ? 0.3048 : 1;
    const reverseDepthBuffer = renderer.capabilities.reversedDepthBuffer;
    const cacheKey = `${source}:${renderMode}`;
    const cacheOwners = source === "recovered"
      ? [result, hiddenElementIds]
      : source === "reference-model"
        ? [result, referenceModelUrl]
        : [result, comparison];
    const cachedSource = sourceCache.acquire(cacheKey, cacheOwners, () => ({
      root: isReferenceModel
        ? new THREE.Group()
        : useOverlay
          ? overlayMeshGroup(
              result,
              comparison.referenceMeshes,
              renderMode,
              reverseDepthBuffer,
            )
          : useReference
            ? referenceMeshGroup(comparison.referenceMeshes, renderMode)
            : meshGroup(result, renderMode, hiddenElementIds, reverseDepthBuffer),
      disposed: false,
      walkSurface: null,
      walkCollision: null,
      walkIndexDirty: false,
      walkSurfaceBuildMs: null,
      walkCollisionBuildMs: null,
      referenceBounds: null,
      referenceState: "idle",
      referenceLoad: null,
    }));
    const sourceAssets = cachedSource.value;
    const root = sourceAssets.root;
    canvas.dataset.sceneCache = cachedSource.hit ? "hit" : "miss";
    if (isReferenceModel) referenceBoundsRef.current = sourceAssets.referenceBounds;
    // A paired reference's extent is measured when it arrives, not declared.
    // Until then the recovery's own bounds frame the empty scene, which is the
    // right guess: the two are the same building.
    const bounds = isReferenceModel
      ? sourceAssets.referenceBounds ?? result.bbox
      : useReference
        ? comparison.referenceBoundsMetres
        : result.bbox;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(
      technical ? 0xf8fbff : 0xccefff,
      technical ? 0x9da6ad : 0x102026,
      technical ? 0.9 : 1.45,
    ));
    scene.add(new THREE.AmbientLight(technical ? 0xffffff : 0x16333a, technical ? 0.25 : 0.18));
    const sun = new THREE.DirectionalLight(
      technical ? 0xfff7e8 : 0xfff4d8,
      technical ? 1.6 : 2.3,
    );
    const sunOffset = new THREE.Vector3(
      180,
      isReferenceModel ? 280 : -120,
      isReferenceModel ? -120 : 280,
    );
    sun.castShadow = false;
    scene.add(sun);

    const dx = bounds.max.x - bounds.min.x;
    const dy = bounds.max.y - bounds.min.y;
    const dz = bounds.max.z - bounds.min.z;
    let radius = Math.max(25 * sceneUnitsPerFoot, dx, dy, dz) * 0.62;
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const sceneBounds = new THREE.Box3(
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    );
    let up = (
      isReferenceModel && referenceBoundsRef.current
        ? (referenceIsYUp(sourceAssets.referenceBounds ?? referenceBoundsRef.current) ? "y" : "z")
        : isReferenceModel ? "y" : "z"
    ) as "y" | "z";
    sun.position.copy(center).add(sunOffset);
    sun.target.position.copy(center);
    scene.add(sun.target);
    controls.target.copy(center);

    const grid = new THREE.GridHelper(
      Math.max(dx, isReferenceModel ? dz : dy, 100) * 1.35,
      32,
      technical ? 0x667f9b : 0x3c7176,
      technical ? 0x91a7bf : 0x17363d,
    );
    if (isReferenceModel) grid.position.y = bounds.min.y - 0.04;
    else {
      grid.rotation.x = Math.PI / 2;
      grid.position.z = bounds.min.z - 0.04;
    }
    // The technical GLB presentation has no model grid. Keep the grid as an
    // X-ray diagnostic aid, but remove it from the matched Shaded comparison.
    grid.visible = !technical && !isReferenceModel;
    if (technical && Array.isArray(grid.material)) {
      for (const material of grid.material) {
        material.transparent = true;
        material.opacity = 0.34;
      }
    }
    scene.add(grid);

    // A reference that has already been measured opens on its own framing; one
    // that has not yet arrived borrows the recovery's, because it is the same
    // building and that beats opening on nothing.
    const pose = isReferenceModel && referenceBoundsRef.current
      ? referenceHomePose(referenceBoundsRef.current)
      : { ...cameraPoseForPreset(center, radius, DEFAULT_CAMERA_PRESET), target: center, fov: 45 };
    const poseTarget = pose.target;
    camera.fov = pose.fov;
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.near = Math.max(0.1, radius / 1_000);
    camera.far = radius * 30;
    camera.lookAt(poseTarget);
    controls.target.copy(poseTarget);
    camera.updateProjectionMatrix();
    controls.update();

    const applyMatchedCamera = (): boolean => {
      const matched = matchedCameraRef.current;
      if (!matched) return false;
      const position = sceneCameraVector(
        matched.position.clone().multiplyScalar(radius),
        up,
      ).add(center);
      const target = sceneCameraVector(
        matched.target.clone().multiplyScalar(radius),
        up,
      ).add(center);
      camera.position.copy(position);
      camera.up.copy(sceneCameraVector(matched.up, up).normalize());
      camera.lookAt(target);
      controls.target.copy(target);
      controls.update();
      return true;
    };
    // A reference has to wait for its own measured bounds. Recovered geometry
    // already has trustworthy bounds, so a camera handed off from the GLB can
    // be placed immediately.
    if (!isReferenceModel) applyMatchedCamera();

    const raycaster = new THREE.Raycaster();
    const floorRaycaster = new THREE.Raycaster();
    const collisionRaycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const measurement = createMeasurementScene(scene);
    let needsRender = true;
    let cameraInteracting = false;
    const handleControlsChange = () => {
      needsRender = true;
    };
    const handleControlsStart = () => {
      cameraInteracting = true;
    };
    const handleControlsEnd = () => {
      cameraInteracting = false;
    };
    controls.addEventListener("change", handleControlsChange);
    controls.addEventListener("start", handleControlsStart);
    controls.addEventListener("end", handleControlsEnd);
    let interactionMeshes: THREE.Object3D[] = [];
    const refreshInteractionMeshes = () => {
      interactionMeshes = [];
      root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) interactionMeshes.push(object);
      });
    };
    refreshInteractionMeshes();
    /** The geometry hit test shared by picking and first-person teleporting. */
    const geometryHitAt = (clientX: number, clientY: number): ViewerIntersection | undefined => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      // In the overlay the recovered meshes sit a level deeper, under their own
      // group, and the export's meshes carry no element ids — so the search goes
      // recursive and takes the first hit that can actually name an element.
      return firstTriangleHit(raycaster, interactionMeshes, (intersection) =>
        !useOverlay || intersection.object.userData.elementIds != null);
    };
    // glTF declares +Y up, so a reference normally is; but ask the geometry
    // rather than assume, so a z-up reference is not drawn on its side.
    const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const downVector = upVector.clone().negate();
    let active = true;
    let referenceWalkSurface: WalkSurfaceIndex | null = isReferenceModel
      ? sourceAssets.walkSurface
      : null;
    // Spatial indexes for first-person walking over recovered geometry; built
    // on walk entry, and rebuilt when something has moved the meshes since.
    // The reference path had these from the start; the recovered path was
    // handing every batch to Raycaster.intersectObjects every frame instead,
    // which is where the first-person lag came from.
    let recoveredWalkSurface: WalkSurfaceIndex | null = isReferenceModel
      ? null
      : sourceAssets.walkSurface;
    let recoveredWalkCollision: WalkCollisionIndex | null = isReferenceModel
      ? null
      : sourceAssets.walkCollision;
    let walkIndexBuild: Promise<void> | null = null;
    let collisionIndexBuild: Promise<void> | null = null;
    let walkIndexBuildVersion = 0;
    let collisionIndexBuildVersion = 0;
    canvas.dataset.activeSource = source;
    canvas.dataset.walkSurfaceCache = recoveredWalkSurface || referenceWalkSurface ? "hit" : "miss";
    canvas.dataset.walkCollisionCache = recoveredWalkCollision ? "hit" : "miss";
    canvas.dataset.walkIndexState = referenceWalkSurface || recoveredWalkCollision
      ? "ready"
      : recoveredWalkSurface
        ? "surface-ready"
        : "empty";
    canvas.dataset.walkIndexState = recoveredWalkCollision
      ? "ready"
      : recoveredWalkSurface || referenceWalkSurface ? "surface-ready" : "idle";
    if (!isReferenceModel) delete canvas.dataset.referenceCache;
    if (sourceAssets.walkSurfaceBuildMs != null) {
      canvas.dataset.walkIndexBuildMs = sourceAssets.walkSurfaceBuildMs.toFixed(1);
    } else delete canvas.dataset.walkIndexBuildMs;
    if (sourceAssets.walkCollisionBuildMs != null) {
      canvas.dataset.walkCollisionBuildMs = sourceAssets.walkCollisionBuildMs.toFixed(1);
    } else delete canvas.dataset.walkCollisionBuildMs;
    const waitForIdleSlice = () => new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 50 });
      } else {
        window.setTimeout(resolve, 0);
      }
    });
    const walkGeometryJobs = () => {
      root.updateMatrixWorld(true);
      return interactionMeshes.map((object) => {
        const mesh = object as THREE.Mesh;
        return {
          geometry: mesh.geometry,
          matrix: mesh.matrixWorld.clone(),
          triangleCount: geometryTriangleCount(mesh.geometry),
          elementIds: mesh.userData.elementIds as Uint32Array | undefined,
        };
      });
    };
    const excludedWalkSurfaceElementIds = new Set(
      result.elementBounds
        .filter((record) =>
          record.categoryId != null &&
          NON_WALKABLE_SURFACE_CATEGORIES.has(record.categoryId))
        .map((record) => record.elementId),
    );
    const prepareCollisionIndex = (
      jobs: ReturnType<typeof walkGeometryJobs>,
      buildVersion: number,
    ): void => {
      if (recoveredWalkCollision || collisionIndexBuild || isReferenceModel) return;
      const collisionBuildVersion = ++collisionIndexBuildVersion;
      const collisionStartedAt = performance.now();
      const build = (async () => {
        const collision = new WalkCollisionIndex({ up, cellSize: 4 * sceneUnitsPerFoot });
        for (const job of jobs) {
          for (
            let startTriangle = 0;
            startTriangle < job.triangleCount;
            startTriangle += WALK_INDEX_CHUNK_TRIANGLES
          ) {
            await waitForIdleSlice();
            if (!active
              || buildVersion !== walkIndexBuildVersion
              || collisionBuildVersion !== collisionIndexBuildVersion
              || sourceAssets.walkIndexDirty) return;
            collision.addGeometry(job.geometry, job.matrix, {
              startTriangle,
              triangleCount: Math.min(WALK_INDEX_CHUNK_TRIANGLES, job.triangleCount - startTriangle),
            });
          }
        }
        if (!active
          || buildVersion !== walkIndexBuildVersion
          || collisionBuildVersion !== collisionIndexBuildVersion
          || sourceAssets.walkIndexDirty) return;
        recoveredWalkCollision = collision;
        sourceAssets.walkCollision = collision;
        sourceAssets.walkCollisionBuildMs = performance.now() - collisionStartedAt;
        canvas.dataset.walkCollisionBuildMs = sourceAssets.walkCollisionBuildMs.toFixed(1);
        canvas.dataset.walkCollisionCache = "ready";
        canvas.dataset.walkIndexState = "ready";
      })().catch(() => {
        // Solid can keep using its accurate raycast fallback if indexing it
        // fails; Ghost and floor following are already ready.
        canvas.dataset.walkIndexState = "surface-ready";
      }).finally(() => {
        if (collisionIndexBuild === build) collisionIndexBuild = null;
      });
      collisionIndexBuild = build;
    };
    const prepareWalkIndexes = (): Promise<void> => {
      if (isReferenceModel) return Promise.resolve();
      if (recoveredWalkSurface && !sourceAssets.walkIndexDirty) {
        canvas.dataset.walkSurfaceCache = "hit";
        canvas.dataset.walkIndexState = recoveredWalkCollision ? "ready" : "surface-ready";
        if (!recoveredWalkCollision && !collisionIndexBuild) {
          prepareCollisionIndex(walkGeometryJobs(), walkIndexBuildVersion);
        }
        return Promise.resolve();
      }
      if (walkIndexBuild) return walkIndexBuild;

      const buildVersion = ++walkIndexBuildVersion;
      const build = (async () => {
        // An explode can move meshes while an idle build is in flight. Repeat
        // from a fresh matrix snapshot until one complete pass stays clean.
        while (active && buildVersion === walkIndexBuildVersion) {
          const runtime = runtimeRef.current;
          if (!runtime) return;
          runtime.walkIndexDirty = false;
          sourceAssets.walkIndexDirty = false;
          recoveredWalkCollision = null;
          sourceAssets.walkCollision = null;
          const jobs = walkGeometryJobs();
          const surface = new WalkSurfaceIndex({ up, cellSize: 1.25 * sceneUnitsPerFoot });
          const startedAt = performance.now();
          for (const job of jobs) {
            for (
              let startTriangle = 0;
              startTriangle < job.triangleCount;
              startTriangle += WALK_INDEX_CHUNK_TRIANGLES
            ) {
              await waitForIdleSlice();
              if (!active || buildVersion !== walkIndexBuildVersion) return;
              const range = {
                startTriangle,
                triangleCount: Math.min(WALK_INDEX_CHUNK_TRIANGLES, job.triangleCount - startTriangle),
                elementIds: job.elementIds,
                excludedSurfaceElementIds: excludedWalkSurfaceElementIds,
              };
              surface.addGeometry(job.geometry, job.matrix, range);
            }
          }
          if (runtime.walkIndexDirty || sourceAssets.walkIndexDirty) continue;
          recoveredWalkSurface = surface;
          sourceAssets.walkSurface = surface;
          sourceAssets.walkSurfaceBuildMs = performance.now() - startedAt;
          canvas.dataset.walkIndexBuildMs = sourceAssets.walkSurfaceBuildMs.toFixed(1);
          canvas.dataset.walkSurfaceCache = "ready";
          canvas.dataset.walkIndexState = "surface-ready";
          // Ghost is the default and needs only the floor index. Solid is beta,
          // so prepare its steep-triangle collision index afterward without
          // making the common Walk entry wait for optional work.
          prepareCollisionIndex(jobs, buildVersion);
          return;
        }
      })();
      canvas.dataset.walkIndexState = "building";
      walkIndexBuild = build.catch(() => {
        // The existing raycast fallback keeps Walk usable if an unusually large
        // or malformed mesh cannot be indexed; do not strand the entry screen.
        canvas.dataset.walkIndexState = "fallback";
      }).finally(() => {
        if (buildVersion === walkIndexBuildVersion) walkIndexBuild = null;
      });
      return walkIndexBuild;
    };
    const surfaceFloorAt = (eyePosition: THREE.Vector3, maxDrop?: number) => {
      if (isReferenceModel && referenceWalkSurface) {
        const eyeCoordinate = up === "y" ? eyePosition.y : eyePosition.z;
        const continuousProbe = maxDrop == null;
        return referenceWalkSurface.floorAt(eyePosition, {
          maxDrop: maxDrop ?? (WALK_EYE_HEIGHT + 12) * sceneUnitsPerFoot,
          maximumHeight: continuousProbe
            ? eyeCoordinate
              - WALK_EYE_HEIGHT * sceneUnitsPerFoot
              + WALK_MAX_STEP_UP * sceneUnitsPerFoot
            : eyeCoordinate,
        });
      }
      if (isReferenceModel) return null;
      // Walking queries the spatial index; the raycast below only serves the
      // occasional probe made before a walk has built it.
      if (recoveredWalkSurface) {
        const eyeCoordinate = up === "y" ? eyePosition.y : eyePosition.z;
        const continuousProbe = maxDrop == null;
        return recoveredWalkSurface.floorAt(eyePosition, {
          maxDrop: maxDrop ?? (WALK_EYE_HEIGHT + 12) * sceneUnitsPerFoot,
          maximumHeight: continuousProbe
            ? eyeCoordinate
              - WALK_EYE_HEIGHT * sceneUnitsPerFoot
              + WALK_MAX_STEP_UP * sceneUnitsPerFoot
            : eyeCoordinate,
        });
      }
      const origin = eyePosition.clone().addScaledVector(upVector, 1.5);
      floorRaycaster.set(origin, downVector);
      floorRaycaster.near = 0;
      floorRaycaster.far = maxDrop ?? (WALK_EYE_HEIGHT + 12) * sceneUnitsPerFoot;
      const hit = firstTriangleHit(floorRaycaster, interactionMeshes, (intersection) => {
        if (!intersection.face) return false;
        const worldNormal = hitWorldNormal(intersection);
        return Math.abs(worldNormal.dot(upVector)) >= 0.45;
      });
      return hit ? (up === "y" ? hit.point.y : hit.point.z) : null;
    };
    const resolveWalkMovement = (from: THREE.Vector3, to: THREE.Vector3) => {
      // The reference derivative has no lightweight collision representation
      // yet. Keep its first-person movement responsive and use picked-surface
      // travel for precise placement instead of scanning every batch each frame.
      if (isReferenceModel) return to;
      // Ghost movement is the default: colliding with every wall, door leaf,
      // and pane is realistic and mostly in the way. Solid is one toggle over.
      if (!walkCollisionRef.current) return to;
      const delta = to.clone().sub(from);
      const vertical = delta.dot(upVector);
      const horizontal = delta.addScaledVector(upVector, -vertical);
      const distance = horizontal.length();
      if (distance < 1e-6) return to;
      const margin = 0.72 * sceneUnitsPerFoot;
      let hitDistance: number | null = null;
      if (recoveredWalkCollision) {
        // The per-frame path: a step sweeps a couple of feet, so the index
        // opens a handful of plan cells instead of every batch in the scene.
        hitDistance = recoveredWalkCollision.nearestHit(
          from,
          horizontal.normalize(),
          distance + margin,
        );
      } else {
        collisionRaycaster.set(from, horizontal.normalize());
        collisionRaycaster.near = 0;
        collisionRaycaster.far = distance + margin;
        const hit = firstTriangleHit(collisionRaycaster, interactionMeshes);
        hitDistance = hit && hit.distance <= distance + margin ? hit.distance : null;
      }
      if (hitDistance == null) return to;
      return from.clone()
        .addScaledVector(horizontal, Math.max(0, hitDistance - margin))
        .addScaledVector(upVector, vertical);
    };
    const addMeasurementHit = (point: THREE.Vector3) => {
      const mode = measureModeRef.current;
      addPendingMeasurementPoint(measurement, point, radius);
      const requiredPoints = mode === "angle" ? 3 : mode === "coordinates" || mode === "laser" ? 1 : 2;
      if (measurement.pending.length < requiredPoints) return;
      const points = commitMeasurement(measurement, radius);
      const id = measurementIdRef.current++;
      let label = "";
      if (mode === "coordinates") {
        const at = points[0]!;
        const sceneFeet = 1 / sceneUnitsPerFoot;
        const modelOrigin = source === "recovered" || source === "overlay" ? result.origin : { x: 0, y: 0, z: 0 };
        const displayScale = measureUnitRef.current === "metres" ? 0.3048 : 1;
        const unitLabel = measureUnitRef.current === "metres" ? "m" : "ft";
        const x = (at.x * sceneFeet + modelOrigin.x) * displayScale;
        const y = (at.y * sceneFeet + modelOrigin.y) * displayScale;
        const z = (at.z * sceneFeet + modelOrigin.z) * displayScale;
        label = `X ${x.toFixed(3)} · Y ${y.toFixed(3)} · Z ${z.toFixed(3)} ${unitLabel}`;
      } else if (mode === "angle") {
        label = `${measuredAngleDegrees(points[0]!, points[1]!, points[2]!).toFixed(2)}°`;
      } else {
        const rawDistance = (mode === "laser"
          ? camera.position.distanceTo(points[0]!)
          : points[0]!.distanceTo(points[1]!)) / sceneUnitsPerFoot;
        if (mode === "calibrate") setCalibrationSample(rawDistance);
        label = `${mode === "laser" ? "Laser " : mode === "calibrate" ? "Calibration " : ""}${
          formatMeasuredLength(rawDistance, measureUnitRef.current, measureCalibrationRef.current)
        }`;
      }
      setMeasurementReadings((current) => [...current, { id, label }]);
    };
    let pointerStart: { x: number; y: number } | null = null;
    let lastSurfaceHit: ViewerIntersection | undefined;
    let lastSurfaceHitAt = 0;
    const showSurfaceSelection = (hit: ViewerIntersection | undefined) => {
      const runtime = runtimeRef.current;
      if (runtime?.selectionOverlay) {
        runtime.scene.remove(runtime.selectionOverlay);
        disposeGroup(runtime.selectionOverlay);
        runtime.selectionOverlay = null;
      }
      if (!hit || !runtime) return;
      const selection = (isReferenceModel
        ? createElementSelection(hit, sceneUnitsPerFoot)
        : null) ?? createFaceSelection(hit, camera, sceneUnitsPerFoot);
      if (!selection) return;
      runtime.selectionOverlay = selection;
      runtime.scene.add(selection);
      runtime.invalidate();
    };
    /**
     * Markup drawing.
     *
     * A stroke is fixed to a plane rather than snapped per point to whatever
     * surface is behind it: dragging across a door reveal would otherwise send
     * alternate points metres apart and shred the line. The plane is set at the
     * depth of the first point and faces the camera that drew it, which is what
     * makes a cloud round a window stay round — and stay on that window — from
     * every other camera afterwards.
     */
    const markupPlane = new THREE.Plane();
    const markupRay = new THREE.Ray();
    let markupPoints: THREE.Vector3[] | null = null;
    let markupWorldWeight = 0;
    let markupSpacing = 0;
    const markupPointAt = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      markupRay.copy(raycaster.ray);
      const at = markupRay.intersectPlane(markupPlane, new THREE.Vector3());
      return at ?? null;
    };
    const beginMarkup = (event: PointerEvent): boolean => {
      const settings = markupSettingsRef.current;
      if (!settings.tool || settings.tool === "delete") return false;
      const hit = geometryHitAt(event.clientX, event.clientY);
      const view = camera.getWorldDirection(new THREE.Vector3());
      // Nothing under the cursor still deserves an anchor — annotating the sky
      // over a roofline is a normal thing to want — but the depth it gets has
      // to be somewhere in the building. A fixed fraction of the model radius
      // put the plane on the camera's own axis, where dollying cannot move it,
      // so a stroke that started off the building looked pinned to the glass.
      // What the camera is looking at is the honest answer in orbit; an arm's
      // length ahead is the honest answer indoors.
      const missDistance = walkRef.current
        ? 12 * sceneUnitsPerFoot
        : Math.max(radius * 0.05, camera.position.distanceTo(controls.target));
      const anchor = hit
        ? hit.point.clone().addScaledVector(view, -radius * 0.0015)
        : camera.position.clone().addScaledVector(view, missDistance);
      markupPlane.setFromNormalAndCoplanarPoint(view.clone().negate(), anchor);
      const perPixel = sceneUnitsPerPixel(
        camera.position.distanceTo(anchor),
        camera.fov,
        canvas.clientHeight || 1,
      );
      markupWorldWeight = Math.max(1e-6, settings.weight * perPixel);
      // Two pixels of travel before a new anchor, measured in the world so the
      // sampling does not change with how far away the wall is.
      markupSpacing = Math.max(1e-6, perPixel * 2.5);
      if (settings.tool === "text") {
        createMarkupRef.current({
          source,
          tool: "text",
          points: [tuple(anchor)],
          ...markupFeet([anchor]),
          color: settings.color,
          worldWeight: markupWorldWeight,
          text: settings.text,
        });
        return true;
      }
      markupPoints = [anchor];
      const draft: MarkupStroke = {
        id: "markup-draft",
        source,
        tool: settings.tool,
        points: [tuple(anchor)],
        color: settings.color,
        worldWeight: markupWorldWeight,
        createdAt: new Date().toISOString(),
      };
      markupDraftRef.current = draft;
      setMarkupDraft(draft);
      canvas.setPointerCapture(event.pointerId);
      // Orbit would spin the model under the line being drawn on it.
      if (!walkRef.current) controls.enabled = false;
      return true;
    };
    const extendMarkup = (event: PointerEvent) => {
      if (!markupPoints) return;
      const at = markupPointAt(event.clientX, event.clientY);
      if (!at) return;
      const last = markupPoints.at(-1)!;
      const isArrow = markupDraftRef.current?.tool === "arrow";
      if (!isArrow && at.distanceTo(last) < markupSpacing) return;
      if (isArrow) markupPoints.splice(1, markupPoints.length - 1, at);
      else markupPoints.push(at);
      // The draft object is projected from `points` every frame, so growing the
      // array in place is what the layer reads — no re-render per sample.
      const draft = markupDraftRef.current;
      if (draft) draft.points = markupPoints.map(tuple);
    };
    const finishMarkup = (event: PointerEvent) => {
      if (!markupPoints) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const settings = markupSettingsRef.current;
      const points = markupPoints;
      markupPoints = null;
      markupDraftRef.current = null;
      setMarkupDraft(null);
      controls.enabled = true;
      if (points.length > 1 && settings.tool && settings.tool !== "delete" && settings.tool !== "text") {
        createMarkupRef.current({
          source,
          tool: settings.tool,
          points: points.map(tuple),
          ...markupFeet(points),
          color: settings.color,
          worldWeight: markupWorldWeight,
        });
      }
    };
    const markupFeet = (points: readonly THREE.Vector3[]) => {
      const origin: Point3Tuple = [result.origin.x, result.origin.y, result.origin.z];
      const feet: Point3Tuple[] = [];
      for (const point of points) {
        const registered = scenePointToModelFeet(tuple(point), source, origin);
        if (!registered) return {};
        feet.push(registered);
      }
      return { pointsFeet: feet };
    };

    const handlePointerDown = (event: PointerEvent) => {
      // Only the primary button picks. The right button used to run the same
      // pick on release, which cleared the selection under the menu that was
      // about to offer "Clear selection".
      if (event.button !== 0) return;
      if (beginMarkup(event)) return;
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (markupPoints) {
        finishMarkup(event);
        return;
      }
      if (!pointerStart) return;
      const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (movement > 5) return;
      if (commentingRef.current) {
        const hit = geometryHitAt(event.clientX, event.clientY);
        if (!hit) return;
        const modelPositionFeet = scenePointToModelFeet(
          tuple(hit.point),
          source,
          [result.origin.x, result.origin.y, result.origin.z],
        );
        // Recording what the pin landed on is what lets the Comments panel name
        // the object instead of quoting a coordinate back at the reviewer.
        const hitElementIds = hit.object.userData.elementIds as Uint32Array | undefined;
        const elementId = hit.faceIndex == null ? undefined : hitElementIds?.[hit.faceIndex];
        const id = onCreateComment({
          source,
          scenePosition: tuple(hit.point),
          ...(modelPositionFeet ? { modelPositionFeet } : {}),
          ...(elementId == null ? {} : { elementId }),
          viewpoint: {
            source,
            position: tuple(camera.position),
            target: tuple(controls.target),
            up: tuple(camera.up),
            fov: camera.fov,
          },
        });
        activateCommentRef.current(id);
        return;
      }
      if (measuringRef.current) {
        const hit = geometryHitAt(event.clientX, event.clientY);
        if (hit) addMeasurementHit(hit.point);
        return;
      }
      const hit = geometryHitAt(event.clientX, event.clientY);
      lastSurfaceHit = hit;
      lastSurfaceHitAt = performance.now();
      if (walkRef.current || useReference || isReferenceModel) {
        showSurfaceSelection(hit);
        if (useReference || isReferenceModel) onSelectElement(null);
        else if (hit?.faceIndex != null) {
          const elementIds = hit.object.userData.elementIds as Uint32Array | undefined;
          onSelectElement(elementIds?.[hit.faceIndex] ?? null);
        }
        return;
      }
      onSelectElement(hit?.faceIndex == null
        ? null
        : (hit.object.userData.elementIds as Uint32Array | undefined)?.[hit.faceIndex] ?? null);
    };
    // A right-click asks about whatever is under it, so it runs the same hit
    // test as a left-click and picks the object too — the menu's "Zoom to
    // object" and the properties panel both read the selection.
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // While a drawing tool is armed the right button is the look drag, so it
      // must not also raise a menu under the cursor.
      if (walkRef.current || measuringRef.current || markupSettingsRef.current.tool) return;
      const hit = geometryHitAt(event.clientX, event.clientY);
      const elementIds = hit?.object.userData.elementIds as Uint32Array | undefined;
      const elementId = useReference || isReferenceModel || hit?.faceIndex == null
        ? null
        : elementIds?.[hit.faceIndex] ?? null;
      if (elementId != null) onSelectElement(elementId);
      const normal = hit ? hitWorldNormal(hit) : null;
      const walkable = normal && Math.abs(normal.dot(upVector)) >= 0.55;
      const rect = canvas.getBoundingClientRect();
      onCanvasMenu({
        elementId,
        ...(hit && walkable ? { walkPoint: tuple(hit.point), walkNormal: tuple(normal) } : {}),
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    const handleDoubleClick = (event: MouseEvent) => {
      const walk = walkRef.current;
      const hit = performance.now() - lastSurfaceHitAt < 500
        ? lastSurfaceHit
        : geometryHitAt(event.clientX, event.clientY);
      if (!hit) return;
      showSurfaceSelection(hit);
      if (walk) {
        walk.travelToSurface(hit.point, hitWorldNormal(hit));
        return;
      }
      // Outside Walk, a double-click makes the picked point the orbit pivot.
      // Horizontal picks also become the next walk entry, so a person can point
      // at a room or floor before pressing the Walk tool.
      const normal = hitWorldNormal(hit);
      controls.target.copy(hit.point);
      camera.lookAt(hit.point);
      controls.update();
      if (Math.abs(normal.dot(upVector)) >= 0.55 && runtimeRef.current) {
        runtimeRef.current.walkStart = { point: hit.point.clone(), normal };
      }
      needsRender = true;
    };
    // What is under the cursor should name itself before you commit to
    // clicking it. The raycast is the same one picking uses; it is throttled to
    // one per animation frame because a move event can fire far more often than
    // the scene can answer.
    let hoverPending = false;
    let hoverEvent: PointerEvent | null = null;
    let measurementPreviewPending = false;
    let measurementPreviewEvent: PointerEvent | null = null;
    let hoveredElementId: number | null = null;
    let hoverRaycastCount = 0;
    if (navigationTest) canvas.dataset.hoverRaycasts = "0";
    const reportHover = (elementId: number | null) => {
      if (elementId === hoveredElementId) return;
      hoveredElementId = elementId;
      onHoverElement(elementId);
    };
    const resolveHover = () => {
      hoverPending = false;
      const event = hoverEvent;
      // OrbitControls runs its own pointer listeners before this one. Avoid
      // tracing a ray through every triangle while that control is consuming
      // the same pointer stream; the final click still gets an exact pick and
      // the next unpressed move restores hover normally.
      if (!event || cameraInteracting || pointerStart) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      hoverRaycastCount += 1;
      if (navigationTest) canvas.dataset.hoverRaycasts = String(hoverRaycastCount);
      const hit = firstTriangleHit(raycaster, interactionMeshes, (intersection) =>
        intersection.object.userData.elementIds != null);
      const elementIds = hit?.object.userData.elementIds as Uint32Array | undefined;
      reportHover(hit?.faceIndex == null ? null : elementIds?.[hit.faceIndex] ?? null);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (markupPoints) {
        extendMarkup(event);
        return;
      }
      if (measuringRef.current) {
        measurementPreviewEvent = event;
        if (measurementPreviewPending) return;
        measurementPreviewPending = true;
        requestAnimationFrame(() => {
          measurementPreviewPending = false;
          const previewEvent = measurementPreviewEvent;
          if (!previewEvent || !measuringRef.current) return;
          const hit = geometryHitAt(previewEvent.clientX, previewEvent.clientY);
          updateMeasurementPreview(measurement, hit?.point ?? null);
        });
        return;
      }
      if (useReference || isReferenceModel || walkRef.current) return;
      hoverEvent = event;
      if (cameraInteracting || pointerStart) {
        reportHover(null);
        return;
      }
      if (hoverPending) return;
      hoverPending = true;
      requestAnimationFrame(resolveHover);
    };
    const handlePointerLeave = () => {
      hoverEvent = null;
      markupPoints = null;
      markupDraftRef.current = null;
      setMarkupDraft(null);
      controls.enabled = true;
      measurementPreviewEvent = null;
      updateMeasurementPreview(measurement, null);
      reportHover(null);
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("dblclick", handleDoubleClick);
    let cancelWalkPrewarm = () => {};
    runtimeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      root,
      center,
      radius,
      bounds: sceneBounds,
      // Where the walker's feet go: the bottom of the model on whichever axis
      // this source stands on.
      floor: isReferenceModel ? bounds.min.y : bounds.min.z,
      up,
      sceneUnitsPerFoot,
      surfaceFloorAt,
      resolveMovement: resolveWalkMovement,
      prepareWalkIndexes,
      walkIndexDirty: sourceAssets.walkIndexDirty,
      invalidateWalkIndexes: () => {
        const runtime = runtimeRef.current;
        if (runtime) runtime.walkIndexDirty = true;
        sourceAssets.walkIndexDirty = true;
        sourceAssets.walkSurface = null;
        sourceAssets.walkCollision = null;
        recoveredWalkSurface = null;
        recoveredWalkCollision = null;
        collisionIndexBuildVersion += 1;
        collisionIndexBuild = null;
        canvas.dataset.walkSurfaceCache = "dirty";
        canvas.dataset.walkCollisionCache = "dirty";
      },
      walkStart: null,
      selectionOverlay: null,
      measurement,
      sectionHelper: null,
      explodeParts: [],
      invalidate: () => {
        needsRender = true;
      },
    };

    // The index is useful but not urgent while the user is orbiting. Start it
    // after the browser has painted the model; each triangle chunk yields back
    // to the event loop, so even a campus-sized RVT stays interactive.
    if (!isReferenceModel) {
      if (typeof window.requestIdleCallback === "function") {
        const idleId = window.requestIdleCallback(() => {
          if (active) void prepareWalkIndexes();
        }, { timeout: 1_500 });
        cancelWalkPrewarm = () => window.cancelIdleCallback(idleId);
      } else {
        const timeoutId = window.setTimeout(() => {
          if (active) void prepareWalkIndexes();
        }, 250);
        cancelWalkPrewarm = () => window.clearTimeout(timeoutId);
      }
    }

    queueMicrotask(() => {
      if (!active) return;
      setMeasurementReadings([]);
      setCalibrationSample(null);
      measurementIdRef.current = 1;
    });
    if (isReferenceModel && referenceModelUrl) {
      const applyLoadedReference = () => {
        const measured = sourceAssets.referenceBounds;
        if (!active || !measured || sourceAssets.referenceState !== "ready") return;
        referenceBoundsRef.current = measured;
        const home = referenceHomePose(measured);
        const measuredBounds = new THREE.Box3(
          new THREE.Vector3(measured.min.x, measured.min.y, measured.min.z),
          new THREE.Vector3(measured.max.x, measured.max.y, measured.max.z),
        );
        const measuredSize = measuredBounds.getSize(new THREE.Vector3());
        radius = Math.max(
          25 * sceneUnitsPerFoot,
          measuredSize.x,
          measuredSize.y,
          measuredSize.z,
        ) * 0.62;
        center.copy(home.target);
        sceneBounds.copy(measuredBounds);
        up = referenceIsYUp(measured) ? "y" : "z";
        sun.position.copy(center).add(sunOffset);
        sun.target.position.copy(center);
        camera.up.copy(home.up);
        camera.fov = home.fov;
        camera.position.copy(home.position);
        camera.near = Math.max(0.1 * sceneUnitsPerFoot, radius / 1_000);
        camera.far = radius * 30;
        camera.updateProjectionMatrix();
        controls.target.copy(home.target);
        controls.update();
        referenceWalkSurface = sourceAssets.walkSurface;
        refreshInteractionMeshes();
        const runtime = runtimeRef.current;
        if (runtime) {
          runtime.center.copy(center);
          runtime.radius = radius;
          runtime.bounds.copy(sceneBounds);
          runtime.floor = up === "y" ? measured.min.y : measured.min.z;
          runtime.up = up;
        }
        canvas.dataset.referenceCache = cachedSource.hit ? "hit" : "ready";
        canvas.dataset.walkSurfaceCache = referenceWalkSurface ? "hit" : "miss";
        applyMatchedCamera();
        needsRender = true;
        setReferenceLoadState("ready");
      };

      if (!sourceAssets.referenceLoad && sourceAssets.referenceState !== "ready") {
        sourceAssets.referenceState = "loading";
        sourceAssets.referenceLoad = import("./gltf-loader.ts").then((module) =>
          module.loadReferenceModel(referenceModelUrl),
        ).then((loadedScene) => {
          if (sourceAssets.disposed) {
            disposeGroup(loadedScene);
            return;
          }
          styleReferenceModel(loadedScene, renderMode);
          const measured = referenceModelBounds(loadedScene);
          const batchedScene = batchReferenceScene(loadedScene);
          if (sourceAssets.disposed) {
            disposeGroup(batchedScene);
            return;
          }
          sourceAssets.referenceBounds = measured;
          sourceAssets.walkSurface = batchedScene.userData.walkSurface as WalkSurfaceIndex;
          sourceAssets.root.add(batchedScene);
          sourceAssets.referenceState = "ready";
        }).catch(() => {
          if (!sourceAssets.disposed) sourceAssets.referenceState = "error";
        }).finally(() => {
          sourceAssets.referenceLoad = null;
        });
      }
      queueMicrotask(() => active && setReferenceLoadState(sourceAssets.referenceState));
      if (sourceAssets.referenceState === "ready") applyLoadedReference();
      else void sourceAssets.referenceLoad?.then(() => {
        if (sourceAssets.referenceState === "ready") applyLoadedReference();
        else if (active) setReferenceLoadState("error");
      });
    } else {
      queueMicrotask(() => active && setReferenceLoadState("idle"));
    }

    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      needsRender = true;
    };
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    });
    observer.observe(canvas);
    resize();

    let frame = 0;
    let previous = performance.now();
    const render = () => {
      if (!active) return;
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      // Exactly one of the two drives the camera; orbit damping would fight the
      // walker for it otherwise.
      let cameraChanged = false;
      if (walkRef.current) {
        walkRef.current.update(delta);
        cameraChanged = true;
      } else {
        cameraChanged = controls.update();
      }
      const liveDirection = camera.getWorldDirection(new THREE.Vector3());
      const liveTarget = walkRef.current ? camera.position.clone().add(liveDirection) : controls.target;
      canvas.dataset.navigationState = walkRef.current ? "walk" : "orbit";
      const modelPosition = scenePointToModelFeet(
        tuple(camera.position), source, [result.origin.x, result.origin.y, result.origin.z],
      );
      if (modelPosition) {
        canvas.dataset.modelCameraPositionFeet = modelPosition.map((value) => value.toFixed(5)).join(",");
        canvas.dataset.modelCameraDirection = canonicalCameraVector(liveDirection, up)
          .normalize().toArray().map((value) => value.toFixed(7)).join(",");
      } else {
        delete canvas.dataset.modelCameraPositionFeet;
        delete canvas.dataset.modelCameraDirection;
      }
      if (navigationTest) {
        canvas.dataset.cameraPosition = camera.position.toArray().map((value) => value.toFixed(5)).join(",");
        canvas.dataset.cameraTarget = liveTarget.toArray().map((value) => value.toFixed(5)).join(",");
        canvas.dataset.cameraDirection = liveDirection.toArray().map((value) => value.toFixed(5)).join(",");
        canvas.dataset.canonicalCameraPosition = canonicalCameraVector(
          camera.position.clone().sub(center),
          up,
        ).divideScalar(radius).toArray().map((value) => value.toFixed(7)).join(",");
        canvas.dataset.canonicalCameraTarget = canonicalCameraVector(
          liveTarget.clone().sub(center),
          up,
        ).divideScalar(radius).toArray().map((value) => value.toFixed(7)).join(",");
        canvas.dataset.canonicalCameraDirection = canonicalCameraVector(liveDirection, up)
          .normalize().toArray().map((value) => value.toFixed(7)).join(",");
        canvas.dataset.pointerLocked = String(walkRef.current?.isPointerLocked() ?? false);
        canvas.dataset.walkGravity = String(walkGravityRef.current);
      }
      if (cameraChanged || needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    render();

    return () => {
      active = false;
      walkIndexBuildVersion += 1;
      cancelWalkPrewarm();
      cancelAnimationFrame(frame);
      // Carry a normalized camera between the feet/z-up recovery and the
      // metres/y-up GLB. First-person controls do not maintain OrbitControls'
      // target, so derive a target from the live look direction while walking.
      const cameraTarget = walkRef.current
        ? camera.position.clone().addScaledVector(
            camera.getWorldDirection(new THREE.Vector3()),
            radius * 0.25,
          )
        : controls.target.clone();
      walkCameraHandoffPendingRef.current = Boolean(walkRef.current);
      matchedCameraRef.current = {
        position: canonicalCameraVector(camera.position.clone().sub(center), up)
          .divideScalar(radius),
        target: canonicalCameraVector(cameraTarget.sub(center), up)
          .divideScalar(radius),
        up: canonicalCameraVector(camera.up, up).normalize(),
      };
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      onHoverElement(null);
      onCanvasMenu(null);
      controls.removeEventListener("change", handleControlsChange);
      controls.removeEventListener("start", handleControlsStart);
      controls.removeEventListener("end", handleControlsEnd);
      controls.dispose();
      // Cached roots must be stored in their canonical geometry pose. The next
      // source effect will reapply the current explode amount; retaining moved
      // parts here would make that displacement compound on every revisit.
      if (runtimeRef.current?.explodeParts.length) {
        applyExplode(runtimeRef.current.explodeParts, 0);
        runtimeRef.current.invalidateWalkIndexes();
      }
      sourceAssets.walkIndexDirty ||= runtimeRef.current?.walkIndexDirty ?? false;
      root.removeFromParent();
      if (runtimeRef.current?.sectionHelper) disposeGroup(runtimeRef.current.sectionHelper);
      disposeMeasurementScene(scene, measurement);
      if (runtimeRef.current?.selectionOverlay) disposeGroup(runtimeRef.current.selectionOverlay);
      runtimeRef.current = null;
      renderer.dispose();
    };
  }, [comparison, hiddenElementIds, onCanvasMenu, onCreateComment, onHoverElement, onSelectElement, referenceModelUrl, renderMode, result, source, sourceCache]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    // Scene/source rebuilds preserve the matched camera above. Only an explicit
    // Home/Fit/view-preset request should replace it.
    if (cameraRequest.sequence === appliedCameraRequestRef.current) return;
    if (source === "reference-model" && referenceLoadState !== "ready") return;
    appliedCameraRequestRef.current = cameraRequest.sequence;
    // One control decides the orientation now, so there is nothing to
    // reconcile: the requested preset is the camera.
    const preset = cameraRequest.preset;
    const visibleBounds = cameraRequest.fit ? new THREE.Box3().setFromObject(runtime.root) : null;
    const frameBounds = visibleBounds && !visibleBounds.isEmpty() ? visibleBounds : runtime.bounds;
    const frameCenter = frameBounds.getCenter(new THREE.Vector3());
    const frameSize = frameBounds.getSize(new THREE.Vector3());
    const frameRadius = Math.max(
      25 * runtime.sceneUnitsPerFoot,
      frameSize.x,
      frameSize.y,
      frameSize.z,
    ) * 0.62;
    const pose = (() => {
      if (source !== "reference-model") {
        return { ...cameraPoseForPreset(frameCenter, frameRadius, preset), target: frameCenter, fov: 45 };
      }
      const referencePose = referencePoseForPreset(preset, frameRadius);
      return {
        ...referencePose,
        position: referencePose.position.clone().add(frameCenter),
        target: frameCenter,
      };
    })();
    const target = pose.target;
    runtime.camera.fov = pose.fov;
    runtime.camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    runtime.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    runtime.controls.target.copy(target);
    runtime.camera.lookAt(target);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
    runtime.invalidate();
  }, [cameraRequest, comparison, referenceLoadState, renderMode, result, source]);

  // Frame one object without changing which way the camera faces: the eye
  // keeps its direction and only the distance and the target move.
  useEffect(() => {
    const runtime = runtimeRef.current;
    // A source change remounts the scene while retaining the last object-focus
    // request. Replaying that request during Walk overrides the normalized
    // camera handoff and visibly teleports the user back to the framed object.
    if (walkingRef.current || !runtime || !focusRequest.sequence || focusRequest.elementId == null) return;
    if (source === "reference-model" && referenceLoadState !== "ready") return;
    const record = result.elementBounds.find((entry) => entry.elementId === focusRequest.elementId);
    if (!record) return;
    const origin = result.origin;
    const modelTargetFeet: Point3Tuple = [
      (record.boundsFeet.min.x + record.boundsFeet.max.x) / 2,
      (record.boundsFeet.min.y + record.boundsFeet.max.y) / 2,
      (record.boundsFeet.min.z + record.boundsFeet.max.z) / 2,
    ];
    const registeredTarget = modelFeetToScenePoint(
      modelTargetFeet,
      source,
      [origin.x, origin.y, origin.z],
    );
    const target = registeredTarget
      ? new THREE.Vector3(...registeredTarget)
      : (() => {
          // Autodesk GLB carries no Revit element ids or project datum. Map the
          // requested RVT point by its normalized position inside the measured
          // building bounds, using the same z-up/y-up basis handoff as Walk.
          const recoveredBounds = result.bbox;
          const recoveredCenter = new THREE.Vector3(
            (recoveredBounds.min.x + recoveredBounds.max.x) / 2,
            (recoveredBounds.min.y + recoveredBounds.max.y) / 2,
            (recoveredBounds.min.z + recoveredBounds.max.z) / 2,
          );
          const recoveredRadius = Math.max(
            25,
            recoveredBounds.max.x - recoveredBounds.min.x,
            recoveredBounds.max.y - recoveredBounds.min.y,
            recoveredBounds.max.z - recoveredBounds.min.z,
          ) * 0.62;
          const recoveredPoint = new THREE.Vector3(
            modelTargetFeet[0] - origin.x,
            modelTargetFeet[1] - origin.y,
            modelTargetFeet[2] - origin.z,
          );
          const normalized = canonicalCameraVector(
            recoveredPoint.sub(recoveredCenter),
            "z",
          ).divideScalar(recoveredRadius);
          return sceneCameraVector(
            normalized.multiplyScalar(runtime.radius),
            runtime.up,
          ).add(runtime.center);
        })();
    const size = boundsDimensions(record.boundsFeet);
    const extent = Math.max(size.x, size.y, size.z, 1) * runtime.sceneUnitsPerFoot;
    const direction = runtime.camera.position.clone().sub(runtime.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, -1, 0.8);
    direction.normalize().multiplyScalar(extent * 2.4);
    runtime.controls.target.copy(target);
    runtime.camera.position.copy(target).add(direction);
    runtime.camera.lookAt(target);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
    runtime.invalidate();
  }, [focusRequest, referenceLoadState, result, source]);

  useEffect(() => {
    const controls = runtimeRef.current?.controls;
    if (!controls) return;
    applyNavigationMode(controls, navigationMode);
  }, [comparison, navigationMode, renderMode, result, source]);

  /**
   * Walk mode. Orbiting is how you look at a building from outside; walking is
   * how you find out whether a corridor is a corridor. The orbit controls are
   * switched off while the walker has the camera, and the camera is handed back
   * where the walker left it so leaving walk mode does not teleport the view.
   */
  useEffect(() => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return;

    if (!walking) {
      walkCameraHandoffPendingRef.current = false;
      const previousWalk = walkRef.current;
      previousWalk?.dispose();
      walkRef.current = null;
      queueMicrotask(() => {
        setWalkPreparing(false);
        setWalkLooking(false);
      });
      runtime.controls.enabled = true;
      if (source === "reference-model") setReferenceOutlineMode(runtime.root, "orbit");
      runtime.camera.near = Math.max(0.1, runtime.radius / 1_000);
      runtime.camera.far = runtime.radius * 30;
      runtime.camera.updateProjectionMatrix();
      if (previousWalk) {
        // Orbit around whatever is in front of the camera now, rather than
        // snapping back to the model centre. Leave the initial Orbit target
        // alone when this effect first mounts.
        const forward = new THREE.Vector3();
        runtime.camera.getWorldDirection(forward);
        runtime.controls.target.copy(
          runtime.camera.position.clone().addScaledVector(forward, runtime.radius * 0.35),
        );
      }
      runtime.controls.update();
      runtime.invalidate();
      return;
    }

    runtime.controls.enabled = false;
    if (source === "reference-model") setReferenceOutlineMode(runtime.root, "walk");
    // First-person needs a close near plane, but pulling it to 0.02 ft against
    // a far of radius*30 left a ~1:300,000 depth range on a 24-bit buffer —
    // the z-fighting shimmer on coplanar recovered faces. A tenth of a foot
    // still lets you put your nose to a wall, and the far plane only has to
    // clear the building, not the orbit framing.
    runtime.camera.near = Math.max(0.1 * runtime.sceneUnitsPerFoot, runtime.radius / 10_000);
    runtime.camera.far = runtime.radius * 8;
    runtime.camera.updateProjectionMatrix();
    // The proxy edge hairlines read as a technical drawing from orbit and as
    // moiré at eye height; the reference path already dims its outlines for
    // walking, this hides the recovered ones the same way.
    const hiddenEdgeOverlays: THREE.Object3D[] = [];
    if (source !== "reference-model") {
      runtime.root.traverse((object) => {
        if (
          (object as THREE.LineSegments).isLineSegments &&
          object.name.endsWith(" edges") &&
          object.visible
        ) {
          object.visible = false;
          hiddenEdgeOverlays.push(object);
        }
      });
    }
    let cancelled = false;
    let walk: WalkControls | null = null;
    queueMicrotask(() => {
      if (!cancelled) {
        setWalkPreparing(true);
        setWalkLooking(false);
      }
    });

    void runtime.prepareWalkIndexes().then(() => {
      if (cancelled) return;
      setWalkPreparing(false);
      const eyeHeight = WALK_EYE_HEIGHT * runtime.sceneUnitsPerFoot;
      const hasRequestedStart = walkStartRequest.sequence !== appliedWalkStartRequestRef.current
        && walkStartRequest.point !== null;
      if (hasRequestedStart) appliedWalkStartRequestRef.current = walkStartRequest.sequence;
      const pickedStart = hasRequestedStart
        ? new THREE.Vector3(...walkStartRequest.point!)
        : runtime.walkStart?.point.clone() ?? (() => {
            const selectedId = selectedElementIdRef.current;
            if (selectedId == null) return null;
            const selected = result.elementBounds.find(
              (record) => record.elementId === selectedId,
            );
            if (!selected?.stairTreads?.length) return null;
            const point = selectedStairWalkStart(
              selected.stairTreads,
              source,
              [result.origin.x, result.origin.y, result.origin.z],
            );
            return point ? new THREE.Vector3(...point) : null;
          })();
      runtime.walkStart = null;
      // OrbitControls' target describes the area the user is inspecting. Use it
      // as the default plan location instead of teleporting to the model centre;
      // a double-click or “Walk from here” supplies an exact floor point.
      const resumeFromMatchedEye = walkCameraHandoffPendingRef.current;
      walkCameraHandoffPendingRef.current = false;
      const start = pickedStart
        ?? (resumeFromMatchedEye
          ? runtime.camera.position.clone()
          : runtime.controls.target.clone());
      let nearbyFloor = pickedStart
        ? (runtime.up === "y" ? pickedStart.y : pickedStart.z)
        : resumeFromMatchedEye
          ? (runtime.up === "y" ? start.y : start.z) - eyeHeight
          : null;
      if (nearbyFloor == null) {
        const targetProbe = start.clone();
        if (runtime.up === "y") targetProbe.y = runtime.bounds.max.y + eyeHeight;
        else targetProbe.z = runtime.bounds.max.z + eyeHeight;
        nearbyFloor = runtime.surfaceFloorAt(targetProbe, runtime.radius * 4);
      }
      if (nearbyFloor == null) {
        const cameraProbe = runtime.camera.position.clone();
        nearbyFloor = runtime.surfaceFloorAt(cameraProbe, runtime.radius * 4);
        if (nearbyFloor != null) start.copy(cameraProbe);
      }
      const eye = (nearbyFloor ?? runtime.floor) + eyeHeight;
      if (runtime.up === "y") start.y = eye;
      else start.z = eye;
      const forward = runtime.camera.getWorldDirection(new THREE.Vector3());
      if (runtime.up === "y") forward.y = 0;
      else forward.z = 0;
      if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0);
      const lookAt = start.clone().addScaledVector(forward.normalize(), runtime.radius * 0.25);

      walk = createWalkControls(runtime.camera, canvas, {
        start,
        lookAt,
        floor: runtime.floor + eyeHeight,
        eyeHeight,
        sceneUnitsPerFoot: runtime.sceneUnitsPerFoot,
        up: runtime.up,
        speed: walkSpeedRef.current,
        gravity: walkGravityRef.current,
        floorProbeInterval: 1 / 30,
        resolveFloor: runtime.surfaceFloorAt,
        dropDistance: runtime.radius * 4,
        resolveMovement: runtime.resolveMovement,
        onLookChange: setWalkLooking,
        onSpeedChange: setWalkSpeed,
        onGravityChange: setWalkGravity,
        onExit: () => onWalkingChange(false),
      });
      walk.enable();
      walkRef.current = walk;
      runtime.invalidate();
    });

    return () => {
      cancelled = true;
      // Reference loading and source-scene changes can restart this effect
      // while Walk remains selected. Resume that replacement controller from
      // the live eye; a later intentional exit clears the flag above.
      if (walkRef.current === walk || walk) {
        walkCameraHandoffPendingRef.current = true;
      }
      walk?.dispose();
      if (walkRef.current === walk) walkRef.current = null;
      for (const object of hiddenEdgeOverlays) object.visible = true;
      runtime.invalidate();
    };
  }, [comparison, onWalkingChange, referenceLoadState, renderMode, result, source, walking, walkStartRequest]);

  useEffect(() => {
    walkSpeedRef.current = walkSpeed;
    walkRef.current?.setSpeed(walkSpeed);
  }, [walkSpeed]);

  useEffect(() => {
    walkGravityRef.current = walkGravity;
    walkRef.current?.setGravity(walkGravity);
  }, [walkGravity]);

  useEffect(() => {
    walkCollisionRef.current = walkCollision;
  }, [walkCollision]);

  useEffect(() => {
    measuringRef.current = measuring;
    if (!measuring) {
      const runtime = runtimeRef.current;
      if (runtime) clearPendingMeasurement(runtime.measurement);
    }
  }, [measuring]);

  useEffect(() => {
    commentingRef.current = commenting;
  }, [commenting]);

  useEffect(() => {
    activateCommentRef.current = onActiveComment;
  }, [onActiveComment]);

  useEffect(() => {
    markupSettingsRef.current = markupSettings;
  }, [markupSettings]);

  useEffect(() => {
    createMarkupRef.current = onCreateMarkup;
  }, [onCreateMarkup]);

  // A drawing tool takes the left drag, so first-person looking moves to the
  // right button rather than the two gestures fighting over one gesture.
  useEffect(() => {
    walkRef.current?.setLookButton(markupSettings.tool && markupSettings.tool !== "delete" ? 2 : 0);
  }, [markupSettings.tool, walking]);

  useEffect(() => {
    measureModeRef.current = measureMode;
    const runtime = runtimeRef.current;
    if (runtime) clearPendingMeasurement(runtime.measurement);
  }, [measureMode]);

  useEffect(() => {
    measureUnitRef.current = measureUnit;
  }, [measureUnit]);

  useEffect(() => {
    measureCalibrationRef.current = measureCalibration;
  }, [measureCalibration]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.sectionHelper) {
      runtime.scene.remove(runtime.sectionHelper);
      disposeGroup(runtime.sectionHelper);
      runtime.sectionHelper = null;
    }
    const planes = sectioning
      ? sectionPlanes(runtime.bounds, sectionMode, sectionOffset, sectionReverse)
      : [];
    runtime.renderer.localClippingEnabled = Boolean(planes.length);
    applyClippingPlanes(runtime.root, planes);
    if (sectioning) {
      runtime.sectionHelper = createSectionHelper(runtime.bounds, sectionMode, sectionOffset);
      runtime.scene.add(runtime.sectionHelper);
    }
    runtime.invalidate();
  }, [comparison, referenceLoadState, renderMode, result, sectionMode, sectionOffset, sectionReverse, sectioning, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!exploding) {
      const hadExplodedParts = runtime.explodeParts.length > 0;
      applyExplode(runtime.explodeParts, 0);
      if (hadExplodedParts) runtime.invalidateWalkIndexes();
      runtime.invalidate();
      return;
    }
    if (!runtime.explodeParts.length) runtime.explodeParts = collectExplodeParts(runtime.root, runtime.center);
    queueMicrotask(() => setExplodePartCount(runtime.explodeParts.length));
    applyExplode(runtime.explodeParts, explodeAmount);
    // Exploding moves the meshes the walk indexes were built over.
    runtime.invalidateWalkIndexes();
    runtime.invalidate();
  }, [comparison, explodeAmount, exploding, referenceLoadState, renderMode, result, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.selectionOverlay) {
      runtime.scene.remove(runtime.selectionOverlay);
      disposeGroup(runtime.selectionOverlay);
      runtime.selectionOverlay = null;
      runtime.invalidate();
    }
    if (source !== "recovered" || selectedElementId == null) return;
    const record = result.elementBounds.find((candidate) => candidate.elementId === selectedElementId);
    if (!record) return;
    const overlay = new THREE.Group();
    // Highlight the triangles the element actually draws. The filled
    // record-bounds box that used to stand in for this swallowed sparse
    // elements whole — an 83-baluster native railing read as a solid crate.
    runtime.root.updateMatrixWorld(true);
    const triangles = createRecoveredElementSelection(
      runtime.root,
      selectedElementId,
      runtime.sceneUnitsPerFoot,
    );
    if (triangles) overlay.add(triangles);
    // The record-bounds wireframe stays as a locator — it is what makes a
    // small element findable from across the model — but it no longer fills.
    const dimensions = boundsDimensions(record.boundsFeet);
    const selectedCenter = new THREE.Vector3(
      (record.boundsFeet.min.x + record.boundsFeet.max.x) / 2 - result.origin.x,
      (record.boundsFeet.min.y + record.boundsFeet.max.y) / 2 - result.origin.y,
      (record.boundsFeet.min.z + record.boundsFeet.max.z) / 2 - result.origin.z,
    );
    const selectedGeometry = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(selectedGeometry),
      new THREE.LineBasicMaterial({ color: 0xff9f1c, linewidth: 2, depthTest: false }),
    );
    outline.position.copy(selectedCenter);
    outline.renderOrder = 20;
    overlay.add(outline);
    // An element whose triangles are hidden or held back still shows a fill,
    // so "selected but not drawn" stays visible — as the envelope, which in
    // that case is all there is.
    if (!triangles) {
      const fill = new THREE.Mesh(
        selectedGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffc441, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      fill.position.copy(selectedCenter);
      overlay.add(fill);
    }
    runtime.selectionOverlay = overlay;
    runtime.scene.add(overlay);
    runtime.invalidate();
  }, [comparison, renderMode, result, selectedElementId, source]);

  const clearAllMeasurements = () => {
    const runtime = runtimeRef.current;
    if (runtime) clearMeasurements(runtime.measurement);
    setMeasurementReadings([]);
    setCalibrationSample(null);
  };

  const removeLastMeasurement = () => {
    const runtime = runtimeRef.current;
    if (!runtime || !deleteLastMeasurement(runtime.measurement)) return;
    setMeasurementReadings((current) => current.slice(0, -1));
  };

  const applyCalibration = () => {
    if (!calibrationSample) return;
    const known = Number(knownCalibrationLength);
    if (!Number.isFinite(known) || known <= 0) return;
    const knownFeet = measureUnit === "metres" ? known / 0.3048 : known;
    setMeasureCalibration(knownFeet / calibrationSample);
  };

  const projectComment = useCallback((comment: ModelComment): CommentProjection | null => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return null;
    const point = commentScenePoint(comment, source, result);
    if (!point) return null;
    const cameraDirection = runtime.camera.getWorldDirection(new THREE.Vector3());
    const inFront = point.clone().sub(runtime.camera.position).dot(cameraDirection) > 0;
    const projected = point.clone().project(runtime.camera);
    const visible = inFront
      && projected.z >= -1
      && projected.z <= 1
      && projected.x >= -1.1
      && projected.x <= 1.1
      && projected.y >= -1.1
      && projected.y <= 1.1;
    return {
      x: (projected.x + 1) * 0.5 * canvas.clientWidth,
      y: (1 - projected.y) * 0.5 * canvas.clientHeight,
      visible,
    };
  }, [result, source]);

  /**
   * Place a stroke on the glass from wherever the camera is now.
   *
   * The width comes back out of the world the same way it went in, so a redline
   * you walk up to gets thicker exactly as a painted line on that wall would.
   */
  const projectMarkup = useCallback((stroke: MarkupStroke): MarkupProjection | null => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (!runtime || !canvas) return null;
    const points = markupScenePoints(stroke, source, result);
    if (!points?.length) return null;
    const cameraDirection = runtime.camera.getWorldDirection(new THREE.Vector3());
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const screen: ScreenPoint[] = [];
    let anyVisible = false;
    for (const point of points) {
      const inFront = point.clone().sub(runtime.camera.position).dot(cameraDirection) > 0;
      const projected = point.clone().project(runtime.camera);
      const visible = inFront && projected.z >= -1 && projected.z <= 1;
      if (visible) anyVisible = true;
      screen.push({
        x: (projected.x + 1) * 0.5 * width,
        y: (1 - projected.y) * 0.5 * height,
        visible,
      });
    }
    // A stroke that straddles the near plane would otherwise draw a line across
    // the whole screen through the point that flipped behind the camera.
    if (!anyVisible || screen.some((point) => !point.visible)) {
      return { points: screen, weight: 0, visible: anyVisible && screen.every((point) => point.visible) };
    }
    const perPixel = sceneUnitsPerPixel(
      runtime.camera.position.distanceTo(points[0]!),
      runtime.camera.fov,
      height || 1,
    );
    return {
      points: screen,
      weight: perPixel > 0 ? stroke.worldWeight / perPixel : 1,
      visible: true,
    };
  }, [result, source]);

  const restoreCommentViewpoint = useCallback((comment: ModelComment) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const point = commentScenePoint(comment, source, result);
    if (!point) return;
    if (comment.viewpoint.source === source) {
      runtime.camera.position.set(...comment.viewpoint.position);
      runtime.camera.up.set(...comment.viewpoint.up);
      runtime.camera.fov = comment.viewpoint.fov;
      runtime.controls.target.set(...comment.viewpoint.target);
    } else {
      const direction = runtime.camera.position.clone().sub(runtime.controls.target).normalize();
      runtime.controls.target.copy(point);
      runtime.camera.position.copy(point).addScaledVector(direction, runtime.radius * 0.22);
    }
    runtime.camera.lookAt(runtime.controls.target);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
    runtime.invalidate();
  }, [result, source]);

  // "Viewpoint" now lives in the Comments panel, so the request arrives as a
  // sequence-stamped prop rather than a click inside this component.
  const viewpointSequenceRef = useRef(viewpointRequest.sequence);
  useEffect(() => {
    if (viewpointRequest.sequence === viewpointSequenceRef.current) return;
    viewpointSequenceRef.current = viewpointRequest.sequence;
    const comment = comments.find((entry) => entry.id === viewpointRequest.commentId);
    if (comment) restoreCommentViewpoint(comment);
  }, [comments, restoreCommentViewpoint, viewpointRequest]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`model-canvas nav-${navigationMode}${commenting ? " comment-pick-mode" : ""}${
          markupSettings.tool && markupSettings.tool !== "delete" ? " markup-draw-mode" : ""
        }`}
        aria-label="Interactive Revit geometry"
      />
      <MarkupLayer
        strokes={markup}
        draft={markupDraft}
        active={Boolean(markupSettings.tool)}
        erasing={markupSettings.tool === "delete"}
        project={projectMarkup}
        onErase={onDeleteMarkup}
      />
      <ModelCommentLayer
        comments={comments}
        visibleIds={visibleCommentIds}
        activeId={activeCommentId}
        project={projectComment}
        onActivate={onActiveComment}
      />
      {walking && (
        <FirstPersonPanel
          looking={walkLooking}
          preparing={walkPreparing}
          drawing={Boolean(markupSettings.tool && markupSettings.tool !== "delete")}
          speed={walkSpeed}
          gravity={walkGravity}
          collision={source !== "reference-model" ? walkCollision : null}
          guideOpen={walkGuideOpen}
          onSpeed={setWalkSpeed}
          onGravity={setWalkGravity}
          onCollision={setWalkCollision}
          onDrop={() => walkRef.current?.dropToSurface()}
          onGuide={setWalkGuideOpen}
          onNeverShow={() => {
            try {
              window.localStorage.setItem("reviter.first-person-guide", "hidden");
            } catch {
              // Persistence is optional; closing the guide is not.
            }
            setWalkGuideOpen(false);
          }}
          onExit={() => onWalkingChange(false)}
        />
      )}
      {measuring && (
        <MeasureToolPanel
          mode={measureMode}
          unit={measureUnit}
          calibration={measureCalibration}
          calibrationSample={calibrationSample}
          knownLength={knownCalibrationLength}
          settingsOpen={measureSettingsOpen}
          readings={measurementReadings}
          onMode={setMeasureMode}
          onUnit={setMeasureUnit}
          onKnownLength={setKnownCalibrationLength}
          onApplyCalibration={applyCalibration}
          onToggleSettings={() => setMeasureSettingsOpen((open) => !open)}
          onDelete={removeLastMeasurement}
          onClear={clearAllMeasurements}
        />
      )}
      {sectioning && (
        <SectionToolPanel
          mode={sectionMode}
          offset={sectionOffset}
          reverse={sectionReverse}
          onMode={setSectionMode}
          onOffset={setSectionOffset}
          onReverse={() => setSectionReverse((current) => !current)}
          onClear={onSectionClear}
        />
      )}
      {exploding && (
        <ExplodeToolPanel amount={explodeAmount} parts={explodePartCount} onAmount={setExplodeAmount} />
      )}
      {source === "reference-model" && referenceLoadState !== "ready" && (
        <div className={`reference-load-state reference-load-${referenceLoadState}`} role="status">
          <i />
          <span>{referenceLoadState === "error"
            ? "Reference model failed to load"
            : referenceModelUrl ? "Loading paired reference geometry" : "Pair a GLB or glTF reference to compare"}</span>
        </div>
      )}
    </>
  );
}
