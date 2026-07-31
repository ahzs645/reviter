"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileBox, Moon, ShieldCheck, Sun } from "lucide-react";

import {
  boundsDimensions,
  DEFAULT_CAMERA_PRESET,
  downloadBlob,
  drawnBounds,
  makeDxf,
  makeGlb,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
  outputName,
  parseBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
  STANDARDS_READER_RANGE_LABEL,
  standardsReaderSupports,
  type CameraPreset,
  type BasicFileInfoProperties,
  type ConvertResult,
  type IfcWorkerRequest,
  type IfcWorkerResponse,
  type PairedRegressionResult,
  type RenderMode,
  type WorkerRequest,
  type WorkerResponse,
} from "../lib/reviter";

import { staticWorkerUrl } from "./studio/reference-model.ts";
import {
  canvasMenuPosition,
  formatBytes,
  formatNumber,
  matchesFilter,
  propertyClipboardText,
  savedFileName,
} from "./studio/format.ts";
import { BrowserDock } from "./studio/BrowserDock.tsx";
import { EmptyState } from "./studio/EmptyState.tsx";
import { MobileShell } from "./studio/MobileShell.tsx";
import { ModelCanvas } from "./studio/ModelCanvas.tsx";
import { MarkupOverlay } from "./studio/MarkupOverlay.tsx";
import { loadModelComments, saveModelComments } from "./studio/model-comments.ts";
import { PropertiesDock, type EvidenceRow } from "./studio/PropertiesDock.tsx";
import { ToolButton } from "./studio/panels.tsx";
import {
  ReportDock,
  type ExportAction,
  type FileRecord,
  type ReportCheck,
} from "./studio/ReportDock.tsx";
import {
  recentFilesServerSnapshot,
  recentFilesSnapshot,
  recordRecentFile,
  subscribeToRecentFiles,
  type RecentFile,
} from "./studio/recents.ts";
import { ViewerToolbar, type SourceOption } from "./studio/ViewerToolbar.tsx";
import {
  navigationModeForTool,
  type MarkupTool,
  type ModelComment,
  type NewModelComment,
  type ViewerTool,
} from "./studio/viewer-tools.ts";
import type {
  BrowserTab,
  CameraRequest,
  CanvasMenuRequest,
  CommentFilter,
  GeometrySource,
  MobileSheet,
  Phase,
  PropertyRow,
  ReferencePhase,
  ReportTab,
} from "./studio/types.ts";

type StudioFileInfo = Omit<FileInfo, "fileVersion"> & { fileVersion: number };

/** The layout below this width is the phone shell, not a narrowed desktop. */
const MOBILE_QUERY = "(max-width: 860px)";

function subscribeToBreakpoint(listener: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function breakpointSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Server-rendered markup is the desktop shell. The viewport width is not
 * knowable until there is a window, and guessing produces a layout that has to
 * be thrown away on hydration.
 */
function breakpointServerSnapshot(): boolean {
  return false;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Clipboard access is unavailable in some embedded or non-secure previews.
  // Keep the action working there through the older synchronous browser path.
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("The browser did not grant clipboard access");
}

/**
 * The theme lives on `<html data-theme>` and in `localStorage`, not in React
 * state. Nothing in the tree needs to re-render when it flips — the tokens and
 * both toggle icons are switched by CSS — and keeping it out of state is what
 * lets `app/layout.tsx` apply the stored value before the first paint instead
 * of flashing the default and correcting it afterwards.
 */
const THEME_KEY = "reviter.theme";

function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // The theme still applies for this session.
  }
}

/** Both icons are rendered; the stylesheet shows whichever matches the theme. */
function ThemeIcons({ size }: { size: number }) {
  return (
    <>
      <Sun className="theme-icon-dark" size={size} aria-hidden />
      <Moon className="theme-icon-light" size={size} aria-hidden />
    </>
  );
}

