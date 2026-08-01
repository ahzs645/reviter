"use client";

/**
 * The application toolbar.
 *
 * One row across the top of the model, in place of the four floating bars the
 * viewport used to carry (command bar, navigation dock, view-style bar and
 * source switcher). Everything that acts on the model scrolls in the left
 * group; the three panel toggles are pinned to the right so they never scroll
 * out of reach — they are the only way back to a dock you have closed.
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Expand,
  FolderOpen,
  Footprints,
  Hand,
  MessageSquarePlus,
  PenLine,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Rotate3d,
  Ruler,
  Scissors,
  X,
  ZoomIn,
} from "lucide-react";

import { CAMERA_PRESETS, type CameraPreset, type RenderMode } from "../../lib/reviter";
import { ToolButton } from "./panels.tsx";
import type { GeometrySource } from "./types.ts";
import { isNavigationTool, type ActionTool, type NavigationTool, type ViewerTool } from "./viewer-tools.ts";

type ToolEntry = { id: ViewerTool; label: string; Icon: typeof Hand };

const TOOLS: readonly ToolEntry[] = [
  { id: "orbit", label: "Orbit", Icon: Rotate3d },
  { id: "pan", label: "Pan", Icon: Hand },
  { id: "zoom", label: "Zoom", Icon: ZoomIn },
  { id: "firstPerson", label: "Walk", Icon: Footprints },
  { id: "measure", label: "Measure", Icon: Ruler },
  { id: "section", label: "Section", Icon: Scissors },
  { id: "explode", label: "Explode", Icon: Expand },
  { id: "comment", label: "Comment", Icon: MessageSquarePlus },
  // Not in the four-group layout the handoff describes, but 2D markup predates
  // it and would otherwise have no entry point at all once the Comment tool
  // stopped raising the drawing toolbar with it.
  { id: "markup", label: "Markup", Icon: PenLine },
];

export type SourceOption = {
  id: GeometrySource;
  label: string;
  /** Null when the source can be used; otherwise why it cannot be. */
  reason: string | null;
  title?: string;
  /** Direct source-selection key available while walking. */
  shortcut?: string;
  /** File picker that makes this unavailable source usable. */
  missingAction?: "ifc" | "reference-model";
};

