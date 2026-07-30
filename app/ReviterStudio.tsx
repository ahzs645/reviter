"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  boundsDimensions,
  CAMERA_PRESETS,
  compareSharedParameterDocuments,
  DEFAULT_CAMERA_PRESET,
  downloadBlob,
  drawnBounds,
  dwgThumbnailBlob,
  extractDwgThumbnail,
  indexFamilyLibraryFiles,
  loadBundledOmniClassTaxonomy,
  mergeSharedParameterDocuments,
  makeDxf,
  makeGlb,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  loadLegacyRevit2021Api,
  outputName,
  parseBasicFileInfoProperties,
  parseSharedParameterBytes,
  revitVersionFromBasicFileInfo,
  searchFamilyLibrary,
  searchOmniClassTaxonomy,
  validateSharedParameterDocument,
  writeSharedParameterFile,
  type CameraPreset,
  type BasicFileInfoProperties,
  type ConvertResult,
  type DecodedSharedParameterDocument,
  type FamilyLibraryIndex,
  type IfcWorkerRequest,
  type IfcWorkerResponse,
  type LegacyRevit2021Api,
  type OmniClassItem,
  type PairedRegressionResult,
  type RenderMode,
  type WorkerRequest,
  type WorkerResponse,
} from "../lib/reviter";

import { AUTODESK_PREVIEW_RESULT, hasAutodeskReference, staticWorkerUrl } from "./studio/autodesk-reference.ts";
import { canvasMenuPosition, formatBytes, formatNumber, matchesFilter, savedFileName } from "./studio/format.ts";
import { ModelCanvas } from "./studio/ModelCanvas.tsx";
import { MarkupOverlay } from "./studio/MarkupOverlay.tsx";
import { loadModelComments, saveModelComments } from "./studio/model-comments.ts";
import { ObjectList } from "./studio/ObjectList.tsx";
import { FidelityRow, RegressionPanel, ToolButton } from "./studio/panels.tsx";
import { ViewerToolbar } from "./studio/ViewerToolbar.tsx";
import {
  navigationModeForTool,
  type MarkupTool,
  type ModelComment,
  type NewModelComment,
  type ViewerTool,
} from "./studio/viewer-tools.ts";
import type {
  CameraRequest,
  CanvasMenuRequest,
  GeometrySource,
  Phase,
  ReferencePhase,
  ViewerPanel,
} from "./studio/types.ts";

