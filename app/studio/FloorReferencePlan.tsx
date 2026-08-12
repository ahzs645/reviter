"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Download, Eye, EyeOff, FileUp, RotateCcw, Upload } from "lucide-react";

import {
  IDENTITY_FLOOR_REFERENCE_TRANSFORM,
  applyFloorReferenceTransform,
  composeFloorReferenceTransform,
  cropFloorReferenceCatalogSvg,
  decomposeFloorReferenceTransform,
  downloadBlob,
  fitFloorReferenceTransform,
  floorReferenceTransformAttribute,
  makeFloorReferenceAlignment,
  outputName,
  parseFloorReferenceCatalogSvg,
  parseFloorReferenceAlignment,
  withFloorReferenceIntrinsicSize,
  type FloorReferenceCatalogSection,
  type FloorReferenceControlPair,
  type FloorReferencePoint,
  type FloorReferenceTransform,
} from "../../lib/reviter";
import { decodeDwg, type DecodedDwg, type DecodedDwgSheet } from "./decode-dwg.ts";

type ReferenceAsset = {
  fileName: string;
  mediaType: string;
  sha256: string | null;
  svgText: string | null;
  sections: FloorReferenceCatalogSection[];
  /** Named plans a DWG carried in its own layouts; empty for every other input. */
  sheets: DecodedDwgSheet[];
  url: string;
};

type CaptureMode = "reference" | "rvt" | null;

async function sha256(file: File) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function residualFor(transform: FloorReferenceTransform, pairs: readonly FloorReferenceControlPair[]) {
  if (!pairs.length) return { rms: 0, maximum: 0 };
  const errors = pairs.map((pair) => {
    const fitted = applyFloorReferenceTransform(transform, pair.reference);
    return Math.hypot(fitted.x - pair.rvt.x, fitted.y - pair.rvt.y);
  });
  return {
    rms: Math.sqrt(errors.reduce((total, error) => total + error * error, 0) / errors.length),
    maximum: Math.max(...errors),
  };
}

/**
 * Layer a local SVG/raster reference above the generated RVT plan. Registration
 * stays visual and reversible; neither source file is modified.
 */
