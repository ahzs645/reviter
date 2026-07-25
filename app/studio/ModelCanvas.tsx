"use client";

/** The WebGL viewport: scene assembly, camera presets, picking, and disposal. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  boundsDimensions,
  cameraPoseForPreset,
  type ConvertResult,
  type NavigationMode,
  type PairedRegressionResult,
  type RenderMode,
} from "../../lib/reviter";
import {
  AUTODESK_REFERENCE_BOUNDS,
  autodeskPoseForPreset,
  publicAssetUrl,
  styleAutodeskReference,
} from "./autodesk-reference.ts";
import { applyNavigationMode, disposeGroup, meshGroup, referenceMeshGroup } from "./three-scene.ts";
import type { CameraRequest, GeometrySource, ReferenceLoadState, ViewMode } from "./types.ts";

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
  view,
  renderMode,
  navigationMode,
  cameraRequest,
  sectionEnabled,
  selectedElementId,
  onSelectElement,
}: {
  result: ConvertResult;
  comparison: PairedRegressionResult | null;
  source: GeometrySource;
  view: ViewMode;
  renderMode: RenderMode;
  navigationMode: NavigationMode;
  cameraRequest: CameraRequest;
  sectionEnabled: boolean;
  selectedElementId: number | null;
  onSelectElement: (elementId: number | null) => void;
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
    selectionOverlay: THREE.Group | null;
  } | null>(null);
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
    const root = isAutodesk
      ? new THREE.Group()
      : useReference
        ? referenceMeshGroup(comparison.referenceMeshes, renderMode)
        : meshGroup(result, renderMode);
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
      ? autodeskPoseForPreset("home", radius)
      : { ...cameraPoseForPreset(center, radius, "home"), target: center, fov: 45 };
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
    let pointerStart: { x: number; y: number } | null = null;
    const handlePointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (useReference || isAutodesk || !pointerStart) return;
      const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (movement > 5) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(root.children, false).find((intersection) =>
        intersection.object instanceof THREE.Mesh && intersection.faceIndex != null,
      );
      if (!hit || hit.faceIndex == null) {
        onSelectElement(null);
        return;
      }
      const elementIds = hit.object.userData.elementIds as Uint32Array | undefined;
      // One id per triangle: drawn items range from a 12-triangle box to an
      // extruded sketch boundary with as many triangles as its ring has edges.
      const elementId = elementIds?.[hit.faceIndex];
      onSelectElement(elementId ?? null);
    };
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    runtimeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      root,
      center,
      radius,
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
    const render = () => {
      if (!active) return;
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      controls.dispose();
      disposeGroup(root);
      if (runtimeRef.current?.selectionOverlay) disposeGroup(runtimeRef.current.selectionOverlay);
      runtimeRef.current = null;
      renderer.dispose();
    };
  }, [comparison, onSelectElement, renderMode, result, source]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const preset = view === "plan" ? "top" : cameraRequest.preset;
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
  }, [cameraRequest, comparison, renderMode, result, source, view]);

  useEffect(() => {
    const controls = runtimeRef.current?.controls;
    if (!controls) return;
    applyNavigationMode(controls, navigationMode);
  }, [comparison, navigationMode, renderMode, result, source]);

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
