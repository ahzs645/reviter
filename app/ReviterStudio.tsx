"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  downloadBlob,
  makeDxf,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  outputName,
  type ConvertResult,
  type IfcWorkerRequest,
  type IfcWorkerResponse,
  type PairedRegressionResult,
  type ReferenceMeshData,
  type WorkerRequest,
  type WorkerResponse,
} from "../lib/reviter";

type Phase = "idle" | "reading" | "converting" | "ready" | "error";
type ViewMode = "perspective" | "plan";
type ReferencePhase = "idle" | "reading" | "ready" | "error";
type GeometrySource = "reference" | "recovered";

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

function meshGroup(result: ConvertResult): THREE.Group {
  const group = new THREE.Group();
  const isElementBounds = result.method === "partition-bounds-recovery";
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
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.74,
      metalness: 0.04,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: isElementBounds,
      opacity: isElementBounds ? 0.32 : 1,
      depthWrite: !isElementBounds,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.renderOrder = 1;
    group.add(mesh);
    if (isElementBounds) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 1),
        new THREE.LineBasicMaterial({
          color: 0x9be7e3,
          transparent: true,
          opacity: 0.68,
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

function referenceMeshGroup(meshes: ReferenceMeshData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "IFC reference geometry";
  group.userData = { source: "paired-ifc", fidelity: "reference" };
  for (const data of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    const color = new THREE.Color().setRGB(...data.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: data.matched ? color.clone().multiplyScalar(0.08) : new THREE.Color(0x000000),
      roughness: data.matched ? 0.58 : 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.name;
    mesh.renderOrder = data.matched ? 2 : 1;
    group.add(mesh);
  }
  return group;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material.dispose();
  });
}

function ModelCanvas({
  result,
  comparison,
  source,
  view,
}: {
  result: ConvertResult;
  comparison: PairedRegressionResult | null;
  source: GeometrySource;
  view: ViewMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081419);
    scene.fog = new THREE.FogExp2(0x081419, 0.00045);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;

    const useReference = source === "reference" && comparison?.referenceMeshes.length;
    const root = useReference ? referenceMeshGroup(comparison.referenceMeshes) : meshGroup(result);
    const bounds = useReference ? comparison.referenceBoundsMetres : result.bbox;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xccefff, 0x102026, 1.45));
    const sun = new THREE.DirectionalLight(0xfff4d8, 2.3);
    sun.position.set(180, -120, 280);
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

    const grid = new THREE.GridHelper(Math.max(dx, dy, 100) * 1.35, 32, 0x3c7176, 0x17363d);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = bounds.min.z - 0.04;
    scene.add(grid);

    if (view === "plan") {
      camera.up.set(0, 1, 0);
      camera.position.set(center.x, center.y, center.z + radius * 2.25);
    } else {
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + radius, center.y - radius * 1.2, center.z + radius * 0.82);
    }
    camera.near = Math.max(0.1, radius / 1_000);
    camera.far = radius * 30;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.update();

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
    let active = true;
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
      controls.dispose();
      disposeGroup(root);
      renderer.dispose();
    };
  }, [comparison, result, source, view]);

  return <canvas ref={canvasRef} className="model-canvas" aria-label="Interactive recovered Revit geometry" />;
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

