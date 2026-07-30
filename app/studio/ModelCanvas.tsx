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
  AUTODESK_REFERENCE_BOUNDS,
  autodeskHomePose,
  autodeskPoseForPreset,
  publicAssetUrl,
  styleAutodeskReference,
} from "./autodesk-reference.ts";
import { batchAutodeskScene, setAutodeskLineVisibility } from "./autodesk-scene.ts";
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
  type WalkControls,
  type WalkSpeed,
} from "./walk-controls.ts";
import {
  ExplodeToolPanel,
  FirstPersonPanel,
  MeasureToolPanel,
  SectionToolPanel,
} from "./ViewerToolPanels.tsx";
import { ModelCommentLayer, type CommentProjection } from "./ModelCommentLayer.tsx";
import type { CameraRequest, CanvasMenuRequest, GeometrySource, ReferenceLoadState } from "./types.ts";
import {
  createFaceSelection,
  firstTriangleHit,
  hitWorldNormal,
  type ViewerIntersection,
} from "./viewer-picking.ts";
import {
  formatMeasuredLength,
  measuredAngleDegrees,
  modelFeetToScenePoint,
  scenePointToModelFeet,
  type ModelComment,
  type MeasureMode,
  type MeasureUnit,
  type NewModelComment,
  type Point3Tuple,
  type SectionMode,
} from "./viewer-tools.ts";

function tuple(point: THREE.Vector3): Point3Tuple {
  return [point.x, point.y, point.z];
}

