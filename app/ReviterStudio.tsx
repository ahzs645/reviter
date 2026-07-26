"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  boundsDimensions,
  downloadBlob,
  makeDxf,
  makeGlb,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  outputName,
  type CameraPreset,
  type ConvertResult,
  type IfcWorkerRequest,
  type IfcWorkerResponse,
  type PairedRegressionResult,
  type NavigationMode,
  type RenderMode,
  type WorkerRequest,
  type WorkerResponse,
} from "../lib/reviter";

import { AUTODESK_PREVIEW_RESULT, hasAutodeskReference, staticWorkerUrl } from "./studio/autodesk-reference.ts";
import { formatBytes, formatNumber, savedFileName } from "./studio/format.ts";
import { ModelCanvas } from "./studio/ModelCanvas.tsx";
import { FidelityRow, RegressionPanel } from "./studio/panels.tsx";
import type {
  CameraRequest,
  GeometrySource,
  Phase,
  ReferencePhase,
  ViewMode,
  ViewerPanel,
} from "./studio/types.ts";

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
  const [walking, setWalking] = useState(false);
  const [viewerPanel, setViewerPanel] = useState<ViewerPanel>("none");
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [schemaSearch, setSchemaSearch] = useState("");
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

  // Tear the workers down when the studio unmounts, and only then. This was
  // keyed on the thumbnail, so opening a second file — which sets a new
  // thumbnail — terminated the worker that was about to convert it, left the
  // dead worker in the ref for `getWorker` to hand back, and hung the progress
  // bar at 8% with no error and no timeout.
  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    ifcWorkerRef.current?.terminate();
    ifcWorkerRef.current = null;
  }, []);

  // The previous preview URL is revoked where the next one is created, so the
  // object URL's lifetime no longer depends on an unmount cleanup.
  useEffect(() => () => {
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
  // The list is the drawn set, and nothing else. It used to be filtered a second
  // time through a three-axis "is this solid" test that the scene no longer
  // applies — a sketch-bounded ceiling is drawn but has no thickness — so the
  // browser and the toolbar reported two different counts of the same thing.
  const solidRecords = useMemo(
    () => result ? result.elementBounds.filter((record) => displayedElementIds.has(record.elementId)) : [],
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
    const query = modelSearch.trim().toLowerCase();
    // Asking the user to search by an id they would have to already know is not
    // much of a search; category and type names are on the record too.
    const records = query
      ? solidRecords.filter((record) =>
          String(record.elementId).includes(query)
          || record.categoryName?.toLowerCase().includes(query)
          || record.typeName?.toLowerCase().includes(query))
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
          {/* The pitch belongs on the empty page, not above a model you are
              already working on. */}
          {!result && (
            <div className="rail-intro">
              <p className="eyebrow">RVT → open geometry</p>
              <h1>Inspect first.<br />Convert honestly.</h1>
              <p>Verified metadata stays separate from experimental geometry recovery.</p>
            </div>
          )}

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

          {(metadata || result) && (
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
              value={geometrySource === "autodesk" ? "From the derivative" : result ? result.decoderCoverage.nativeMeshes.toLocaleString() : "Not evaluated"}
              tone={geometrySource === "autodesk" ? "good" : result?.decoderCoverage.nativeMeshes ? "warn" : "off"}
            />
            <FidelityRow
              label="RVT materials"
              value={geometrySource === "autodesk" ? "From the derivative" : result?.decoderCoverage.nativeMaterialDefinitions ? `${result.decoderCoverage.nativeMaterialDefinitions.toLocaleString()} definitions` : result ? "Not decoded" : "Not evaluated"}
              tone={geometrySource === "autodesk" ? "good" : result?.decoderCoverage.nativeMaterialDefinitions ? "warn" : "off"}
            />
            <FidelityRow
              label="Placed instances"
              value={result?.stats.placedInstances
                ? `${result.stats.placedInstances.toLocaleString()} oriented`
                : result ? "Not placed" : "Not evaluated"}
              tone={result?.stats.placedInstances ? "good" : "off"}
            />
            <FidelityRow
              label="Sketch boundaries"
              value={result?.stats.sketchBoundaryElements
                ? `${result.stats.sketchBoundaryElements.toLocaleString()} extruded`
                : result ? "Not recovered" : "Not evaluated"}
              tone={result?.stats.sketchBoundaryElements ? "good" : "off"}
            />
            <FidelityRow
              label="Native solids"
              value={result?.stats.nativeSolids
                ? `${result.stats.nativeSolids.toLocaleString()} rebuilt`
                : result ? "Not rebuilt" : "Not evaluated"}
              tone={result?.stats.nativeSolids ? "good" : "off"}
            />
            <FidelityRow
              label="Element types"
              value={result?.stats.typedElements
                ? `${result.stats.typedElements.toLocaleString()} linked · ${(result.stats.namedTypeElements ?? 0).toLocaleString()} named`
                : result ? "Not decoded" : "Not evaluated"}
              tone={result?.stats.typedElements ? "good" : "off"}
            />
            <FidelityRow
              label="Native surfaces"
              value={result?.stats.surfaces?.planes
                ? `${result.stats.surfaces.planes.toLocaleString()} planes · ${result.stats.surfaces.cylinders.toLocaleString()} cylinders`
                : result ? "Not decoded" : "Not evaluated"}
              tone={result?.stats.surfaces?.planes ? "warn" : "off"}
            />
            <FidelityRow
              label="Element parameters"
              value={result?.stats.parameterElements
                ? `${result.stats.parameterElements.toLocaleString()} elements`
                : result ? "Not decoded" : "Not evaluated"}
              tone={result?.stats.parameterElements ? "good" : "off"}
            />
            <FidelityRow
              label="Element objects"
              value={result?.stats.elementObjects
                ? `${result.stats.elementObjects.toLocaleString()} chained`
                : result ? "Not chained" : "Not evaluated"}
              tone={result?.stats.elementObjects ? "good" : "off"}
            />
            <FidelityRow
              label="Container streams"
              value={result?.coverage
                ? `${result.coverage.fullStreams} full · ${result.coverage.partialStreams} partial · ${result.coverage.undecodedStreams} undecoded`
                : result ? "Not evaluated" : "Not evaluated"}
              tone={result?.coverage?.undecodedStreams ? "warn" : result?.coverage ? "good" : "off"}
            />
            <FidelityRow
              label="Embedded schema"
              value={result?.schema
                ? `${result.schema.taggedClasses.length} tagged classes`
                : result ? "Not found" : "Not evaluated"}
              tone={result?.schema?.taggedClasses.length ? "good" : "off"}
            />
            <FidelityRow
              label="Revit categories"
              value={result?.decoderCoverage.nativeCategorisedElements
                ? `${result.decoderCoverage.nativeCategorisedElements.toLocaleString()} native`
                : result ? "Not decoded" : "Not evaluated"}
              tone={result?.decoderCoverage.nativeCategorisedElements ? "good" : "off"}
            />
            <FidelityRow
              label="BIM semantics"
              value={geometrySource === "reference" && comparison ? `${comparison.reference.elementCount.toLocaleString()} IFC` : result?.stats.parameterElements ? "Categories and parameters" : result?.decoderCoverage.nativeCategorisedElements ? "Categories only" : "Unavailable"}
              tone={geometrySource === "reference" && comparison ? "good" : result?.decoderCoverage.nativeCategorisedElements ? "warn" : "off"}
            />
          </section>
          )}

          {result && (
            <section className="rail-section reference-section">
              <div className="section-heading"><span>Paired IFC export</span><span className={comparison ? `fixture-${comparison.status}` : ""}>{comparison ? comparison.status : "optional"}</span></div>
              <p>Pair this model&apos;s IFC export to check the recovery against it, and to unlock the overlay view.</p>
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
              <div><strong>{result ? result.fileName : "No model open"}</strong><span>{!result ? "" : geometrySource === "autodesk" ? "Autodesk server-generated derivative" : geometrySource === "overlay" && comparison ? `${formatNumber(result.stats.candidatesUsed)} recovered · ${formatNumber(comparison.reference.elementCount)} in the export` : geometrySource === "reference" && comparison ? `${formatNumber(comparison.reference.elementCount)} typed IFC elements` : result.method === "native-profile-recovery" ? `${formatNumber(result.stats.candidatesUsed)} native ArcWall profiles` : result.method === "partition-bounds-recovery" ? `${formatNumber(result.stats.candidatesUsed)} RVT element envelopes in scene` : `${formatNumber(result.stats.candidatesUsed)} recovered diagnostic centerlines`}</span></div>
            </div>
            <div className="toolbar-controls">
              {autodeskReferenceAvailable || comparison?.referenceMeshes.length ? (
                <div className="segmented-control source-control" aria-label="Geometry source">
                  {autodeskReferenceAvailable && <button className={geometrySource === "autodesk" ? "active" : ""} onClick={() => { setGeometrySource("autodesk"); setSelectedElementId(null); }}>Autodesk</button>}
                  {comparison?.referenceMeshes.length ? <button className={geometrySource === "reference" ? "active" : ""} onClick={() => { setGeometrySource("reference"); setSelectedElementId(null); }}>IFC reference</button> : null}
                  {comparison?.referenceMeshes.length ? <button className={geometrySource === "overlay" ? "active" : ""} onClick={() => setGeometrySource("overlay")} title="Recovered model over the paired export: matched elements ghosted, elements missing from the recovery in red">Overlay</button> : null}
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
                  walking={walking}
                  onWalkingChange={setWalking}
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
                    <div className="viewer-panel-heading"><div><strong>Model browser</strong><span>{solidRecords.length.toLocaleString()} elements in the scene</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close model browser">×</button></div>
                    <label className="model-search"><span>Search</span><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="ID, category, or type" /></label>
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
                            <span><i />{record.categoryName ?? "Uncategorised"} <em>{record.elementId}</em></span>
                            <small>{dimensions.x.toFixed(1)} × {dimensions.y.toFixed(1)} × {dimensions.z.toFixed(1)} ft</small>
                          </button>
                        );
                      })}
                    </div>
                    {solidRecords.length > visibleModelRecords.length && <p>Showing {visibleModelRecords.length} of {solidRecords.length.toLocaleString()} elements. Search to narrow the list.</p>}
                  </aside>
                )}

                {viewerPanel === "properties" && (
                  <aside className="viewer-sidepanel properties-panel" aria-label="Element properties">
                    <div className="viewer-panel-heading"><div><strong>Properties</strong><span>{selectedRecord ? `Element ${selectedRecord.elementId}` : "No selection"}</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close properties">×</button></div>
                    {selectedRecord && selectedDimensions ? (
                      <dl className="property-table">
                        <div><dt>Native Revit ID</dt><dd>{selectedRecord.elementId}</dd></div>
                        {selectedRecord.categoryName && (
                          <div><dt>Revit category</dt><dd>{selectedRecord.categoryName}</dd></div>
                        )}
                        {selectedRecord.categoryId != null && (
                          <div><dt>Category ID</dt><dd>{selectedRecord.categoryId}{selectedRecord.categorySource === "record-code-consensus" ? " (record-code consensus)" : " (native token)"}</dd></div>
                        )}
                        {/* Not every element reaches the scene through a bounds
                            record any more — some are rebuilt from surfaces, a
                            placed instance, or a sketch — so the row says which. */}
                        <div><dt>Evidence</dt><dd>{
                          selectedRecord.recordOffset >= 0
                            ? "Duplicated bounds record"
                            : selectedRecord.loops?.length
                              ? "Sketch boundary"
                              : selectedRecord.orientedBox
                                ? "Placed family instance"
                                : selectedRecord.solids?.length || selectedRecord.solid
                                  ? "Rebuilt from native surfaces"
                                  : "Native faces"
                        }</dd></div>
                        {selectedRecord.solid && (
                          <div><dt>Native geometry</dt><dd>{Math.hypot(selectedRecord.solid.end.x - selectedRecord.solid.start.x, selectedRecord.solid.end.y - selectedRecord.solid.start.y).toFixed(3)} ft long · {(selectedRecord.solid.thickness * 304.8).toFixed(0)} mm thick</dd></div>
                        )}
                        {selectedRecord.typeName && (
                          <div><dt>Type</dt><dd>{selectedRecord.typeName}</dd></div>
                        )}
                        {selectedRecord.typeId != null && (
                          <div><dt>Type element</dt><dd>{selectedRecord.typeId}</dd></div>
                        )}
                        {selectedRecord.parameters?.map((parameter) => (
                          <div key={parameter.parameterId}>
                            <dt>{parameter.name}</dt>
                            <dd>{parameter.value.toFixed(4)} ft</dd>
                          </div>
                        ))}
                        <div><dt>Stream</dt><dd>{selectedRecord.stream}</dd></div>
                        {selectedRecord.chunkIndex >= 0 && (
                          <div><dt>Chunk</dt><dd>{selectedRecord.chunkIndex.toLocaleString()}</dd></div>
                        )}
                        <div><dt>Width</dt><dd>{selectedDimensions.x.toFixed(3)} ft</dd></div>
                        <div><dt>Depth</dt><dd>{selectedDimensions.y.toFixed(3)} ft</dd></div>
                        <div><dt>Height</dt><dd>{selectedDimensions.z.toFixed(3)} ft</dd></div>
                        <div><dt>Minimum Z</dt><dd>{selectedRecord.boundsFeet.min.z.toFixed(3)} ft</dd></div>
                        {selectedRecord.recordOffset >= 0 && (
                          <div><dt>Record offset</dt><dd>0x{selectedRecord.recordOffset.toString(16)}</dd></div>
                        )}
                      </dl>
                    ) : (
                      <div className="property-empty"><b>Pick an element in the viewport</b><p>Click a recovered solid, or choose one from the model browser.</p></div>
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
                  {/* Re-applies the current preset without touching the view;
                      going through requestCamera dropped you out of plan. */}
                  <button onClick={() => setCameraRequest((current) => ({ ...current, sequence: current.sequence + 1 }))}><i>⛶</i><span>Fit</span></button>
                  <button className={navigationMode === "pan" ? "active" : ""} onClick={() => setNavigationMode("pan")} aria-pressed={navigationMode === "pan"}><i>✣</i><span>Pan</span></button>
                  <button className={navigationMode === "zoom" ? "active" : ""} onClick={() => setNavigationMode("zoom")} aria-pressed={navigationMode === "zoom"}><i>⌕</i><span>Zoom</span></button>
                  <button className={navigationMode === "orbit" ? "active" : ""} onClick={() => setNavigationMode("orbit")} aria-pressed={navigationMode === "orbit"}><i>◉</i><span>Orbit</span></button>
                  <button
                    className={walking ? "active" : ""}
                    onClick={() => setWalking((current) => !current)}
                    aria-pressed={walking}
                    title="Walk the model at eye level — W A S D to move, mouse to look, Shift to run, Esc to leave"
                  ><i>⇱</i><span>Walk</span></button>
                  <span />
                  <button className={sectionEnabled ? "active" : ""} onClick={() => setSectionEnabled((current) => !current)} aria-pressed={sectionEnabled}><i>◩</i><span>Section</span></button>
                  <button onClick={() => { setSelectedElementId(null); setSectionEnabled(false); requestCamera("home"); }}><i>↺</i><span>Reset</span></button>
                </nav>

                {selectedRecord && <button className="selection-chip" onClick={() => setViewerPanel("properties")}>Element {selectedRecord.elementId}<span>View properties</span></button>}
                <div className="viewport-legend">
                  {geometrySource === "autodesk" ? (
                    <span><i className="legend-cyan" />Autodesk source meshes</span>
                  ) : geometrySource === "overlay" && comparison ? (
                    <><span><i className="legend-amber" />Recovered</span><span><i className="legend-context" />In the export, matched</span><span><i className="legend-missing" />Missing from the recovery</span></>
                  ) : geometrySource === "reference" && comparison ? (
                    <><span><i className="legend-cyan" />Matched RVT records</span><span><i className="legend-context" />IFC context</span></>
                  ) : (
                    <span><i className="legend-amber" />{result.method === "native-profile-recovery" ? "Native ArcWall profiles · approximate solids" : result.method === "partition-bounds-recovery" ? "RVT element envelopes" : "Rejected diagnostic recovery"}</span>
                  )}
                  {geometrySource !== "autodesk" && <span><i className="legend-grid" />Model grid</span>}
                </div>
                <div className="viewport-stamp">{geometrySource === "autodesk" ? "Autodesk SVF derivative · metres · y-up" : geometrySource === "overlay" && comparison ? "recovery over paired IFC · feet · z-up" : geometrySource === "reference" && comparison ? "paired IFC ground truth · metres · z-up" : result.method === "native-profile-recovery" ? "RVT 2023 ArcWall profiles · feet · z-up" : result.method === "partition-bounds-recovery" ? "RVT duplicated-bounds records · feet · z-up" : "rejected heuristic · feet · z-up"}</div>
              </>
            ) : (
              <div className="empty-stage">
                <div className="empty-orbit" aria-hidden="true"><span /><span /><b>R</b></div>
                <h2>Your model stays<br />on your machine.</h2>
                <p>Drop a Revit file on the left, or open one here. It is converted in a browser worker and never uploaded.</p>
                <button onClick={() => inputRef.current?.click()}>Open a local model</button>
              </div>
            )}
          </div>

          {result && detailsOpen && (
            <div className="results-dock">
              {comparison && <RegressionPanel comparison={comparison} drawnElementIds={displayedElementIds} />}
              <section className="result-summary">
                <p className="eyebrow">Recovery summary</p>
                <div className="metric-row">
                  <div><strong>{formatNumber(result.stats.candidatesFound)}</strong><span>records recovered</span></div>
                  <div><strong>{formatNumber(result.stats.candidatesUsed)}</strong><span>drawn in the scene</span></div>
                  <div><strong>{formatNumber(result.stats.triangleCount)}</strong><span>triangles</span></div>
                  <div><strong>{(result.stats.durationMs / 1_000).toFixed(1)}s</strong><span>convert time</span></div>
                </div>
                <div className="level-bands">
                  <span>Dominant elevations</span>
                  {result.levels.slice(0, 5).map((level) => <b key={level.elevation}>{level.elevation.toFixed(1)}′ <small>{level.candidates}</small></b>)}
                </div>
              </section>

              {result.coverage && (
                <section className="coverage-panel">
                  <div className="section-heading">
                    <span>Container streams</span>
                    <span>{result.coverage.fullStreams} full · {result.coverage.partialStreams} partial · {result.coverage.undecodedStreams} undecoded</span>
                  </div>
                  <table className="coverage-table">
                    <tbody>
                      {result.coverage.streams.map((stream) => (
                        <tr key={stream.path} className={`coverage-${stream.depth}`}>
                          <td>{stream.path}</td>
                          <td>{formatBytes(stream.storedBytes)}</td>
                          <td>{stream.inflatedBytes == null ? "—" : formatBytes(stream.inflatedBytes)}</td>
                          <td>{stream.depth}</td>
                          <td title={stream.note}>{stream.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="export-disclaimer">Depth is graded per stream rather than weighted by bytes: the partition stream is most of the file, so counting it as covered because a decoder reads part of it would overstate the result.</p>
                </section>
              )}

              {result.schema && result.schema.taggedClasses.length > 0 && (
                <section className="coverage-panel">
                  <div className="section-heading">
                    <span>Embedded schema · Formats/Latest</span>
                    <span>{result.schema.taggedClasses.length} tagged classes{result.schema.rejectedCandidates ? ` · ${result.schema.rejectedCandidates} rejected` : ""}</span>
                  </div>
                  <label className="model-search"><span>Search class or base class</span>
                    <input value={schemaSearch} onChange={(event) => setSchemaSearch(event.target.value)} placeholder="e.g. Wall" />
                  </label>
                  <table className="coverage-table">
                    <tbody>
                      {result.schema.taggedClasses
                        .filter((entry) => {
                          const query = schemaSearch.trim().toLowerCase();
                          if (!query) return true;
                          return entry.name.toLowerCase().includes(query) || entry.parent.toLowerCase().includes(query);
                        })
                        .slice(0, 60)
                        .map((entry) => (
                          <tr key={`${entry.tag}-${entry.name}`}>
                            <td>{entry.name}</td>
                            <td>0x{entry.tag.toString(16).padStart(4, "0")}</td>
                            <td>{entry.parent}</td>
                            <td>{entry.version == null ? "—" : `v${entry.version}`}</td>
                            <td>{entry.declaredFieldCount == null ? "—" : `${entry.declaredFieldCount} field${entry.declaredFieldCount === 1 ? "" : "s"} declared`}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="export-disclaimer">Class names, serialization tags, and base classes are decoded from the file. Field lists are declared but not walked — their layout does not close across the corpus, so they are counted, not invented.</p>
                </section>
              )}

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
