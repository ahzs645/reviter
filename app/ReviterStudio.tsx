"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  boundsDimensions,
  cameraPoseForPreset,
  downloadBlob,
  makeDxf,
  makeGlb,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  outputName,
  solidElementBounds,
  type CameraPreset,
  type ConvertResult,
  type IfcWorkerRequest,
  type IfcWorkerResponse,
  type PairedRegressionResult,
  type ReferenceMeshData,
  type NavigationMode,
  type RenderMode,
  type WorkerRequest,
  type WorkerResponse,
} from "../lib/reviter";

type Phase = "idle" | "reading" | "converting" | "ready" | "error";
type ViewMode = "perspective" | "plan";
type ReferencePhase = "idle" | "reading" | "ready" | "error";
type GeometrySource = "autodesk" | "reference" | "recovered";
type ViewerPanel = "none" | "model" | "properties";
type CameraRequest = { preset: CameraPreset; sequence: number };
type ReferenceLoadState = "idle" | "loading" | "ready" | "error";
type ReviterGlobal = typeof globalThis & {
  __REVITER_STATIC_WORKERS__?: { rvt?: string; ifc?: string };
};
type AutodeskMeshRecord = {
  id: number;
  name: string;
  material: string;
  triangles: number;
};

const AUTODESK_REFERENCE_FILE = "UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt";
const AUTODESK_REFERENCE_BOUNDS = {
  min: { x: -108.9497, y: -9.7, z: -187.3832 },
  max: { x: 108.9497, y: 9.7, z: 187.3832 },
};
const AUTODESK_HOME_CAMERA = {
  position: new THREE.Vector3(41.734, 26.243, -88.721),
  target: new THREE.Vector3(128.105, 17.516, -36.128),
  up: new THREE.Vector3(0.07347, 0.99629, 0.04472),
  fov: 62.7447,
};
const AUTODESK_PREVIEW_RESULT: ConvertResult = {
  ok: true,
  fileName: AUTODESK_REFERENCE_FILE,
  byteLength: 0,
  meshes: [],
  materials: [],
  segments: [],
  elementBounds: [],
  nativeProfiles: [],
  decoderCoverage: {
    revitVersion: 2026,
    activeDecoders: [],
    nativeCurves: 0,
    nativeProfiles: 0,
    nativeMeshes: 0,
    nativeMaterialDefinitions: 0,
    nativeMaterialAssignments: 0,
    approximateSolids: 0,
    geometryFidelity: "diagnostic-only",
    materialFidelity: "display-fallback",
  },
  origin: { x: 0, y: 0, z: 0 },
  bbox: AUTODESK_REFERENCE_BOUNDS,
  levels: [],
  stats: {
    streamCount: 0,
    partitionStreams: 0,
    gzipChunks: 0,
    inflatedBytes: 0,
    candidatesFound: 0,
    candidatesFocused: 0,
    candidatesUsed: 0,
    vertexCount: 0,
    triangleCount: 1_220_000,
    meshCount: 8_698,
    boundsRecordsFound: 0,
    solidBoundsRecords: 0,
    durationMs: 0,
  },
  warnings: [],
  method: "partition-coordinate-recovery",
};

function hasAutodeskReference(fileName: string): boolean {
  return fileName.localeCompare(AUTODESK_REFERENCE_FILE, undefined, { sensitivity: "base" }) === 0;
}

function publicAssetUrl(fileName: string): string {
  const base = document.baseURI.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  return `${base}${fileName}`;
}

function staticWorkerUrl(kind: "rvt" | "ifc"): string | undefined {
  return (globalThis as ReviterGlobal).__REVITER_STATIC_WORKERS__?.[kind];
}


function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1_024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function savedFileName(path: string | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? null;
}

function meshGroup(result: ConvertResult, renderMode: RenderMode): THREE.Group {
  const group = new THREE.Group();
  const isElementBounds = result.method === "partition-bounds-recovery";
  const technical = renderMode === "technical";
  group.name = "Reviter recovered geometry";
  group.userData = {
    sourceFile: result.fileName,
    method: result.method,
    originFeet: result.origin,
    fidelity: "experimental",
  };
  for (const data of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const sourceMaterial = result.materials[data.materialIndex] ?? result.materials[0];
    const sourceColor = sourceMaterial
      ? new THREE.Color().setRGB(...sourceMaterial.baseColorLinear.slice(0, 3) as [number, number, number])
      : new THREE.Color(0xb9cbe0);
    const glazingProxy = data.name.startsWith("Glazing");
    const material = new THREE.MeshStandardMaterial({
      color: sourceColor,
      vertexColors: !technical,
      roughness: technical ? 0.86 : sourceMaterial?.roughness ?? 0.74,
      metalness: technical ? 0 : sourceMaterial?.metallic ?? 0.04,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: isElementBounds && (!technical || glazingProxy),
      opacity: isElementBounds ? (technical ? (glazingProxy ? 0.58 : 1) : 0.32) : 1,
      depthWrite: technical ? !glazingProxy : !isElementBounds,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = technical;
    mesh.receiveShadow = technical;
    mesh.userData.elementIds = data.elementIds;
    mesh.renderOrder = 1;
    group.add(mesh);
    if (isElementBounds) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 1),
        new THREE.LineBasicMaterial({
          color: technical ? 0x263c55 : 0x9be7e3,
          transparent: true,
          opacity: technical ? 0.56 : 0.68,
          depthWrite: false,
        }),
      );
      edges.name = `${data.name} edges`;
      edges.renderOrder = 2;
      group.add(edges);
    }
  }
  return group;
}