export default function ReviterStudio() {
  const mobile = useSyncExternalStore(
    subscribeToBreakpoint,
    breakpointSnapshot,
    breakpointServerSnapshot,
  );
  const recents = useSyncExternalStore(
    subscribeToRecentFiles,
    recentFilesSnapshot,
    recentFilesServerSnapshot,
  );
  const [sheet, setSheet] = useState<MobileSheet | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<StudioFileInfo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [privateFileInfo, setPrivateFileInfo] = useState<BasicFileInfoProperties | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [geometrySource, setGeometrySource] = useState<GeometrySource>("recovered");
  const [renderMode, setRenderMode] = useState<RenderMode>("technical");
  const [activeTool, setActiveTool] = useState<ViewerTool>("orbit");
  const [markupTool, setMarkupTool] = useState<MarkupTool>("pencil");
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({
    preset: DEFAULT_CAMERA_PRESET,
    sequence: 0,
  });
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<string>>(new Set());
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuRequest | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ elementId: number; label: string } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ elementId: number | null; sequence: number }>({
    elementId: null,
    sequence: 0,
  });

  // The docks are independent now: opening Properties no longer closes the
  // Browser, because neither is an overlay on the model any more.
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const [browserTab, setBrowserTab] = useState<BrowserTab>("objects");
  const [reportTab, setReportTab] = useState<ReportTab>("summary");
  const [browserSearch, setBrowserSearch] = useState("");
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const [modelComments, setModelComments] = useState<ModelComment[]>([]);
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("open");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [viewpointRequest, setViewpointRequest] = useState<{ commentId: string | null; sequence: number }>({
    commentId: null,
    sequence: 0,
  });

  const [exporting, setExporting] = useState<string | null>(null);

  const [referenceModelUrl, setReferenceModelUrl] = useState<string | null>(null);
  const [referenceModelName, setReferenceModelName] = useState<string | null>(null);
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
  const referenceRequestIdRef = useRef(0);
  const commentSessionRef = useRef<ModelComment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);
  const referenceModelInputRef = useRef<HTMLInputElement>(null);
  const canvasMenuRef = useRef<HTMLDivElement>(null);

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

  // The object URL outlives a render, so it is released when the studio goes
  // away rather than leaking the file for the life of the tab.
  useEffect(() => () => {
    if (referenceModelUrl) URL.revokeObjectURL(referenceModelUrl);
  }, [referenceModelUrl]);

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

  const rememberFile = useCallback((
    name: string,
    size: number,
    revitVersion: string | null,
    status: RecentFile["status"],
  ) => {
    recordRecentFile({ name, size, revitVersion, openedAt: Date.now(), status });
  }, []);

  // --- Opening a file ----------------------------------------------------

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
    setActiveCommentId(null);
    setCommentFilter("open");
    setCameraRequest({ preset: DEFAULT_CAMERA_PRESET, sequence: requestId, fit: false });
    setSelectedElementId(null);
    setHiddenCategories(new Set());
    setBrowserTab("objects");
    setBrowserSearch("");
    setCanvasMenu(null);
    setDockOpen(false);
    setSheet(null);
    setReferencePhase("idle");
    setReferenceError(null);
    setMetadata(null);
    setPrivateFileInfo(null);
    setError(null);
    setProgress(0.03);
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
      // The previous preview URL is revoked where the next one is created, so
      // the object URL's lifetime does not depend on an unmount cleanup.
      setThumbnail((current) => {
        if (current) URL.revokeObjectURL(current);
        return preview.ok ? URL.createObjectURL(preview.data) : null;
      });
      setPrivateFileInfo(basicData ? parseBasicFileInfoProperties(basicData) : null);
      setPhase("converting");
      setProgress(0.08);

      const buffer = await nextFile.arrayBuffer();
      const worker = getWorker();
      const fail = (message: string) => {
        setError(message);
        setPhase("error");
        rememberFile(nextFile.name, nextFile.size, info.version, "partial");
      };
      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return;
        fail(event.message || "The local conversion worker stopped unexpectedly.");
      };
      worker.onmessageerror = () => {
        if (requestId !== requestIdRef.current) return;
        fail("The local conversion worker returned an unreadable result.");
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.id !== requestId || requestId !== requestIdRef.current) return;
        if (message.type === "progress") {
          setProgress(message.ratio);
          return;
        }
        if (message.type === "error") {
          fail(message.error);
          return;
        }
        if (!message.result.ok) {
          fail(message.result.error);
          return;
        }
        setResult(message.result);
        setModelComments(loadModelComments(message.result));
        // Reviter's own recovery is what opening a model shows. Nothing about
        // the file — not its name, not its document id — switches the viewer to
        // a different converter's output behind the user's back.
        setGeometrySource("recovered");
        setProgress(1);
        setPhase("ready");
        rememberFile(
          nextFile.name,
          nextFile.size,
          info.version,
          message.result.stats.candidatesUsed >= message.result.elementBounds.length ? "ready" : "partial",
        );
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
  }, [getWorker, rememberFile]);

  const closeModel = useCallback(() => {
    requestIdRef.current += 1;
    setResult(null);
    setComparison(null);
    setFile(null);
    setMetadata(null);
    setThumbnail((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPrivateFileInfo(null);
    setModelComments([]);
    setActiveCommentId(null);
    setSelectedElementId(null);
    setHiddenCategories(new Set());
    setCanvasMenu(null);
    setDockOpen(false);
    setSheet(null);
    setError(null);
    setPhase("idle");
    setProgress(0);
  }, []);

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

  /**
   * Pair a reference conversion of the same building from disk.
   *
   * An object URL, so the file is read by the viewer and never uploaded — the
   * same contract as the RVT and the paired IFC.
   */
  const pairReferenceModel = (selected: File | null | undefined) => {
    if (!selected) return;
    setReferenceModelUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(selected);
    });
    setReferenceModelName(selected.name);
    setGeometrySource("reference-model");
    setSelectedElementId(null);
  };

  // --- Derived model views ----------------------------------------------

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
  const visibleModelRecords = useMemo(
    () => solidRecords.filter((record) =>
      matchesFilter(browserSearch, record.elementId, record.categoryName, record.typeName)),
    [browserSearch, solidRecords],
  );
  const categoryRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of solidRecords) {
      const name = record.categoryName ?? "Uncategorised";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [solidRecords]);
  const visibleCategoryRows = useMemo(
    () => categoryRows.filter((row) => matchesFilter(browserSearch, row.name)),
    [browserSearch, categoryRows],
  );
  const hiddenElementIds = useMemo(() => {
    if (!result || !hiddenCategories.size) return new Set<number>();
    const hidden = new Set<number>();
    for (const record of result.elementBounds) {
      if (hiddenCategories.has(record.categoryName ?? "Uncategorised")) hidden.add(record.elementId);
    }
    return hidden;
  }, [hiddenCategories, result]);

  const selectedRecord = useMemo(
    () => selectedElementId == null
      ? null
      : result?.elementBounds.find((record) => record.elementId === selectedElementId) ?? null,
    [result, selectedElementId],
  );
  const hoveredRecord = useMemo(
    () => hoveredElementId == null
      ? null
      : result?.elementBounds.find((record) => record.elementId === hoveredElementId) ?? null,
    [hoveredElementId, result],
  );
  const selectedDimensions = selectedRecord ? boundsDimensions(selectedRecord.boundsFeet) : null;

  /**
   * The properties palette.
   *
   * Category, type and id lead, because that is what a CAD palette answers
   * first; the recovery's own evidence follows, because in this viewer it is a
   * property of the object rather than a footnote about the file.
   */
  const propertyRows: PropertyRow[] = useMemo(() => {
    if (!selectedRecord || !selectedDimensions) return [];
    return [
      { key: "category", label: "Category", value: selectedRecord.categoryName ?? "Uncategorised" },
      ...(selectedRecord.typeName ? [{ key: "type", label: "Type", value: selectedRecord.typeName }] : []),
      { key: "element-id", label: "Element id", value: String(selectedRecord.elementId) },
      ...(selectedRecord.typeId != null
        ? [{ key: "type-element", label: "Type element", value: String(selectedRecord.typeId) }]
        : []),
      {
        key: "geometry",
        label: "Geometry",
        value: selectedRecord.renderGeometryProvenance === "native"
          ? "Native RVT face mesh"
          : selectedRecord.renderGeometryProvenance === "reconstructed"
            ? selectedRecord.stairTreads?.length
              ? "Reconstructed stair-run geometry"
              : "Reconstructed RVT geometry"
            : selectedRecord.renderGeometryProvenance === "boundary-clipped-proxy"
              ? "Mullion-clipped panel proxy"
              : selectedRecord.renderGeometryProvenance === "bounds-fallback"
                ? "Bounds fallback"
                : selectedRecord.renderGeometryProvenance === "not-rendered-helper"
                  ? "Drawing aid—not rendered"
                  : "Not classified",
      },
      {
        key: "evidence",
        label: "Evidence",
        value: selectedRecord.stairTreads?.length
          ? selectedRecord.categorySource === "native-object"
            ? "Native StairsRun sketch and aggregate"
            : "Recovered stair tread sketch"
          : selectedRecord.railPath
            ? "Native railing path"
            : selectedRecord.loops?.length
              ? "Sketch boundary"
              : selectedRecord.recordOffset >= 0
                ? "Duplicated bounds record"
                : selectedRecord.orientedBox
                  ? "Placed family instance"
                  : selectedRecord.solids?.length || selectedRecord.solid
                    ? "Rebuilt from native surfaces"
                    : "Native faces",
      },
      ...(selectedRecord.categoryId != null
        ? [{
          key: "category-id",
          label: "Category ID",
          value: `${selectedRecord.categoryId}${
            selectedRecord.categorySource === "record-code-consensus"
              ? " (record-code consensus)"
              : selectedRecord.categorySource === "native-object"
                ? " (native object)"
                : " (native token)"
          }`,
        }]
        : []),
      ...(selectedRecord.solid
        ? [{
          key: "native-geometry",
          label: "Native geometry",
          value: `${Math.hypot(
            selectedRecord.solid.end.x - selectedRecord.solid.start.x,
            selectedRecord.solid.end.y - selectedRecord.solid.start.y,
          ).toFixed(3)} ft long · ${(selectedRecord.solid.thickness * 304.8).toFixed(0)} mm thick`,
        }]
        : []),
      ...(selectedRecord.parameters?.map((parameter) => ({
        key: `parameter-${parameter.parameterId}`,
        label: parameter.name,
        value: `${parameter.value.toFixed(4)} ft`,
      })) ?? []),
      {
        key: "bounding-size",
        label: "Bounding size",
        value: `${selectedDimensions.x.toFixed(2)} × ${selectedDimensions.y.toFixed(2)} × ${selectedDimensions.z.toFixed(2)} ft`,
      },
      { key: "minimum-z", label: "Minimum Z", value: `${selectedRecord.boundsFeet.min.z.toFixed(3)} ft` },
      { key: "stream", label: "Source stream", value: selectedRecord.stream },
      ...(selectedRecord.chunkIndex >= 0
        ? [{ key: "chunk", label: "Chunk", value: selectedRecord.chunkIndex.toLocaleString() }]
        : []),
      ...(selectedRecord.recordOffset >= 0
        ? [{ key: "record-offset", label: "Record offset", value: `0x${selectedRecord.recordOffset.toString(16)}` }]
        : []),
    ];
  }, [selectedDimensions, selectedRecord]);

  const copySelectedProperties = useCallback(async () => {
    if (!selectedRecord || !propertyRows.length) return;
    const elementId = selectedRecord.elementId;
    try {
      await writeClipboardText(propertyClipboardText(
        selectedRecord.categoryName ?? "Uncategorised object",
        `Object ${elementId}`,
        propertyRows,
      ));
      setCopyFeedback({ elementId, label: "Copied" });
    } catch {
      setCopyFeedback({ elementId, label: "Copy failed" });
    }
    window.setTimeout(() => {
      setCopyFeedback((current) => current?.elementId === elementId ? null : current);
    }, 1_400);
  }, [propertyRows, selectedRecord]);

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

  const requestCamera = useCallback((preset: CameraPreset) => {
    setCameraRequest((current) => ({ preset, sequence: current.sequence + 1, fit: false }));
  }, []);

  // --- Comments ----------------------------------------------------------

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
    // A new comment is open, so a list filtered to resolved would swallow it.
    setCommentFilter((current) => current === "resolved" ? "all" : current);
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
    setActiveCommentId((current) => current === id ? null : current);
  }, [commitComments]);

  const resolveModelComment = useCallback((id: string) => {
    setModelComments((current) => {
      const next = current.map((comment) => comment.id === id
        ? {
          ...comment,
          status: comment.status === "open" ? "resolved" as const : "open" as const,
          updatedAt: new Date().toISOString(),
        }
        : comment);
      if (result) saveModelComments(result, next);
      return next;
    });
  }, [result]);

  const visibleComments = useMemo(
    () => commentFilter === "all"
      ? modelComments
      : modelComments.filter((comment) => comment.status === commentFilter),
    [commentFilter, modelComments],
  );
  // Filtering the list filters the pins with it, but the numbering never moves.
  const visibleCommentIds = useMemo(
    () => commentFilter === "all" ? null : new Set(visibleComments.map((comment) => comment.id)),
    [commentFilter, visibleComments],
  );

  const describeCommentTarget = useCallback((comment: ModelComment) => {
    if (comment.elementId != null) {
      const record = result?.elementBounds.find((entry) => entry.elementId === comment.elementId);
      return `${record?.categoryName ?? "Object"} ${comment.elementId}`;
    }
    const point = comment.modelPositionFeet ?? comment.scenePosition;
    return `${point[0].toFixed(1)}, ${point[1].toFixed(1)}, ${point[2].toFixed(1)} ft`;
  }, [result]);

  const activateComment = useCallback((id: string | null) => {
    setActiveCommentId(id);
    if (!id) return;
    if (mobile) setSheet("comments");
    else {
      setBrowserTab("comments");
      setLeftOpen(true);
    }
  }, [mobile]);

  const requestCommentViewpoint = useCallback((id: string) => {
    setViewpointRequest((current) => ({ commentId: id, sequence: current.sequence + 1 }));
  }, []);

  const commentToolArmed = activeTool === "markup" && markupTool === "comment";

  const armCommentTool = useCallback(() => {
    setActiveTool((current) => {
      if (current === "markup") return "orbit";
      commentSessionRef.current = modelComments;
      return "markup";
    });
    setMarkupTool("comment");
  }, [modelComments]);

  const selectViewerTool = useCallback((tool: ViewerTool) => {
    if (tool === "markup") {
      if (activeTool !== "markup") commentSessionRef.current = modelComments;
      setMarkupTool("comment");
      if (mobile) setSheet("comments");
      else {
        setBrowserTab("comments");
        setLeftOpen(true);
      }
    }
    setActiveTool(tool);
  }, [activeTool, mobile, modelComments]);

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

  // --- Reporting ---------------------------------------------------------

  const versionNumber = Number(metadata?.version ?? 0);
  // Not "future": a release the optional standards-aware reader declines. The
  // check reads both ends of its range so a legacy file is described the same
  // way rather than silently falling through as if it were supported.
  const isBeyondStandardsReader = versionNumber > 0 && !standardsReaderSupports(versionNumber);
  const referenceModelAvailable = Boolean(referenceModelUrl);
  const objectsInFile = result
    ? result.elementIndex?.uniqueElementIds.length ?? result.stats.candidatesFound
    : 0;

  const metricCards = useMemo(() => result ? [
    { label: "Objects in file", value: formatNumber(objectsInFile) },
    { label: "Recovered", value: formatNumber(recoveredElementIds.size) },
    { label: "Drawn", value: formatNumber(displayedElementIds.size) },
    { label: "Read time", value: `${(result.stats.durationMs / 1_000).toFixed(1)} s` },
  ] : [], [displayedElementIds, objectsInFile, recoveredElementIds, result]);

  const checks: ReportCheck[] = useMemo(() => {
    if (!result) return [];
    const materials = result.decoderCoverage.nativeMaterialDefinitions;
    return [
      {
        label: "Metadata",
        value: metadata ? "Read from file" : "Not read",
        tone: metadata ? "good" : "off",
      },
      {
        label: "Geometry",
        value: geometrySource === "reference-model"
          ? "Paired reference model"
          : result.method === "native-profile-recovery"
            ? "Native wall profiles · approximate"
            : result.method === "partition-bounds-recovery"
              ? "Element envelopes · approximate"
              : "Recovered · approximate",
        tone: geometrySource === "reference-model" ? "good" : "warn",
      },
      {
        label: "Materials",
        value: materials ? `${materials.toLocaleString()} definitions` : "Not decoded",
        tone: materials ? "warn" : "off",
      },
      {
        label: "IFC comparison",
        value: comparison
          ? `${comparison.reference.matchedElementCount.toLocaleString()} matched · ${comparison.status}`
          : "Not paired",
        tone: comparison ? (comparison.status === "pass" ? "good" : "warn") : "off",
      },
    ];
  }, [comparison, geometrySource, metadata, result]);

  const fileRecord: FileRecord | null = useMemo(() => {
    if (!metadata) return null;
    const savedName = savedFileName(metadata.path);
    return {
      thumbnail,
      rows: [
        { label: "Release", value: `Revit ${metadata.version}` },
        { label: "Build", value: metadata.build },
        { label: "Locale", value: metadata.locale },
        { label: "Size", value: file ? formatBytes(file.size) : "—" },
        ...(metadata.documentId
          ? [{ label: "Document", value: metadata.documentId }]
          : []),
      ],
      note: savedName ? `Original folder path withheld · saved as ${savedName}` : null,
    };
  }, [file, metadata, thumbnail]);

  const evidenceRows: EvidenceRow[] = useMemo(() => {
    const materials = result?.decoderCoverage.nativeMaterialDefinitions ?? 0;
    return [
      { label: "File metadata", value: metadata ? "Read from file" : "Not read", tone: metadata ? "good" : "off" },
      { label: "Object bounds", value: result ? "Recovered" : "Not evaluated", tone: result ? "warn" : "off" },
      {
        label: "Materials",
        value: materials ? `${materials.toLocaleString()} definitions` : "Not decoded",
        tone: materials ? "warn" : "off",
      },
      { label: "Openings & textures", value: "Not available", tone: "off" },
    ];
  }, [metadata, result]);

  const evidenceSummary = isBeyondStandardsReader
    ? `Revit ${metadata?.version} is outside the optional Rust reader's verified ${STANDARDS_READER_RANGE_LABEL} range; Reviter's own decoders ran normally. Shapes are approximate; metadata is read directly from the file.`
    : result?.readerDiagnostics?.summary
      ?? "This is a recovery, not a native Revit decode. Shapes are approximate; metadata is read directly from the file.";

  const exportText = useCallback((
    id: string,
    extension: string,
    content: () => string,
    type = "text/plain",
  ) => {
    if (!result) return;
    setExporting(id);
    try {
      downloadBlob(new Blob([content()], { type }), outputName(result.fileName, extension));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setExporting(null);
    }
  }, [result]);

  const exportActions: ExportAction[] = useMemo(() => {
    if (!result) return [];
    return [
      {
        id: "GLB",
        format: "GLB",
        detail: "3D scene",
        run: () => {
          setExporting("GLB");
          try {
            downloadBlob(new Blob([makeGlb(result)], { type: "model/gltf-binary" }), outputName(result.fileName, "glb"));
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setExporting(null);
          }
        },
      },
      { id: "OBJ", format: "OBJ", detail: "Mesh", run: () => exportText("OBJ", "obj", () => makeObj(result)) },
      { id: "DXF", format: "DXF", detail: "3D lines", run: () => exportText("DXF", "dxf", () => makeDxf(result)) },
      {
        id: "SVG",
        format: "SVG",
        detail: "Plan",
        run: () => exportText("SVG", "svg", () => makePlanSvg(result), "image/svg+xml"),
      },
      {
        id: "IFC",
        format: "IFC",
        detail: result.method === "partition-bounds-recovery"
          ? "Solid proxies"
          : result.method === "native-profile-recovery" ? "Profile proxies" : "Proxies",
        run: () => exportText("IFC", "ifc", () => makeIfcCenterlines(result), "application/x-step"),
      },
      {
        id: "JSON",
        format: "JSON",
        detail: "Audit log",
        run: () => exportText(
          "JSON",
          "json",
          () => makeReport(result, metadata as unknown as Record<string, unknown>),
          "application/json",
        ),
      },
    ];
  }, [exportText, metadata, result]);

  const exportDisclaimer = result
    ? `Exports preserve ${
      result.method === "native-profile-recovery"
        ? "native ArcWall centerlines with explicitly approximate solids"
        : result.method === "partition-bounds-recovery"
          ? "native-ID element envelopes"
          : "the recovered geometry"
    }. The audit records ${result.decoderCoverage.nativeMaterialDefinitions.toLocaleString()} decoded material definitions and ${result.decoderCoverage.nativeMaterialAssignments.toLocaleString()} proven assignments; textures and openings remain unavailable.`
    : "";

  // --- Chrome ------------------------------------------------------------

  const busy = phase === "reading" || phase === "converting";
  const statusText = phase === "error"
    ? error ?? "Conversion stopped"
    : busy
      ? phase === "reading" ? "Reading file" : "Recovering geometry"
      : result ? "Ready" : "No model open";
  const statusTone = phase === "error" ? "error" : busy ? "busy" : result ? "ready" : "";

  const ifcReason = comparison?.referenceMeshes.length
    ? null
    : referencePhase === "reading"
      ? "Reading the IFC export now"
      : "Pair an IFC export in Report → Coverage to enable this source";
  const sources: SourceOption[] = [
    { id: "recovered", label: "Recovered", reason: null, title: "Geometry rebuilt from the RVT file" },
    { id: "reference", label: "IFC", reason: ifcReason, title: "The paired IFC export on its own" },
    {
      id: "overlay",
      label: "Overlay",
      reason: ifcReason,
      title: "Recovered model over the paired export: aligned IFC geometry is ghosted and geometric differences are red",
    },
    {
      id: "reference-model",
      label: "Reference",
      reason: referenceModelAvailable
        ? null
        : "Pair a GLB or glTF of the same building in Report → Coverage to enable this source",
      title: referenceModelName ? `Paired reference: ${referenceModelName}` : "A GLB or glTF conversion of the same building",
    },
  ];

  const selectGeometrySource = useCallback((source: GeometrySource) => {
    setGeometrySource(source);
    if (source !== "recovered") setSelectedElementId(null);
  }, []);

  const fileMeta = [
    file ? formatBytes(file.size) : null,
    metadata ? `Revit ${metadata.version}` : null,
    result ? `${formatNumber(objectsInFile)} objects` : null,
  ].filter(Boolean).join(" · ");

  /**
   * Why the Objects and Categories lists are empty when they are.
   *
   * Only the recovery carries per-triangle element ids; the paired export and
   * the paired reference arrive as anonymous meshes. And a file can convert
   * into drawable geometry with no identified elements at all — a family with
   * no element table does exactly that — which is a fact about the file, not a
   * list that failed to load.
   */
  const browserEmptyNote = geometrySource !== "recovered"
    ? "Only the recovered source carries object ids. Switch back to Recovered to browse objects and categories."
    : browserSearch.trim()
      ? "Nothing in this model matches that filter."
      : "This file converted into geometry, but no element ids were recovered from it — there is nothing to list. The Report dock has the stream-by-stream detail.";

  const selectedTitle = selectedRecord ? selectedRecord.categoryName ?? "Uncategorised object" : "No selection";
  const selectedSubtitle = selectedRecord
    ? [selectedRecord.typeName, `id ${selectedRecord.elementId}`].filter(Boolean).join(" · ")
    : "Nothing picked";

  const legend = geometrySource === "reference-model"
    ? [{ tone: "cyan", label: "Reference source meshes" }]
    : geometrySource === "overlay" && comparison
      ? [
        { tone: "amber", label: "Recovered" },
        { tone: "cyan", label: "Matched" },
        { tone: "missing", label: "Differs" },
        { tone: "context", label: "Unmatched IFC" },
      ]
      : geometrySource === "reference" && comparison
        ? [
          { tone: "cyan", label: "Aligned" },
          { tone: "missing", label: "Differs" },
          { tone: "context", label: "IFC context" },
        ]
        : [{ tone: "amber", label: "Recovered" }];
  const stamp = geometrySource === "reference-model"
    ? "paired reference model"
    : geometrySource === "reference" && comparison
      ? "metres · z-up"
      : "feet · z-up";

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const canvas = result ? (
    <ModelCanvas
      result={result}
      comparison={comparison}
      source={geometrySource}
      referenceModelUrl={referenceModelUrl}
      renderMode={renderMode}
      navigationMode={navigationMode}
      cameraRequest={cameraRequest}
      measuring={activeTool === "measure"}
      sectioning={activeTool === "section"}
      onSectionClear={() => setActiveTool("orbit")}
      exploding={activeTool === "explode"}
      commenting={commentToolArmed}
      comments={modelComments}
      visibleCommentIds={visibleCommentIds}
      activeCommentId={activeCommentId}
      onActiveComment={activateComment}
      onCreateComment={createModelComment}
      viewpointRequest={viewpointRequest}
      walking={walking}
      onWalkingChange={handleWalkingChange}
      selectedElementId={selectedElementId}
      onSelectElement={setSelectedElementId}
      hiddenElementIds={hiddenElementIds}
      onHoverElement={setHoveredElementId}
      onCanvasMenu={setCanvasMenu}
      focusRequest={focusRequest}
    />
  ) : null;

  const fileInputs = (
    <>
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
      <input
        ref={referenceModelInputRef}
        className="visually-hidden"
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        onChange={(event) => {
          pairReferenceModel(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </>
  );

  const emptyState = (
    <EmptyState recents={recents} error={phase === "error" ? error : null} onOpen={openPicker} />
  );

  const commentPanelProps = {
    comments: modelComments,
    visibleComments,
    commentFilter,
    activeCommentId,
    commentToolArmed,
    describeCommentTarget,
    onCommentFilter: setCommentFilter,
    onActiveComment: setActiveCommentId,
    onEditComment: (id: string, text: string) => updateModelComment(id, { text }),
    onResolveComment: resolveModelComment,
    onDeleteComment: deleteModelComment,
    onCommentViewpoint: requestCommentViewpoint,
    onArmComment: armCommentTool,
  };

  return (
    <main
      className="studio"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const dropped = event.dataTransfer.files[0];
        if (dropped) void processFile(dropped);
      }}
    >
      {fileInputs}

      {/* The phone layout brings its own 52px header; two of them stacked is
          what the old 760px breakpoint did, and is what this replaces. */}
      {!mobile && (
      <header className="titlebar">
        <div className="titlebar-brand">
          {/* The logo is a static asset, not a Next.js image route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.png" alt="" />
          <span>Reviter</span>
        </div>
        {result && (
          <>
            <span className="titlebar-divider" />
            <div className="file-chip">
              <FileBox size={14} aria-hidden />
              <b title={result.fileName}>{result.fileName}</b>
              <span>{fileMeta}</span>
            </div>
          </>
        )}
        <div className="titlebar-right">
          <span className="local-chip">
            <ShieldCheck size={12} aria-hidden />
            Local only
          </span>
          <button
            type="button"
            className="rv-icon-button bordered"
            title="Toggle theme"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          ><ThemeIcons size={15} /></button>
        </div>
      </header>
      )}

      {mobile ? (
        <MobileShell
          themeIcons={<ThemeIcons size={16} />}
          onTheme={toggleTheme}
          fileName={result?.fileName ?? "Reviter"}
          statusLine={busy ? `${Math.round(progress * 100)}% · ${statusText.toLowerCase()}` : statusText}
          viewport={
            <>
              {canvas}
              {result && (
                <MarkupOverlay
                  key={`${result.fileName}:${result.byteLength}`}
                  active={activeTool === "markup"}
                  tool={markupTool}
                  commentCount={modelComments.length}
                  onToolChange={setMarkupTool}
                  onDone={() => setActiveTool("orbit")}
                  onCancel={cancelMarkup}
                />
              )}
            </>
          }
          activeTool={activeTool}
          onTool={setActiveTool}
          sheet={sheet}
          onSheet={setSheet}
          selectedTitle={selectedTitle}
          selectedSubtitle={selectedSubtitle}
          hasSelection={Boolean(selectedRecord)}
          records={visibleModelRecords}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          properties={propertyRows}
          emptyNote={browserEmptyNote}
          metricCards={metricCards}
          checks={checks}
          emptyState={emptyState}
          modelOpen={Boolean(result)}
          {...commentPanelProps}
        />
      ) : (
        <>
          {result && (
            <ViewerToolbar
              sources={sources}
              geometrySource={geometrySource}
              onSource={selectGeometrySource}
              activeTool={activeTool}
              onTool={selectViewerTool}
              cameraPreset={cameraRequest.preset}
              onCameraPreset={requestCamera}
              renderMode={renderMode}
              onRenderMode={setRenderMode}
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              dockOpen={dockOpen}
              onLeft={() => setLeftOpen((open) => !open)}
              onRight={() => setRightOpen((open) => !open)}
              onDock={() => setDockOpen((open) => !open)}
              onOpen={openPicker}
              onCloseModel={closeModel}
            />
          )}

          <div className="workarea">
            {result && leftOpen && (
              <BrowserDock
                tab={browserTab}
                onTab={(tab) => {
                  setBrowserTab(tab);
                  setBrowserSearch("");
                }}
                objectCount={visibleModelRecords.length}
                categoryCount={visibleCategoryRows.length}
                commentCount={modelComments.length}
                search={browserSearch}
                onSearch={setBrowserSearch}
                records={visibleModelRecords}
                selectedElementId={selectedElementId}
                onSelect={setSelectedElementId}
                categories={visibleCategoryRows}
                emptyNote={browserEmptyNote}
                hiddenCategories={hiddenCategories}
                onToggleCategory={toggleCategory}
                onShowAllCategories={() => setHiddenCategories(new Set())}
                {...commentPanelProps}
              />
            )}

            <div className="stage">
              {result ? (
                <div className={`viewport ${renderMode === "technical" ? "shaded" : "xray"}`}>
                  {canvas}
                  <MarkupOverlay
                    key={`${result.fileName}:${result.byteLength}`}
                    active={activeTool === "markup"}
                    tool={markupTool}
                    commentCount={modelComments.length}
                    onToolChange={setMarkupTool}
                    onDone={() => setActiveTool("orbit")}
                    onCancel={cancelMarkup}
                  />

                  {selectedRecord && (
                    <button type="button" className="viewport-selection" onClick={() => setRightOpen(true)}>
                      <b>{selectedTitle}</b>
                      <span>{selectedSubtitle}</span>
                    </button>
                  )}

                  {commentToolArmed && (
                    <div className="comment-banner" role="status">
                      Click a surface to pin a comment
                      <button type="button" onClick={() => setActiveTool("orbit")}>Cancel</button>
                    </div>
                  )}

                  {hoveredRecord && hoveredRecord.elementId !== selectedElementId && (
                    <div className="hover-readout" aria-live="polite">
                      {hoveredRecord.categoryName ?? "Uncategorised"}
                      <span>{hoveredRecord.elementId}</span>
                    </div>
                  )}

                  {/* Legend and unit stamp are one row, so a long legend pushes
                      the stamp along instead of colliding with it. */}
                  <div className="viewport-footer">
                    <div className="viewport-legend">
                      {legend.map((entry) => (
                        <span key={entry.label}><i className={`legend-${entry.tone}`} />{entry.label}</span>
                      ))}
                      {geometrySource !== "reference-model" && (
                        <span><i className="legend-grid" />Grid</span>
                      )}
                    </div>
                    <span className="viewport-stamp">{stamp}</span>
                  </div>

                  {/* The right-click menu. A read-only viewer has no last
                      command to repeat and nothing to paste, so what survives
                      from a CAD context menu is four questions about the object
                      under the cursor and two about the view. */}
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
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setCanvasMenu(null);
                              setCameraRequest((current) => ({ ...current, sequence: current.sequence + 1, fit: true }));
                            }}
                          >Zoom extents</button>
                          <ToolButton
                            role="menuitem"
                            reason={selectedElementId == null ? "Nothing is picked" : null}
                            onClick={() => { setCanvasMenu(null); setSelectedElementId(null); }}
                          >Clear selection</ToolButton>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setCanvasMenu(null); requestZoomToSelection(); }}
                          >Zoom to object</button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setCanvasMenu(null);
                              void writeClipboardText(String(canvasMenu.elementId));
                            }}
                          >Copy object ID<em>{canvasMenu.elementId}</em></button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setCanvasMenu(null); setRightOpen(true); }}
                          >Show properties</button>
                          <ToolButton
                            role="menuitem"
                            reason={canvasMenuCategory ? null : "This object has no category row"}
                            onClick={() => {
                              setCanvasMenu(null);
                              if (canvasMenuCategory) toggleCategory(canvasMenuCategory);
                            }}
                          >Hide this category<em>{canvasMenuCategory}</em></ToolButton>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : emptyState}

              {result && dockOpen && (
                <ReportDock
                  tab={reportTab}
                  onTab={setReportTab}
                  onClose={() => setDockOpen(false)}
                  result={result}
                  comparison={comparison}
                  privateFileInfo={privateFileInfo}
                  metricCards={metricCards}
                  checks={checks}
                  fileRecord={fileRecord}
                  exports={exportActions}
                  exporting={exporting}
                  recoveredElementIds={recoveredElementIds}
                  drawnElementIds={displayedElementIds}
                  exportDisclaimer={exportDisclaimer}
                  onPairIfc={() => ifcInputRef.current?.click()}
                  onPairReferenceModel={() => referenceModelInputRef.current?.click()}
                  pairingStatus={referencePhase === "idle"
                    ? null
                    : `${referenceError ?? referenceMessage} · ${Math.round(referenceProgress * 100)}%`}
                  ifcPairingLabel={referencePhase === "reading"
                    ? "Analyzing IFC…"
                    : comparison ? "Choose another IFC" : "Pair IFC export"}
                  referenceModelLabel={referenceModelName
                    ? `Reference: ${referenceModelName}`
                    : "Pair reference model"}
                  onOpenFile={(selected) => { void processFile(selected); }}
                />
              )}
            </div>

            {result && rightOpen && (
              <PropertiesDock
                title={selectedTitle}
                subtitle={selectedSubtitle}
                rows={propertyRows}
                copyLabel={copyFeedback?.elementId === selectedRecord?.elementId
                  ? copyFeedback?.label ?? "Copy"
                  : "Copy"}
                evidenceOpen={evidenceOpen}
                evidenceSummary={evidenceSummary}
                evidenceRows={evidenceRows}
                onClose={() => setRightOpen(false)}
                onZoom={requestZoomToSelection}
                onCopy={() => { void copySelectedProperties(); }}
                onToggleEvidence={() => setEvidenceOpen((open) => !open)}
              />
            )}
          </div>

          <footer className="statusbar" aria-live="polite">
            <span>
              <span className={`status-dot ${statusTone}`} />
              <b>{statusText}</b>
            </span>
            {busy && (
              <span className="status-progress">
                <span><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></span>
                <em>{Math.round(progress * 100)}%</em>
              </span>
            )}
            <span className="stats">
              <span>{result ? `${formatNumber(result.stats.triangleCount)} triangles` : "—"}</span>
              <span>{result ? `${formatNumber(displayedElementIds.size)} drawn` : "—"}</span>
              <span>{stamp}</span>
            </span>
          </footer>
        </>
      )}
    </main>
  );
}