export default function ReviterStudio() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("Waiting for a local file");
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<FileInfo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<ViewMode>("perspective");
  const [geometrySource, setGeometrySource] = useState<GeometrySource>("recovered");
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
      workerRef.current = new Worker(new URL("../lib/reviter/worker.ts", import.meta.url), { type: "module" });
    }
    return workerRef.current;
  }, []);

  const getIfcWorker = useCallback(() => {
    if (!ifcWorkerRef.current) {
      ifcWorkerRef.current = new Worker(new URL("../lib/reviter/ifc-worker.ts", import.meta.url), { type: "module" });
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
        setProgress(1);
        setProgressMessage("Conversion ready");
        setPhase("ready");
      };
      const request: WorkerRequest = {
        id: requestId,
        type: "convert",
        fileName: nextFile.name,
        buffer,
        options: { maxSegments: 12_000 },
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
    const group = meshGroup(result);
    try {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
      if (!(data instanceof ArrayBuffer)) throw new Error("GLB exporter returned an unexpected value.");
      downloadBlob(new Blob([data], { type: "model/gltf-binary" }), outputName(result.fileName, "glb"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      disposeGroup(group);
      setExporting(null);
    }
  };

  const versionNumber = Number(metadata?.version ?? 0);
  const isFutureVersion = versionNumber > 2026;
  const savedName = savedFileName(metadata?.path);

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

      <section className="workspace">
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
              value={geometrySource === "reference" && comparison ? "IFC reference" : result?.method === "partition-bounds-recovery" ? "RVT element bounds" : result ? "Experimental" : "Not evaluated"}
              tone={geometrySource === "reference" && comparison ? "good" : result ? "warn" : "off"}
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

        <section className="stage">
          <div className="stage-toolbar">
            <div className="stage-title">
              <span className={`status-dot status-${phase}`} />
              <div><strong>{result ? result.fileName : "No model open"}</strong><span>{result ? geometrySource === "reference" && comparison ? `${formatNumber(comparison.reference.elementCount)} typed IFC elements · paired locally` : result.method === "partition-bounds-recovery" ? `${formatNumber(result.stats.candidatesUsed)} RVT element envelopes in scene` : `${formatNumber(result.stats.candidatesUsed)} recovered diagnostic centerlines` : "Your file never leaves this browser tab"}</span></div>
            </div>
            <div className="toolbar-controls">
              {comparison?.referenceMeshes.length ? (
                <div className="segmented-control source-control" aria-label="Geometry source">
                  <button className={geometrySource === "reference" ? "active" : ""} onClick={() => setGeometrySource("reference")}>IFC reference</button>
                  <button className={geometrySource === "recovered" ? "active diagnostic-active" : ""} onClick={() => setGeometrySource("recovered")}>RVT diagnostic</button>
                </div>
              ) : null}
              <div className="segmented-control" aria-label="Camera view">
                <button className={view === "perspective" ? "active" : ""} onClick={() => setView("perspective")} disabled={!result}>3D</button>
                <button className={view === "plan" ? "active" : ""} onClick={() => setView("plan")} disabled={!result}>Plan</button>
              </div>
            </div>
          </div>

          <div className="viewport">
            {result ? (
              <>
                <ModelCanvas result={result} comparison={comparison} source={geometrySource} view={view} />
                <div className="viewport-legend">
                  {geometrySource === "reference" && comparison ? (
                    <><span><i className="legend-cyan" />Matched RVT records</span><span><i className="legend-context" />IFC context</span></>
                  ) : (
                    <span><i className="legend-amber" />{result.method === "partition-bounds-recovery" ? "RVT element envelopes" : "Rejected diagnostic recovery"}</span>
                  )}
                  <span><i className="legend-grid" />Model grid</span>
                </div>
                <div className="viewport-stamp">{geometrySource === "reference" && comparison ? "paired IFC ground truth · metres · z-up" : result.method === "partition-bounds-recovery" ? "RVT duplicated-bounds records · feet · z-up" : "rejected heuristic · feet · z-up"}</div>
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

          {result && (
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
                  <button onClick={() => exportText("IFC", "ifc", () => makeIfcCenterlines(result), "application/x-step")} disabled={Boolean(exporting)}><strong>IFC</strong><span>{result.method === "partition-bounds-recovery" ? "solid proxies" : "proxies"}</span></button>
                  <button onClick={() => exportText("JSON", "json", () => makeReport(result, metadata as unknown as Record<string, unknown>), "application/json")} disabled={Boolean(exporting)}><strong>JSON</strong><span>audit</span></button>
                </div>
                <p className="export-disclaimer">Exports preserve {result.method === "partition-bounds-recovery" ? "native-ID element envelopes" : "the recovered geometry"}, not decoded families, materials, parameters, constraints, curved profiles, or openings.</p>
              </section>
            </div>
          )}

          {(result || isFutureVersion) && (
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