export function FloorReferencePlan({
  rvtFileName,
  levelIds,
  planImageUrl,
  planAlt,
  zoom,
  toolbar,
  onPlanClick,
}: {
  rvtFileName: string;
  levelIds: number[];
  planImageUrl: string;
  planAlt: string;
  zoom: number;
  toolbar: ReactNode;
  /** Fraction of the plan image (0–1 both axes) a non-capture click landed on. */
  onPlanClick?: (fraction: { x: number; y: number }) => void;
}) {
  const referenceInput = useRef<HTMLInputElement>(null);
  const alignmentInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const previousUrl = useRef<string | null>(null);
  const [asset, setAsset] = useState<ReferenceAsset | null>(null);
  const [sectionId, setSectionId] = useState("");
  /** Which named sheet is shown; null is the whole drawing. */
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(0.48);
  const [transform, setTransform] = useState<FloorReferenceTransform>(IDENTITY_FLOOR_REFERENCE_TRANSFORM);
  const [referencePoints, setReferencePoints] = useState<FloorReferencePoint[]>([]);
  const [rvtPoints, setRvtPoints] = useState<FloorReferencePoint[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [status, setStatus] = useState("Load a DWG, or an SVG or image made from one, to begin.");
  /** Decoding a survey DWG takes seconds; the picker is disabled while it runs. */
  const [busy, setBusy] = useState(false);
  /** Reference width ÷ height, measured once it decodes. */
  const [referenceAspect, setReferenceAspect] = useState<number | null>(null);
  const [canvasAspect, setCanvasAspect] = useState(1);

  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0) setCanvasAspect(bounds.height / bounds.width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
  }, []);

  const selectedSection = useMemo(
    () => asset?.sections.find((section) => section.id === sectionId) ?? null,
    [asset, sectionId],
  );

  const sectionUrl = useMemo(() => asset?.svgText && selectedSection
    ? URL.createObjectURL(new Blob([
      withFloorReferenceIntrinsicSize(
        cropFloorReferenceCatalogSvg(asset.svgText, selectedSection.bounds)),
    ], { type: "image/svg+xml" }))
    : null, [asset, selectedSection]);

  useEffect(() => () => {
    if (sectionUrl) URL.revokeObjectURL(sectionUrl);
  }, [sectionUrl]);

  const selectedSheet = useMemo(
    () => asset?.sheets.find((sheet) => sheet.id === sheetId) ?? null,
    [asset, sheetId],
  );

  // Every sheet was drawn during the decode, so switching between them is a new
  // Blob URL over a string already in hand rather than another pass over the
  // drawing. Only the shown one is ever given a URL.
  const sheetUrl = useMemo(() => selectedSheet
    ? URL.createObjectURL(new Blob([selectedSheet.svg], { type: "image/svg+xml" }))
    : null, [selectedSheet]);

  useEffect(() => () => {
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  }, [sheetUrl]);

  const referenceUrl = sheetUrl ?? sectionUrl ?? asset?.url ?? null;

  // The reference's own proportions, measured rather than assumed, because the
  // `<image>` below has to be fitted by hand — see `fittedReference`. Choosing a
  // reference or a section clears the previous measurement, so this only ever
  // records one, never resets one.
  useEffect(() => {
    if (!referenceUrl) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setReferenceAspect(probe.naturalWidth / probe.naturalHeight);
      }
    };
    probe.src = referenceUrl;
    return () => { cancelled = true; };
  }, [referenceUrl]);

  /**
   * What `preserveAspectRatio="xMidYMid meet"` would have given, computed here.
   *
   * Chromium never paints an `<image>` set to `meet` when it points at a large
   * SVG: the fitted box needs the intrinsic size, which is not known until the
   * document finishes decoding, and the layout is not redone once it is. The
   * reference then silently shows nothing — which is what every SVG reference
   * did before, DWG or hand-exported. Sizing the box ourselves and asking for
   * `none` puts the decision in code that runs after the size is known, and is
   * identical geometry: an exactly-proportioned box makes `none` and `meet`
   * agree, so the fitted alignment transform still means what it meant.
   */
  const fittedReference = useMemo(() => {
    const full = { x: 0, y: 0, width: 1, height: canvasAspect };
    if (!referenceAspect || !Number.isFinite(referenceAspect)) return full;
    const boxAspect = 1 / canvasAspect;
    if (referenceAspect >= boxAspect) {
      const height = 1 / referenceAspect;
      return { x: 0, y: (canvasAspect - height) / 2, width: 1, height };
    }
    const width = canvasAspect * referenceAspect;
    return { x: (1 - width) / 2, y: 0, width, height: canvasAspect };
  }, [canvasAspect, referenceAspect]);

  const controlPairs = useMemo(() => referencePoints
    .slice(0, Math.min(referencePoints.length, rvtPoints.length))
    .map((reference, index) => ({ reference, rvt: rvtPoints[index]! })),
  [referencePoints, rvtPoints]);
  const residual = useMemo(() => residualFor(transform, controlPairs), [controlPairs, transform]);
  const decomposed = useMemo(() => decomposeFloorReferenceTransform(transform), [transform]);

  const fitCapturedPoints = (references: FloorReferencePoint[], targets: FloorReferencePoint[]) => {
    if (references.length < 2 || targets.length < 2) return;
    try {
      const fit = fitFloorReferenceTransform(references.map((reference, index) => ({
        reference,
        rvt: targets[index]!,
      })));
      setTransform(fit.transform);
      setCaptureMode(null);
      setVisible(true);
      setStatus(references.length === 2
        ? "Two-anchor registration fitted. Its control residual is exactly zero by definition; review other corners before treating it as validated."
        : `Registered from ${references.length} control pairs · RMS ${(fit.rms * 100).toFixed(2)}% of plan width.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The control points could not be fitted.");
    }
  };

  const loadReference = async (file: File) => {
    const isDwg = /\.dwg$/iu.test(file.name);
    if (!isDwg && !file.type.startsWith("image/") && !/\.(svg|png|jpe?g|webp)$/iu.test(file.name)) {
      setStatus("Load a DWG, or an SVG/PNG/JPEG/WebP produced from one.");
      return;
    }
    if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);

    // A DWG is decoded to plan linework first; everything downstream then sees
    // the same SVG it would have seen from a hand-exported one.
    let decoded: DecodedDwg | null = null;
    let svgText: string | null = null;
    let url: string;
    if (isDwg) {
      setBusy(true);
      setStatus("Reading the drawing…");
      try {
        decoded = await decodeDwg(await file.arrayBuffer(), (stage) => setStatus(`${stage}…`));
      } catch (error) {
        setBusy(false);
        setStatus(error instanceof Error ? error.message : "This DWG could not be read.");
        return;
      }
      setBusy(false);
      svgText = decoded.svg;
      url = URL.createObjectURL(new Blob([decoded.svg], { type: "image/svg+xml" }));
    } else {
      svgText = /\.svg$/iu.test(file.name) || file.type === "image/svg+xml" ? await file.text() : null;
      // An SVG is re-blobbed rather than used as-is so it can be given the
      // intrinsic size an <image> needs; anything raster already has one.
      url = svgText
        ? URL.createObjectURL(new Blob([withFloorReferenceIntrinsicSize(svgText)],
          { type: "image/svg+xml" }))
        : URL.createObjectURL(file);
    }
    const catalog = svgText && !isDwg ? parseFloorReferenceCatalogSvg(svgText) : null;
    previousUrl.current = url;
    setAsset({
      fileName: file.name,
      mediaType: isDwg ? "image/svg+xml" : (file.type || "application/octet-stream"),
      sha256: null,
      svgText,
      sections: catalog?.sections ?? [],
      sheets: decoded?.sheets ?? [],
      url,
    });
    setSectionId("");
    setSheetId(null);
    setReferenceAspect(null);
    setTransform(IDENTITY_FLOOR_REFERENCE_TRANSFORM);
    setReferencePoints([]);
    setRvtPoints([]);
    setVisible(true);
    setStatus(decoded
      ? `${decoded.entityCount.toLocaleString()} entities on ${decoded.layerNames.length} layers` +
        `${decoded.sheets.length ? ` · ${decoded.sheets.length} named plans, listed below` : ""}` +
        `${decoded.feetPerUnit == null ? " · the drawing declares no units, so scale comes from your control points" : ""}` +
        `. ${decoded.sheets.length
          ? "Pick a plan, then mark two points on it and the same two on the RVT."
          : "Mark two recognizable points on it, then the same two on the RVT."}`
      : catalog?.sections.length
        ? `${catalog.sections.length} independent plan sections detected. Choose one section before aligning it to the RVT.`
        : "Reference loaded. Mark two recognizable points on it, then the same two points on the RVT.");
    const hash = await sha256(file);
    setAsset((current) => current?.url === url ? { ...current, sha256: hash } : current);
  };

  const loadAlignment = async (file: File) => {
    try {
      const alignment = parseFloorReferenceAlignment(await file.text());
      if (alignment.target.rvtFileName !== rvtFileName) {
        throw new Error(`Alignment targets ${alignment.target.rvtFileName}, not ${rvtFileName}.`);
      }
      if (alignment.source.section && asset?.fileName === alignment.source.fileName) {
        const matched = asset.sections.find((section) => section.id === alignment.source.section!.id);
        if (!matched) throw new Error(`This reference does not contain section ${alignment.source.section.label}.`);
        setSectionId(matched.id);
      }
      setTransform(alignment.transform);
      setOpacity(alignment.opacity);
      setReferencePoints(alignment.controlPairs.map((pair) => pair.reference));
      setRvtPoints(alignment.controlPairs.map((pair) => pair.rvt));
      setVisible(true);
      setCaptureMode(null);
      const sectionMismatch = Boolean(
        asset && alignment.source.section && selectedSection && alignment.source.section.id !== selectedSection.id,
      );
      setStatus(asset && asset.fileName !== alignment.source.fileName
        ? `Alignment loaded; it was created for ${alignment.source.fileName}. Load that reference for a reliable overlay.`
        : sectionMismatch
          ? `Alignment loaded for ${alignment.source.section!.label}; that catalogue section is now selected.`
        : alignment.controlPairs.length === 2
          ? "Two-anchor alignment loaded. The zero control residual is exact by construction; review other building corners before validation."
          : `Alignment loaded · RMS ${(alignment.residual.rms * 100).toFixed(2)}% of plan width.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The alignment JSON could not be loaded.");
    }
  };

  const capturePoint = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!captureMode) {
      // Outside anchor capture, a click is a plan interaction: report where it
      // landed as a fraction of the contained image so the owner can hit-test
      // rooms in model space.
      if (!onPlanClick) return;
      const node = event.currentTarget;
      const image = node.querySelector<HTMLImageElement>("img.floor-reference-rvt");
      const rect = node.getBoundingClientRect();
      if (!image?.naturalWidth || !image.naturalHeight || !rect.width || !rect.height) return;
      const fitted = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
      const imageWidth = image.naturalWidth * fitted;
      const imageHeight = image.naturalHeight * fitted;
      const x = event.clientX - rect.left - (rect.width - imageWidth) / 2;
      const y = event.clientY - rect.top - (rect.height - imageHeight) / 2;
      if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) return;
      onPlanClick({ x: x / imageWidth, y: y / imageHeight });
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const point = {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.width,
    };
    const current = captureMode === "reference" ? referencePoints : rvtPoints;
    const next = current.length >= 2 ? [point] : [...current, point];
    if (captureMode === "reference") setReferencePoints(next);
    else setRvtPoints(next);
    if (next.length === 2) {
      setCaptureMode(null);
      if (captureMode === "reference") {
        setStatus("Reference anchors captured. Now mark the same two landmarks on the RVT in the same order.");
      } else {
        setStatus("RVT anchors captured. Calculating the non-stretched fit…");
        fitCapturedPoints(referencePoints, next);
      }
    } else {
      setStatus(`Mark the second ${captureMode === "reference" ? "reference" : "RVT"} landmark.`);
    }
  };

  const beginCapture = (mode: Exclude<CaptureMode, null>) => {
    if (!asset) return;
    if (mode === "reference") setReferencePoints([]);
    else setRvtPoints([]);
    setCaptureMode(mode);
    setStatus(`Mark two well-separated landmarks on the ${mode === "reference" ? "reference" : "RVT"}, in matching order.`);
  };

  const chooseSheet = (nextId: number | null) => {
    if (nextId === sheetId) return;
    setSheetId(nextId);
    setReferenceAspect(null);
    // A registration is between one drawing and one floor, so switching plans
    // has to drop it rather than carry a fit from a different building.
    setTransform(IDENTITY_FLOOR_REFERENCE_TRANSFORM);
    setReferencePoints([]);
    setRvtPoints([]);
    setCaptureMode(null);
    setVisible(true);
    const sheet = asset?.sheets.find((item) => item.id === nextId);
    setStatus(sheet
      ? `${sheet.name} · ${sheet.entityCount.toLocaleString()} entities. Mark two recognizable points on it, then the same two on the RVT.`
      : `Whole sheet · ${asset?.sheets.length ?? 0} plans. Pick one below, or align the sheet as it is.`);
  };

  const chooseSection = (nextId: string) => {
    setSectionId(nextId);
    setReferenceAspect(null);
    setTransform(IDENTITY_FLOOR_REFERENCE_TRANSFORM);
    setReferencePoints([]);
    setRvtPoints([]);
    setCaptureMode(null);
    setVisible(true);
    const section = asset?.sections.find((item) => item.id === nextId);
    setStatus(section
      ? `${section.label} isolated. Mark two recognizable points on this section, then the same points on the RVT.`
      : asset?.sections.length
        ? "Whole catalogue shown. Choose an individual section before registering it."
        : "Reference shown at its original extent.");
  };

  const updateDecomposed = (update: Partial<ReturnType<typeof decomposeFloorReferenceTransform>>) => {
    setTransform(composeFloorReferenceTransform({ ...decomposed, ...update }));
  };

  const downloadAlignment = () => {
    if (!asset || controlPairs.length < 2) return;
    const alignment = makeFloorReferenceAlignment({
      source: {
        fileName: asset.fileName,
        mediaType: asset.mediaType,
        sha256: asset.sha256,
        ...(selectedSection ? { section: selectedSection } : {}),
      },
      rvtFileName,
      levelIds,
      controlPairs,
      transform,
      rms: residual.rms,
      maximum: residual.maximum,
      opacity,
    });
    downloadBlob(
      new Blob([`${JSON.stringify(alignment, null, 2)}\n`], { type: "application/json" }),
      outputName(rvtFileName, `floor-reference-${selectedSection?.id ?? "whole"}-${levelIds.join("-")}.json`),
    );
    setStatus("Reusable floor-reference alignment JSON downloaded.");
  };

  const referenceOnly = captureMode === "reference";
  const rvtOnly = captureMode === "rvt";
  const referenceTransform = referenceOnly
    ? floorReferenceTransformAttribute(IDENTITY_FLOOR_REFERENCE_TRANSFORM)
    : floorReferenceTransformAttribute(transform);
  const displayedReferencePoints = referenceOnly ? referencePoints : [];
  const displayedRvtPoints = rvtOnly ? rvtPoints : [];

  return (
    <figure className="floor-browser-preview">
      {toolbar}
      <div className="floor-reference-toolbar" role="group" aria-label="Reference overlay controls">
        {/* Both pickers are opened by the named buttons below them, so they are
            those buttons' mechanism rather than two more controls. Clipping
            them alone left two tab stops that announced only "Choose file". */}
        <input
          ref={referenceInput}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept=".dwg,.svg,.png,.jpg,.jpeg,.webp,image/vnd.dwg,image/svg+xml,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadReference(file);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={alignmentInput}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadAlignment(file);
            event.currentTarget.value = "";
          }}
        />
        <button type="button" disabled={busy} onClick={() => referenceInput.current?.click()}><Upload size={13} /> {busy ? "Reading DWG…" : asset ? "Replace reference" : "Add reference"}</button>
        <button type="button" disabled={!asset} onClick={() => setVisible((value) => !value)}>{visible ? <Eye size={13} /> : <EyeOff size={13} />} {visible ? "Reference on" : "Reference off"}</button>
        <button type="button" disabled={!asset} className={captureMode === "reference" ? "active" : ""} onClick={() => beginCapture("reference")}><Crosshair size={13} /> 1 · Reference points</button>
        <button type="button" disabled={!asset} className={captureMode === "rvt" ? "active" : ""} onClick={() => beginCapture("rvt")}><Crosshair size={13} /> 2 · RVT points</button>
        <button type="button" onClick={() => alignmentInput.current?.click()}><FileUp size={13} /> Load alignment</button>
        <button type="button" disabled={!asset || controlPairs.length < 2} onClick={downloadAlignment}><Download size={13} /> Save alignment</button>
      </div>
      {/* Sections come from frames drawn in an exported SVG; a DWG names its own
          plans instead, and those are the tab strip under the drawing. */}
      {asset && asset.sections.length > 0 && (
        <label className="floor-reference-section-picker">
          <span>Reference section</span>
          <select value={sectionId} onChange={(event) => chooseSection(event.target.value)}>
            <option value="">Whole drawing</option>
            {asset.sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
          <em>{asset.sections.length} detected</em>
        </label>
      )}
      {asset && (
        <details className="floor-reference-fine-tune">
          <summary>Fine alignment · {selectedSheet?.name ?? selectedSection?.label ?? asset.fileName}</summary>
          <div>
            <label><span>Opacity</span><input type="range" min="0" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><output>{Math.round(opacity * 100)}%</output></label>
            <label><span>Scale</span><input type="number" min="0.001" step="0.01" value={(decomposed.scale * 100).toFixed(2)} onChange={(event) => updateDecomposed({ scale: Number(event.target.value) / 100 })} /><output>%</output></label>
            <label><span>Rotation</span><input type="number" step="0.1" value={decomposed.rotationDegrees.toFixed(2)} onChange={(event) => updateDecomposed({ rotationDegrees: Number(event.target.value) })} /><output>°</output></label>
            <label><span>X offset</span><input type="number" step="0.1" value={(decomposed.offsetX * 100).toFixed(2)} onChange={(event) => updateDecomposed({ offsetX: Number(event.target.value) / 100 })} /><output>%</output></label>
            <label><span>Y offset</span><input type="number" step="0.1" value={(decomposed.offsetY * 100).toFixed(2)} onChange={(event) => updateDecomposed({ offsetY: Number(event.target.value) / 100 })} /><output>%</output></label>
            <button type="button" onClick={() => { setTransform(IDENTITY_FLOOR_REFERENCE_TRANSFORM); setReferencePoints([]); setRvtPoints([]); setStatus("Alignment reset; the reference remains loaded."); }}><RotateCcw size={12} /> Reset</button>
          </div>
        </details>
      )}
      <div className={`floor-reference-status${captureMode ? " capturing" : ""}`} role="status">{status}</div>
      <div className="floor-browser-plan-scroll">
        <div
          ref={canvas}
          className={`floor-reference-canvas${captureMode ? " capture" : ""}`}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          onClick={capturePoint}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="floor-reference-rvt" src={planImageUrl} alt={planAlt} style={{ opacity: referenceOnly ? 0.08 : 1 }} />
          {asset && visible && !rvtOnly && (
            <svg className="floor-reference-layer" viewBox={`0 0 1 ${canvasAspect}`} preserveAspectRatio="none" aria-label={`Reference overlay ${asset.fileName}`}>
              <image href={referenceUrl ?? asset.url} x={fittedReference.x} y={fittedReference.y} width={fittedReference.width} height={fittedReference.height} preserveAspectRatio="none" transform={referenceTransform} opacity={referenceOnly ? 1 : opacity} />
              {displayedReferencePoints.map((point, index) => <g key={`reference-${index}`} className="floor-reference-anchor"><circle cx={point.x} cy={point.y} r="0.012" /><text x={point.x + 0.015} y={point.y - 0.015}>{index + 1}</text></g>)}
            </svg>
          )}
          {displayedRvtPoints.length > 0 && (
            <svg className="floor-reference-layer floor-reference-rvt-anchors" viewBox={`0 0 1 ${canvasAspect}`} preserveAspectRatio="none" aria-hidden>
              {displayedRvtPoints.map((point, index) => <g key={`rvt-${index}`} className="floor-reference-anchor"><circle cx={point.x} cy={point.y} r="0.012" /><text x={point.x + 0.015} y={point.y - 0.015}>{index + 1}</text></g>)}
            </svg>
          )}
        </div>
      </div>
      {asset && asset.sheets.length > 0 && (
        <div className="floor-reference-sheets" role="tablist" aria-label="Plans in this drawing">
          <button
            type="button"
            role="tab"
            aria-selected={sheetId === null}
            className={sheetId === null ? "active" : ""}
            onClick={() => chooseSheet(null)}
          >
            Full sheet
          </button>
          {asset.sheets.map((sheet) => (
            <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={sheetId === sheet.id}
              className={sheetId === sheet.id ? "active" : ""}
              title={`${sheet.name} · ${sheet.entityCount.toLocaleString()} entities`}
              onClick={() => chooseSheet(sheet.id)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}