export function ViewerToolbar({
  sources,
  geometrySource,
  onSource,
  activeTool,
  actionTool,
  onTool,
  cameraPreset,
  onCameraPreset,
  renderMode,
  onRenderMode,
  leftOpen,
  rightOpen,
  dockOpen,
  onLeft,
  onRight,
  onDock,
  onOpen,
  onPairIfc,
  onPairReferenceModel,
  onCloseModel,
}: {
  sources: readonly SourceOption[];
  geometrySource: GeometrySource;
  onSource: (source: GeometrySource) => void;
  /** The navigation tool in force. */
  activeTool: NavigationTool;
  /** The armed action, if any. It is independent of the navigation tool. */
  actionTool: ActionTool | null;
  onTool: (tool: ViewerTool) => void;
  cameraPreset: CameraPreset;
  onCameraPreset: (preset: CameraPreset) => void;
  renderMode: RenderMode;
  onRenderMode: (mode: RenderMode) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  dockOpen: boolean;
  onLeft: () => void;
  onRight: () => void;
  onDock: () => void;
  onOpen: () => void;
  onPairIfc: () => void;
  onPairReferenceModel: () => void;
  onCloseModel: () => void;
}) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // The same dismissal contract as the canvas menu: the next press outside, or
  // Escape. Containment is tested so a press on an entry still fires its click.
  useEffect(() => {
    if (!viewMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismissOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismissOnEscape);
    };
  }, [viewMenuOpen]);

  const presetLabel = CAMERA_PRESETS.find((entry) => entry.preset === cameraPreset)?.label ?? "View";

  return (
    <div className="toolbar">
      <div className="toolbar-scroll">
        <button type="button" className="rv-button" onClick={onOpen}>
          <FolderOpen size={15} aria-hidden />
          Open
        </button>
        <button
          type="button"
          className="rv-icon-button"
          title="Close model"
          aria-label="Close model"
          onClick={onCloseModel}
        ><X size={15} aria-hidden /></button>

        <span className="toolbar-divider" />

        {/* Every source this viewer has is on the switcher whether or not it can
            be reached. Hiding the two that need something first made a model
            with no paired export look like a model that could not have one, so
            each unavailable source says what would turn it on instead. */}
        <div className="rv-segmented" role="group" aria-label="Geometry source">
          {sources.map((entry) => (
            <ToolButton
              key={entry.id}
              className={geometrySource === entry.id ? "active" : ""}
              reason={entry.reason}
              onUnavailable={entry.missingAction === "ifc"
                ? onPairIfc
                : entry.missingAction === "reference-model" ? onPairReferenceModel : undefined}
              title={[entry.title, entry.shortcut ? `Walk shortcut: ${entry.shortcut}` : null]
                .filter(Boolean).join(" · ")}
              pressed={geometrySource === entry.id}
              onClick={() => onSource(entry.id)}
            >{entry.label}</ToolButton>
          ))}
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-group" role="group" aria-label="Model tools">
          {TOOLS.map(({ id, label, Icon }) => {
            // A navigation tool is lit when it is the one driving the camera; an
            // action is lit when it is armed. Both can be lit at once, which is
            // the point: Walk and Comment together is a review from inside.
            const active = isNavigationTool(id) ? activeTool === id : actionTool === id;
            return (
              <button
                key={id}
                type="button"
                className={`rv-tool${active ? " active" : ""}`}
                title={label}
                aria-label={label}
                aria-pressed={active}
                data-tool={id}
                onClick={() => onTool(id)}
              ><Icon size={16} aria-hidden /></button>
            );
          })}
        </div>

        <span className="toolbar-divider" />

        <div className="view-menu" ref={viewMenuRef}>
          <button
            type="button"
            className="view-menu-button"
            aria-expanded={viewMenuOpen}
            aria-haspopup="listbox"
            onClick={() => setViewMenuOpen((open) => !open)}
          >
            {presetLabel}
            <ChevronDown size={13} aria-hidden />
          </button>
          {viewMenuOpen && (
            <div className="view-menu-list" role="listbox" aria-label="Camera orientation">
              {CAMERA_PRESETS.map((entry) => (
                <button
                  key={entry.preset}
                  type="button"
                  role="option"
                  aria-selected={cameraPreset === entry.preset}
                  className={cameraPreset === entry.preset ? "selected" : ""}
                  onClick={() => {
                    onCameraPreset(entry.preset);
                    setViewMenuOpen(false);
                  }}
                >{entry.label}</button>
              ))}
            </div>
          )}
        </div>

        <div className="rv-segmented" role="group" aria-label="Visual style">
          <button
            type="button"
            className={renderMode === "technical" ? "active" : ""}
            aria-pressed={renderMode === "technical"}
            onClick={() => onRenderMode("technical")}
          >Shaded</button>
          <button
            type="button"
            className={renderMode === "xray" ? "active" : ""}
            aria-pressed={renderMode === "xray"}
            onClick={() => onRenderMode("xray")}
          >X-ray</button>
        </div>
      </div>

      <div className="toolbar-pinned" role="group" aria-label="Panels">
        <button
          type="button"
          className={`rv-tool${leftOpen ? " active" : ""}`}
          title="Browser"
          aria-label="Browser"
          aria-pressed={leftOpen}
          onClick={onLeft}
        ><PanelLeft size={16} aria-hidden /></button>
        <button
          type="button"
          className={`rv-tool${rightOpen ? " active" : ""}`}
          title="Properties"
          aria-label="Properties"
          aria-pressed={rightOpen}
          onClick={onRight}
        ><PanelRight size={16} aria-hidden /></button>
        <button
          type="button"
          className={`rv-tool${dockOpen ? " active" : ""}`}
          title="Report"
          aria-label="Report"
          aria-pressed={dockOpen}
          onClick={onDock}
        ><PanelBottom size={16} aria-hidden /></button>
      </div>
    </div>
  );
}
