"use client";

import { basicFileInfo, openFile, tryThumbnail, type FileInfo } from "@phi-ag/rvt";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileBox, Moon, ShieldCheck, Sun } from "lucide-react";

import {
  applyIfcReferenceRepairs,
  boundsDimensions,
  type Bounds3,
  connectedFloorPlanGroup,
  DEFAULT_CAMERA_PRESET,
  downloadBlob,
  deriveRoomsForLevels,
  floorPlateLevels,
  incompleteExpectedStairTopologyIds,
  makeDxf,
  makeGlb,
  makeIfcCenterlines,
  makeFloorPlateSvg,
  makeObj,
  makePlanSvg,
  makeReport,
  meshBoundsByElement,
  outputName,
  packMeshSurfaceOrientationSignatures,
  mergeRoomReview,
  reconcileRoomReview,
  parseBasicFileInfoProperties,
  revitVersionFromBasicFileInfo,
  STANDARDS_READER_RANGE_LABEL,
  standardsReaderSupports,
  type CameraPreset,
  type BasicFileInfoProperties,
  type ConvertOutcome,
  type ConvertResult,
  type DerivedRoomResult,
  type IfcWorkerRequest,
  type OrbitDragConvention,
  type PairedRegressionResult,
  type RenderMode,
  type RoomReviewState,
  type WorkerRequest,
} from "../lib/reviter";
import {
  WorkerClient,
  type WorkerClientOptions,
  type WorkerRequestEnvelope,
} from "../lib/reviter/worker-client.ts";