function referenceMeshGroup(meshes: ReferenceMeshData[], renderMode: RenderMode): THREE.Group {
  const group = new THREE.Group();
  const technical = renderMode === "technical";
  group.name = "IFC reference geometry";
  group.userData = { source: "paired-ifc", fidelity: "reference" };
  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const color = technical
      ? new THREE.Color(data.matched ? 0xc6d6e8 : 0xaebed2)
      : new THREE.Color().setRGB(...data.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: data.matched ? color.clone().multiplyScalar(0.08) : new THREE.Color(0x000000),
      roughness: technical ? 0.84 : data.matched ? 0.58 : 0.82,
      metalness: technical ? 0 : 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.castShadow = technical;
    mesh.receiveShadow = technical;
    mesh.renderOrder = data.matched ? 2 : 1;
    group.add(mesh);
    if (technical && data.indices.length <= 600_000) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 28),
        new THREE.LineBasicMaterial({ color: 0x263c55, transparent: true, opacity: 0.42 }),
      );
      edges.name = `${data.name} edges`;
      group.add(edges);
    }
  }
  return group;
}

function styleAutodeskReference(root: THREE.Object3D, renderMode: RenderMode) {
  const styled = new Set<THREE.Material>();
  root.name = "Autodesk derivative reference";
  root.userData = {
    source: "autodesk-svf-derivative",
    fidelity: "reference",
    fragments: 51_420,
    materials: 22,
  };
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = renderMode === "technical";
    mesh.receiveShadow = renderMode === "technical";
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (styled.has(material)) continue;
      styled.add(material);
      material.side = THREE.DoubleSide;
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        standard.metalness = 0;
        standard.roughness = renderMode === "technical" ? 0.82 : 0.68;
        if (renderMode === "technical") {
          standard.color.lerp(new THREE.Color(0xe3e7ec), 0.18);
        } else {
          standard.transparent = true;
          standard.opacity = Math.min(standard.opacity, 0.24);
          standard.depthWrite = false;
        }
      }
      material.needsUpdate = true;
    }
  });
}

function autodeskPoseForPreset(preset: CameraPreset, radius: number) {
  const target = new THREE.Vector3();
  if (preset === "home") {
    return {
      position: AUTODESK_HOME_CAMERA.position.clone(),
      target: AUTODESK_HOME_CAMERA.target.clone(),
      up: AUTODESK_HOME_CAMERA.up.clone(),
      fov: AUTODESK_HOME_CAMERA.fov,
    };
  }
  if (preset === "top") {
    return {
      position: new THREE.Vector3(0, radius * 2.25, 0),
      target,
      up: new THREE.Vector3(0, 0, -1),
      fov: 45,
    };
  }
  if (preset === "front") {
    return {
      position: new THREE.Vector3(0, radius * 0.22, radius * 2.25),
      target,
      up: new THREE.Vector3(0, 1, 0),
      fov: 45,
    };
  }
  return {
    position: new THREE.Vector3(radius * 2.25, radius * 0.22, 0),
    target,
    up: new THREE.Vector3(0, 1, 0),
    fov: 45,
  };
}

function autodeskFitPose(radius: number) {
  const fovRadians = THREE.MathUtils.degToRad(AUTODESK_HOME_CAMERA.fov);
  const fitDistance = (radius / Math.sin(fovRadians / 2)) * 0.55;
  const direction = AUTODESK_HOME_CAMERA.position
    .clone()
    .sub(AUTODESK_HOME_CAMERA.target)
    .normalize();
  return {
    position: direction.multiplyScalar(fitDistance),
    target: new THREE.Vector3(),
    up: AUTODESK_HOME_CAMERA.up.clone(),
    fov: AUTODESK_HOME_CAMERA.fov,
  };
}