type StudioFileInfo = Omit<FileInfo, "fileVersion"> & { fileVersion: number };

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder.toString().padStart(2, "0")}s` : `${remainder}s`;
}

function BlobThumbnail({ blob, alt }: { blob?: Blob; alt: string }) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="family-library-thumbnail" src={url} alt={alt} />
    : <span className="family-library-fallback">RFA</span>;
}

export default function ReviterStudio({ referencePreview = false }: { referencePreview?: boolean }) {
  const [phase, setPhase] = useState<Phase>(referencePreview ? "ready" : "idle");
  const [progress, setProgress] = useState(referencePreview ? 1 : 0);
  const [progressMessage, setProgressMessage] = useState(
    referencePreview ? "Autodesk derivative reference loaded for visual review" : "Waiting for a local file",
  );
  const [conversionStartedAt, setConversionStartedAt] = useState<number | null>(null);
  const [conversionElapsedSeconds, setConversionElapsedSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<StudioFileInfo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(referencePreview ? AUTODESK_PREVIEW_RESULT : null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [geometrySource, setGeometrySource] = useState<GeometrySource>(referencePreview ? "autodesk" : "recovered");
  const [renderMode, setRenderMode] = useState<RenderMode>("technical");
  const [activeTool, setActiveTool] = useState<ViewerTool>("orbit");
  const [markupTool, setMarkupTool] = useState<MarkupTool>("pencil");
  const [modelComments, setModelComments] = useState<ModelComment[]>(
    () => referencePreview ? loadModelComments(AUTODESK_PREVIEW_RESULT) : [],
  );
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({ preset: DEFAULT_CAMERA_PRESET, sequence: 0 });
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<string>>(new Set());
  const [viewerPanel, setViewerPanel] = useState<ViewerPanel>("none");
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [legacySearch, setLegacySearch] = useState("");
  const [legacyApi, setLegacyApi] = useState<LegacyRevit2021Api | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [privateFileInfo, setPrivateFileInfo] = useState<BasicFileInfoProperties | null>(null);
  const [familyLibrary, setFamilyLibrary] = useState<FamilyLibraryIndex | null>(null);
  const [familySearch, setFamilySearch] = useState("");
  const [familyBusy, setFamilyBusy] = useState(false);
  const [familyMessage, setFamilyMessage] = useState("Choose a folder containing .rfa files");
  const [omniClass, setOmniClass] = useState<OmniClassItem[] | null>(null);
  const [omniSearch, setOmniSearch] = useState("");
  const [omniBusy, setOmniBusy] = useState(false);
  const [omniError, setOmniError] = useState<string | null>(null);
  const [sharedFiles, setSharedFiles] = useState<Array<{
    name: string;
    decoded: DecodedSharedParameterDocument;
  }>>([]);
  const [dwgPreview, setDwgPreview] = useState<{
    url: string;
    fileName: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [dwgError, setDwgError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuRequest | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [referencePhase, setReferencePhase] = useState<ReferencePhase>("idle");
  const [referenceProgress, setReferenceProgress] = useState(0);
  const [referenceMessage, setReferenceMessage] = useState("Choose the matching IFC export");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<PairedRegressionResult | null>(null);
  const navigationMode = navigationModeForTool(activeTool);
  const walking = activeTool === "firstPerson";
  const handleWalkingChange = useCallback((enabled: boolean) => {
    setActiveTool(enabled ? "firstPerson" : "orbit");
  }, []);
  const workerRef = useRef<Worker | null>(null);
  const ifcWorkerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const commentSessionRef = useRef<ModelComment[]>([]);
  const referenceRequestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);
  const familyInputRef = useRef<HTMLInputElement>(null);
  const sharedInputRef = useRef<HTMLInputElement>(null);
  const dwgInputRef = useRef<HTMLInputElement>(null);
  const canvasMenuRef = useRef<HTMLDivElement>(null);

  const legacyMatches = useMemo(
    () => legacyApi && legacySearch.trim() ? legacyApi.search(legacySearch, 60) : [],
    [legacyApi, legacySearch],
  );
  const familyMatches = useMemo(
    () => familyLibrary ? searchFamilyLibrary(familyLibrary, familySearch, 30) : [],
    [familyLibrary, familySearch],
  );
  const omniMatches = useMemo(
    () => omniClass && omniSearch.trim()
      ? searchOmniClassTaxonomy(omniClass, omniSearch, 60)
      : [],
    [omniClass, omniSearch],
  );
  const mergedSharedParameters = useMemo(
    () => sharedFiles.length
      ? mergeSharedParameterDocuments(sharedFiles.map((file) => file.decoded.document))
      : null,
    [sharedFiles],
  );
  const sharedIssues = useMemo(
    () => mergedSharedParameters
      ? validateSharedParameterDocument(mergedSharedParameters)
      : [],
    [mergedSharedParameters],
  );
  const sharedComparison = useMemo(
    () => sharedFiles.length >= 2
      ? compareSharedParameterDocuments(
          sharedFiles[0]!.decoded.document,
          sharedFiles[1]!.decoded.document,
        )
      : null,
    [sharedFiles],
  );

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

  useEffect(() => () => {
    if (dwgPreview) URL.revokeObjectURL(dwgPreview.url);
  }, [dwgPreview]);

  useEffect(() => {
    if (conversionStartedAt == null || (phase !== "reading" && phase !== "converting")) return;
    const updateElapsed = () => {
      setConversionElapsedSeconds(Math.max(0, Math.floor((Date.now() - conversionStartedAt) / 1_000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [conversionStartedAt, phase]);

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

  const loadLegacyApi = useCallback(async () => {
    setLegacyLoading(true);
    setLegacyError(null);
    try {
      setLegacyApi(await loadLegacyRevit2021Api());
      setLegacySearch((current) => current || "-2000011");
    } catch (caught) {
      setLegacyError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLegacyLoading(false);
    }
  }, []);

  const loadOmniClass = useCallback(async () => {
    if (omniClass) return omniClass;
    setOmniBusy(true);
    setOmniError(null);
    try {
      const taxonomy = await loadBundledOmniClassTaxonomy();
      setOmniClass(taxonomy);
      setOmniSearch((current) => current || "23.10");
      return taxonomy;
    } catch (caught) {
      setOmniError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setOmniBusy(false);
    }
  }, [omniClass]);

  const processFamilyFolder = useCallback(async (selected: File[]) => {
    setFamilyBusy(true);
    setFamilyMessage("Loading OmniClass taxonomy");
    try {
      const taxonomy = await loadOmniClass();
      setFamilyMessage("Indexing local Revit families");
      const index = await indexFamilyLibraryFiles(selected, {
        ...(taxonomy ? { taxonomy } : {}),
        onProgress: ({ completed, total, fileName }) => {
          setFamilyMessage(
            total
              ? `${completed.toLocaleString()} / ${total.toLocaleString()} · ${fileName}`
              : "No .rfa files found",
          );
        },
      });
      setFamilyLibrary(index);
      setFamilyMessage(
        `${index.entries.length.toLocaleString()} families · ` +
        `${index.catalogFiles.toLocaleString()} type catalogs · ` +
        `${index.errors.length.toLocaleString()} errors`,
      );
    } catch (caught) {
      setFamilyMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFamilyBusy(false);
    }
  }, [loadOmniClass]);

  const processSharedParameterFiles = useCallback(async (selected: File[]) => {
    const decoded = await Promise.all(selected.map(async (selectedFile) => ({
      name: selectedFile.name,
      decoded: parseSharedParameterBytes(new Uint8Array(await selectedFile.arrayBuffer())),
    })));
    setSharedFiles(decoded);
  }, []);

  const processDwgFile = useCallback(async (selected: File) => {
    setDwgError(null);
    try {
      const thumbnail = extractDwgThumbnail(new Uint8Array(await selected.arrayBuffer()));
      if (!thumbnail) throw new Error("This DWG does not contain a supported embedded preview.");
      const url = URL.createObjectURL(dwgThumbnailBlob(thumbnail));
      setDwgPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          url,
          fileName: selected.name,
          ...(thumbnail.width != null ? { width: thumbnail.width } : {}),
          ...(thumbnail.height != null ? { height: thumbnail.height } : {}),
        };
      });
    } catch (caught) {
      setDwgError(caught instanceof Error ? caught.message : String(caught));
    }
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
    setActiveTool("orbit");
    setMarkupTool("pencil");
    setModelComments([]);
    setCameraRequest({ preset: DEFAULT_CAMERA_PRESET, sequence: requestId, fit: false });
    setViewerPanel("none");
    setSelectedElementId(null);
    setModelSearch("");
    setCategorySearch("");
    setCanvasMenu(null);
    setDetailsOpen(false);
    setReferencePhase("idle");
    setReferenceError(null);
    setMetadata(null);
    setPrivateFileInfo(null);
    setError(null);
    setProgress(0.03);
    setProgressMessage("Reading metadata and thumbnail");
    setConversionStartedAt(Date.now());
    setConversionElapsedSeconds(0);
    setPhase("reading");

    try {
      const cfb = await openFile(nextFile);
      const basicEntry = cfb.findEntry("BasicFileInfo");
      const basicDataPromise = basicEntry
        ? cfb.entryData(basicEntry)
        : Promise.resolve<Uint8Array | undefined>(undefined);
      const infoPromise = (async (): Promise<StudioFileInfo> => {
        try {
          return await basicFileInfo(cfb);
        } catch (metadataError) {
          // @phi-ag/rvt currently recognizes BasicFileInfo versions 10, 13,
          // and 14. Older families commonly use version 6, but the release is
          // still available in the same legacy length-prefixed application
          // string. Keep those files moving into the client-side worker.
          const data = await basicDataPromise;
          if (!data) throw metadataError;
          const version = revitVersionFromBasicFileInfo(data);
          if (version == null) throw metadataError;
          const content = new TextDecoder("utf-16le").decode(data.subarray(18));
          const build = content.match(/\bBuild:\s*([^)]+)/i)?.[1]?.trim() ?? "Unknown";
          return {
            fileVersion: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true),
            version: String(version),
            build,
            path: "",
            locale: "Unknown",
            identityId: "",
            documentId: "",
            appName: "Autodesk Revit",
            content,
          };
        }
      })();
      const [info, preview, basicData] = await Promise.all([
        infoPromise,
        tryThumbnail(cfb),
        basicDataPromise,
      ]);
      if (requestId !== requestIdRef.current) return;
      setMetadata(info);
      setPrivateFileInfo(basicData ? parseBasicFileInfoProperties(basicData) : null);
      if (thumbnail) URL.revokeObjectURL(thumbnail);
      setThumbnail(preview.ok ? URL.createObjectURL(preview.data) : null);
      setPhase("converting");
      setProgress(0.08);
      setProgressMessage("Preparing local conversion worker");

      const buffer = await nextFile.arrayBuffer();
      const worker = getWorker();
      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return;
        setError(event.message || "The local conversion worker stopped unexpectedly.");
        setPhase("error");
      };
      worker.onmessageerror = () => {
        if (requestId !== requestIdRef.current) return;
        setError("The local conversion worker returned an unreadable result.");
        setPhase("error");
      };
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
        setModelComments(loadModelComments(message.result));
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
          // Do not impose the studio's former 96 MB override here. Native
          // component definitions can be filed long after the railing/stair
          // that instances them; truncating the cache by storage order breaks
          // an otherwise complete recursive symbol closure. The converter's
          // own bounded default remains the browser-safety backstop.
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
      const displayedIds = new Set(
        result.meshes.flatMap((mesh) => mesh.elementIds ? [...mesh.elementIds] : []),
      );
      const packedDisplayBounds: number[] = [];
      for (const record of result.elementBounds) {
        if (!displayedIds.has(record.elementId)) continue;
        const bounds = drawnBounds(record);
        if (!bounds.every(Number.isFinite)) continue;
        packedDisplayBounds.push(record.elementId, ...bounds);
      }
      const displayBounds = Float64Array.from(packedDisplayBounds);
      worker.onerror = (event) => {
        if (requestId !== referenceRequestIdRef.current) return;
        setReferenceError(event.message || "The local IFC worker stopped unexpectedly.");
        setReferencePhase("error");
      };
      worker.onmessageerror = () => {
        if (requestId !== referenceRequestIdRef.current) return;
        setReferenceError("The local IFC worker returned an unreadable result.");
        setReferencePhase("error");
      };
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
          recoveredIds: Uint32Array.from(result.elementBounds.map((record) => record.elementId)),
          partitionRecords: result.elementIndex.partitionRecords,
          boundsFeet: result.bbox,
          triangleCount: result.stats.triangleCount,
          productionElements: result.readerDiagnostics?.productionElements ?? 0,
          typedElements: result.decoderCoverage.nativeCategorisedElements,
          displayBounds,
        },
      };
      worker.postMessage(request, [buffer, displayBounds.buffer as ArrayBuffer]);
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
  // Objects, categories and properties all read the per-triangle element ids,
  // and only the recovery carries them — the derivative and the export arrive
  // as anonymous meshes.
  const panelReason = geometrySource === "recovered" ? null : "Only the RVT diagnostic source carries object ids";
  const savedName = savedFileName(metadata?.path);
  const displayedElementIds = useMemo(() => {
    if (!result) return new Set<number>();
    return new Set(result.meshes.flatMap((mesh) => mesh.elementIds ? [...mesh.elementIds] : []));
  }, [result]);
  // Everything the converter gave an envelope, drawn or not — the middle column
  // of the coverage table, and the only one the IFC analysis cannot supply.
  const recoveredElementIds = useMemo(
    () => new Set(result ? result.elementBounds.map((record) => record.elementId) : []),
    [result],
  );
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
  // Asking the user to filter by an id they would have to already know is not
  // much of a filter; category and type names are on the record too.
  const visibleModelRecords = useMemo(
    () => solidRecords.filter((record) =>
      matchesFilter(modelSearch, record.elementId, record.categoryName, record.typeName)),
    [modelSearch, solidRecords],
  );
  // One row per category, which is the layer list a CAD user reaches for, and
  // the only visibility control that scales to tens of thousands of envelopes.
  const categoryRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of solidRecords) {
      const name = record.categoryName ?? "Uncategorised";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [solidRecords]);
  // Sorted largest first, so the category you want by name is somewhere down a
  // 24-row scroller on the supplied model. Filtering is how a layer list is
  // used everywhere else.
  const visibleCategoryRows = useMemo(
    () => categoryRows.filter((row) => matchesFilter(categorySearch, row.name)),
    [categoryRows, categorySearch],
  );
  const hiddenElementIds = useMemo(() => {
    if (!result || !hiddenCategories.size) return new Set<number>();
    const hidden = new Set<number>();
    for (const record of result.elementBounds) {
      if (hiddenCategories.has(record.categoryName ?? "Uncategorised")) hidden.add(record.elementId);
    }
    return hidden;
  }, [hiddenCategories, result]);
  // Framing one object keeps the current orientation and only moves in; a
  // sequence number is what makes asking for the same object twice a new
  // request rather than a no-op.
  const [focusRequest, setFocusRequest] = useState<{ elementId: number | null; sequence: number }>({
    elementId: null,
    sequence: 0,
  });
  const requestZoomToSelection = useCallback(() => {
    setFocusRequest((current) => ({ elementId: selectedElementId, sequence: current.sequence + 1 }));
  }, [selectedElementId]);
  const toggleCategory = useCallback((name: string) => {
    setHiddenCategories((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);
  const canvasMenuCategory = useMemo(() => {
    if (canvasMenu?.elementId == null) return null;
    const record = result?.elementBounds.find((entry) => entry.elementId === canvasMenu.elementId);
    return record ? record.categoryName ?? "Uncategorised" : null;
  }, [canvasMenu, result]);
  const hoveredRecord = useMemo(
    () => hoveredElementId == null
      ? null
      : result?.elementBounds.find((record) => record.elementId === hoveredElementId) ?? null,
    [hoveredElementId, result],
  );
  const requestCamera = useCallback((preset: CameraPreset) => {
    setCameraRequest((current) => ({ preset, sequence: current.sequence + 1, fit: false }));
    setViewMenuOpen(false);
  }, []);

  const commitComments = useCallback((update: (current: ModelComment[]) => ModelComment[]) => {
    setModelComments((current) => {
      const next = update(current);
      if (result) saveModelComments(result, next);
      return next;
    });
  }, [result]);

  const createModelComment = useCallback((comment: NewModelComment): string => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    commitComments((current) => [...current, {
      ...comment,
      id,
      text: "New review comment",
      status: "open",
      createdAt: now,
      updatedAt: now,
    }]);
    return id;
  }, [commitComments]);

  const updateModelComment = useCallback((
    id: string,
    patch: Partial<Pick<ModelComment, "text" | "status">>,
  ) => {
    commitComments((current) => current.map((comment) => comment.id === id
      ? { ...comment, ...patch, updatedAt: new Date().toISOString() }
      : comment));
  }, [commitComments]);

  const deleteModelComment = useCallback((id: string) => {
    commitComments((current) => current.filter((comment) => comment.id !== id));
  }, [commitComments]);

  const selectViewerTool = useCallback((tool: ViewerTool) => {
    if (tool === "markup" && activeTool !== "markup") {
      commentSessionRef.current = modelComments;
    }
    setActiveTool(tool);
  }, [activeTool, modelComments]);

  const cancelMarkup = useCallback(() => {
    const restored = commentSessionRef.current;
    setModelComments(restored);
    if (result) saveModelComments(result, restored);
    setActiveTool("orbit");
  }, [result]);

  // The canvas menu closes on the next press anywhere outside it, or on Escape.
  // Containment is tested rather than relying on the press not reaching the
  // window, because a press on a menu item would otherwise unmount the button
  // before its own click could fire.
  useEffect(() => {
    if (!canvasMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!canvasMenuRef.current?.contains(event.target as Node)) setCanvasMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCanvasMenu(null);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [canvasMenu]);

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

          <section className="rail-section local-library-section">
            <div className="section-heading">
              <span>Local family library</span>
              <span>{familyLibrary ? familyLibrary.entries.length.toLocaleString() : "folder"}</span>
            </div>
            <button
              type="button"
              className="legacy-api-load"
              onClick={() => familyInputRef.current?.click()}
              disabled={familyBusy}
            >
              {familyBusy ? "Indexing family folder…" : "Choose family folder"}
            </button>
            <input
              ref={familyInputRef}
              className="visually-hidden"
              type="file"
              accept=".rfa,.txt"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (selected.length) void processFamilyFolder(selected);
                event.currentTarget.value = "";
              }}
            />
            <p className="privacy-note">{familyMessage}</p>
            {familyLibrary && (
              <>
                <label className="model-search inline-search">
                  <span>Search families</span>
                  <input
                    value={familySearch}
                    onChange={(event) => setFamilySearch(event.target.value)}
                    placeholder="manufacturer, voltage, type…"
                  />
                </label>
                <div className="family-library-list">
                  {familyMatches.slice(0, 12).map((entry) => (
                    <button
                      type="button"
                      key={entry.fileName}
                      onClick={() => void processFile(entry.sourceFile)}
                      title={`Open ${entry.fileName}`}
                    >
                      <BlobThumbnail blob={entry.thumbnail} alt="" />
                      <span>
                        <strong>{entry.title}</strong>
                        <small>
                          {[entry.category, entry.manufacturer, entry.voltage]
                            .filter(Boolean)
                            .join(" · ") || entry.fileName}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="rail-section dwg-preview-section">
            <div className="section-heading"><span>DWG preview</span><span>local</span></div>
            <button
              type="button"
              className="legacy-api-load"
              onClick={() => dwgInputRef.current?.click()}
            >
              Choose DWG
            </button>
            <input
              ref={dwgInputRef}
              className="visually-hidden"
              type="file"
              accept=".dwg"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void processDwgFile(selected);
                event.currentTarget.value = "";
              }}
            />
            {dwgPreview && (
              <div className="dwg-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={dwgPreview.url} alt={`Embedded preview from ${dwgPreview.fileName}`} />
                <small>
                  {dwgPreview.fileName}
                  {dwgPreview.width && dwgPreview.height
                    ? ` · ${dwgPreview.width}×${dwgPreview.height}`
                    : ""}
                </small>
              </div>
            )}
            {dwgError && <p className="privacy-note">{dwgError}</p>}
          </section>

          {phase !== "idle" && (
            <div className="progress-card" aria-live="polite">
              <div className="progress-heading">
                <span>
                  {phase === "ready"
                    ? `Local conversion complete · ${formatElapsed(conversionElapsedSeconds)}`
                    : phase === "error"
                      ? `Conversion stopped · ${formatElapsed(conversionElapsedSeconds)}`
                      : `Working locally · ${formatElapsed(conversionElapsedSeconds)}`}
                </span>
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
                {/* Embedded CFB previews are local object URLs, not Next.js image assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {thumbnail ? <img src={thumbnail} alt="Embedded Revit preview" /> : <div className="thumbnail-fallback">RVT</div>}
                <div><strong>{file?.name}</strong><span>{file ? formatBytes(file.size) : null}</span></div>
              </div>
              <dl className="metadata-grid">
                <div><dt>Revit</dt><dd>{metadata.version}</dd></div>
                <div><dt>Build</dt><dd>{metadata.build}</dd></div>
                <div><dt>Locale</dt><dd>{metadata.locale}</dd></div>
                <div><dt>Document</dt><dd title={metadata.documentId}>{metadata.documentId.slice(0, 8)}…</dd></div>
                {(result?.partAtom ?? result?.readerDiagnostics?.partAtom)?.title && (
                  <div>
                    <dt>Family type</dt>
                    <dd>{(result?.partAtom ?? result?.readerDiagnostics?.partAtom)?.title}</dd>
                  </div>
                )}
                {(result?.partAtom ?? result?.readerDiagnostics?.partAtom)?.categories.length ? (
                  <div>
                    <dt>Category</dt>
                    <dd>
                      {(result?.partAtom ?? result?.readerDiagnostics?.partAtom)?.categories
                        .map((item) => item.term)
                        .join(", ")}
                    </dd>
                  </div>
                ) : null}
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
              <p>{comparison
                ? `${comparison.reference.geometricAlignedElementCount?.toLocaleString() ?? 0} of ${comparison.reference.geometricComparedElementCount?.toLocaleString() ?? 0} matched elements align within ${comparison.reference.geometryToleranceFeet?.toFixed(1) ?? "0.5"} ft. Open Overlay to inspect the differences.`
                : "Pair this model's IFC export to check the recovery against it, and to unlock the overlay view."}</p>
              <button
                type="button"
                onClick={() => ifcInputRef.current?.click()}
                disabled={referencePhase === "reading"}
                title={referencePhase === "reading" ? "Reading the IFC export in this tab" : undefined}
              >
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
              {/* Every source this viewer has is on the switcher whether or not
                  it can be reached. Hiding the two that need something first
                  made a model with no paired export look like a model that
                  could not have one, so each unavailable source says what would
                  turn it on instead. */}
              {result && (
                <div className="segmented-control source-control" aria-label="Geometry source">
                  <ToolButton
                    className={geometrySource === "autodesk" ? "active" : ""}
                    reason={autodeskReferenceAvailable ? null : "No Autodesk derivative is bundled for this file"}
                    onClick={() => { setGeometrySource("autodesk"); setSelectedElementId(null); }}
                  >Autodesk</ToolButton>
                  <ToolButton
                    className={geometrySource === "reference" ? "active" : ""}
                    reason={comparison?.referenceMeshes.length
                      ? null
                      : referencePhase === "reading" ? "Reading the IFC export now" : "Pair an IFC export to enable"}
                    onClick={() => { setGeometrySource("reference"); setSelectedElementId(null); }}
                  >IFC reference</ToolButton>
                  <ToolButton
                    className={geometrySource === "overlay" ? "active" : ""}
                    reason={comparison?.referenceMeshes.length
                      ? null
                      : referencePhase === "reading" ? "Reading the IFC export now" : "Pair an IFC export to compare it with the recovery"}
                    title="Recovered model over the paired export: aligned IFC geometry is ghosted and geometric differences are red"
                    onClick={() => setGeometrySource("overlay")}
                  >Overlay</ToolButton>
                  <ToolButton
                    className={geometrySource === "recovered" ? "active diagnostic-active" : ""}
                    onClick={() => setGeometrySource("recovered")}
                  >RVT diagnostic</ToolButton>
                </div>
              )}
            </div>
          </div>

          <div className={`viewport viewport-${renderMode} ${geometrySource === "autodesk" ? "viewport-autodesk" : ""}`}>
            {result ? (
              <>
                <ModelCanvas
                  result={result}
                  comparison={comparison}
                  source={geometrySource}
                  renderMode={renderMode}
                  navigationMode={navigationMode}
                  cameraRequest={cameraRequest}
                  measuring={activeTool === "measure"}
                  sectioning={activeTool === "section"}
                  onSectionClear={() => setActiveTool("orbit")}
                  exploding={activeTool === "explode"}
                  commenting={activeTool === "markup" && markupTool === "comment"}
                  commentEditing={activeTool === "markup"}
                  comments={modelComments}
                  onCreateComment={createModelComment}
                  onUpdateComment={updateModelComment}
                  onDeleteComment={deleteModelComment}
                  walking={walking}
                  onWalkingChange={handleWalkingChange}
                  selectedElementId={selectedElementId}
                  onSelectElement={setSelectedElementId}
                  hiddenElementIds={hiddenElementIds}
                  onHoverElement={setHoveredElementId}
                  onCanvasMenu={setCanvasMenu}
                  focusRequest={focusRequest}
                />
                <MarkupOverlay
                  key={`${result.fileName}:${result.byteLength}`}
                  active={activeTool === "markup"}
                  tool={markupTool}
                  commentCount={modelComments.length}
                  onToolChange={setMarkupTool}
                  onDone={() => setActiveTool("orbit")}
                  onCancel={cancelMarkup}
                />
                <nav className="viewer-commandbar" aria-label="Model tools">
                  <ToolButton
                    className={viewerPanel === "model" ? "active" : ""}
                    onClick={() => setViewerPanel((current) => current === "model" ? "none" : "model")}
                    pressed={viewerPanel === "model"}
                    reason={panelReason}
                  ><i>☷</i>Objects</ToolButton>
                  <ToolButton
                    className={viewerPanel === "categories" ? "active" : ""}
                    onClick={() => setViewerPanel((current) => current === "categories" ? "none" : "categories")}
                    pressed={viewerPanel === "categories"}
                    reason={panelReason}
                    title="Turn categories on and off"
                  ><i>◑</i>Categories</ToolButton>
                  <ToolButton
                    className={viewerPanel === "properties" ? "active" : ""}
                    onClick={() => setViewerPanel((current) => current === "properties" ? "none" : "properties")}
                    pressed={viewerPanel === "properties"}
                    reason={panelReason}
                  ><i>ⓘ</i>Properties</ToolButton>
                  <ToolButton
                    className={detailsOpen ? "active" : ""}
                    onClick={() => setDetailsOpen((current) => !current)}
                    pressed={detailsOpen}
                  ><i>▤</i>Report & exports</ToolButton>
                  <span className="command-divider" />
                  <span className="viewer-fidelity-chip">{geometrySource === "autodesk" ? "Autodesk derivative reference" : result.decoderCoverage.geometryFidelity.replaceAll("-", " ")}</span>
                </nav>

                {viewerPanel === "model" && (
                  <aside className="viewer-sidepanel model-browser-panel" aria-label="Objects">
                    <div className="viewer-panel-heading"><div><strong>Objects</strong><span>{visibleModelRecords.length.toLocaleString()}{visibleModelRecords.length === solidRecords.length ? "" : ` of ${solidRecords.length.toLocaleString()}`} in the scene</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close objects">×</button></div>
                    <label className="model-search"><span>Filter</span><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="ID, category, or type" /></label>
                    <ObjectList
                      records={visibleModelRecords}
                      selectedElementId={selectedElementId}
                      onSelect={setSelectedElementId}
                    />
                  </aside>
                )}

                {viewerPanel === "categories" && (
                  <aside className="viewer-sidepanel category-panel" aria-label="Categories">
                    <div className="viewer-panel-heading"><div><strong>Categories</strong><span>{visibleCategoryRows.length}{visibleCategoryRows.length === categoryRows.length ? "" : ` of ${categoryRows.length}`} in the scene{hiddenCategories.size ? ` · ${hiddenCategories.size} off` : ""}</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close categories">×</button></div>
                    <label className="model-search"><span>Filter</span><input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Category name" /></label>
                    <div className="category-list" role="list">
                      {visibleCategoryRows.map((row) => {
                        const hidden = hiddenCategories.has(row.name);
                        return (
                          <div className={`category-row${hidden ? " category-off" : ""}`} role="listitem" key={row.name}>
                            <button
                              className="category-bulb"
                              onClick={() => toggleCategory(row.name)}
                              aria-pressed={!hidden}
                              title={hidden ? `Turn ${row.name} on` : `Turn ${row.name} off`}
                            >{hidden ? "○" : "●"}</button>
                            <span>{row.name}</span>
                            <em>{row.count.toLocaleString()}</em>
                          </div>
                        );
                      })}
                    </div>
                    <p>
                      <ToolButton
                        className="category-reset"
                        reason={hiddenCategories.size ? null : "Every category is already on"}
                        onClick={() => setHiddenCategories(new Set())}
                      >Turn every category back on</ToolButton>
                    </p>
                  </aside>
                )}

                {viewerPanel === "properties" && (
                  <aside className="viewer-sidepanel properties-panel" aria-label="Element properties">
                    {/* The header is the object, the way every CAD properties
                        palette names it — "Curtain Panel", not "Properties". The
                        id is which one, which is the subtitle's job. */}
                    <div className="viewer-panel-heading"><div><strong>{selectedRecord ? selectedRecord.categoryName ?? "Uncategorised object" : "No selection"}</strong><span>{selectedRecord ? `Object ${selectedRecord.elementId}` : "Nothing picked"}</span></div><button onClick={() => setViewerPanel("none")} aria-label="Close properties">×</button></div>
                    {selectedRecord && selectedDimensions ? (
                      <dl className="property-table">
                        <div><dt>Native Revit ID</dt><dd>{selectedRecord.elementId}</dd></div>
                        <div><dt>Rendered geometry</dt><dd>{
                          selectedRecord.renderGeometryProvenance === "native"
                            ? "Native RVT face mesh"
                            : selectedRecord.renderGeometryProvenance === "reconstructed"
                              ? "Exact reconstructed geometry"
                              : selectedRecord.renderGeometryProvenance === "bounds-fallback"
                                ? "Bounds fallback"
                                : selectedRecord.renderGeometryProvenance === "not-rendered-helper"
                                  ? "Drawing aid—not rendered"
                                  : "Not classified"
                        }</dd></div>
                        {selectedRecord.categoryName && (
                          <div><dt>Category</dt><dd>{selectedRecord.categoryName}</dd></div>
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
                      <div className="property-empty"><b>Pick an object in the viewport</b><p>Click a recovered solid, or choose one from the Objects list.</p></div>
                    )}
                  </aside>
                )}

                {/* One control for orientation, named the way a drawing package
                    names it. A three-faced cube and a separate 3D/Plan switch
                    held the same idea in two places and neither said "SE
                    isometric", which is what people arrive knowing. */}
                <div className="view-style-bar">
                  <div className="view-menu">
                    <button
                      className={`view-control-button${viewMenuOpen ? " open" : ""}`}
                      onClick={() => setViewMenuOpen((current) => !current)}
                      aria-expanded={viewMenuOpen}
                      aria-haspopup="listbox"
                    >{CAMERA_PRESETS.find((entry) => entry.preset === cameraRequest.preset)?.label ?? "View"}</button>
                    {viewMenuOpen && (
                      <div className="view-menu-list" role="listbox" aria-label="Camera orientation">
                        {CAMERA_PRESETS.map((entry) => (
                          <button
                            key={entry.preset}
                            role="option"
                            aria-selected={cameraRequest.preset === entry.preset}
                            className={cameraRequest.preset === entry.preset ? "selected" : ""}
                            onClick={() => requestCamera(entry.preset)}
                          >{entry.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="render-switch" aria-label="Visual style">
                    <button className={renderMode === "technical" ? "active" : ""} onClick={() => setRenderMode("technical")}>Shaded</button>
                    <button className={renderMode === "xray" ? "active" : ""} onClick={() => setRenderMode("xray")}>X-ray</button>
                  </div>
                </div>

                <ViewerToolbar
                  activeTool={activeTool}
                  propertiesActive={viewerPanel === "properties"}
                  onTool={selectViewerTool}
                  onFit={() => setCameraRequest((current) => ({ ...current, sequence: current.sequence + 1, fit: true }))}
                  onProperties={() => setViewerPanel((current) => current === "properties" ? "none" : "properties")}
                  onHome={() => {
                    setActiveTool("orbit");
                    requestCamera(DEFAULT_CAMERA_PRESET);
                  }}
                />

                {/* The right-click menu. A read-only viewer has no last command
                    to repeat and nothing to paste, so what survives from a CAD
                    context menu is four questions about the object under the
                    cursor and two about the view. Every entry calls a control
                    that already exists elsewhere in this file rather than a
                    second copy of it. */}
                {canvasMenu && (
                  <div
                    className="canvas-menu"
                    ref={canvasMenuRef}
                    role="menu"
                    aria-label="Canvas actions"
                    style={canvasMenuPosition(canvasMenu, canvasMenu.elementId == null ? 2 : 4)}
                  >
                    {canvasMenu.elementId == null ? (
                      <>
                        <button role="menuitem" onClick={() => { setCanvasMenu(null); setCameraRequest((current) => ({ ...current, sequence: current.sequence + 1, fit: true })); }}>Zoom extents</button>
                        <ToolButton
                          role="menuitem"
                          reason={selectedElementId == null ? "Nothing is picked" : null}
                          onClick={() => { setCanvasMenu(null); setSelectedElementId(null); }}
                        >Clear selection</ToolButton>
                      </>
                    ) : (
                      <>
                        <button role="menuitem" onClick={() => { setCanvasMenu(null); requestZoomToSelection(); }}>Zoom to object</button>
                        <button role="menuitem" onClick={() => { setCanvasMenu(null); void navigator.clipboard?.writeText(String(canvasMenu.elementId)); }}>Copy object ID<em>{canvasMenu.elementId}</em></button>
                        <button role="menuitem" onClick={() => { setCanvasMenu(null); setViewerPanel("properties"); }}>Show properties</button>
                        <ToolButton
                          role="menuitem"
                          reason={canvasMenuCategory ? null : "This object has no category row"}
                          onClick={() => { setCanvasMenu(null); if (canvasMenuCategory) toggleCategory(canvasMenuCategory); }}
                        >Hide this category<em>{canvasMenuCategory}</em></ToolButton>
                      </>
                    )}
                  </div>
                )}
                {hoveredRecord && hoveredRecord.elementId !== selectedElementId && (
                  <div className="hover-readout" aria-live="polite">
                    {hoveredRecord.categoryName ?? "Uncategorised"}<span>{hoveredRecord.elementId}</span>
                  </div>
                )}
                {selectedRecord && <button className="selection-chip" onClick={() => setViewerPanel("properties")}>{selectedRecord.categoryName ?? "Uncategorised"} {selectedRecord.elementId}<span>View properties</span></button>}
                <div className="viewport-legend">
                  {geometrySource === "autodesk" ? (
                    <span><i className="legend-cyan" />Autodesk source meshes</span>
                  ) : geometrySource === "overlay" && comparison ? (
                    <><span><i className="legend-amber" />Recovered</span><span><i className="legend-cyan" />Aligned within 0.5 ft</span><span><i className="legend-missing" />Geometric difference</span><span><i className="legend-context" />Unmatched IFC context</span></>
                  ) : geometrySource === "reference" && comparison ? (
                    <><span><i className="legend-cyan" />Geometrically aligned</span><span><i className="legend-missing" />Geometric difference</span><span><i className="legend-context" />IFC context</span></>
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
              {comparison && (
                <RegressionPanel
                  comparison={comparison}
                  recoveredElementIds={recoveredElementIds}
                  drawnElementIds={displayedElementIds}
                />
              )}
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
                  <label className="model-search inline-search"><span>Filter</span>
                    <input value={schemaSearch} onChange={(event) => setSchemaSearch(event.target.value)} placeholder="Class or base class, e.g. Wall" />
                  </label>
                  <table className="coverage-table">
                    <tbody>
                      {result.schema.taggedClasses
                        .filter((entry) => matchesFilter(schemaSearch, entry.name, entry.parent))
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

              {privateFileInfo && (
                <section className="coverage-panel private-metadata-panel">
                  <div className="section-heading">
                    <span>Local-only file metadata</span>
                    <span>excluded from exports</span>
                  </div>
                  <table className="coverage-table">
                    <tbody>
                      <tr><td>Worksharing</td><td>{privateFileInfo.worksharing ?? "—"}</td></tr>
                      <tr><td>Username</td><td>{privateFileInfo.username ?? "—"}</td></tr>
                      <tr><td>Central model path</td><td>{privateFileInfo.centralModelPath ?? "—"}</td></tr>
                      <tr><td>Last save path</td><td>{privateFileInfo.lastSavePath ?? "—"}</td></tr>
                      <tr><td>Central identity</td><td>{privateFileInfo.centralModelIdentity ?? "—"}</td></tr>
                      <tr><td>Document GUID</td><td>{privateFileInfo.uniqueDocumentGuid ?? "—"}</td></tr>
                      <tr>
                        <td>Document increment</td>
                        <td>{privateFileInfo.uniqueDocumentIncrements ?? "—"}</td>
                      </tr>
                      <tr>
                        <td>Saved to central</td>
                        <td>
                          {privateFileInfo.allLocalChangesSavedToCentral == null
                            ? "—"
                            : privateFileInfo.allLocalChangesSavedToCentral ? "Yes" : "No"}
                        </td>
                      </tr>
                      <tr><td>Open workset default</td><td>{privateFileInfo.openWorksetDefault ?? "—"}</td></tr>
                      <tr><td>Build architecture</td><td>{privateFileInfo.architecture ?? "—"}</td></tr>
                      <tr><td>Locale</td><td>{privateFileInfo.locale ?? "—"}</td></tr>
                    </tbody>
                  </table>
                  <p className="export-disclaimer">
                    Paths and usernames are held only in this component state and are not
                    attached to the conversion result or JSON audit.
                  </p>
                </section>
              )}

              <section className="coverage-panel omniclass-panel">
                <div className="section-heading">
                  <span>Bundled OmniClass browser</span>
                  <span>{omniClass ? `${omniClass.length.toLocaleString()} rows` : "optional"}</span>
                </div>
                {!omniClass ? (
                  <button
                    type="button"
                    className="legacy-api-load"
                    disabled={omniBusy}
                    onClick={() => void loadOmniClass()}
                  >
                    {omniBusy ? "Loading classifications…" : "Load OmniClass editions"}
                  </button>
                ) : (
                  <>
                    <label className="model-search inline-search">
                      <span>Number, title, or category ID</span>
                      <input
                        value={omniSearch}
                        onChange={(event) => setOmniSearch(event.target.value)}
                        placeholder="23.10, retaining wall…"
                      />
                    </label>
                    <table className="coverage-table">
                      <tbody>
                        {omniMatches.map((item) => (
                          <tr key={`${item.number}-${item.title}-${item.categoryId ?? ""}`}>
                            <td>{item.number}</td>
                            <td>{item.title}</td>
                            <td>Level {item.level}</td>
                            <td>{item.categoryId ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {omniError && <p className="export-disclaimer">{omniError}</p>}
              </section>

              <section className="coverage-panel shared-parameter-panel">
                <div className="section-heading">
                  <span>Shared-parameter manager</span>
                  <span>{sharedFiles.length ? `${sharedFiles.length} files` : "local files"}</span>
                </div>
                <button
                  type="button"
                  className="legacy-api-load"
                  onClick={() => sharedInputRef.current?.click()}
                >
                  Choose shared-parameter files
                </button>
                <input
                  ref={sharedInputRef}
                  className="visually-hidden"
                  type="file"
                  accept=".txt"
                  multiple
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    if (selected.length) void processSharedParameterFiles(selected);
                    event.currentTarget.value = "";
                  }}
                />
                {mergedSharedParameters && (
                  <>
                    <div className="shared-parameter-metrics">
                      <span>{mergedSharedParameters.groups.length.toLocaleString()} groups</span>
                      <span>{mergedSharedParameters.parameters.length.toLocaleString()} parameters</span>
                      <span>{sharedIssues.filter((issue) => issue.severity === "error").length} errors</span>
                      <span>{sharedIssues.filter((issue) => issue.severity === "warning").length} warnings</span>
                    </div>
                    {sharedComparison && (
                      <p className="export-disclaimer">
                        First-two-file comparison: {sharedComparison.added.length} added ·{" "}
                        {sharedComparison.removed.length} removed · {sharedComparison.renamed.length} renamed ·{" "}
                        {sharedComparison.incompatibleDataTypes.length} incompatible datatypes ·{" "}
                        {sharedComparison.movedGroups.length} regrouped.
                      </p>
                    )}
                    <button
                      type="button"
                      className="legacy-api-load"
                      onClick={() => downloadBlob(
                        new Blob([writeSharedParameterFile(mergedSharedParameters)], {
                          type: "text/plain;charset=utf-8",
                        }),
                        "merged-shared-parameters.txt",
                      )}
                    >
                      Download merged file
                    </button>
                    {sharedIssues.length > 0 && (
                      <table className="coverage-table">
                        <tbody>
                          {sharedIssues.slice(0, 30).map((issue, index) => (
                            <tr key={`${issue.code}-${issue.guid ?? issue.groupId ?? index}`}>
                              <td>{issue.severity}</td>
                              <td>{issue.code}</td>
                              <td>{issue.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </section>

              <section className="coverage-panel legacy-api-panel">
                <div className="section-heading">
                  <span>Personal Revit 2021 API vocabulary</span>
                  <span>{legacyApi ? "5,426 enum members" : "optional · lazy loaded"}</span>
                </div>
                {!legacyApi ? (
                  <>
                    <p className="export-disclaimer">
                      Load the transposed RevitAPI compatibility tables to inspect legacy
                      IDs, aliases, parameter groups, MEP classifications, units, and symbols.
                    </p>
                    <button
                      className="legacy-api-load"
                      type="button"
                      onClick={() => void loadLegacyApi()}
                      disabled={legacyLoading}
                    >
                      {legacyLoading ? "Loading compatibility data…" : "Load legacy API data"}
                    </button>
                  </>
                ) : (
                  <>
                    <label className="model-search inline-search">
                      <span>ID or enum member</span>
                      <input
                        value={legacySearch}
                        onChange={(event) => setLegacySearch(event.target.value)}
                        placeholder="-2000011, OST_Walls, SupplyAir…"
                      />
                    </label>
                    <table className="coverage-table">
                      <tbody>
                        {legacyMatches.map((entry, index) => (
                          <tr key={`${entry.enumName}-${entry.name}-${index}`}>
                            <td>{entry.enumName}</td>
                            <td>{entry.name}</td>
                            <td>{entry.value}</td>
                            <td>{entry.label ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="export-disclaimer">
                      Personal compatibility data transposed from the toolkit&apos;s
                      Revit 2021 decompiled folder; it is not geometry-decoder evidence.
                    </p>
                  </>
                )}
                {legacyError && <p className="export-disclaimer">{legacyError}</p>}
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