import { staticWorkerUrl } from "./studio/reference-model.ts";
import type { FloorRegionsRequest } from "./studio/floor-regions.worker.ts";
import {
  canvasMenuPosition,
  formatBytes,
  formatNumber,
  matchesFilter,
  propertyRowsFor,
  propertyClipboardText,
  savedFileName,
} from "./studio/format.ts";
import { BrowserDock } from "./studio/BrowserDock.tsx";
import { EmptyState } from "./studio/EmptyState.tsx";
import { MobileShell } from "./studio/MobileShell.tsx";
import { ModelCanvas } from "./studio/ModelCanvas.tsx";
import { FloorMiniMap } from "./studio/FloorMiniMap.tsx";
import { FloorWorkspace } from "./studio/FloorWorkspace.tsx";
import { loadModelComments, saveModelComments } from "./studio/model-comments.ts";
import { loadModelMarkup, saveModelMarkup } from "./studio/model-markup.ts";
import {
  assertSidecarMatchesModel,
  makeCommentsSidecar,
  makeMarkupSidecar,
  makeRoomReviewSidecar,
  mergeComments,
  mergeMarkup,
  parseReviewSidecar,
} from "./studio/review-exchange.ts";
import { loadRoomReview, saveRoomReview } from "./studio/room-review-storage.ts";
import { PropertiesDock, type EvidenceRow } from "./studio/PropertiesDock.tsx";
import { ToolButton } from "./studio/panels.tsx";
import {
  ReportDock,
  type ExportAction,
  type FileRecord,
  type ReportCheck,
} from "./studio/ReportDock.tsx";
import {
  clearRecentFiles,
  recentFilesServerSnapshot,
  recentFilesSnapshot,
  recordRecentFile,
  removeRecentFile,
  subscribeToRecentFiles,
  type RecentFile,
} from "./studio/recents.ts";
import { readOrbitDrag, writeOrbitDrag } from "./studio/viewer-preferences.ts";
import {
  cacheRecentModel,
  cacheRecentSource,
  clearCachedRecentModels,
  deleteCachedRecentModel,
  loadCachedRecentModel,
  type CachedRecentModel,
} from "./studio/recent-model-cache.ts";
import { ViewerToolbar, type SourceOption } from "./studio/ViewerToolbar.tsx";
import { WorkspaceSwitcher } from "./studio/WorkspaceSwitcher.tsx";
import { MarkupToolbar } from "./studio/MarkupToolbar.tsx";
import {
  isNavigationTool,
  navigationModeForTool,
  modelFeetToScenePoint,
  walkComparisonSourceForCode,
  type ActionTool,
  type MarkupEdit,
  type MarkupStroke,
  type MarkupTool,
  type ModelComment,
  type NavigationTool,
  type NewMarkupStroke,
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
  StudioWorkspace,
  WalkStartRequest,
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

/**
 * One worker client for the life of the studio. The client is cheap and holds
 * no worker until something is sent, so it is built on the first render and
 * torn down on unmount; `options` is read once, at that first build.
 */
function useWorkerClient<Request extends WorkerRequestEnvelope, Result>(
  options: () => WorkerClientOptions,
): WorkerClient<Request, Result> {
  // State rather than a ref: the instance has to be built exactly once and read
  // during render, which is what a lazy state initialiser is for. Nothing ever
  // sets it — the client is mutable on the inside and never re-renders anyone.
  const [client] = useState(() => new WorkerClient<Request, Result>(options()));
  return client;
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
  // How the camera is driven, and what a click does, are separate choices — so
  // a review can be conducted from inside the building rather than having to
  // leave first person to say anything about it.
  const [navTool, setNavTool] = useState<NavigationTool>("orbit");
  const [orbitDrag, setOrbitDrag] = useState<OrbitDragConvention>(readOrbitDrag);
  const changeOrbitDrag = useCallback((value: OrbitDragConvention) => {
    setOrbitDrag(value);
    writeOrbitDrag(value);
  }, []);
  const [actionTool, setActionTool] = useState<ActionTool | null>(null);
  const [markupTool, setMarkupTool] = useState<MarkupTool>("pencil");
  const [markupColor, setMarkupColor] = useState("#ef3f45");
  const [markupWeight, setMarkupWeight] = useState(4);
  const [markupText, setMarkupText] = useState("Note");
  const [markup, setMarkup] = useState<MarkupStroke[]>([]);
  const [markupUndo, setMarkupUndo] = useState<MarkupEdit[]>([]);
  const [markupRedo, setMarkupRedo] = useState<MarkupEdit[]>([]);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({
    preset: DEFAULT_CAMERA_PRESET,
    sequence: 0,
  });
  const [hoveredElementId, setHoveredElementId] = useState<number | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<string>>(new Set());
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuRequest | null>(null);
  const [walkStartRequest, setWalkStartRequest] = useState<WalkStartRequest>({
    point: null,
    normal: null,
    sequence: 0,
  });
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
  const [workspace, setWorkspace] = useState<StudioWorkspace>("model");
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
  const [planLevelId, setPlanLevelId] = useState<number | null>(null);
  const [floorSideMapOpen, setFloorSideMapOpen] = useState(false);
  const [isolateMapLevel, setIsolateMapLevel] = useState(false);
  const [storeyFocus, setStoreyFocus] = useState<{ boundsFeet: Bounds3 | null; sequence: number }>(
    { boundsFeet: null, sequence: 0 },
  );
  const [showDerivedRooms, setShowDerivedRooms] = useState(false);
  const [roomReview, setRoomReview] = useState<RoomReviewState>({ rooms: [], gaps: [] });
  const [reviewImportMessage, setReviewImportMessage] = useState<string | null>(null);

  const [referenceModelUrl, setReferenceModelUrl] = useState<string | null>(null);
  const [referenceModelName, setReferenceModelName] = useState<string | null>(null);
  const [referencePhase, setReferencePhase] = useState<ReferencePhase>("idle");
  const [referenceProgress, setReferenceProgress] = useState(0);
  const [referenceMessage, setReferenceMessage] = useState("Choose the matching IFC export");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<PairedRegressionResult | null>(null);
  const referenceAssistedResult = useMemo(
    () => result && comparison
      ? applyIfcReferenceRepairs(result, comparison.referenceMeshes, {
          completeRampAggregateElementIds:
            comparison.reference.completeRampAggregateElementIds,
          directRoofGeometryElementIds:
            comparison.reference.directRoofGeometryElementIds,
          directStairFlightGeometryElementIds:
            comparison.reference.directStairFlightGeometryElementIds,
          shapeDifferentElementIds:
            comparison.reference.geometricShapeDifferentElementIds,
        })
      : null,
    [comparison, result],
  );

  const navigationMode = navigationModeForTool(navTool);
  const walking = navTool === "firstPerson";
  const handleWalkingChange = useCallback((enabled: boolean) => {
    setNavTool(enabled ? "firstPerson" : "orbit");
  }, []);

  const rvtClient = useWorkerClient<WorkerRequest, ConvertOutcome>(() => ({
    spawn: () => new Worker(
      staticWorkerUrl("rvt") ?? new URL("../lib/reviter/worker.ts", import.meta.url),
      { type: "module" },
    ),
    startFailureMessage: "The conversion worker could not be prepared.",
    deathMessage: "The local conversion worker stopped unexpectedly.",
    unreadableMessage: "The local conversion worker returned an unreadable result.",
    // One model is being opened at a time. A conversion the user has moved on
    // from is retired here rather than at each place that reads its reply.
    latestOnly: true,
  }));
  const ifcClient = useWorkerClient<IfcWorkerRequest, PairedRegressionResult>(() => ({
    spawn: () => new Worker(
      staticWorkerUrl("ifc") ?? new URL("../lib/reviter/ifc-worker.ts", import.meta.url),
      { type: "module" },
    ),
    startFailureMessage: "The local IFC worker could not be started.",
    deathMessage: "The local IFC worker stopped unexpectedly.",
    unreadableMessage: "The local IFC worker returned an unreadable result.",
    // One pairing at a time, measured against the model on screen.
    latestOnly: true,
  }));
  const floorRegionClient = useWorkerClient<FloorRegionsRequest, DerivedRoomResult>(() => ({
    spawn: () => new Worker(
      staticWorkerUrl("regions") ?? new URL("./studio/floor-regions.worker.ts", import.meta.url),
      { type: "module" },
    ),
    startFailureMessage: "This browser blocked the room worker.",
    deathMessage: "The room worker stopped unexpectedly.",
    // Only the floor on screen is worth deriving. An earlier floor's answer is
    // dropped rather than applied, and rapid switching no longer leaves a queue
    // of derivations whose results all land in turn.
    latestOnly: true,
  }));
  const floorRegionCacheRef = useRef(new Map<number, DerivedRoomResult>());
  const requestIdRef = useRef(0);
  const referenceRequestIdRef = useRef(0);
  // IndexedDB reads are asynchronous, so React may not have rendered the busy
  // phase before a double-click arrives. This ref closes that small window.
  const recentOpenInProgressRef = useRef(false);
  const recentOpenAttemptRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ifcInputRef = useRef<HTMLInputElement>(null);
  const referenceModelInputRef = useRef<HTMLInputElement>(null);
  const reviewInputRef = useRef<HTMLInputElement>(null);
  const canvasMenuRef = useRef<HTMLDivElement>(null);

  // Tear the workers down when the studio unmounts, and only then. This was
  // keyed on the thumbnail, so opening a second file — which sets a new
  // thumbnail — terminated the worker that was about to convert it, left the
  // dead worker in place to be handed back to the next conversion, and hung the
  // progress bar at 8% with no error and no timeout.
  useEffect(() => () => {
    rvtClient.terminate();
    ifcClient.terminate();
    floorRegionClient.terminate();
  }, [floorRegionClient, ifcClient, rvtClient]);

  // The object URL outlives a render, so it is released when the studio goes
  // away rather than leaking the file for the life of the tab.
  useEffect(() => () => {
    if (referenceModelUrl) URL.revokeObjectURL(referenceModelUrl);
  }, [referenceModelUrl]);

  /**
   * Retire the conversion in flight and open a new attempt.
   *
   * The id is what tells the asynchronous file reads below whether they are
   * still working for the attempt that started them; the client drops the
   * worker's reply for the retired one. Both retirements happen here so they
   * cannot drift apart — the conversion itself keeps running inside the worker
   * either way, and only its answer is discarded.
   */
  const beginConversionAttempt = useCallback(() => {
    rvtClient.cancel();
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, [rvtClient]);

  /**
   * Retire the IFC pairing in flight and open a new attempt.
   *
   * A pairing is measured against one model, so opening another or closing this
   * one has to retire it: its late result would otherwise be applied to the
   * model now on screen, and `referenceAssistedResult` would graft the previous
   * file's reference meshes onto it wherever the element ids collide. The
   * client drops the worker's reply; the id retires the file read that would
   * have posted one.
   */
  const retireReferencePairing = useCallback(() => {
    ifcClient.cancel();
    referenceRequestIdRef.current += 1;
    return referenceRequestIdRef.current;
  }, [ifcClient]);

  const rememberFile = useCallback((
    name: string,
    size: number,
    lastModified: number,
    revitVersion: string | null,
    status: RecentFile["status"],
  ) => {
    recordRecentFile({
      name,
      size,
      lastModified,
      revitVersion,
      openedAt: Date.now(),
      status,
    });
  }, []);

  // --- Opening a file ----------------------------------------------------

  const processFile = useCallback(async (
    nextFile: File,
    knownCache?: CachedRecentModel | null,
  ) => {
    // A picker/drop is an intentional replacement. Invalidate a pending
    // IndexedDB lookup so it cannot finish later and replace the newer file.
    if (knownCache === undefined) {
      recentOpenAttemptRef.current += 1;
      recentOpenInProgressRef.current = false;
    }
    if (!/\.(rvt|rfa|rte|rft)$/i.test(nextFile.name)) {
      recentOpenInProgressRef.current = false;
      setError("Choose a Revit .rvt, .rfa, .rte, or .rft file.");
      setPhase("error");
      return;
    }
    if (!nextFile.size) {
      recentOpenInProgressRef.current = false;
      setError("The selected file is empty.");
      setPhase("error");
      return;
    }

    const requestId = beginConversionAttempt();
    // An IFC pairing still in flight was measured against the outgoing model.
    retireReferencePairing();
    setFile(nextFile);
    setResult(null);
    setPlanLevelId(null);
    setComparison(null);
    setGeometrySource("recovered");
    setRenderMode("technical");
    setNavTool("orbit");
    setActionTool(null);
    setMarkupTool("pencil");
    setModelComments([]);
    setMarkup([]);
    setMarkupUndo([]);
    setMarkupRedo([]);
    setActiveCommentId(null);
    setCommentFilter("open");
    setCameraRequest({ preset: DEFAULT_CAMERA_PRESET, sequence: requestId, fit: false });
    setSelectedElementId(null);
    setHiddenCategories(new Set());
    setBrowserTab("objects");
    setBrowserSearch("");
    setCanvasMenu(null);
    setWalkStartRequest({ point: null, normal: null, sequence: requestId });
    setDockOpen(false);
    setWorkspace("model");
    setFloorSideMapOpen(false);
    setIsolateMapLevel(false);
    setShowDerivedRooms(false);
    setSheet(null);
    setReferencePhase("idle");
    setReferenceError(null);
    setMetadata(null);
    setPrivateFileInfo(null);
    setError(null);
    setReviewImportMessage(null);
    setProgress(0.03);
    setPhase("reading");

    try {
      const cached = knownCache ?? await loadCachedRecentModel({
        name: nextFile.name,
        size: nextFile.size,
        lastModified: nextFile.lastModified,
      });
      const cfb = await openFile(nextFile);
      // Start the only full-file read and boot the conversion worker as soon as
      // the container directory is known to be valid. Metadata and the embedded
      // preview are small, independent CFB reads, so doing them while the file
      // buffer is prepared removes an avoidable serial wait — especially for a
      // cloud-backed File whose bytes are not warm on disk yet.
      const bufferPromise = cached?.result ? null : nextFile.arrayBuffer();
      const workerStarted = cached?.result ? false : rvtClient.start();
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
      const [info, preview, basicData, buffer] = await Promise.all([
        infoPromise,
        tryThumbnail(cfb),
        basicDataPromise,
        bufferPromise,
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

      const acceptResult = (converted: ConvertResult) => {
        recentOpenInProgressRef.current = false;
        setResult(converted);
        setPlanLevelId(
          converted.levels.find(
            (level) => level.levelId != null && level.elevation >= -0.01,
          )?.levelId
            ?? converted.levels.find((level) => level.levelId != null)?.levelId
            ?? null,
        );
        setModelComments(loadModelComments(converted));
        setMarkup(loadModelMarkup(converted));
        // Reviter's own recovery is what opening a model shows. Nothing about
        // the file — not its name, not its document id — switches the viewer to
        // a different converter's output behind the user's back.
        setGeometrySource("recovered");
        setProgress(1);
        setPhase("ready");
        rememberFile(
          nextFile.name,
          nextFile.size,
          nextFile.lastModified,
          info.version,
          converted.stats.candidatesUsed >= converted.elementBounds.length ? "ready" : "partial",
        );
      };

      if (cached?.result) {
        acceptResult(cached.result);
        return;
      }

      setPhase("converting");
      setProgress(0.08);

      const fail = (message: string) => {
        recentOpenInProgressRef.current = false;
        setError(message);
        setPhase("error");
        rememberFile(
          nextFile.name,
          nextFile.size,
          nextFile.lastModified,
          info.version,
          "partial",
        );
        void cacheRecentSource(nextFile);
      };
      if (!workerStarted || !buffer) {
        throw new Error("The conversion worker could not be prepared.");
      }
      rvtClient.send({
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
      }, {
        onProgress: (progress) => setProgress(progress.ratio),
        onResult: (outcome) => {
          if (!outcome.ok) {
            fail(outcome.error);
            return;
          }
          acceptResult(outcome);
          // IndexedDB failures (private mode, eviction, quota) must not turn a
          // successful conversion into an application error.
          void cacheRecentModel(nextFile, outcome);
        },
        onError: fail,
      }, [buffer]);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      recentOpenInProgressRef.current = false;
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("error");
    }
  }, [beginConversionAttempt, rememberFile, retireReferencePairing, rvtClient]);

  const closeModel = useCallback(() => {
    recentOpenAttemptRef.current += 1;
    recentOpenInProgressRef.current = false;
    beginConversionAttempt();
    // Closing is as much a replacement as opening. Without this an IFC pairing
    // that resolves after the close reinstates a comparison — and a
    // "reference-assisted" geometry source — for a model that is no longer here.
    retireReferencePairing();
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
    setMarkup([]);
    setMarkupUndo([]);
    setMarkupRedo([]);
    setActiveCommentId(null);
    setSelectedElementId(null);
    setHiddenCategories(new Set());
    setCanvasMenu(null);
    setWalkStartRequest((current) => ({ point: null, normal: null, sequence: current.sequence + 1 }));
    setDockOpen(false);
    setWorkspace("model");
    setFloorSideMapOpen(false);
    setShowDerivedRooms(false);
    setSheet(null);
    setError(null);
    setReviewImportMessage(null);
    setPhase("idle");
    setProgress(0);
  }, [beginConversionAttempt, retireReferencePairing]);

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
    const requestId = retireReferencePairing();
    setComparison(null);
    setReferenceError(null);
    setReferencePhase("reading");
    setReferenceProgress(0.02);
    setReferenceMessage("Reading IFC reference in this browser");
    try {
      const buffer = await referenceFile.arrayBuffer();
      const packedDisplayBounds: number[] = [];
      for (const [elementId, bounds] of meshBoundsByElement(result.meshes, result.origin)) {
        if (!bounds.every(Number.isFinite)) continue;
        packedDisplayBounds.push(elementId, ...bounds);
      }
      const displayBounds = Float64Array.from(packedDisplayBounds);
      const surfaceOrientationSignatures = packMeshSurfaceOrientationSignatures(result.meshes);
      const incompleteStairTopologyIds = incompleteExpectedStairTopologyIds(result);
      ifcClient.send({
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
          surfaceOrientationSignatures,
          incompleteStairTopologyIds,
        },
      }, {
        onProgress: (progress) => {
          setReferenceProgress(progress.ratio);
          setReferenceMessage(progress.message);
        },
        onResult: (paired) => {
          setComparison(paired);
          setGeometrySource("reference-assisted");
          setReferenceProgress(1);
          setReferenceMessage("Paired regression complete");
          setReferencePhase("ready");
        },
        onError: (message) => {
          setReferenceError(message);
          setReferencePhase("error");
        },
      }, [
        buffer,
        displayBounds.buffer as ArrayBuffer,
        surfaceOrientationSignatures.buffer as ArrayBuffer,
        incompleteStairTopologyIds.buffer as ArrayBuffer,
      ]);
    } catch (caught) {
      if (requestId !== referenceRequestIdRef.current) return;
      setReferenceError(caught instanceof Error ? caught.message : String(caught));
      setReferencePhase("error");
    }
  }, [ifcClient, result, retireReferencePairing]);

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

  // Mesh batches can also name internal geometry carriers that do not have an
  // element record of their own. They are useful provenance, but they are not
  // selectable model objects and must not inflate the UI's "drawn" count.
  const meshElementIds = useMemo(() => {
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
    () => result ? result.elementBounds.filter((record) => meshElementIds.has(record.elementId)) : [],
    [meshElementIds, result],
  );
  const displayedElementIds = useMemo(
    () => new Set(solidRecords.map((record) => record.elementId)),
    [solidRecords],
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
    if (!result) return new Set<number>();
    const hidden = new Set<number>();
    for (const record of result.elementBounds) {
      if (hiddenCategories.has(record.categoryName ?? "Uncategorised")) hidden.add(record.elementId);
    }
    if (isolateMapLevel && planLevelId != null) {
      // Isolate the storey the map is drawing, not the one Revit level it is
      // keyed on: on a split level those are different, and isolating the key
      // level alone hid the wings the plan itself shows.
      const group = connectedFloorPlanGroup(result, planLevelId);
      const storey = new Set(group?.levelIds ?? [planLevelId]);
      const visible = new Set((result.nativeAssociatedLevelRelations ?? [])
        .filter((relation) => storey.has(relation.levelId))
        .map((relation) => relation.elementId));
      const associated = new Set((result.nativeAssociatedLevelRelations ?? [])
        .map((relation) => relation.elementId));
      // A level relation is the best evidence of which storey something is on,
      // but the model does not always carry one: on the sample 3,171 elements
      // have none, including the building's largest floor slab and nearly every
      // stair and railing part. Isolating on relations alone therefore removed
      // the floor from under the walls. Where there is no relation to go on,
      // fall back to where the element actually sits.
      const floor = (group?.minElevation ?? Number.NaN) - 2;
      const head = (group?.maxElevation ?? Number.NaN) + 14;
      const placeable = Number.isFinite(floor) && Number.isFinite(head);
      for (const record of result.elementBounds) {
        if (visible.has(record.elementId)) continue;
        if (!associated.has(record.elementId) && placeable) {
          // Judge by the base, the way a storey is assigned: a tall unassociated
          // element belongs to the floor it stands on, not to every floor it
          // passes through.
          const base = record.boundsFeet.min.z;
          if (base >= floor && base <= head) continue;
        }
        hidden.add(record.elementId);
      }
    }
    return hidden;
  }, [hiddenCategories, isolateMapLevel, planLevelId, result]);

  const activeGeometryResult = geometrySource === "reference-assisted"
    ? referenceAssistedResult ?? result
    : result;
  const selectedRecord = useMemo(
    () => selectedElementId == null
      ? null
      : activeGeometryResult?.elementBounds.find((record) => record.elementId === selectedElementId) ?? null,
    [activeGeometryResult, selectedElementId],
  );
  const hoveredRecord = useMemo(
    () => hoveredElementId == null
      ? null
      : activeGeometryResult?.elementBounds.find((record) => record.elementId === hoveredElementId) ?? null,
    [activeGeometryResult, hoveredElementId],
  );
  const selectedDimensions = selectedRecord ? boundsDimensions(selectedRecord.boundsFeet) : null;

  /**
   * The properties palette.
   *
   * Category, type and id lead, because that is what a CAD palette answers
   * first; the recovery's own evidence follows, because in this viewer it is a
   * property of the object rather than a footnote about the file.
   */
  const propertyRows: PropertyRow[] = useMemo(
    () => propertyRowsFor(selectedRecord, selectedDimensions),
    [selectedDimensions, selectedRecord],
  );

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
    // Object framing is an Orbit action. Leaving Walk explicitly makes a new
    // request distinguishable from the stale focus request retained only for
    // cross-source comparison.
    setNavTool("orbit");
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

  const commentToolArmed = actionTool === "comment";

  /** Open the panel the Comment tool writes into, wherever that panel lives. */
  const revealComments = useCallback(() => {
    if (mobile) setSheet("comments");
    else {
      setBrowserTab("comments");
      setLeftOpen(true);
    }
  }, [mobile]);

  const armCommentTool = useCallback(() => {
    setActionTool((current) => current === "comment" ? null : "comment");
    revealComments();
  }, [revealComments]);

  /**
   * A tool click.
   *
   * Navigation replaces navigation; an action toggles and leaves the camera
   * alone. Walking through a building and pinning comments as you go is one
   * activity, not two that take turns.
   */
  const selectViewerTool = useCallback((tool: ViewerTool) => {
    if (isNavigationTool(tool)) {
      setNavTool(tool);
      return;
    }
    setActionTool((current) => current === tool ? null : tool);
    if (tool === "comment") revealComments();
  }, [revealComments]);

  // --- Markup ------------------------------------------------------------

  const commitMarkup = useCallback((update: (current: MarkupStroke[]) => MarkupStroke[]) => {
    setMarkup((current) => {
      const next = update(current);
      if (result) saveModelMarkup(result, next);
      return next;
    });
  }, [result]);

  /**
   * Undo walks a log of edits, not a stack of strokes.
   *
   * Holding "what to put back" in one list made Undo mean two different things:
   * after erasing the last stroke there was nothing left to pop, so Undo went
   * grey and the only way back was Redo — which is not what anyone reaches for
   * having just deleted something by mistake.
   */
  const applyMarkupEdit = useCallback((edit: MarkupEdit, invert: boolean) => {
    commitMarkup((current) => {
      const removing = invert ? edit.kind === "add" : edit.kind !== "add";
      if (edit.kind === "clear") return removing ? [] : [...edit.strokes];
      if (removing) return current.filter((stroke) => stroke.id !== edit.stroke.id);
      const next = [...current];
      next.splice(Math.min(edit.index, next.length), 0, edit.stroke);
      return next;
    });
  }, [commitMarkup]);

  const pushMarkupEdit = useCallback((edit: MarkupEdit) => {
    setMarkupUndo((current) => [...current, edit]);
    // A fresh edit invalidates anything that was waiting to be redone.
    setMarkupRedo([]);
  }, []);

  const createMarkupStroke = useCallback((stroke: NewMarkupStroke) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `markup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created: MarkupStroke = { ...stroke, id, createdAt: new Date().toISOString() };
    let index = 0;
    commitMarkup((current) => {
      index = current.length;
      return [...current, created];
    });
    pushMarkupEdit({ kind: "add", stroke: created, index });
  }, [commitMarkup, pushMarkupEdit]);

  const deleteMarkupStroke = useCallback((id: string) => {
    setMarkup((current) => {
      const index = current.findIndex((stroke) => stroke.id === id);
      if (index < 0) return current;
      pushMarkupEdit({ kind: "delete", stroke: current[index]!, index });
      const next = current.filter((stroke) => stroke.id !== id);
      if (result) saveModelMarkup(result, next);
      return next;
    });
  }, [pushMarkupEdit, result]);

  const undoMarkup = useCallback(() => {
    setMarkupUndo((current) => {
      const last = current.at(-1);
      if (!last) return current;
      applyMarkupEdit(last, true);
      setMarkupRedo((redo) => [...redo, last]);
      return current.slice(0, -1);
    });
  }, [applyMarkupEdit]);

  const redoMarkup = useCallback(() => {
    setMarkupRedo((current) => {
      const last = current.at(-1);
      if (!last) return current;
      applyMarkupEdit(last, false);
      setMarkupUndo((undo) => [...undo, last]);
      return current.slice(0, -1);
    });
  }, [applyMarkupEdit]);

  const clearMarkup = useCallback(() => {
    setMarkup((current) => {
      if (!current.length) return current;
      pushMarkupEdit({ kind: "clear", strokes: current, index: 0 });
      if (result) saveModelMarkup(result, []);
      return [];
    });
  }, [pushMarkupEdit, result]);

  const markupSettings = useMemo(() => ({
    tool: actionTool === "markup" ? markupTool : null,
    color: markupColor,
    weight: markupWeight,
    text: markupText,
  }), [actionTool, markupColor, markupText, markupTool, markupWeight]);

  const importReviewFile = useCallback(async (reviewFile: File) => {
    if (!result) {
      setReviewImportMessage("Open the matching Revit source file before importing review data.");
      return;
    }
    try {
      const sidecar = parseReviewSidecar(await reviewFile.text());
      assertSidecarMatchesModel(sidecar, result);
      // Canonical anchors are in the RVT's model feet, so reveal the recovery
      // rather than leaving an imported review hidden on an unrelated source.
      setGeometrySource("recovered");
      if (sidecar.format === "reviter-comments") {
        setModelComments((current) => {
          const next = mergeComments(current, sidecar.comments);
          saveModelComments(result, next);
          return next;
        });
        setActiveCommentId(null);
        setCommentFilter("all");
        setBrowserTab("comments");
        setLeftOpen(true);
        setReviewImportMessage(
          `Imported ${sidecar.comments.length} comment${sidecar.comments.length === 1 ? "" : "s"} from ${reviewFile.name}.`,
        );
      } else if (sidecar.format === "reviter-markup") {
        setMarkup((current) => {
          const next = mergeMarkup(current, sidecar.markup);
          saveModelMarkup(result, next);
          return next;
        });
        setMarkupUndo([]);
        setMarkupRedo([]);
        setReviewImportMessage(
          `Imported ${sidecar.markup.length} markup stroke${sidecar.markup.length === 1 ? "" : "s"} from ${reviewFile.name}.`,
        );
      } else {
        setRoomReview((current) => {
          const next = mergeRoomReview(current, { rooms: sidecar.rooms, gaps: sidecar.gaps });
          saveRoomReview(result, next);
          return next;
        });
        setShowDerivedRooms(true);
        setWorkspace("floors");
        setReviewImportMessage(
          `Imported ${sidecar.rooms.length} room review${sidecar.rooms.length === 1 ? "" : "s"} and ${sidecar.gaps.length} gap decision${sidecar.gaps.length === 1 ? "" : "s"} from ${reviewFile.name}.`,
        );
      }
    } catch (caught) {
      setReviewImportMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [result]);

  // The canvas menu closes on the next press anywhere outside it, or on Escape.
  // Containment is tested rather than relying on the press not reaching the
  // window, because a press on a menu item would otherwise unmount the button
  // before its own click could fire.
  useEffect(() => {
    if (!canvasMenu) return;
    // Shift+F10 raises this menu over the viewport, so its commands are only
    // reachable if focus follows it in and comes back to the viewport after.
    const opener = document.activeElement as HTMLElement | null;
    canvasMenuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
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
      // The menu is already off the page here, so focus has fallen to the body
      // unless one of its commands moved it somewhere deliberate.
      if (document.activeElement === document.body && opener?.isConnected) opener.focus();
    };
  }, [canvasMenu]);

  // --- Reporting ---------------------------------------------------------

  const versionNumber = Number(metadata?.version ?? 0);
  // Not "future": a release the optional standards-aware reader declines. The
  // check reads both ends of its range so a legacy file is described the same
  // way rather than silently falling through as if it were supported.
  const isBeyondStandardsReader = versionNumber > 0 && !standardsReaderSupports(versionNumber);
  const referenceModelAvailable = Boolean(referenceModelUrl);
  /**
   * How many objects the file holds.
   *
   * The ownership records name every element the decoder saw, which is the only
   * count that can legitimately exceed the recovery. `elementIndex` is the
   * element *table* — a partial index, and on this building an eighth of the
   * ownership count, so reading it as "objects in file" put a smaller number
   * above a larger "recovered" beside it.
   */
  const objectsInFile = result
    ? result.decoderCoverage.nativeUniqueIds
      || result.elementIndex?.uniqueElementIds.length
      || result.stats.candidatesFound
    : 0;

  const metricCards = useMemo(() => result ? [
    { label: "Objects in file", value: formatNumber(objectsInFile) },
    { label: "Recovered", value: formatNumber(recoveredElementIds.size) },
    { label: "Drawn", value: formatNumber(displayedElementIds.size) },
    { label: "Read time", value: `${(result.stats.durationMs / 1_000).toFixed(1)} s` },
  ] : [], [displayedElementIds, objectsInFile, recoveredElementIds, result]);

  const [derivedFloorRooms, setDerivedFloorRooms] = useState<DerivedRoomResult | null>(null);
  useEffect(() => {
    queueMicrotask(() => setRoomReview(result ? loadRoomReview(result) : { rooms: [], gaps: [] }));
  }, [result]);
  useEffect(() => {
    floorRegionCacheRef.current.clear();
    queueMicrotask(() => setDerivedFloorRooms(null));
  }, [result]);
  useEffect(() => {
    if (!result || planLevelId == null || !showDerivedRooms) {
      queueMicrotask(() => setDerivedFloorRooms(null));
      return;
    }
    const cached = floorRegionCacheRef.current.get(planLevelId);
    if (cached) { queueMicrotask(() => setDerivedFloorRooms(cached)); return; }
    const analysisLevelIds = connectedFloorPlanGroup(result, planLevelId)?.levelIds ?? [planLevelId];
    // The cache is read by the level the plan is showing, but a derivation
    // covers the whole connected group and reports the group's *lowest* level
    // as its own `levelId`. Filing it under that reported id left every upper
    // member of a split-level group unable to find its entry, re-deriving the
    // identical group analysis on each revisit. Write the requested key first —
    // the one the read above uses — then the rest of the group, which the same
    // analysis equally answers for. Membership only changes when `result` does,
    // and that clears the cache.
    const cacheDerived = (derived: DerivedRoomResult) => {
      floorRegionCacheRef.current.set(planLevelId, derived);
      for (const levelId of analysisLevelIds) floorRegionCacheRef.current.set(levelId, derived);
    };
    const accept = (derived: DerivedRoomResult) => {
      cacheDerived(derived);
      setDerivedFloorRooms(derived);
    };
    const categories = new Set([-2_000_032, -2_000_011, -2_000_170, -2_000_171]);
    const compactResult = {
      levels: result.levels,
      nativeAssociatedLevelRelations: result.nativeAssociatedLevelRelations,
      elementBounds: result.elementBounds.filter((record) => categories.has(record.categoryId ?? 0)).map((record) => ({
        elementId: record.elementId,
        stream: record.stream,
        chunkIndex: record.chunkIndex,
        rawOffset: record.rawOffset,
        recordOffset: record.recordOffset,
        categoryId: record.categoryId,
        boundsFeet: record.boundsFeet,
        loops: record.loops,
        solid: record.solid,
        solids: record.solids,
        arcs: record.arcs,
        orientedBox: record.orientedBox,
      })),
    } as ConvertResult;
    floorRegionClient.send(
      { type: "floor-regions", levelIds: analysisLevelIds, result: compactResult },
      {
        onResult: accept,
        onError: (message) => {
          // A strict fallback keeps the feature available if a browser blocks
          // module workers, and is the retry for a derivation the worker could
          // not finish. It costs the pause the worker exists to avoid, so the
          // reason is reported rather than swallowed.
          accept(deriveRoomsForLevels(result, analysisLevelIds));
          setReviewImportMessage(`Room worker fallback: ${message}`);
        },
      },
    );
    // Leaving this floor retires the derivation with it. The work already
    // running in the worker cannot be stopped, but its answer no longer arrives
    // for a floor that is no longer on screen.
    return () => floorRegionClient.cancel();
  }, [floorRegionClient, planLevelId, result, showDerivedRooms]);
  useEffect(() => {
    if (!derivedFloorRooms || !result) return;
    queueMicrotask(() => setRoomReview((current) => {
        const next = reconcileRoomReview(current, derivedFloorRooms);
        saveRoomReview(result, next);
        return next;
      }));
  }, [derivedFloorRooms, result]);
  const selectedMapPoint = selectedRecord
    ? [
        (selectedRecord.boundsFeet.min.x + selectedRecord.boundsFeet.max.x) / 2,
        (selectedRecord.boundsFeet.min.y + selectedRecord.boundsFeet.max.y) / 2,
      ] as [number, number]
    : null;
  const walkFromMap = useCallback((point: [number, number], elevation: number) => {
    if (!result) return;
    const scenePoint = modelFeetToScenePoint(
      [point[0], point[1], elevation],
      "recovered",
      [result.origin.x, result.origin.y, result.origin.z],
    );
    if (!scenePoint) return;
    setGeometrySource("recovered");
    setWalkStartRequest((current) => ({
      point: scenePoint,
      normal: [0, 0, 1],
      sequence: current.sequence + 1,
    }));
    setNavTool("firstPerson");
  }, [result]);

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
        // The decoder already grades its own output; saying "element envelopes"
        // over a certified native BREP understates what was actually read.
        label: "Geometry",
        value: geometrySource === "reference-model"
          ? "Paired reference model"
          : result.decoderCoverage.geometryFidelity.replaceAll("-", " "),
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
          ? `${comparison.reference.matchedElementCount.toLocaleString()} matched · ${comparison.status}${
            comparison.reference.geometricShapeDifferentElementCount
              ? ` · ${comparison.reference.geometricShapeDifferentElementCount.toLocaleString()} shape/topology differences`
              : ""
          }`
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
      {
        label: "Object bounds",
        value: result ? result.decoderCoverage.geometryFidelity.replaceAll("-", " ") : "Not evaluated",
        tone: result ? "warn" : "off",
      },
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
    const geometryResult = referenceAssistedResult ?? result;
    return [
      {
        id: "GLB",
        format: "GLB",
        detail: "3D scene",
        run: () => {
          setExporting("GLB");
          try {
            downloadBlob(new Blob([makeGlb(geometryResult)], { type: "model/gltf-binary" }), outputName(result.fileName, "glb"));
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setExporting(null);
          }
        },
      },
      { id: "OBJ", format: "OBJ", detail: "Mesh", run: () => exportText("OBJ", "obj", () => makeObj(geometryResult)) },
      { id: "DXF", format: "DXF", detail: "3D lines", run: () => exportText("DXF", "dxf", () => makeDxf(geometryResult)) },
      {
        id: "SVG",
        format: "SVG",
        detail: "All-level projection",
        run: () => exportText("SVG", "svg", () => makePlanSvg(geometryResult), "image/svg+xml"),
      },
      ...(planLevelId == null
        ? []
        : [{
            id: "FLOOR_SVG",
            format: "Level plan SVG",
            detail: `Revit level ${planLevelId}`,
            run: () => exportText(
              "FLOOR_SVG",
              `level-${planLevelId}.svg`,
              () => makePlanSvg(geometryResult, { levelId: planLevelId }),
              "image/svg+xml",
            ),
          }]),
      ...(planLevelId == null
        ? []
        : [{
            id: "FLOOR_PLATES_SVG",
            format: "Floor plates SVG",
            detail: `Actual Floors · level ${planLevelId}`,
            run: () => exportText(
              "FLOOR_PLATES_SVG",
              `floor-plates-${planLevelId}.svg`,
              () => makeFloorPlateSvg(geometryResult, planLevelId),
              "image/svg+xml",
            ),
          }]),
      {
        id: "IFC",
        format: "IFC",
        detail: referenceAssistedResult
          ? `IFC4 · ${referenceAssistedResult.referenceAssistedElementIds?.length.toLocaleString()} paired repairs`
          : `IFC4 · elements, storeys, materials · ${roomReview.rooms.filter((room) => room.disposition === "accepted" && room.ifc.export).length} reviewed spaces`,
        run: () => exportText("IFC", "ifc", () => makeIfcCenterlines(geometryResult, { rooms: roomReview.rooms }), "application/x-step"),
      },
      {
        id: "JSON",
        format: "JSON",
        detail: "Audit log",
        run: () => exportText(
          "JSON",
          "json",
          () => makeReport(geometryResult, metadata as unknown as Record<string, unknown>),
          "application/json",
        ),
      },
      {
        id: "COMMENTS",
        format: "Comments",
        detail: `${modelComments.length} pinned · portable JSON`,
        run: () => exportText(
          "COMMENTS",
          "comments.reviter.json",
          () => makeCommentsSidecar(result, modelComments),
          "application/vnd.reviter.comments+json",
        ),
      },
      {
        id: "ROOMS",
        format: "Rooms",
        detail: `${roomReview.rooms.filter((room) => room.disposition === "accepted").length} accepted · ${roomReview.gaps.filter((gap) => gap.disposition !== "unreviewed").length} gap decisions · portable JSON`,
        run: () => exportText(
          "ROOMS",
          "rooms.reviter.json",
          () => makeRoomReviewSidecar(result, roomReview),
          "application/vnd.reviter.rooms+json",
        ),
      },
      {
        id: "MARKUP",
        format: "Markup",
        detail: `${markup.length} stroke${markup.length === 1 ? "" : "s"} · portable JSON`,
        run: () => exportText(
          "MARKUP",
          "markup.reviter.json",
          () => makeMarkupSidecar(result, markup),
          "application/vnd.reviter.markup+json",
        ),
      },
    ];
  }, [exportText, markup, metadata, modelComments, planLevelId, referenceAssistedResult, result, roomReview]);

  const exportDisclaimer = result
    ? `Exports preserve ${
      result.method === "native-profile-recovery"
        ? "native ArcWall centerlines with explicitly approximate solids"
        : result.method === "partition-bounds-recovery"
          ? "native-ID element envelopes"
          : "the recovered geometry"
    }. The audit records ${result.decoderCoverage.nativeMaterialDefinitions.toLocaleString()} decoded material definitions and ${result.decoderCoverage.nativeMaterialAssignments.toLocaleString()} proven assignments; textures and openings remain unavailable. Comments and markup export as separate review sidecars and can be imported after opening the matching source model.`
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
      : "Click to choose the matching IFC export";
  const sources = useMemo<SourceOption[]>(() => [
    { id: "recovered", label: "RVT", reason: null, shortcut: "1", title: "Geometry rebuilt from the RVT file" },
    {
      id: "reference-assisted",
      label: "RVT + IFC",
      reason: ifcReason,
      title: "RVT identity, semantics and materials with geometrically different bodies repaired from the tagged IFC",
      missingAction: referencePhase === "reading" ? undefined : "ifc",
    },
    {
      id: "reference",
      label: ifcReason ? "Add IFC" : "IFC",
      reason: ifcReason,
      shortcut: "2",
      title: "The paired IFC export on its own",
      missingAction: referencePhase === "reading" ? undefined : "ifc",
    },
    {
      id: "overlay",
      label: "Overlay",
      reason: ifcReason,
      title: "Recovered model over the paired export: aligned IFC geometry is ghosted and geometric differences are red",
      missingAction: referencePhase === "reading" ? undefined : "ifc",
    },
    {
      id: "reference-model",
      label: referenceModelAvailable ? "Autodesk GLB" : "Add GLB",
      shortcut: "3",
      reason: referenceModelAvailable
        ? null
        : "Click to choose a GLB or glTF of the same building",
      title: referenceModelName ? `Paired reference: ${referenceModelName}` : "A GLB or glTF conversion of the same building",
      missingAction: referenceModelAvailable ? undefined : "reference-model",
    },
  ], [ifcReason, referenceModelAvailable, referenceModelName, referencePhase]);

  const selectGeometrySource = useCallback((source: GeometrySource) => {
    setGeometrySource(source);
    if (source !== "recovered" && source !== "reference-assisted") {
      setSelectedElementId(null);
    }
  }, []);

  useEffect(() => {
    if (!walking) return;
    const onWalkComparisonKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
      ) return;
      const next = walkComparisonSourceForCode(event.code);
      if (!next || next === geometrySource) return;
      const option = sources.find((entry) => entry.id === next);
      if (!option || option.reason) return;
      event.preventDefault();
      selectGeometrySource(next);
    };
    window.addEventListener("keydown", onWalkComparisonKey);
    return () => window.removeEventListener("keydown", onWalkComparisonKey);
  }, [geometrySource, selectGeometrySource, sources, walking]);

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
  const browserEmptyNote = geometrySource !== "recovered" && geometrySource !== "reference-assisted"
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
        { tone: "matched", label: "Matched RVT + IFC" },
        { tone: "amber", label: "RVT only / recovered difference" },
        { tone: "missing", label: "Geometry differs" },
        { tone: "context", label: "IFC only / context" },
      ]
      : geometrySource === "reference" && comparison
        ? [
          { tone: "matched", label: "Matched RVT + IFC" },
          { tone: "missing", label: "Geometry differs" },
          { tone: "context", label: "IFC only / context" },
        ]
        : geometrySource === "reference-assisted"
          ? [{ tone: "matched", label: "Reference-assisted RVT" }]
          : [{ tone: "amber", label: "Recovered" }];
  const stamp = geometrySource === "reference-model"
    ? "paired reference model"
    : geometrySource === "reference" && comparison
      ? "metres · z-up"
      : "feet · z-up";
  const floorLevelCount = useMemo(
    () => result ? floorPlateLevels(result).length : 0,
    [result],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const openRecent = useCallback((recent: RecentFile) => {
    if (recentOpenInProgressRef.current) return;
    recentOpenInProgressRef.current = true;
    const attempt = ++recentOpenAttemptRef.current;
    setError(null);
    setPhase("reading");
    void (async () => {
      const cached = await loadCachedRecentModel(recent);
      if (attempt !== recentOpenAttemptRef.current) return;
      if (!cached) {
        recentOpenInProgressRef.current = false;
        setError("This older Recent entry has no browser-cached copy. Choose the source file once to cache it.");
        setPhase("error");
        return;
      }
      await processFile(cached.file, cached);
    })();
  }, [processFile]);
  const deleteRecent = useCallback((recent: RecentFile) => {
    removeRecentFile(recent);
    void deleteCachedRecentModel(recent);
  }, []);
  const deleteAllRecents = useCallback(() => {
    clearRecentFiles();
    void clearCachedRecentModels();
  }, []);

  const canvas = result ? (
    <ModelCanvas
      result={geometrySource === "reference-assisted"
        ? referenceAssistedResult ?? result
        : result}
      comparison={comparison}
      source={geometrySource}
      referenceModelUrl={referenceModelUrl}
      renderMode={renderMode}
      navigationMode={navigationMode}
      orbitDrag={orbitDrag}
      cameraRequest={cameraRequest}
      measuring={actionTool === "measure"}
      sectioning={actionTool === "section"}
      onSectionClear={() => setActionTool(null)}
      exploding={actionTool === "explode"}
      commenting={commentToolArmed}
      comments={modelComments}
      visibleCommentIds={visibleCommentIds}
      activeCommentId={activeCommentId}
      onActiveComment={activateComment}
      onCreateComment={createModelComment}
      viewpointRequest={viewpointRequest}
      markup={markup}
      markupSettings={markupSettings}
      onCreateMarkup={createMarkupStroke}
      onDeleteMarkup={deleteMarkupStroke}
      walking={walking}
      onWalkingChange={handleWalkingChange}
      walkStartRequest={walkStartRequest}
      selectedElementId={selectedElementId}
      onSelectElement={setSelectedElementId}
      hiddenElementIds={hiddenElementIds}
      onHoverElement={setHoveredElementId}
      onCanvasMenu={setCanvasMenu}
      focusRequest={focusRequest}
      storeyFocusRequest={storeyFocus}
    />
  ) : null;

  /**
   * The pickers themselves. Every one of them is opened by a named button
   * elsewhere — Open, Pair IFC, Pair reference model, Import review — which is
   * the control a reviewer is meant to find. `visually-hidden` clips these but
   * does not take them out of the tab order, so a keyboard user used to walk
   * through four more stops that announced only "Choose file" and had nothing
   * to say about which file. They are the button's mechanism, not four extra
   * controls, so they leave the tab order and the accessibility tree with it.
   */
  const fileInputs = (
    <>
      <input
        ref={inputRef}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
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
        tabIndex={-1}
        aria-hidden="true"
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
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        onChange={(event) => {
          pairReferenceModel(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={reviewInputRef}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        accept=".json,application/json,application/vnd.reviter.comments+json,application/vnd.reviter.markup+json"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void importReviewFile(selected);
          event.currentTarget.value = "";
        }}
      />
    </>
  );

  const emptyState = (
    <EmptyState
      recents={recents}
      busy={busy}
      error={phase === "error" ? error : null}
      onOpen={openPicker}
      onOpenRecent={openRecent}
      onRemoveRecent={deleteRecent}
      onClearRecents={deleteAllRecents}
    />
  );

  /**
   * Put the 3D camera on the storey the map is showing. The bounds come from
   * the elements on that storey rather than its slabs alone, so the framing
   * includes the walls standing on it instead of just the floor plate.
   */
  const focusStoreyInModel = useCallback(() => {
    if (!result || planLevelId == null) return;
    const group = connectedFloorPlanGroup(result, planLevelId);
    const storey = new Set(group?.levelIds ?? [planLevelId]);
    const onStorey = new Set((result.nativeAssociatedLevelRelations ?? [])
      .filter((relation) => storey.has(relation.levelId))
      .map((relation) => relation.elementId));
    let boundsFeet: Bounds3 | null = null;
    for (const record of result.elementBounds) {
      if (!onStorey.has(record.elementId)) continue;
      boundsFeet = boundsFeet ? {
        min: {
          x: Math.min(boundsFeet.min.x, record.boundsFeet.min.x),
          y: Math.min(boundsFeet.min.y, record.boundsFeet.min.y),
          z: Math.min(boundsFeet.min.z, record.boundsFeet.min.z),
        },
        max: {
          x: Math.max(boundsFeet.max.x, record.boundsFeet.max.x),
          y: Math.max(boundsFeet.max.y, record.boundsFeet.max.y),
          z: Math.max(boundsFeet.max.z, record.boundsFeet.max.z),
        },
      } : { min: { ...record.boundsFeet.min }, max: { ...record.boundsFeet.max } };
    }
    if (!boundsFeet) return;
    // Clamp the framing to the storey's own band. A curtain wall or column
    // spanning several floors is filed on the level it starts from, and letting
    // it into the vertical extent aimed the camera storeys above the floor you
    // asked for. The plan extent is left alone: that is what sets the distance.
    if (group) {
      const floor = group.minElevation - 2;
      const ceiling = group.maxElevation + 16;
      boundsFeet = {
        min: { ...boundsFeet.min, z: Math.max(boundsFeet.min.z, floor) },
        max: { ...boundsFeet.max, z: Math.min(Math.max(boundsFeet.max.z, floor + 8), ceiling) },
      };
    }
    setWorkspace("model");
    setStoreyFocus((current) => ({ boundsFeet, sequence: current.sequence + 1 }));
  }, [planLevelId, result]);

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
      data-phase={phase}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const dropped = event.dataTransfer.files[0];
        if (!dropped) return;
        if (/\.json$/i.test(dropped.name)) void importReviewFile(dropped);
        else if (/\.ifc$/i.test(dropped.name)) void processIfcFile(dropped);
        else if (/\.(glb|gltf)$/i.test(dropped.name)) {
          if (result) pairReferenceModel(dropped);
          else void processFile(dropped);
        }
        else void processFile(dropped);
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
          <img src="./favicon.png" alt="" />
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
            canvas
          }
          activeTool={navTool}
          actionTool={actionTool}
          onTool={selectViewerTool}
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
          floorMap={result ? (
            <FloorMiniMap
              embedded
              result={result}
              selectedLevelId={planLevelId}
              onSelectedLevelId={setPlanLevelId}
              showDerivedRooms={showDerivedRooms}
              onShowDerivedRooms={setShowDerivedRooms}
              derivedRooms={derivedFloorRooms}
              roomReview={roomReview}
              isolateLevel={isolateMapLevel}
              onIsolateLevel={setIsolateMapLevel}
              selectedPoint={selectedMapPoint}
              onWalkTo={walkFromMap}
              onFocusStorey={focusStoreyInModel}
              onClose={() => setSheet(null)}
            />
          ) : null}
          emptyState={emptyState}
          modelOpen={Boolean(result)}
          {...commentPanelProps}
        />
      ) : (
        <>
          {result && workspace === "model" && (
            <ViewerToolbar
              sources={sources}
              geometrySource={geometrySource}
              onSource={selectGeometrySource}
              activeTool={navTool}
              actionTool={actionTool}
              onTool={selectViewerTool}
              cameraPreset={cameraRequest.preset}
              onCameraPreset={requestCamera}
              orbitDrag={orbitDrag}
              onOrbitDrag={changeOrbitDrag}
              renderMode={renderMode}
              onRenderMode={setRenderMode}
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              dockOpen={dockOpen}
              onLeft={() => setLeftOpen((open) => !open)}
              onRight={() => setRightOpen((open) => !open)}
              onDock={() => setDockOpen((open) => !open)}
              onOpen={openPicker}
              onPairIfc={() => ifcInputRef.current?.click()}
              onPairReferenceModel={() => referenceModelInputRef.current?.click()}
              onCloseModel={closeModel}
            />
          )}

          {result && workspace === "floors" ? (
            <FloorWorkspace
              result={result}
              selectedLevelId={planLevelId}
              onSelectedLevelId={setPlanLevelId}
              showDerivedRooms={showDerivedRooms}
              onShowDerivedRooms={setShowDerivedRooms}
              derivedRooms={derivedFloorRooms}
              roomReview={roomReview}
              onRoomReview={(next) => {
                setRoomReview(next);
                saveRoomReview(result, next);
              }}
              onModel={() => setWorkspace("model")}
              onOpenModelMap={() => {
                setWorkspace("model");
                setFloorSideMapOpen(true);
              }}
            />
          ) : (
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

                  {floorSideMapOpen && (
                    <FloorMiniMap
                      result={result}
                      selectedLevelId={planLevelId}
                      onSelectedLevelId={setPlanLevelId}
                      showDerivedRooms={showDerivedRooms}
                      onShowDerivedRooms={setShowDerivedRooms}
                      derivedRooms={derivedFloorRooms}
                      roomReview={roomReview}
                      isolateLevel={isolateMapLevel}
                      onIsolateLevel={setIsolateMapLevel}
                      selectedPoint={selectedMapPoint}
                      onWalkTo={walkFromMap}
                      onFocusStorey={focusStoreyInModel}
                      onClose={() => setFloorSideMapOpen(false)}
                    />
                  )}

                  {actionTool === "markup" && (
                    <MarkupToolbar
                      tool={markupTool}
                      color={markupColor}
                      weight={markupWeight}
                      text={markupText}
                      strokeCount={markup.length}
                      canUndo={markupUndo.length > 0}
                      canRedo={markupRedo.length > 0}
                      walking={walking}
                      onTool={setMarkupTool}
                      onColor={setMarkupColor}
                      onWeight={setMarkupWeight}
                      onText={setMarkupText}
                      onUndo={undoMarkup}
                      onRedo={redoMarkup}
                      onClear={clearMarkup}
                      onDone={() => setActionTool(null)}
                    />
                  )}

                  {selectedRecord && (
                    <button type="button" className="viewport-selection" onClick={() => setRightOpen(true)}>
                      <b>{selectedTitle}</b>
                      <span>{selectedSubtitle}</span>
                    </button>
                  )}

                  {commentToolArmed && (
                    <div className="comment-banner" role="status">
                      Click a surface to pin a comment
                      <button type="button" onClick={() => setActionTool(null)}>Cancel</button>
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
                      style={canvasMenuPosition(canvasMenu, canvasMenu.elementId == null ? 3 : 5)}
                    >
                      <ToolButton
                        role="menuitem"
                        reason={canvasMenu.walkPoint ? null : "Choose a model surface"}
                        onClick={() => {
                          if (!canvasMenu.walkPoint) return;
                          setWalkStartRequest((current) => ({
                            point: canvasMenu.walkPoint!,
                            normal: canvasMenu.walkNormal ?? null,
                            sequence: current.sequence + 1,
                          }));
                          setCanvasMenu(null);
                          setNavTool("firstPerson");
                        }}
                      >Walk from here</ToolButton>
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
                  onImportReview={() => reviewInputRef.current?.click()}
                  reviewImportMessage={reviewImportMessage}
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
          )}

          {/* The live region is the phase, not the bar and not the whole
              footer. Announcing the footer re-read the workspace switcher and
              the triangle counts on every percentage tick; the percentage
              itself belongs to a progressbar, which a reader reports on demand
              instead of interrupting with a hundred times. */}
          <footer className="statusbar">
            <div className="statusbar-state">
              <span>
                <span className={`status-dot ${statusTone}`} />
                <b role="status">{statusText}</b>
              </span>
              {busy && (
                <span className="status-progress">
                  <span
                    role="progressbar"
                    aria-label="Conversion progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                  ><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></span>
                  <em>{Math.round(progress * 100)}%</em>
                </span>
              )}
            </div>
            {result && (
              <WorkspaceSwitcher
                workspace={workspace}
                floorLevelCount={floorLevelCount}
                onWorkspace={(next) => {
                  setWorkspace(next);
                  if (next === "floors") {
                    setDockOpen(false);
                    setFloorSideMapOpen(false);
                  }
                }}
              />
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
