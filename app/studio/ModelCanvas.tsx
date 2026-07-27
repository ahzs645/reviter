"use client";

/** The WebGL viewport: scene assembly, camera presets, picking, and disposal. */
import { useEffect, useRef, useState } from "react";
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
import {
  applyNavigationMode,
  disposeGroup,
  meshGroup,
  overlayMeshGroup,
  referenceMeshGroup,
} from "./three-scene.ts";
import { createWalkControls, WALK_EYE_HEIGHT, type WalkControls } from "./walk-controls.ts";
import type { CameraRequest, CanvasMenuRequest, GeometrySource, ReferenceLoadState } from "./types.ts";

/**
 * Shape of the bundled `autodesk-gltf-loader.js`, which is imported at runtime
 * from the public directory so its Three.js loader stays out of the main bundle.
 */
type AutodeskLoaderModule = {
  loadAutodeskModel: (url: string) => Promise<THREE.Group>;
};

export function ModelCanvas({
  result,
  comparison,
  source,
  renderMode,
  navigationMode,
  cameraRequest,
  sectionEnabled,
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
  sectionEnabled: boolean;
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
    floor: number;
    up: "y" | "z";
    selectionOverlay: THREE.Group | null;
  } | null>(null);
  const walkRef = useRef<WalkControls | null>(null);
  const [referenceLoadState, setReferenceLoadState] = useState<ReferenceLoadState>("idle");

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = isAutodesk ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isAutodesk ? 0.95 : technical ? 1.16 : 1.08;
    renderer.shadowMap.enabled = technical;
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
    sun.castShadow = technical;
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
    controls.target.copy(center);

    if (technical) {
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
    const pointer = new THREE.Vector2();
    /** The hit test both a left-click and a right-click run, in canvas pixels. */
    const pickAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      // In the overlay the recovered meshes sit a level deeper, under their own
      // group, and the export's meshes carry no element ids — so the search goes
      // recursive and takes the first hit that can actually name an element.
      const hit = raycaster.intersectObjects(root.children, Boolean(useOverlay)).find((intersection) =>
        intersection.object instanceof THREE.Mesh
        && intersection.faceIndex != null
        && (!useOverlay || intersection.object.userData.elementIds != null),
      );
      if (!hit || hit.faceIndex == null) return null;
      const elementIds = hit.object.userData.elementIds as Uint32Array | undefined;
      // One id per triangle: drawn items range from a 12-triangle box to an
      // extruded sketch boundary with as many triangles as its ring has edges.
      return elementIds?.[hit.faceIndex] ?? null;
    };
    let pointerStart: { x: number; y: number } | null = null;
    const handlePointerDown = (event: PointerEvent) => {
      // Only the primary button picks. The right button used to run the same
      // pick on release, which cleared the selection under the menu that was
      // about to offer "Clear selection".
      if (event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (useReference || isAutodesk || !pointerStart) return;
      const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (movement > 5) return;
      onSelectElement(pickAt(event.clientX, event.clientY));
    };
    // A right-click asks about whatever is under it, so it runs the same hit
    // test as a left-click and picks the object too — the menu's "Zoom to
    // object" and the properties panel both read the selection.
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (walkRef.current) return;
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
    // What is under the cursor should name itself before you commit to
    // clicking it. The raycast is the same one picking uses; it is throttled to
    // one per animation frame because a move event can fire far more often than
    // the scene can answer.
    let hoverPending = false;
    let hoverEvent: PointerEvent | null = null;
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
      const hit = raycaster.intersectObjects(root.children, Boolean(useOverlay)).find((intersection) =>
        intersection.object instanceof THREE.Mesh
        && intersection.faceIndex != null
        && intersection.object.userData.elementIds != null,
      );
      const elementIds = hit?.object.userData.elementIds as Uint32Array | undefined;
      reportHover(hit?.faceIndex == null ? null : elementIds?.[hit.faceIndex] ?? null);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (useReference || isAutodesk || walkRef.current) return;
      hoverEvent = event;
      if (hoverPending) return;
      hoverPending = true;
      requestAnimationFrame(resolveHover);
    };
    const handlePointerLeave = () => {
      hoverEvent = null;
      reportHover(null);
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("contextmenu", handleContextMenu);
    runtimeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      root,
      center,
      radius,
      // Where the walker's feet go: the bottom of the model on whichever axis
      // this source stands on.
      floor: isAutodesk ? bounds.min.y : bounds.min.z,
      up: (isAutodesk ? "y" : "z") as "y" | "z",
      selectionOverlay: null,
    };

    let active = true;
    if (isAutodesk) {
      queueMicrotask(() => active && setReferenceLoadState("loading"));
      const moduleUrl = publicAssetUrl("autodesk-gltf-loader.js");
      void import(/* @vite-ignore */ moduleUrl).then((module) =>
        (module as AutodeskLoaderModule).loadAutodeskModel(publicAssetUrl("autodesk-reference.glb")),
      ).then((loadedScene) => {
        if (!active) {
          disposeGroup(loadedScene);
          return;
        }
        styleAutodeskReference(loadedScene, renderMode);
        root.add(loadedScene);
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
      if (walkRef.current) walkRef.current.update(delta);
      else controls.update();
      renderer.render(scene, camera);
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
      onHoverElement(null);
      onCanvasMenu(null);
      controls.dispose();
      disposeGroup(root);
      if (runtimeRef.current?.selectionOverlay) disposeGroup(runtimeRef.current.selectionOverlay);
      runtimeRef.current = null;
      renderer.dispose();
    };
  }, [comparison, hiddenElementIds, onCanvasMenu, onHoverElement, onSelectElement, renderMode, result, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    // One control decides the orientation now, so there is nothing to
    // reconcile: the requested preset is the camera.
    const preset = cameraRequest.preset;
    const pose = source === "autodesk"
      ? autodeskPoseForPreset(preset, runtime.radius)
      : { ...cameraPoseForPreset(runtime.center, runtime.radius, preset), target: runtime.center, fov: 45 };
    const target = pose.target;
    runtime.camera.fov = pose.fov;
    runtime.camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    runtime.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    runtime.controls.target.copy(target);
    runtime.camera.lookAt(target);
    runtime.camera.updateProjectionMatrix();
    runtime.controls.update();
  }, [cameraRequest, comparison, renderMode, result, source]);

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
      // Orbit around whatever is in front of the camera now, rather than
      // snapping back to the model centre.
      const forward = new THREE.Vector3();
      runtime.camera.getWorldDirection(forward);
      runtime.controls.target.copy(
        runtime.camera.position.clone().addScaledVector(forward, runtime.radius * 0.35),
      );
      runtime.controls.update();
      return;
    }

    runtime.controls.enabled = false;
    const eye = runtime.floor + WALK_EYE_HEIGHT;
    // Start where the camera already is, dropped to eye level, looking at the
    // middle of the model — so entering walk mode keeps your bearings.
    const start = runtime.camera.position.clone();
    if (runtime.up === "y") start.y = eye;
    else start.z = eye;
    const lookAt = runtime.center.clone();
    if (runtime.up === "y") lookAt.y = eye;
    else lookAt.z = eye;

    const walk = createWalkControls(runtime.camera, canvas, {
      start,
      lookAt,
      floor: eye,
      up: runtime.up,
      onLockChange: (locked) => {
        // Escape releases the pointer; treat that as leaving walk mode so the
        // button and the camera never disagree.
        if (!locked) onWalkingChange(false);
      },
    });
    walk.enable();
    walkRef.current = walk;

    return () => {
      walk.dispose();
      if (walkRef.current === walk) walkRef.current = null;
    };
  }, [comparison, onWalkingChange, renderMode, result, source, walking]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.renderer.localClippingEnabled = sectionEnabled;
    const clippingPlane = source === "autodesk"
      ? new THREE.Plane(new THREE.Vector3(0, -1, 0), runtime.center.y)
      : new THREE.Plane(new THREE.Vector3(0, 0, -1), runtime.center.z);
    runtime.root.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments;
      if (!(object as THREE.Mesh).isMesh && !(object as THREE.LineSegments).isLineSegments) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) {
        material.clippingPlanes = sectionEnabled ? [clippingPlane] : [];
        material.clipShadows = sectionEnabled;
        material.needsUpdate = true;
      }
    });
  }, [comparison, renderMode, result, sectionEnabled, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.selectionOverlay) {
      runtime.scene.remove(runtime.selectionOverlay);
      disposeGroup(runtime.selectionOverlay);
      runtime.selectionOverlay = null;
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
  }, [comparison, renderMode, result, selectedElementId, source]);

  return (
    <>
      <canvas ref={canvasRef} className={`model-canvas nav-${navigationMode}`} aria-label="Interactive Revit geometry" />
      {source === "autodesk" && referenceLoadState !== "ready" && (
        <div className={`reference-load-state reference-load-${referenceLoadState}`} role="status">
          <i />
          <span>{referenceLoadState === "error" ? "Reference model failed to load" : "Loading Autodesk reference geometry"}</span>
        </div>
      )}
    </>
  );
}
