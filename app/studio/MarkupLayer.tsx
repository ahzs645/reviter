"use client";

/**
 * Markup, drawn from wherever the camera is now.
 *
 * Every stroke is a list of scene positions, so nothing about it is known until
 * it is projected — which is why this runs the same rAF loop `ModelCommentLayer`
 * uses for pins and writes into the DOM directly rather than through React
 * state. A stroke behind the camera is hidden; one you walk towards gets wider,
 * because its width is a length in the room and not a number of pixels.
 */
import { useEffect, useMemo, useRef } from "react";

import type { MarkupStroke } from "./viewer-tools.ts";

export type ScreenPoint = { x: number; y: number; visible: boolean };

export type MarkupProjection = {
  /** Screen position of each anchor, in canvas pixels. */
  points: ScreenPoint[];
  /** The stroke's world width, converted to pixels at its own depth. */
  weight: number;
  /** False when the whole stroke is behind the camera or off the near plane. */
  visible: boolean;
};

/** Rounded to keep the rewritten attribute strings short and stable. */
function pathData(points: readonly ScreenPoint[], tool: MarkupStroke["tool"]): string {
  if (!points.length) return "";
  const used = tool === "arrow" && points.length > 1 ? [points[0]!, points.at(-1)!] : points;
  return used
    .map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

export function MarkupLayer({
  strokes,
  draft,
  active,
  erasing,
  project,
  onErase,
}: {
  strokes: readonly MarkupStroke[];
  /** The stroke being drawn right now, if any. */
  draft: MarkupStroke | null;
  /** True while a markup tool is armed — only then does a stroke accept clicks. */
  active: boolean;
  erasing: boolean;
  project: (stroke: MarkupStroke) => MarkupProjection | null;
  onErase: (id: string) => void;
}) {
  const nodesRef = useRef(new Map<string, SVGGraphicsElement>());
  const hitAreaRef = useRef(new Map<string, SVGPathElement>());
  const visible = useMemo(
    () => draft ? [...strokes, draft] : strokes,
    [draft, strokes],
  );

  useEffect(() => {
    let frame = 0;
    const place = () => {
      for (const stroke of visible) {
        const node = nodesRef.current.get(stroke.id);
        if (!node) continue;
        const projection = project(stroke);
        if (!projection?.visible) {
          node.setAttribute("visibility", "hidden");
          continue;
        }
        node.setAttribute("visibility", "visible");
        if (node.tagName === "text") {
          const at = projection.points[0]!;
          node.setAttribute("x", at.x.toFixed(1));
          node.setAttribute("y", at.y.toFixed(1));
          node.setAttribute("font-size", Math.max(9, projection.weight * 5).toFixed(1));
        } else {
          const d = pathData(projection.points, stroke.tool);
          node.setAttribute("d", d);
          // Clamped generously at both ends: the width is a length in the room,
          // so it should shrink with distance, but a redline that thins to a
          // hairline across a campus-scale model is one nobody can find again.
          const weight = Math.min(64, Math.max(1, projection.weight));
          node.setAttribute("stroke-width", weight.toFixed(2));
          // The eraser needs something bigger than a 1px line to hit.
          const hitArea = hitAreaRef.current.get(stroke.id);
          if (hitArea) {
            hitArea.setAttribute("d", d);
            hitArea.setAttribute("stroke-width", Math.max(14, weight + 10).toFixed(2));
          }
          if (stroke.tool === "cloud") {
            node.setAttribute(
              "stroke-dasharray",
              `${(projection.weight * 1.6).toFixed(1)} ${(projection.weight * 2).toFixed(1)}`,
            );
          }
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [project, visible]);

  return (
    <svg
      className={`markup-layer${active ? " active" : ""}${erasing ? " erasing" : ""}`}
      aria-label="Model markup"
    >
      <defs>
        <marker id="markup-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      {visible.map((stroke) => {
        const ref = (node: SVGGraphicsElement | null) => {
          if (node) nodesRef.current.set(stroke.id, node);
          else nodesRef.current.delete(stroke.id);
        };
        const erase = () => { if (erasing) onErase(stroke.id); };
        return stroke.tool === "text" ? (
          <text key={stroke.id} ref={ref} className="markup-stroke" visibility="hidden" fill={stroke.color} onClick={erase}>
            {stroke.text}
          </text>
        ) : (
          <g key={stroke.id}>
            <path
              ref={ref}
              className="markup-stroke"
              visibility="hidden"
              fill="none"
              stroke={stroke.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={stroke.tool === "arrow" ? "url(#markup-arrow)" : undefined}
            />
            {erasing && (
              <path
                ref={(node) => {
                  if (node) hitAreaRef.current.set(stroke.id, node);
                  else hitAreaRef.current.delete(stroke.id);
                }}
                className="markup-hit"
                fill="none"
                stroke="transparent"
                strokeLinecap="round"
                strokeLinejoin="round"
                onClick={erase}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
