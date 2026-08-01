"use client";

/**
 * The markup toolbar.
 *
 * It used to own the strokes as well as the controls, because the strokes were
 * screen coordinates and nothing outside this file needed them. They are scene
 * positions now, drawn by the canvas that owns the camera and stored beside the
 * comments, so what is left here is what it always looked like: a choice of
 * tool, a colour, a width, and the history buttons.
 */
import type { MarkupTool } from "./viewer-tools.ts";

const TOOLS: readonly MarkupTool[] = ["pencil", "arrow", "cloud", "text", "delete"];

export function MarkupToolbar({
  tool,
  color,
  weight,
  text,
  strokeCount,
  canUndo,
  canRedo,
  walking,
  onTool,
  onColor,
  onWeight,
  onText,
  onUndo,
  onRedo,
  onClear,
  onDone,
}: {
  tool: MarkupTool;
  color: string;
  weight: number;
  text: string;
  strokeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /** First person is on, so the look drag has moved to the right button. */
  walking: boolean;
  onTool: (tool: MarkupTool) => void;
  onColor: (color: string) => void;
  onWeight: (weight: number) => void;
  onText: (text: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  return (
    <div className="markup-toolbar" role="toolbar" aria-label="Markup tools">
      <div className="markup-toolbar-title">
        <strong>
          Markup
          <span>{strokeCount} stroke{strokeCount === 1 ? "" : "s"} in the model</span>
        </strong>
        <button onClick={onClear} disabled={!strokeCount}>Clear all</button>
        <button className="primary" onClick={onDone}>Done</button>
      </div>
      <div className="markup-toolbar-row">
        {TOOLS.map((entry) => (
          <button
            key={entry}
            className={tool === entry ? "active" : ""}
            onClick={() => onTool(entry)}
            aria-pressed={tool === entry}
          >{entry}</button>
        ))}
        <label>Color <input type="color" value={color} onChange={(event) => onColor(event.target.value)} /></label>
        <label>Weight
          <input
            type="range"
            min="1"
            max="10"
            value={weight}
            onChange={(event) => onWeight(Number(event.target.value))}
          />
        </label>
        {tool === "text" && (
          <label>Text <input value={text} onChange={(event) => onText(event.target.value)} /></label>
        )}
        <button onClick={onUndo} disabled={!canUndo}>Undo</button>
        <button onClick={onRedo} disabled={!canRedo}>Redo</button>
      </div>
      <p className="markup-comment-hint">
        {tool === "delete"
          ? "Click a stroke to remove it. Markup is anchored to the model, so it stays where you drew it."
          : walking
            ? "Drag to draw — while markup is armed, look around with the right mouse button."
            : "Drag on the model to draw. Strokes are anchored in the model's space, not on the screen."}
      </p>
    </div>
  );
}