function commentScenePoint(
  comment: ModelComment,
  source: GeometrySource,
  result: ConvertResult,
): THREE.Vector3 | null {
  if (comment.modelPositionFeet && source !== "autodesk") {
    const position = modelFeetToScenePoint(
      comment.modelPositionFeet,
      source,
      [result.origin.x, result.origin.y, result.origin.z],
    );
    return position ? new THREE.Vector3(...position) : null;
  }
  return comment.source === source ? new THREE.Vector3(...comment.scenePosition) : null;
}

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
  commentEditing,
  comments,
  onCreateComment,
  onUpdateComment,
  onDeleteComment,
  walking,
  onWalkingChange,
  selectedElementId,
  onSelectElement,
  hiddenElementIds,
  onHoverElement,
  onCanvasMenu,
  focusRequest,
}: {
  result: ConvertResult;
  comparison: PairedRegressionResult | null;
  source: GeometrySource;
  renderMode: RenderMode;
  navigationMode: NavigationMode;
  cameraRequest: CameraRequest;
  measuring: boolean;
  sectioning: boolean;
  onSectionClear: () => void;
  exploding: boolean;
  commenting: boolean;
  commentEditing: boolean;
  comments: readonly ModelComment[];
  onCreateComment: (comment: NewModelComment) => string;
  onUpdateComment: (id: string, patch: Partial<Pick<ModelComment, "text" | "status">>) => void;
  onDeleteComment: (id: string) => void;
  walking: boolean;
  onWalkingChange: (walking: boolean) => void;
  selectedElementId: number | null;
  onSelectElement: (elementId: number | null) => void;
  hiddenElementIds: ReadonlySet<number>;
  onHoverElement: (elementId: number | null) => void;
  onCanvasMenu: (request: CanvasMenuRequest | null) => void;
  focusRequest: { elementId: number | null; sequence: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    selectionOverlay: THREE.Group | null;
    measurement: MeasurementScene;
    sectionHelper: THREE.Group | null;
    explodeParts: ExplodePart[];
    invalidate: () => void;
  } | null>(null);
  const walkRef = useRef<WalkControls | null>(null);
  const [referenceLoadState, setReferenceLoadState] = useState<ReferenceLoadState>("idle");
  const [walkSpeed, setWalkSpeed] = useState<WalkSpeed>("normal");
  const [walkGravity, setWalkGravity] = useState(true);
  const [walkLooking, setWalkLooking] = useState(false);
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
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const walkSpeedRef = useRef<WalkSpeed>("normal");
  const walkGravityRef = useRef(true);
  const measuringRef = useRef(false);
  const commentingRef = useRef(false);
  const measureModeRef = useRef<MeasureMode>("distance");
  const measureUnitRef = useRef<MeasureUnit>("feet");
  const measureCalibrationRef = useRef(1);
  const measurementIdRef = useRef(1);

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

    const technical = renderMode === "technical";
    const isAutodesk = source === "autodesk";
    const scene = new THREE.Scene();
    scene.background = isAutodesk && technical ? null : new THREE.Color(technical ? 0xb8d0ee : 0x081419);
    scene.fog = isAutodesk && technical
      ? new THREE.FogExp2(0xeaf1f8, 0.00015)
      : new THREE.FogExp2(technical ? 0xb8d0ee : 0x081419, technical ? 0.00018 : 0.00045);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: isAutodesk && technical, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isAutodesk ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = isAutodesk ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isAutodesk ? 0.95 : technical ? 1.16 : 1.08;
    renderer.shadowMap.enabled = technical && !isAutodesk;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = false;
    if (isAutodesk && technical) renderer.setClearColor(0xffffff, 0);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    applyNavigationMode(controls, "orbit");

    const useReference = source === "reference" && comparison?.referenceMeshes.length;
    // The overlay is drawn in the recovered model's own frame, so it keeps that
    // model's bounds and stays pickable.
    const useOverlay = source === "overlay" && comparison?.referenceMeshes.length;
    const sceneUnitsPerFoot = isAutodesk || useReference ? 0.3048 : 1;
    const root = isAutodesk
      ? new THREE.Group()
      : useOverlay
        ? overlayMeshGroup(result, comparison.referenceMeshes, renderMode)
        : useReference
          ? referenceMeshGroup(comparison.referenceMeshes, renderMode)
          : meshGroup(result, renderMode, hiddenElementIds);
    const bounds = isAutodesk
      ? AUTODESK_REFERENCE_BOUNDS
      : useReference
        ? comparison.referenceBoundsMetres
        : result.bbox;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(
      technical ? 0xf8fbff : 0xccefff,
      isAutodesk ? 0x9da6ad : technical ? 0x7589a1 : 0x102026,
      isAutodesk ? 0.9 : technical ? 2.1 : 1.45,
    ));
    scene.add(new THREE.AmbientLight(technical ? 0xffffff : 0x16333a, isAutodesk ? 0.25 : technical ? 0.58 : 0.18));
    const sun = new THREE.DirectionalLight(
      technical ? 0xfff7e8 : 0xfff4d8,
      isAutodesk ? 1.6 : technical ? 2.8 : 2.3,
    );
    sun.position.set(180, isAutodesk ? 280 : -120, isAutodesk ? -120 : 280);
    sun.castShadow = technical && !isAutodesk;
    scene.add(sun);

    const dx = bounds.max.x - bounds.min.x;
    const dy = bounds.max.y - bounds.min.y;
    const dz = bounds.max.z - bounds.min.z;
    const radius = Math.max(25, dx, dy, dz) * 0.62;
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const sceneBounds = new THREE.Box3(
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    );
    controls.target.copy(center);

    if (technical && !isAutodesk) {
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -radius * 1.5;
      sun.shadow.camera.right = radius * 1.5;
      sun.shadow.camera.top = radius * 1.5;
      sun.shadow.camera.bottom = -radius * 1.5;
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far = radius * 8;
      sun.shadow.bias = -0.0002;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(dx, dy, 100) * 2.2, Math.max(dx, dy, 100) * 2.2),
        new THREE.ShadowMaterial({ color: isAutodesk ? 0x857f76 : 0x6f829a, opacity: isAutodesk ? 0.2 : 0.16 }),
      );
      if (isAutodesk) {
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(center.x, bounds.min.y - 0.06, center.z);
      } else {
        ground.position.set(center.x, center.y, bounds.min.z - 0.06);
      }
      ground.receiveShadow = true;
      (ground.material as THREE.Material).userData.outlineParameters = { visible: false };
      scene.add(ground);
    }

    const grid = new THREE.GridHelper(
      Math.max(dx, isAutodesk ? dz : dy, 100) * 1.35,
      32,
      technical ? 0x667f9b : 0x3c7176,
      technical ? 0x91a7bf : 0x17363d,
    );
    if (isAutodesk) grid.position.y = bounds.min.y - 0.04;
    else {
      grid.rotation.x = Math.PI / 2;
      grid.position.z = bounds.min.z - 0.04;
    }
    grid.visible = !isAutodesk;
    if (technical && Array.isArray(grid.material)) {
      for (const material of grid.material) {
        material.transparent = true;
        material.opacity = 0.34;
      }
    }
    scene.add(grid);

    const pose = isAutodesk
      ? autodeskHomePose()
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

    const raycaster = new THREE.Raycaster();
    const floorRaycaster = new THREE.Raycaster();
    const collisionRaycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const measurement = createMeasurementScene(scene);
    let needsRender = true;
    const handleControlsChange = () => {
      needsRender = true;
    };
    controls.addEventListener("change", handleControlsChange);
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
    /** The hit test both a left-click and a right-click run, in canvas pixels. */
    const pickAt = (clientX: number, clientY: number) => {
      const hit = geometryHitAt(clientX, clientY);
      if (!hit || hit.faceIndex == null) return null;
      const elementIds = hit.object.userData.elementIds as Uint32Array | undefined;
      // One id per triangle: drawn items range from a 12-triangle box to an
      // extruded sketch boundary with as many triangles as its ring has edges.
      return elementIds?.[hit.faceIndex] ?? null;
    };
    const up = (isAutodesk ? "y" : "z") as "y" | "z";
    const upVector = up === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const downVector = upVector.clone().negate();
    const surfaceFloorAt = (eyePosition: THREE.Vector3, maxDrop?: number) => {
      // The compact Autodesk scene contains tens of thousands of batch
      // instances. A one-off long probe is acceptable when entering walk mode,
      // but repeating that full raycast at 10 Hz would make walking stutter.
      if (isAutodesk && maxDrop == null) return null;
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
      if (isAutodesk) return to;
      const delta = to.clone().sub(from);
      const vertical = delta.dot(upVector);
      const horizontal = delta.addScaledVector(upVector, -vertical);
      const distance = horizontal.length();
      if (distance < 1e-6) return to;
      const margin = 0.72 * sceneUnitsPerFoot;
      collisionRaycaster.set(from, horizontal.normalize());
      collisionRaycaster.near = 0;
      collisionRaycaster.far = distance + margin;
      const hit = firstTriangleHit(collisionRaycaster, interactionMeshes);
      if (!hit || hit.distance > distance + margin) return to;
      return from.clone()
        .addScaledVector(horizontal, Math.max(0, hit.distance - margin))
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
      const selection = createFaceSelection(hit, camera, sceneUnitsPerFoot);
      if (!selection) return;
      runtime.selectionOverlay = selection;
      runtime.scene.add(selection);
      runtime.invalidate();
    };
    const handlePointerDown = (event: PointerEvent) => {
      // Only the primary button picks. The right button used to run the same
      // pick on release, which cleared the selection under the menu that was
      // about to offer "Clear selection".
      if (event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
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
        const id = onCreateComment({
          source,
          scenePosition: tuple(hit.point),
          ...(modelPositionFeet ? { modelPositionFeet } : {}),
          viewpoint: {
            source,
            position: tuple(camera.position),
            target: tuple(controls.target),
            up: tuple(camera.up),
            fov: camera.fov,
          },
        });
        setActiveCommentId(id);
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
      if (walkRef.current || useReference || isAutodesk) {
        showSurfaceSelection(hit);
        if (useReference || isAutodesk) onSelectElement(null);
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
      if (walkRef.current || measuringRef.current) return;
      const elementId = useReference || isAutodesk ? null : pickAt(event.clientX, event.clientY);
      if (elementId != null) onSelectElement(elementId);
      const rect = canvas.getBoundingClientRect();
      onCanvasMenu({
        elementId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    const handleDoubleClick = (event: MouseEvent) => {
      const walk = walkRef.current;
      if (!walk) return;
      const hit = performance.now() - lastSurfaceHitAt < 500
        ? lastSurfaceHit
        : geometryHitAt(event.clientX, event.clientY);
      if (hit) {
        showSurfaceSelection(hit);
        walk.teleport(hit.point, hitWorldNormal(hit));
      }
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
    const reportHover = (elementId: number | null) => {
      if (elementId === hoveredElementId) return;
      hoveredElementId = elementId;
      onHoverElement(elementId);
    };
    const resolveHover = () => {
      hoverPending = false;
      const event = hoverEvent;
      if (!event) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = firstTriangleHit(raycaster, interactionMeshes, (intersection) =>
        intersection.object.userData.elementIds != null);
      const elementIds = hit?.object.userData.elementIds as Uint32Array | undefined;
      reportHover(hit?.faceIndex == null ? null : elementIds?.[hit.faceIndex] ?? null);
    };
    const handlePointerMove = (event: PointerEvent) => {
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
      if (useReference || isAutodesk || walkRef.current) return;
      hoverEvent = event;
      if (hoverPending) return;
      hoverPending = true;
      requestAnimationFrame(resolveHover);
    };
    const handlePointerLeave = () => {
      hoverEvent = null;
      measurementPreviewEvent = null;
      updateMeasurementPreview(measurement, null);
      reportHover(null);
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("dblclick", handleDoubleClick);
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
      floor: isAutodesk ? bounds.min.y : bounds.min.z,
      up,
      sceneUnitsPerFoot,
      surfaceFloorAt,
      resolveMovement: resolveWalkMovement,
      selectionOverlay: null,
      measurement,
      sectionHelper: null,
      explodeParts: [],
      invalidate: () => {
        needsRender = true;
      },
    };

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMeasurementReadings([]);
      setCalibrationSample(null);
      measurementIdRef.current = 1;
    });
    if (isAutodesk) {
      queueMicrotask(() => active && setReferenceLoadState("loading"));
      void import("./autodesk-gltf-loader.ts").then((module) =>
        module.loadAutodeskModel(publicAssetUrl("autodesk-reference.glb")),
      ).then((loadedScene) => {
        if (!active) {
          disposeGroup(loadedScene);
          return;
        }
        styleAutodeskReference(loadedScene, renderMode);
        root.add(batchAutodeskScene(loadedScene));
        refreshInteractionMeshes();
        needsRender = true;
        setReferenceLoadState("ready");
      }).catch(() => {
        if (active) setReferenceLoadState("error");
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
    const observer = new ResizeObserver(resize);
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
      if (cameraChanged || needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    render();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      onHoverElement(null);
      onCanvasMenu(null);
      controls.removeEventListener("change", handleControlsChange);
      controls.dispose();
      disposeGroup(root);
      if (runtimeRef.current?.sectionHelper) disposeGroup(runtimeRef.current.sectionHelper);
      disposeMeasurementScene(scene, measurement);
      if (runtimeRef.current?.selectionOverlay) disposeGroup(runtimeRef.current.selectionOverlay);
      runtimeRef.current = null;
      renderer.dispose();
    };
  }, [comparison, hiddenElementIds, onCanvasMenu, onCreateComment, onHoverElement, onSelectElement, renderMode, result, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    // One control decides the orientation now, so there is nothing to
    // reconcile: the requested preset is the camera.
    const preset = cameraRequest.preset;
    const visibleBounds = cameraRequest.fit ? new THREE.Box3().setFromObject(runtime.root) : null;
    const frameBounds = visibleBounds && !visibleBounds.isEmpty() ? visibleBounds : runtime.bounds;
    const frameCenter = frameBounds.getCenter(new THREE.Vector3());
    const frameSize = frameBounds.getSize(new THREE.Vector3());
    const frameRadius = Math.max(25, frameSize.x, frameSize.y, frameSize.z) * 0.62;
    const pose = source === "autodesk"
      ? { ...autodeskPoseForPreset(preset, frameRadius), target: frameCenter }
      : { ...cameraPoseForPreset(frameCenter, frameRadius, preset), target: frameCenter, fov: 45 };
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
    if (!runtime || !focusRequest.sequence || focusRequest.elementId == null) return;
    if (source === "autodesk") return;
    const record = result.elementBounds.find((entry) => entry.elementId === focusRequest.elementId);
    if (!record) return;
    const origin = result.origin;
    const target = new THREE.Vector3(
      (record.boundsFeet.min.x + record.boundsFeet.max.x) / 2 - origin.x,
      (record.boundsFeet.min.y + record.boundsFeet.max.y) / 2 - origin.y,
      (record.boundsFeet.min.z + record.boundsFeet.max.z) / 2 - origin.z,
    );
    const size = boundsDimensions(record.boundsFeet);
    const extent = Math.max(size.x, size.y, size.z, 1);
    const direction = runtime.camera.position.clone().sub(runtime.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, -1, 0.8);
    direction.normalize().multiplyScalar(extent * 2.4);
    runtime.controls.target.copy(target);
    runtime.camera.position.copy(target).add(direction);
    runtime.camera.lookAt(target);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
    runtime.invalidate();
  }, [focusRequest, result, source]);

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
      walkRef.current?.dispose();
      walkRef.current = null;
      runtime.controls.enabled = true;
      if (source === "autodesk") setAutodeskLineVisibility(runtime.root, true);
      runtime.camera.near = Math.max(0.1, runtime.radius / 1_000);
      runtime.camera.updateProjectionMatrix();
      // Orbit around whatever is in front of the camera now, rather than
      // snapping back to the model centre.
      const forward = new THREE.Vector3();
      runtime.camera.getWorldDirection(forward);
      runtime.controls.target.copy(
        runtime.camera.position.clone().addScaledVector(forward, runtime.radius * 0.35),
      );
      runtime.controls.update();
      runtime.invalidate();
      return;
    }

    runtime.controls.enabled = false;
    if (source === "autodesk") setAutodeskLineVisibility(runtime.root, false);
    runtime.camera.near = Math.max(0.02 * runtime.sceneUnitsPerFoot, runtime.radius / 10_000);
    runtime.camera.updateProjectionMatrix();
    const eyeHeight = WALK_EYE_HEIGHT * runtime.sceneUnitsPerFoot;
    const start = runtime.camera.position.clone();
    let nearbyFloor = runtime.surfaceFloorAt(start, runtime.radius * 4);
    if (nearbyFloor == null) {
      // Orbit views usually sit outside the building footprint. Move the walk
      // entry probe to the model centre instead of dropping that distant camera
      // onto an empty baseline where normal walking speed is imperceptible.
      if (runtime.up === "y") {
        start.x = runtime.center.x;
        start.z = runtime.center.z;
        start.y = runtime.bounds.max.y + runtime.radius * 0.25;
      } else {
        start.x = runtime.center.x;
        start.y = runtime.center.y;
        start.z = runtime.bounds.max.z + runtime.radius * 0.25;
      }
      nearbyFloor = runtime.surfaceFloorAt(start, runtime.radius * 4);
    }
    const eye = (nearbyFloor ?? runtime.floor) + eyeHeight;
    if (runtime.up === "y") start.y = eye;
    else start.z = eye;
    const forward = runtime.camera.getWorldDirection(new THREE.Vector3());
    if (runtime.up === "y") forward.y = 0;
    else forward.z = 0;
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0);
    const lookAt = start.clone().addScaledVector(forward.normalize(), runtime.radius * 0.25);

    const walk = createWalkControls(runtime.camera, canvas, {
      start,
      lookAt,
      floor: runtime.floor + eyeHeight,
      eyeHeight,
      sceneUnitsPerFoot: runtime.sceneUnitsPerFoot,
      up: runtime.up,
      speed: walkSpeedRef.current,
      gravity: walkGravityRef.current,
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

    return () => {
      walk.dispose();
      if (walkRef.current === walk) walkRef.current = null;
    };
  }, [comparison, onWalkingChange, referenceLoadState, renderMode, result, source, walking]);

  useEffect(() => {
    walkSpeedRef.current = walkSpeed;
    walkRef.current?.setSpeed(walkSpeed);
  }, [walkSpeed]);

  useEffect(() => {
    walkGravityRef.current = walkGravity;
    walkRef.current?.setGravity(walkGravity);
  }, [walkGravity]);

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
      applyExplode(runtime.explodeParts, 0);
      runtime.invalidate();
      return;
    }
    if (!runtime.explodeParts.length) runtime.explodeParts = collectExplodeParts(runtime.root, runtime.center);
    queueMicrotask(() => setExplodePartCount(runtime.explodeParts.length));
    applyExplode(runtime.explodeParts, explodeAmount);
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
    const dimensions = boundsDimensions(record.boundsFeet);
    const selectedCenter = new THREE.Vector3(
      (record.boundsFeet.min.x + record.boundsFeet.max.x) / 2 - result.origin.x,
      (record.boundsFeet.min.y + record.boundsFeet.max.y) / 2 - result.origin.y,
      (record.boundsFeet.min.z + record.boundsFeet.max.z) / 2 - result.origin.z,
    );
    const selectedGeometry = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
    const fill = new THREE.Mesh(
      selectedGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffc441, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    fill.position.copy(selectedCenter);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(selectedGeometry),
      new THREE.LineBasicMaterial({ color: 0xff9f1c, linewidth: 2, depthTest: false }),
    );
    outline.position.copy(selectedCenter);
    outline.renderOrder = 20;
    const overlay = new THREE.Group();
    overlay.add(fill, outline);
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

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`model-canvas nav-${navigationMode}${commenting ? " comment-pick-mode" : ""}`}
        aria-label="Interactive Revit geometry"
      />
      <ModelCommentLayer
        comments={comments}
        activeId={activeCommentId}
        editing={commentEditing}
        project={projectComment}
        onActive={setActiveCommentId}
        onUpdate={onUpdateComment}
        onDelete={(id) => {
          onDeleteComment(id);
          if (activeCommentId === id) setActiveCommentId(null);
        }}
        onViewpoint={restoreCommentViewpoint}
      />
      {walking && (
        <FirstPersonPanel
          looking={walkLooking}
          speed={walkSpeed}
          gravity={walkGravity}
          guideOpen={walkGuideOpen}
          onSpeed={setWalkSpeed}
          onGravity={setWalkGravity}
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
      {source === "autodesk" && referenceLoadState !== "ready" && (
        <div className={`reference-load-state reference-load-${referenceLoadState}`} role="status">
          <i />
          <span>{referenceLoadState === "error" ? "Reference model failed to load" : "Loading Autodesk reference geometry"}</span>
        </div>
      )}
    </>
  );
}
