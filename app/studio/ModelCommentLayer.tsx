"use client";

import { useEffect, useRef } from "react";

import type { ModelComment } from "./viewer-tools.ts";

export type CommentProjection = {
  x: number;
  y: number;
  visible: boolean;
};

export function ModelCommentLayer({
  comments,
  activeId,
  editing,
  project,
  onActive,
  onUpdate,
  onDelete,
  onViewpoint,
}: {
  comments: readonly ModelComment[];
  activeId: string | null;
  editing: boolean;
  project: (comment: ModelComment) => CommentProjection | null;
  onActive: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Pick<ModelComment, "text" | "status">>) => void;
  onDelete: (id: string) => void;
  onViewpoint: (comment: ModelComment) => void;
}) {
  const nodesRef = useRef(new Map<string, HTMLElement>());

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
      {comments.map((comment, index) => {
        const active = activeId === comment.id;
        return (
          <article
            key={comment.id}
            className={`model-comment${active ? " active" : ""}${comment.status === "resolved" ? " resolved" : ""}`}
            ref={(node) => {
              if (node) nodesRef.current.set(comment.id, node);
              else nodesRef.current.delete(comment.id);
            }}
          >
            <button
              className="model-comment-pin"
              aria-label={`Comment ${index + 1}: ${comment.text || "Untitled"}`}
              aria-expanded={active}
              onClick={() => onActive(active ? null : comment.id)}
            ><span>{index + 1}</span></button>
            {active && (
              <section className="model-comment-card" aria-label={`Edit comment ${index + 1}`}>
                <header>
                  <strong>3D Comment {index + 1}</strong>
                  <button onClick={() => onActive(null)} aria-label="Close comment">×</button>
                </header>
                <textarea
                  value={comment.text}
                  readOnly={!editing}
                  onChange={(event) => onUpdate(comment.id, { text: event.target.value })}
                  aria-label="Comment text"
                  placeholder="Describe the issue or review note"
                />
                <div>
                  <button onClick={() => onViewpoint(comment)}>Viewpoint</button>
                  {editing && (
                    <>
                      <button onClick={() => onUpdate(comment.id, {
                        status: comment.status === "open" ? "resolved" : "open",
                      })}>{comment.status === "open" ? "Resolve" : "Reopen"}</button>
                      <button className="danger" onClick={() => onDelete(comment.id)}>Delete</button>
                    </>
                  )}
                </div>
                <small>
                  {comment.status} · {new Date(comment.updatedAt).toLocaleString()}
                </small>
              </section>
            )}
          </article>
        );
      })}
    </div>
  );
}
