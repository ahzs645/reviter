"use client";

/**
 * The phone layout.
 *
 * Not the desktop shell stacked: the viewport is full-bleed, three navigation
 * tools ride on the canvas as 44px targets, and the browser, comments,
 * properties, floors and report are sheets raised over the model from a five-tab bar.
 * Toolbar, docks and status bar are not rendered here at all.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  Box,
  ChevronUp,
  Hand,
  Info,
  MessageSquare,
  MapPinned,
  Rotate3d,
  Ruler,
  Table,
  X,
} from "lucide-react";

import { CommentsPanel } from "./CommentsPanel.tsx";
import { MOBILE_ROW_HEIGHT, ObjectList } from "./ObjectList.tsx";
import type { ElementBoundsRecord } from "../../lib/reviter";
import type { CommentFilter, MobileSheet, PropertyRow } from "./types.ts";
import type { ReportCheck } from "./ReportDock.tsx";
import type { ModelComment } from "./viewer-tools.ts";
import { isNavigationTool, type ActionTool, type NavigationTool, type ViewerTool } from "./viewer-tools.ts";

const QUICK_TOOLS: readonly { id: ViewerTool; label: string; Icon: typeof Hand }[] = [
  { id: "orbit", label: "Orbit", Icon: Rotate3d },
  { id: "pan", label: "Pan", Icon: Hand },
  { id: "measure", label: "Measure", Icon: Ruler },
];

const TABS: readonly { id: MobileSheet; label: string; Icon: typeof Box }[] = [
  { id: "model", label: "Model", Icon: Box },
  { id: "comments", label: "Comments", Icon: MessageSquare },
  { id: "properties", label: "Info", Icon: Info },
  { id: "map", label: "Floors", Icon: MapPinned },
  { id: "report", label: "Report", Icon: Table },
];

export function MobileShell({
  themeIcons,
  onTheme,
  fileName,
  statusLine,
  viewport,
  activeTool,
  actionTool,
  onTool,
  sheet,
  onSheet,
  selectedTitle,
  selectedSubtitle,
  hasSelection,
  records,
  selectedElementId,
  onSelectElement,
  properties,
  emptyNote,
  metricCards,
  checks,
  floorMap,
  comments,
  visibleComments,
  commentFilter,
  activeCommentId,
  commentToolArmed,
  describeCommentTarget,
  onCommentFilter,
  onActiveComment,
  onEditComment,
  onResolveComment,
  onDeleteComment,
  onCommentViewpoint,
  onArmComment,
  emptyState,
  modelOpen,
}: {
  /** Both theme icons; the stylesheet shows whichever matches the theme. */
  themeIcons: ReactNode;
  onTheme: () => void;
  fileName: string;
  statusLine: string;
  viewport: ReactNode;
  activeTool: NavigationTool;
  actionTool: ActionTool | null;
  onTool: (tool: ViewerTool) => void;
  sheet: MobileSheet | null;
  onSheet: (sheet: MobileSheet | null) => void;
  selectedTitle: string;
  selectedSubtitle: string;
  hasSelection: boolean;
  records: ElementBoundsRecord[];
  selectedElementId: number | null;
  onSelectElement: (elementId: number) => void;
  properties: readonly PropertyRow[];
  /** Why the object list is empty, when it is. */
  emptyNote: string;
  metricCards: readonly { label: string; value: string }[];
  checks: readonly ReportCheck[];
  floorMap: ReactNode;
  comments: readonly ModelComment[];
  visibleComments: readonly ModelComment[];
  commentFilter: CommentFilter;
  activeCommentId: string | null;
  commentToolArmed: boolean;
  describeCommentTarget: (comment: ModelComment) => string;
  onCommentFilter: (filter: CommentFilter) => void;
  onActiveComment: (id: string | null) => void;
  onEditComment: (id: string, text: string) => void;
  onResolveComment: (id: string) => void;
  onDeleteComment: (id: string) => void;
  onCommentViewpoint: (id: string) => void;
  onArmComment: () => void;
  emptyState: ReactNode;
  modelOpen: boolean;
}) {
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!sheet) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    sheetCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); restoreFocusRef.current?.focus?.(); };
  }, [onSheet, sheet]);
  const openCount = comments.filter((comment) => comment.status === "open").length;
  const resolvedCount = comments.length - openCount;
  const sheetMeta: Record<MobileSheet, [string, string]> = {
    model: ["Model browser", `${records.length.toLocaleString()} objects shown`],
    comments: ["Comments", `${openCount} open · ${resolvedCount} resolved`],
    properties: [hasSelection ? selectedTitle : "Properties", hasSelection ? selectedSubtitle : "Nothing picked"],
    map: ["Floor navigation map", "Live camera and inferred regions"],
    report: ["Report", "Recovery summary"],
  };
  const [sheetTitle, sheetSub] = sheet ? sheetMeta[sheet] : ["", ""];

  if (!modelOpen) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          {/* The logo is a static asset, not a Next.js image route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.png" alt="" />
          <div>
            <strong>Reviter</strong>
            <span>{statusLine}</span>
          </div>
          <button type="button" aria-label="Toggle theme" onClick={onTheme}>{themeIcons}</button>
        </header>
        {emptyState}
      </div>
    );
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon.png" alt="" />
        <div>
          <strong>{fileName}</strong>
          <span>{statusLine}</span>
        </div>
        <button type="button" aria-label="Toggle theme" onClick={onTheme}>{themeIcons}</button>
      </header>

      <div className="mobile-viewport">
        {viewport}

        <div className="mobile-quick-tools" role="group" aria-label="Navigation">
          {QUICK_TOOLS.map(({ id, label, Icon }) => {
            const active = isNavigationTool(id) ? activeTool === id : actionTool === id;
            return (
              <button
                key={id}
                type="button"
                className={active ? "active" : ""}
                aria-label={label}
                aria-pressed={active}
                onClick={() => onTool(id)}
              ><Icon size={18} aria-hidden /></button>
            );
          })}
        </div>

        {hasSelection && (
          <button type="button" className="mobile-selection" onClick={() => onSheet("properties")}>
            <span>
              <b>{selectedTitle}</b>
              <small>{selectedSubtitle}</small>
            </span>
            <ChevronUp size={16} aria-hidden />
          </button>
        )}

        {sheet && (
          <div className="mobile-sheet" role="dialog" aria-label={sheetTitle}>
            <div className="sheet-header">
              <div>
                <strong>{sheetTitle}</strong>
                <span>{sheetSub}</span>
              </div>
              <button ref={sheetCloseRef} type="button" aria-label="Close panel" onClick={() => onSheet(null)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="sheet-body">
              {sheet === "model" && (
                records.length ? (
                  <ObjectList
                    records={records}
                    selectedElementId={selectedElementId}
                    onSelect={(elementId) => {
                      onSelectElement(elementId);
                      onSheet("properties");
                    }}
                    rowHeight={MOBILE_ROW_HEIGHT}
                  />
                ) : <p className="comment-empty">{emptyNote}</p>
              )}

              {sheet === "comments" && (
                <CommentsPanel
                  mobile
                  comments={comments}
                  visible={visibleComments}
                  filter={commentFilter}
                  activeId={activeCommentId}
                  armed={commentToolArmed}
                  describeTarget={describeCommentTarget}
                  onFilter={onCommentFilter}
                  onActive={onActiveComment}
                  onEdit={onEditComment}
                  onResolve={onResolveComment}
                  onDelete={onDeleteComment}
                  onViewpoint={(id) => {
                    onCommentViewpoint(id);
                    onSheet(null);
                  }}
                  onArm={() => {
                    onArmComment();
                    onSheet(null);
                  }}
                />
              )}

              {sheet === "properties" && (
                properties.length ? (
                  <dl style={{ margin: 0 }}>
                    {properties.map((row) => (
                      <div className="property-row" key={row.key}>
                        <dt>{row.label}</dt>
                        <dd title={row.value}>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="comment-empty">Pick an object in the viewport to see its properties.</p>
                )
              )}

              {sheet === "report" && (
                <>
                  <div className="mobile-metric-grid">
                    {metricCards.map((card) => (
                      <div className="metric-card" key={card.label}>
                        <strong>{card.value}</strong>
                        <span>{card.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mobile-checks">
                    {checks.map((check) => (
                      <div className={check.tone} key={check.label}>
                        <i />
                        <strong>{check.label}</strong>
                        <span>{check.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {sheet === "map" && floorMap}
            </div>
          </div>
        )}
      </div>

      <nav className="mobile-tabs" aria-label="Panels">
        {TABS.map(({ id, label, Icon }) => {
          const active = sheet === id;
          const badge = id === "comments" && openCount ? String(openCount) : "";
          return (
            <button
              key={id}
              type="button"
              className={active ? "active" : ""}
              aria-pressed={active}
              onClick={() => onSheet(active ? null : id)}
            >
              <Icon size={19} aria-hidden />
              <span>{label}</span>
              {badge && <em>{badge}</em>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
