"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { MarkupTool } from "./viewer-tools.ts";

type MarkupPoint = { x: number; y: number };
type MarkupPath = {
  id: number;
  tool: Exclude<MarkupTool, "delete" | "comment">;
  points: MarkupPoint[];
  color: string;
  weight: number;
  text?: string;
};
type MarkupChange =
  | { kind: "add"; markup: MarkupPath }
  | { kind: "delete"; markup: MarkupPath; index: number };

function svgPoint(event: ReactPointerEvent<SVGSVGElement>): MarkupPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / Math.max(1, rect.width) * 1000,
    y: (event.clientY - rect.top) / Math.max(1, rect.height) * 1000,
  };
}

function pathData(markup: MarkupPath): string {
  if (!markup.points.length) return "";
  if (markup.tool === "arrow") {
    const first = markup.points[0]!;
    const last = markup.points.at(-1)!;
    return `M ${first.x} ${first.y} L ${last.x} ${last.y}`;
  }
  return markup.points.map((point, index) =>
    `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
  ).join(" ");
}

export function MarkupOverlay({
  active,
  tool,
  commentCount,
  onToolChange,
  onDone,
  onCancel,
}: {
  active: boolean;
  tool: MarkupTool;
  commentCount: number;
  onToolChange: (tool: MarkupTool) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [color, setColor] = useState("#ef3f45");
  const [weight, setWeight] = useState(4);
  const [text, setText] = useState("Note");
  const [markups, setMarkups] = useState<MarkupPath[]>([]);
  const [history, setHistory] = useState<MarkupChange[]>([]);
  const [redo, setRedo] = useState<MarkupChange[]>([]);
  const [draft, setDraft] = useState<MarkupPath | null>(null);
  const idRef = useRef(1);
  const wasActiveRef = useRef(false);
  const sessionMarkupsRef = useRef<MarkupPath[]>([]);
  const sessionHistoryRef = useRef<MarkupChange[]>([]);

  useEffect(() => {
    if (active && !wasActiveRef.current) {
      sessionMarkupsRef.current = markups;
      sessionHistoryRef.current = history;
    }
    wasActiveRef.current = active;
  }, [active, history, markups]);

  const recordChange = (change: MarkupChange) => {
    setHistory((current) => [...current, change]);
    setRedo([]);
  };

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!active || event.button !== 0 || tool === "delete" || tool === "comment") return;
    const point = svgPoint(event);
    const next: MarkupPath = {
      id: idRef.current++,
      tool,
      points: [point],
      color,
      weight,
      text: tool === "text" ? text : undefined,
    };
    if (tool === "text") {
      setMarkups((current) => [...current, next]);
      recordChange({ kind: "add", markup: next });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft(next);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const point = svgPoint(event);
    setDraft((current) => {
      if (!current) return current;
      const last = current.points.at(-1)!;
      if (current.tool !== "arrow" && Math.hypot(point.x - last.x, point.y - last.y) < 2.5) return current;
      return {
        ...current,
        points: current.tool === "arrow" ? [current.points[0]!, point] : [...current.points, point],
      };
    });
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarkups((current) => [...current, draft]);
    recordChange({ kind: "add", markup: draft });
    setDraft(null);
  };

  const deleteMarkup = (id: number) => {
    if (tool !== "delete") return;
    const index = markups.findIndex((markup) => markup.id === id);
    const markup = markups[index];
    if (!markup) return;
    setMarkups((current) => current.filter((entry) => entry.id !== id));
    recordChange({ kind: "delete", markup, index });
  };

  const applyChange = (change: MarkupChange) => {
    setMarkups((current) => {
      if (change.kind === "add") return [...current, change.markup];
      return current.filter((entry) => entry.id !== change.markup.id);
    });
  };

  const revertChange = (change: MarkupChange) => {
    setMarkups((current) => {
      if (change.kind === "add") return current.filter((entry) => entry.id !== change.markup.id);
      const next = [...current];
      next.splice(Math.min(change.index, next.length), 0, change.markup);
      return next;
    });
  };

  const undo = () => {
    const change = history.at(-1);
    if (!change) return;
    revertChange(change);
    setHistory((current) => current.slice(0, -1));
    setRedo((current) => [...current, change]);
  };

  const redoChange = () => {
    const change = redo.at(-1);
    if (!change) return;
    applyChange(change);
    setRedo((current) => current.slice(0, -1));
    setHistory((current) => [...current, change]);
  };

  const cancel = () => {
    setDraft(null);
    setMarkups(sessionMarkupsRef.current);
    setHistory(sessionHistoryRef.current);
    setRedo([]);
    onCancel();
  };

  const visibleMarkups = draft ? [...markups, draft] : markups;

  return (
    <div className={`markup-layer${active ? " active" : ""}${tool === "comment" ? " commenting" : ""}`}>
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-label="Model markup canvas"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <defs>
          <marker id="markup-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {visibleMarkups.map((markup) => markup.tool === "text" ? (
          <text
            key={markup.id}
            x={markup.points[0]!.x}
            y={markup.points[0]!.y}
            fill={markup.color}
            fontSize={Math.max(18, markup.weight * 5)}
            onClick={() => deleteMarkup(markup.id)}
          >{markup.text}</text>
        ) : (
          <path
            key={markup.id}
            d={pathData(markup)}
            fill="none"
            stroke={markup.color}
            strokeWidth={markup.weight}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={markup.tool === "cloud" ? `${markup.weight * 1.6} ${markup.weight * 2}` : undefined}
            markerEnd={markup.tool === "arrow" ? "url(#markup-arrow)" : undefined}
            onClick={() => deleteMarkup(markup.id)}
          />
        ))}
      </svg>
      {active && (
        <div className="markup-toolbar" role="toolbar" aria-label="Markup tools">
          <div className="markup-toolbar-title">
            <strong>Create Markup <span>{commentCount} 3D comment{commentCount === 1 ? "" : "s"}</span></strong>
            <button onClick={cancel}>Cancel</button>
            <button className="primary" onClick={onDone}>Save</button>
          </div>
          <div className="markup-toolbar-row">
            {(["pencil", "arrow", "cloud", "text", "comment", "delete"] as const).map((entry) => (
              <button
                key={entry}
                className={tool === entry ? "active" : ""}
                onClick={() => onToolChange(entry)}
                aria-pressed={tool === entry}
              >{entry === "comment" ? "3D Comment" : entry}</button>
            ))}
            <label>Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
            <label>Weight <input type="range" min="1" max="10" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label>
            {tool === "text" && <label>Text <input value={text} onChange={(event) => setText(event.target.value)} /></label>}
            <button onClick={undo} disabled={!history.length}>Undo</button>
            <button onClick={redoChange} disabled={!redo.length}>Redo</button>
          </div>
          {tool === "comment" && (
            <p className="markup-comment-hint">Click a model surface to pin an editable comment and save this viewpoint.</p>
          )}
        </div>
      )}
    </div>
  );
}
