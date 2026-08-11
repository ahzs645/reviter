"use client";

/**
 * The comments list.
 *
 * One component behind both the Browser dock's Comments tab and the mobile
 * Comments sheet — the two differ only in row padding and button height, which
 * the stylesheet handles under `.mobile`. It replaces the card that used to
 * float beside a pin in the viewport: the pin is now only a pin, and every
 * comment is readable at once whether or not it is in view.
 */
import { MessageSquarePlus, Trash2, Video } from "lucide-react";

import type { CommentFilter } from "./types.ts";
import type { ModelComment } from "./viewer-tools.ts";

export function commentTimestamp(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  const elapsed = Math.max(0, now - at);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

const FILTERS: readonly { id: CommentFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

export function CommentsPanel({
  comments,
  visible,
  filter,
  activeId,
  armed,
  describeTarget,
  onFilter,
  onActive,
  onEdit,
  onResolve,
  onDelete,
  onViewpoint,
  onArm,
  mobile = false,
}: {
  /** Every comment, in creation order — the numbering is taken from it. */
  comments: readonly ModelComment[];
  /** The subset the filter is showing. */
  visible: readonly ModelComment[];
  filter: CommentFilter;
  activeId: string | null;
  /** True while the Comment tool is waiting for a surface to be picked. */
  armed: boolean;
  describeTarget: (comment: ModelComment) => string;
  onFilter: (filter: CommentFilter) => void;
  onActive: (id: string | null) => void;
  onEdit: (id: string, text: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onViewpoint: (id: string) => void;
  onArm: () => void;
  mobile?: boolean;
}) {
  const counts: Record<CommentFilter, number> = {
    open: comments.filter((comment) => comment.status === "open").length,
    resolved: comments.filter((comment) => comment.status === "resolved").length,
    all: comments.length,
  };

  return (
    <>
      <div className="comment-filters" role="group" aria-label="Comment status">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={filter === entry.id ? "active" : ""}
            aria-pressed={filter === entry.id}
            onClick={() => onFilter(entry.id)}
          >{entry.label}<em>{counts[entry.id]}</em></button>
        ))}
      </div>

      <div className={mobile ? undefined : "dock-scroll"}>
        {visible.length === 0 && (
          <p className="comment-empty">
            {comments.length
              ? `No ${filter} comments.`
              : "No comments yet. Pick the Comment tool and click a surface to pin one."}
          </p>
        )}
        {visible.map((comment) => {
          const active = activeId === comment.id;
          const resolved = comment.status === "resolved";
          // Numbered by position in the whole list, so filtering never
          // renumbers a comment out from under the pin it belongs to.
          const number = comments.indexOf(comment) + 1;
          return (
            <div
              key={comment.id}
              className={`comment-entry${active ? " active" : ""}${resolved ? " resolved" : ""}`}
            >
              <button
                type="button"
                className="comment-row"
                aria-expanded={active}
                onClick={() => onActive(active ? null : comment.id)}
              >
                <span className="comment-pin">{number}</span>
                <span>
                  <span className="comment-text">{comment.text || "Untitled comment"}</span>
                  <span className="comment-meta">
                    <span>{describeTarget(comment)}</span>
                    <span>{commentTimestamp(comment.updatedAt)}</span>
                  </span>
                </span>
              </button>
              {/* The editor and the delete button are on the phone too. A new
                  comment is created carrying placeholder text, so a sheet
                  without them could pin a comment but never say what it was
                  for, and never take it back. */}
              {active && (
                <div className="comment-editor">
                  <textarea
                    value={comment.text}
                    onChange={(event) => onEdit(comment.id, event.target.value)}
                    aria-label={`Comment ${number} text`}
                    placeholder="Describe the issue or review note"
                  />
                  <div className="comment-actions">
                    <button type="button" className="grow" onClick={() => onViewpoint(comment.id)}>
                      <Video size={13} aria-hidden />
                      Viewpoint
                    </button>
                    <button type="button" className="resolve" onClick={() => onResolve(comment.id)}>
                      {resolved ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="Delete comment"
                      aria-label={`Delete comment ${number}`}
                      onClick={() => onDelete(comment.id)}
                    ><Trash2 size={13} aria-hidden /></button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {mobile && (
          <div className="mobile-sheet-pad">
            <button type="button" className="mobile-new-comment" onClick={onArm}>
              <MessageSquarePlus size={16} aria-hidden />
              {armed ? "Pick a point on the model…" : "New comment"}
            </button>
          </div>
        )}
      </div>

      {!mobile && (
        <div className="dock-footer">
          <button
            type="button"
            className={`new-comment${armed ? " armed" : ""}`}
            aria-pressed={armed}
            onClick={onArm}
          >
            <MessageSquarePlus size={14} aria-hidden />
            {armed ? "Pick a point on the model…" : "New comment"}
          </button>
        </div>
      )}
    </>
  );
}