function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.LineSegments;
    if (!(object as THREE.Mesh).isMesh && !(object as THREE.LineSegments).isLineSegments) return;
    geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) renderable.material.forEach((material) => materials.add(material));
    else materials.add(renderable.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function applyNavigationMode(controls: OrbitControls, mode: NavigationMode) {
  controls.mouseButtons.LEFT = mode === "pan"
    ? THREE.MOUSE.PAN
    : mode === "zoom"
      ? THREE.MOUSE.DOLLY
      : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = mode === "orbit" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
}

function ModelCanvas({
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
      const elementId = elementIds?.[Math.floor(hit.faceIndex / 12)];
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

function FidelityRow({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "off" }) {
  return (
    <div className="fidelity-row">
      <span>{label}</span>
      <span className={`fidelity-value fidelity-${tone}`}><i />{value}</span>
    </div>
  );
}

function RegressionPanel({ comparison }: { comparison: PairedRegressionResult }) {
  const reference = comparison.reference;
  return (
    <section className={`regression-panel regression-${comparison.status}`}>
      <div className="regression-heading">
        <div>
          <p className="eyebrow">Paired RVT / IFC regression</p>
          <h3>{comparison.conclusion}</h3>
          <p>{reference.fileName} · {reference.schema} · {(reference.durationMs / 1_000).toFixed(1)}s local analysis</p>
        </div>
        <span>{comparison.status === "pass" ? "accepted" : comparison.status === "warn" ? "review" : "rejected"}</span>
      </div>

      <div className="regression-metrics">
        <div><strong>{reference.matchedElementCount.toLocaleString()}</strong><span>matched RVT records</span></div>
        <div><strong>{(comparison.identityCoverage * 100).toFixed(1)}%</strong><span>IFC tag coverage</span></div>
        <div><strong>{reference.elementCount.toLocaleString()}</strong><span>typed IFC elements</span></div>
        <div><strong>{reference.storeyCount}</strong><span>IFC storeys</span></div>
        <div><strong>{reference.triangleCount.toLocaleString()}</strong><span>IFC triangles</span></div>
      </div>

      <div className="gate-grid">
        {comparison.gates.map((gate) => (
          <div className={`gate-card gate-${gate.status}`} key={gate.id}>
            <span><i />{gate.label}</span><strong>{gate.value}</strong><p>{gate.detail}</p>
          </div>
        ))}
      </div>

      <div className="match-evidence-grid">
        <div>
          <p className="eyebrow">Object-class matches</p>
          <div className="match-table" role="table" aria-label="IFC object class matches to RVT records">
            {reference.elementTypes.filter((row) => row.matchedRvtRecords).slice(0, 8).map((row) => (
              <div role="row" key={row.ifcType}>
                <span role="cell">{row.ifcType.replace(/^IFC/, "")}</span>
                <strong role="cell">{row.matchedRvtRecords.toLocaleString()} / {row.count.toLocaleString()}</strong>
                <small role="cell">index {row.matchedElemTable.toLocaleString()} · partition {row.matchedPartitionRecords.toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Matched record samples</p>
          <div className="sample-list">
            {reference.matchedSamples.slice(0, 6).map((sample) => (
              <div key={`${sample.expressId}-${sample.revitElementId}`}>
                <strong>#{sample.revitElementId} · {sample.ifcType.replace(/^IFC/, "")}</strong>
                <span>{sample.evidence.replaceAll("-", " ")}{sample.partitionRecord ? ` · ${sample.partitionRecord.stream} chunk ${sample.partitionRecord.chunkIndex}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ReviterStudio({ referencePreview = false }: { referencePreview?: boolean }) {
  const [phase, setPhase] = useState<Phase>(referencePreview ? "ready" : "idle");
  const [progress, setProgress] = useState(referencePreview ? 1 : 0);
  const [progressMessage, setProgressMessage] = useState(
    referencePreview ? "Autodesk derivative reference loaded for visual review" : "Waiting for a local file",
  );
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<FileInfo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(referencePreview ? AUTODESK_PREVIEW_RESULT : null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<ViewMode>("perspective");
  const [geometrySource, setGeometrySource] = useState<GeometrySource>(referencePreview ? "autodesk" : "recovered");
  const [renderMode, setRenderMode] = useState<RenderMode>("technical");
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit");
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({ preset: "home", sequence: 0 });
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [viewerPanel, setViewerPanel] = useState<ViewerPanel>("none");
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [referencePhase, setReferencePhase] = useState<ReferencePhase>("idle");
  const [referenceProgress, setReferenceProgress] = useState(0);
  const [referenceMessage, setReferenceMessage] = useState("Choose the matching IFC export");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<PairedRegressionResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const ifcWorkerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const referenceRequestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
    ifcWorkerRef.current?.terminate();
    if (thumbnail) URL.revokeObjectURL(thumbnail);
  }, [thumbnail]);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const url = staticWorkerUrl("rvt") ?? new URL("../lib/reviter/worker.ts", import.meta.url);
      workerRef.current = new Worker(url, { type: "module" });
    }
    return workerRef.current;
  }, []);

  const getIfcWorker = useCallback(() => {
    if (!ifcWorkerRef.current) {
      const url = staticWorkerUrl("ifc") ?? new URL("../lib/reviter/ifc-worker.ts", import.meta.url);
      ifcWorkerRef.current = new Worker(url, { type: "module" });
    }
    return ifcWorkerRef.current;
  }, []);

  const processFile = useCallback(async (nextFile: File) => {
    if (!/\.(rvt|rfa|rte|rft)$/i.test(nextFile.name)) {
      setError("Choose a Revit .rvt, .rfa, .rte, or .rft file.");
      setPhase("error");
      return;
    }
    if (!nextFile.size) {
      setError("The selected file is empty.");
      setPhase("error");
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setFile(nextFile);
    setResult(null);
    setComparison(null);
    setGeometrySource("recovered");
    setRenderMode("technical");
    setNavigationMode("orbit");
    setCameraRequest({ preset: "home", sequence: requestId });
    setSectionEnabled(false);
    setViewerPanel("none");
    setSelectedElementId(null);
    setModelSearch("");
    setDetailsOpen(false);
    setReferencePhase("idle");
    setReferenceError(null);
    setMetadata(null);
    setError(null);
    setProgress(0.03);
    setProgressMessage("Reading metadata and thumbnail");
    setPhase("reading");

    try {
      const cfb = await openFile(nextFile);
      const [info, preview] = await Promise.all([basicFileInfo(cfb), tryThumbnail(cfb)]);
      if (requestId !== requestIdRef.current) return;
      setMetadata(info);
      if (thumbnail) URL.revokeObjectURL(thumbnail);
      setThumbnail(preview.ok ? URL.createObjectURL(preview.data) : null);
      setPhase("converting");
      setProgress(0.08);
      setProgressMessage("Preparing local conversion worker");

      const buffer = await nextFile.arrayBuffer();
      const worker = getWorker();
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.id !== requestId || requestId !== requestIdRef.current) return;
        if (message.type === "progress") {
          setProgress(message.ratio);
          setProgressMessage(message.message);
          return;
        }
        if (message.type === "error") {
          setError(message.error);
          setPhase("error");
          return;
        }
        if (!message.result.ok) {
          setError(message.result.error);
          setPhase("error");
          return;
        }
        setResult(message.result);
        setGeometrySource(hasAutodeskReference(message.result.fileName) ? "autodesk" : "recovered");
        setProgress(1);
        setProgressMessage("Conversion ready");
        setPhase("ready");
      };
      const request: WorkerRequest = {
        id: requestId,
        type: "convert",
        fileName: nextFile.name,
        buffer,
        options: {
          maxSegments: 12_000,
          revitVersion: Number.parseInt(info.version, 10),
        },
      };
      worker.postMessage(request, [buffer]);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("error");
    }
  }, [getWorker, thumbnail]);

  const processIfcFile = useCallback(async (referenceFile: File) => {
    if (!result?.elementIndex) {
      setReferenceError("Open and finish processing the RVT before pairing an IFC reference.");
      setReferencePhase("error");
      return;
    }
    if (!/\.ifc$/i.test(referenceFile.name)) {
      setReferenceError("Choose an IFC STEP file ending in .ifc.");
      setReferencePhase("error");
      return;
    }
    referenceRequestIdRef.current += 1;
    const requestId = referenceRequestIdRef.current;
    setComparison(null);
    setReferenceError(null);
    setReferencePhase("reading");
    setReferenceProgress(0.02);
    setReferenceMessage("Reading IFC reference in this browser");
    try {
      const buffer = await referenceFile.arrayBuffer();
      const worker = getIfcWorker();
      worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
        const message = event.data;
        if (message.id !== requestId || requestId !== referenceRequestIdRef.current) return;
        if (message.type === "progress") {
          setReferenceProgress(message.ratio);
          setReferenceMessage(message.message);
          return;
        }
        if (message.type === "error") {
          setReferenceError(message.error);
          setReferencePhase("error");
          return;
        }
        setComparison(message.result);
        setGeometrySource("reference");
        setReferenceProgress(1);
        setReferenceMessage("Paired regression complete");
        setReferencePhase("ready");
      };
      const request: IfcWorkerRequest = {
        id: requestId,
        type: "analyze-ifc",
        fileName: referenceFile.name,
        buffer,
        rvt: {
          elemTableIds: result.elementIndex.uniqueElementIds,
          partitionRecordIds: result.elementIndex.partitionRecordIds,
          partitionRecords: result.elementIndex.partitionRecords,
          boundsFeet: result.bbox,
          triangleCount: result.stats.triangleCount,
          productionElements: result.readerDiagnostics?.productionElements ?? 0,
        },
      };
      worker.postMessage(request, [buffer]);
    } catch (caught) {
      if (requestId !== referenceRequestIdRef.current) return;
      setReferenceError(caught instanceof Error ? caught.message : String(caught));
      setReferencePhase("error");
    }
  }, [getIfcWorker, result]);

  const exportText = (kind: string, extension: string, content: () => string, type = "text/plain") => {
    if (!result) return;
    setExporting(kind);
    try {
      downloadBlob(new Blob([content()], { type }), outputName(result.fileName, extension));
    } finally {
      setExporting(null);
    }
  };

  const exportGlb = async () => {
    if (!result) return;
    setExporting("GLB");
    try {
      const data = makeGlb(result);
      downloadBlob(new Blob([data], { type: "model/gltf-binary" }), outputName(result.fileName, "glb"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setExporting(null);
    }
  };

  const versionNumber = Number(metadata?.version ?? 0);
  const isFutureVersion = versionNumber > 2026;
  const autodeskReferenceAvailable = Boolean(result && hasAutodeskReference(result.fileName));
  const savedName = savedFileName(metadata?.path);
  const displayedElementIds = useMemo(() => {
    if (!result) return new Set<number>();
    return new Set(result.meshes.flatMap((mesh) => mesh.elementIds ? [...mesh.elementIds] : []));
  }, [result]);
  const solidRecords = useMemo(
    () => result
      ? solidElementBounds(result.elementBounds).filter((record) => displayedElementIds.has(record.elementId))
      : [],
    [displayedElementIds, result],
  );
  const selectedRecord = useMemo(
    () => selectedElementId == null
      ? null
      : result?.elementBounds.find((record) => record.elementId === selectedElementId) ?? null,
    [result, selectedElementId],
  );
  const selectedDimensions = selectedRecord ? boundsDimensions(selectedRecord.boundsFeet) : null;
  const visibleModelRecords = useMemo(() => {
    const query = modelSearch.trim();
    const records = query
      ? solidRecords.filter((record) => String(record.elementId).includes(query))
      : solidRecords;
    return records.slice(0, 180);
  }, [modelSearch, solidRecords]);
  const requestCamera = useCallback((preset: CameraPreset) => {
    setView(preset === "top" ? "plan" : "perspective");
    setCameraRequest((current) => ({ preset, sequence: current.sequence + 1 }));
  }, []);

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Reviter</span>
          <span className="brand-subtitle">browser Revit lab</span>
        </div>
        <div className="privacy-badge"><span />Local-only processing</div>
      </header>

      <section className={`workspace ${result ? "model-open" : ""}`}>
        <aside className="control-rail">
          <div className="rail-intro">
            <p className="eyebrow">RVT → open geometry</p>
            <h1>Inspect first.<br />Convert honestly.</h1>
            <p>Open a Revit file without uploading it. Verified metadata stays separate from experimental geometry recovery.</p>
          </div>

          <button
            className={`drop-card ${dragging ? "is-dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped) void processFile(dropped);
            }}
            type="button"
          >
            <span className="drop-icon" aria-hidden="true">↗</span>
            <span><strong>{file ? "Choose another Revit file" : "Drop a Revit file here"}</strong><small>.rvt · .rfa · .rte · .rft</small></span>
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".rvt,.rfa,.rte,.rft"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void processFile(selected);
              event.currentTarget.value = "";
            }}
          />

          {phase !== "idle" && (
            <div className="progress-card" aria-live="polite">
              <div className="progress-heading">
                <span>{phase === "ready" ? "Local conversion complete" : phase === "error" ? "Conversion stopped" : "Working in this tab"}</span>
                <b>{Math.round(progress * 100)}%</b>
              </div>
              <div className="progress-track"><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
              <p>{error ?? progressMessage}</p>
            </div>
          )}

          {metadata && (
            <section className="rail-section file-section">
              <div className="section-heading"><span>File record</span><span className="verified-tag">verified</span></div>
              <div className="file-record">
                {thumbnail ? <img src={thumbnail} alt="Embedded Revit preview" /> : <div className="thumbnail-fallback">RVT</div>}
                <div><strong>{file?.name}</strong><span>{file ? formatBytes(file.size) : null}</span></div>
              </div>
              <dl className="metadata-grid">
                <div><dt>Revit</dt><dd>{metadata.version}</dd></div>
                <div><dt>Build</dt><dd>{metadata.build}</dd></div>
                <div><dt>Locale</dt><dd>{metadata.locale}</dd></div>
                <div><dt>Document</dt><dd title={metadata.documentId}>{metadata.documentId.slice(0, 8)}…</dd></div>
              </dl>
              {savedName && <p className="privacy-note">Original folder path withheld · saved as {savedName}</p>}
            </section>
          )}

          <section className="rail-section fidelity-section">
            <div className="section-heading"><span>Fidelity ledger</span></div>
            <FidelityRow label="File metadata" value={metadata ? "Verified" : "Awaiting file"} tone={metadata ? "good" : "off"} />
            <FidelityRow label="OLE / CFB streams" value={result ? "Parsed" : "Awaiting file"} tone={result ? "good" : "off"} />
            <FidelityRow
              label="3D geometry"
              value={geometrySource === "autodesk" ? "Autodesk derivative" : geometrySource === "reference" && comparison ? "IFC reference" : result?.method === "native-profile-recovery" ? "Native wall profiles" : result?.method === "partition-bounds-recovery" ? "RVT element bounds" : result ? "Experimental" : "Not evaluated"}
              tone={geometrySource === "autodesk" || geometrySource === "reference" && comparison ? "good" : result ? "warn" : "off"}
            />
            <FidelityRow
              label="Native meshes"
              value={geometrySource === "autodesk" ? "8,698 derivative meshes" : result ? result.decoderCoverage.nativeMeshes.toLocaleString() : "Not evaluated"}
              tone={geometrySource === "autodesk" ? "good" : result?.decoderCoverage.nativeMeshes ? "warn" : "off"}
            />
            <FidelityRow
              label="RVT materials"
              value={geometrySource === "autodesk" ? "22 derivative materials" : result?.decoderCoverage.nativeMaterialDefinitions ? `${result.decoderCoverage.nativeMaterialDefinitions.toLocaleString()} definitions` : result ? "Not decoded" : "Not evaluated"}
              tone={geometrySource === "autodesk" ? "good" : result?.decoderCoverage.nativeMaterialDefinitions ? "warn" : "off"}
            />
            <FidelityRow
              label="BIM semantics"
              value={geometrySource === "reference" && comparison ? `${comparison.reference.elementCount.toLocaleString()} IFC` : result?.readerDiagnostics?.productionElements ? `${result.readerDiagnostics.productionElements} decoded` : "Unavailable"}
              tone={geometrySource === "reference" && comparison ? "good" : result?.readerDiagnostics?.productionElements ? "warn" : "off"}
            />
          </section>

          {result && (
            <section className="rail-section reference-section">
              <div className="section-heading"><span>Regression fixture</span><span className={comparison ? `fixture-${comparison.status}` : ""}>{comparison ? comparison.status : "optional"}</span></div>
              <p>Pair the matching IFC export to join native Revit IDs and test geometry against typed ground truth.</p>
              <button type="button" onClick={() => ifcInputRef.current?.click()} disabled={referencePhase === "reading"}>
                {referencePhase === "reading" ? "Analyzing IFC…" : comparison ? "Choose another IFC" : "Pair IFC reference"}
              </button>
              <input
                ref={ifcInputRef}
                className="visually-hidden"
                type="file"
                accept=".ifc"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) void processIfcFile(selected);
                  event.currentTarget.value = "";
                }}
              />
              {referencePhase !== "idle" && (
                <div className="fixture-progress" aria-live="polite">
                  <div><span>{referenceError ?? referenceMessage}</span><b>{Math.round(referenceProgress * 100)}%</b></div>
                  <i><span style={{ width: `${Math.max(2, referenceProgress * 100)}%` }} /></i>
                </div>
              )}
              {result.elementIndex && (
                <small>{result.elementIndex.uniqueElementIds.length.toLocaleString()} indexed IDs · {result.elementIndex.partitionRecordIds.length.toLocaleString()} partition IDs</small>
              )}
            </section>
          )}
        </aside>

        <section className={`stage ${result ? "viewer-active" : ""}`}>
          <div className="stage-toolbar">
            <div className="stage-title">
              <span className={`status-dot status-${phase}`} />
              <div><strong>{result ? result.fileName : "No model open"}</strong><span>{result ? geometrySource === "autodesk" ? "51,420 Autodesk fragments · 1.22M source polygons" : geometrySource === "reference" && comparison ? `${formatNumber(comparison.reference.elementCount)} typed IFC elements · paired locally` : result.method === "native-profile-recovery" ? `${formatNumber(result.stats.candidatesUsed)} native ArcWall profiles` : result.method === "partition-bounds-recovery" ? `${formatNumber(result.stats.candidatesUsed)} RVT element envelopes in scene` : `${formatNumber(result.stats.candidatesUsed)} recovered diagnostic centerlines` : "Your file never leaves this browser tab"}</span></div>
            </div>
            <div className="toolbar-controls">
              {autodeskReferenceAvailable || comparison?.referenceMeshes.length ? (
                <div className="segmented-control source-control" aria-label="Geometry source">
                  {autodeskReferenceAvailable && <button className={geometrySource === "autodesk" ? "active" : ""} onClick={() => { setGeometrySource("autodesk"); setSelectedElementId(null); }}>Autodesk</button>}
                  {comparison?.referenceMeshes.length ? <button className={geometrySource === "reference" ? "active" : ""} onClick={() => { setGeometrySource("reference"); setSelectedElementId(null); }}>IFC reference</button> : null}
                  <button className={geometrySource === "recovered" ? "active diagnostic-active" : ""} onClick={() => setGeometrySource("recovered")}>RVT diagnostic</button>
                </div>
              ) : null}
              <div className="segmented-control" aria-label="Camera view">
                <button className={view === "perspective" ? "active" : ""} onClick={() => setView("perspective")} disabled={!result}>3D</button>
                <button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")} disabled={!result}>Plan</button>
              </div>
            </div>
          </div>

          <div className={`viewport viewport-${renderMode} ${geometrySource === "autodesk" ? "viewport-autodesk" : ""}`}>
            {result ? (
              <>
                <ModelCanvas
                  result={result}
                  comparison={comparison}
                  source={geometrySource}
                  view={view}
                  renderMode={renderMode}
                  navigationMode={navigationMode}
                  cameraRequest={cameraRequest}
                  sectionEnabled={sectionEnabled}
                  selectedElementId={selectedElementId}
                  onSelectElement={setSelectedElementId}
                />
                <nav className="viewer-commandbar" aria-label="Model tools">
                  <button
                    className={viewerPanel === "model" ? "active" : ""}
                    onClick={() => setViewerPanel((current) => current === "model" ? "none" : "model")}
                    aria-pressed={viewerPanel === "model"}
                    disabled={geometrySource !== "recovered"}
                  ><i>☷</i>Model browser</button>
                  <button
                    className={viewerPanel === "properties" ? "active" : ""}
                    onClick={() => setViewerPanel((current) => current === "properties" ? "none" : "properties")}
                    aria-pressed={viewerPanel === "properties"}
                    disabled={geometrySource !== "recovered"}
                  ><i>ⓘ</i>Properties</button>
                  <button
                    className={detailsOpen ? "active" : ""}
                    onClick={() => setDetailsOpen((current) => !current)}
                    aria-pressed={detailsOpen}
                  ><i>▤</i>Report & exports</button>
                  <span className="command-divider" />
                  <div className="render-switch" aria-label="Render style">
                    <button className={renderMode === "technical" ? "active" : ""} onClick={() => setRenderMode("technical")}>Shaded</button>
                    <button className={renderMode === "xray" ? "active" : ""} onClick={() => setRenderMode("xray")}>X-ray</button>
                  </div>
                  <span className="viewer-fidelity-chip">{geometrySource === "autodesk" ? "Autodesk derivative reference" : result.decoderCoverage.geometryFidelity.replaceAll("-", " ")}</span>
                </nav>

                {viewerPanel === "model" && (
                  <aside className="viewer-sidepanel model-browser-panel" aria-label="Model browser">
                    <div className="viewer-panel-heading"><div><strong>Model browser</strong><span>{solidRecords.length.toLocaleString()} recovered elements</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close model browser">×</button></div>
                    <label className="model-search"><span>Search native ID</span><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} inputMode="numeric" placeholder="e.g. 290618" /></label>
                    <div className="model-tree" role="listbox" aria-label="Recovered Revit elements">
                      {visibleModelRecords.map((record) => {
                        const dimensions = boundsDimensions(record.boundsFeet);
                        return (
                          <button
                            key={record.elementId}
                            className={selectedElementId === record.elementId ? "selected" : ""}
                            onClick={() => setSelectedElementId(record.elementId)}
                            role="option"
                            aria-selected={selectedElementId === record.elementId}
                          >
                            <span><i />Revit element {record.elementId}</span>
                            <small>{dimensions.x.toFixed(1)} × {dimensions.y.toFixed(1)} × {dimensions.z.toFixed(1)} ft</small>
                          </button>
                        );
                      })}
                    </div>
                    {solidRecords.length > visibleModelRecords.length && <p>Showing {visibleModelRecords.length} of {solidRecords.length.toLocaleString()} elements. Search by native ID to narrow the list.</p>}
                  </aside>
                )}

                {viewerPanel === "properties" && (
                  <aside className="viewer-sidepanel properties-panel" aria-label="Element properties">
                    <div className="viewer-panel-heading"><div><strong>Properties</strong><span>{selectedRecord ? `Element ${selectedRecord.elementId}` : "No selection"}</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close properties">×</button></div>
                    {selectedRecord && selectedDimensions ? (
                      <dl className="property-table">
                        <div><dt>Native Revit ID</dt><dd>{selectedRecord.elementId}</dd></div>
                        <div><dt>Evidence</dt><dd>Duplicated bounds record</dd></div>
                        <div><dt>Stream</dt><dd>{selectedRecord.stream}</dd></div>
                        <div><dt>Chunk</dt><dd>{selectedRecord.chunkIndex.toLocaleString()}</dd></div>
                        <div><dt>Width</dt><dd>{selectedDimensions.x.toFixed(3)} ft</dd></div>
                        <div><dt>Depth</dt><dd>{selectedDimensions.y.toFixed(3)} ft</dd></div>
                        <div><dt>Height</dt><dd>{selectedDimensions.z.toFixed(3)} ft</dd></div>
                        <div><dt>Minimum Z</dt><dd>{selectedRecord.boundsFeet.min.z.toFixed(3)} ft</dd></div>
                        <div><dt>Record offset</dt><dd>0x{selectedRecord.recordOffset.toString(16)}</dd></div>
                      </dl>
                    ) : (
                      <div className="property-empty"><b>Pick an envelope in the viewport</b><p>Click a recovered solid or choose an element from Model browser. Native IDs and record evidence stay local.</p></div>
                    )}
                  </aside>
                )}

                <div className="view-cube" aria-label="Camera orientation">
                  <button className="cube-top" onClick={() => requestCamera("top")}>TOP</button>
                  <button className="cube-front" onClick={() => requestCamera("front")}>FRONT</button>
                  <button className="cube-right" onClick={() => requestCamera("right")}>RIGHT</button>
                </div>

                <nav className="viewer-navigation" aria-label="Viewport navigation">
                  <button onClick={() => requestCamera("home")}><i>⌂</i><span>Home</span></button>
                  <button onClick={() => requestCamera(cameraRequest.preset)}><i>⛶</i><span>Fit</span></button>
                  <button className={navigationMode === "pan" ? "active" : ""} onClick={() => setNavigationMode("pan")} aria-pressed={navigationMode === "pan"}><i>✣</i><span>Pan</span></button>
                  <button className={navigationMode === "zoom" ? "active" : ""} onClick={() => setNavigationMode("zoom")} aria-pressed={navigationMode === "zoom"}><i>⌕</i><span>Zoom</span></button>
                  <button className={navigationMode === "orbit" ? "active" : ""} onClick={() => setNavigationMode("orbit")} aria-pressed={navigationMode === "orbit"}><i>◉</i><span>Orbit</span></button>
                  <span />
                  <button className={sectionEnabled ? "active" : ""} onClick={() => setSectionEnabled((current) => !current)} aria-pressed={sectionEnabled}><i>◩</i><span>Section</span></button>
                  <button onClick={() => { setSelectedElementId(null); setSectionEnabled(false); requestCamera("home"); }}><i>↺</i><span>Reset</span></button>
                </nav>

                {selectedRecord && <button className="selection-chip" onClick={() => setViewerPanel("properties")}>Element {selectedRecord.elementId}<span>View properties</span></button>}
                <div className="viewport-legend">
                  {geometrySource === "autodesk" ? (
                    <><span><i className="legend-cyan" />Autodesk source meshes</span><span><i className="legend-context" />22 source materials</span></>
                  ) : geometrySource === "reference" && comparison ? (
                    <><span><i className="legend-cyan" />Matched RVT records</span><span><i className="legend-context" />IFC context</span></>
                  ) : (
                    <span><i className="legend-amber" />{result.method === "native-profile-recovery" ? "Native ArcWall profiles · approximate solids" : result.method === "partition-bounds-recovery" ? "RVT element envelopes" : "Rejected diagnostic recovery"}</span>
                  )}
                  <span><i className="legend-grid" />Model grid</span>
                </div>
                <div className="viewport-stamp">{geometrySource === "autodesk" ? "Autodesk SVF derivative · metres · y-up" : geometrySource === "reference" && comparison ? "paired IFC ground truth · metres · z-up" : result.method === "native-profile-recovery" ? "RVT 2023 ArcWall profiles · feet · z-up" : result.method === "partition-bounds-recovery" ? "RVT duplicated-bounds records · feet · z-up" : "rejected heuristic · feet · z-up"}</div>
              </>
            ) : (
              <div className="empty-stage">
                <div className="empty-orbit" aria-hidden="true"><span /><span /><b>R</b></div>
                <p className="eyebrow">Zero upload · no account · no telemetry</p>
                <h2>Your model stays<br />on your machine.</h2>
                <p>Use the file picker or drag a local Revit model onto the left panel. Conversion runs in a dedicated browser worker.</p>
                <button onClick={() => inputRef.current?.click()}>Open a local model</button>
              </div>
            )}
          </div>

          {result && detailsOpen && (
            <div className="results-dock">
              {comparison && <RegressionPanel comparison={comparison} />}
              <section className="result-summary">
                <p className="eyebrow">Recovery summary</p>
                <div className="metric-row">
                  <div><strong>{formatNumber(result.stats.candidatesFound)}</strong><span>raw candidates</span></div>
                  <div><strong>{formatNumber(result.stats.candidatesUsed)}</strong><span>in scene</span></div>
                  <div><strong>{formatNumber(result.stats.triangleCount)}</strong><span>triangles</span></div>
                  <div><strong>{(result.stats.durationMs / 1_000).toFixed(1)}s</strong><span>convert time</span></div>
                </div>
                <div className="level-bands">
                  <span>Dominant elevations</span>
                  {result.levels.slice(0, 5).map((level) => <b key={level.elevation}>{level.elevation.toFixed(1)}′ <small>{level.candidates}</small></b>)}
                </div>
              </section>

              <section className="export-panel">
                <div className="export-heading"><div><p className="eyebrow">Export recovered data</p><h3>Choose an open format</h3></div><span>client generated</span></div>
                <div className="export-grid">
                  <button onClick={() => void exportGlb()} disabled={Boolean(exporting)}><strong>GLB</strong><span>3D scene</span></button>
                  <button onClick={() => exportText("OBJ", "obj", () => makeObj(result))} disabled={Boolean(exporting)}><strong>OBJ</strong><span>mesh</span></button>
                  <button onClick={() => exportText("DXF", "dxf", () => makeDxf(result))} disabled={Boolean(exporting)}><strong>DXF</strong><span>3D lines</span></button>
                  <button onClick={() => exportText("SVG", "svg", () => makePlanSvg(result), "image/svg+xml")} disabled={Boolean(exporting)}><strong>SVG</strong><span>plan</span></button>
                  <button onClick={() => exportText("IFC", "ifc", () => makeIfcCenterlines(result), "application/x-step")} disabled={Boolean(exporting)}><strong>IFC</strong><span>{result.method === "partition-bounds-recovery" ? "solid proxies" : result.method === "native-profile-recovery" ? "profile proxies" : "proxies"}</span></button>
                  <button onClick={() => exportText("JSON", "json", () => makeReport(result, metadata as unknown as Record<string, unknown>), "application/json")} disabled={Boolean(exporting)}><strong>JSON</strong><span>audit</span></button>
                </div>
                <p className="export-disclaimer">Exports preserve {result.method === "native-profile-recovery" ? "native ArcWall centerlines with explicitly approximate solids" : result.method === "partition-bounds-recovery" ? "native-ID element envelopes" : "the recovered geometry"}. The audit records {result.decoderCoverage.nativeMaterialDefinitions.toLocaleString()} decoded material definitions and {result.decoderCoverage.nativeMaterialAssignments.toLocaleString()} proven assignments; textures and openings remain unavailable.</p>
              </section>
            </div>
          )}

          {detailsOpen && (result || isFutureVersion) && (
            <aside className="evidence-banner">
              <span className="evidence-icon">!</span>
              <div>
                <strong>{isFutureVersion ? `Revit ${metadata?.version} is newer than the supplied Rust reader’s verified 2016–2026 range.` : "This is a geometry recovery, not a native RVT decode."}</strong>
                <p>{result?.readerDiagnostics?.summary ?? "The standards-aware reader found no validated building elements in this file. IFC export therefore uses clearly labeled centerline proxies."}</p>
              </div>
            </aside>
          )}
        </section>
      </section>
    </main>
  );
}
