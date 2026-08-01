"use client";

/**
 * The 3D comment pins.
 *
 * Every pin carries a world-space anchor, so its screen position is recomputed
 * from the live camera each frame rather than stored — that projection loop is
 * the whole of this file's behaviour and is unchanged. What a pin *is* changed:
 * a square numbered by the comment's place in the full list, which opens the
 * Comments panel instead of a card floating over the model.
 */
import { useEffect, useRef } from "react";

import type { ModelComment } from "./viewer-tools.ts";

export type CommentProjection = {
  x: number;
  y: number;
  visible: boolean;
};

export function ModelCommentLayer({
  comments,
  visibleIds,
  activeId,
  project,
  onActivate,
}: {
  /** Every comment on the model, in creation order — pin numbers come from it. */
  comments: readonly ModelComment[];
  /** The ids the comment filter is showing, or null for all of them. */
  visibleIds: ReadonlySet<string> | null;
  activeId: string | null;
  project: (comment: ModelComment) => CommentProjection | null;
  onActivate: (id: string | null) => void;
}) {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const shown = comments.filter((comment) => !visibleIds || visibleIds.has(comment.id));

  useEffect(() => {
    let frame = 0;
    const place = () => {
      for (const comment of comments) {
        const node = nodesRef.current.get(comment.id);
        if (!node) continue;
        const point = project(comment);
        if (!point?.visible) {
          node.style.visibility = "hidden";
          continue;
        }
        node.style.visibility = "visible";
        node.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)`;
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [comments, project]);

  return (
    <div className="model-comment-layer" aria-label="3D model comments">
      {shown.map((comment) => {
        const active = activeId === comment.id;
        // The number is the comment's index in the whole list, so filtering the
        // panel never renumbers the pins that are still on screen.
        const number = comments.indexOf(comment) + 1;
        return (
          <div
            key={comment.id}
            className={`model-comment${active ? " active" : ""}${comment.status === "resolved" ? " resolved" : ""}`}
            ref={(node) => {
              if (node) nodesRef.current.set(comment.id, node);
              else nodesRef.current.delete(comment.id);
            }}
          >
            <button
              type="button"
              className="model-comment-pin"
              aria-label={`Comment ${number}: ${comment.text || "Untitled"}`}
              aria-pressed={active}
              onClick={() => onActivate(active ? null : comment.id)}
            >{number}</button>
          </div>
        );
      })}
    </div>
  );
}
