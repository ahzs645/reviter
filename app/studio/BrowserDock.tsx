"use client";

/**
 * The left dock: Objects, Categories, Comments.
 *
 * A docked panel rather than the floating overlay the three lists used to share
 * — they were mutually exclusive because they sat on top of the model, which is
 * exactly the constraint a dock removes.
 */
import { Eye, EyeOff, Search } from "lucide-react";

import type { ElementBoundsRecord } from "../../lib/reviter";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { ObjectList } from "./ObjectList.tsx";
import type { BrowserTab, CategoryRow, CommentFilter } from "./types.ts";
import type { ModelComment } from "./viewer-tools.ts";

export function BrowserDock({
  tab,
  onTab,
  objectCount,
  categoryCount,
  commentCount,
  search,
  onSearch,
  records,
  selectedElementId,
  onSelect,
  categories,
  emptyNote,
  hiddenCategories,
  onToggleCategory,
  onShowAllCategories,
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
}: {
  tab: BrowserTab;
  onTab: (tab: BrowserTab) => void;
  objectCount: number;
  categoryCount: number;
  commentCount: number;
  search: string;
  onSearch: (value: string) => void;
  records: ElementBoundsRecord[];
  selectedElementId: number | null;
  onSelect: (elementId: number) => void;
  categories: readonly CategoryRow[];
  /** Why the lists are empty, when they are. */
  emptyNote: string;
  hiddenCategories: ReadonlySet<string>;
  onToggleCategory: (name: string) => void;
  onShowAllCategories: () => void;
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
}) {
  const tabs: readonly { id: BrowserTab; label: string; count: number }[] = [
    { id: "objects", label: "Objects", count: objectCount },
    { id: "categories", label: "Categories", count: categoryCount },
    { id: "comments", label: "Comments", count: commentCount },
  ];

  return (
    <aside className="left-dock" aria-label="Model browser">
      <div className="tabstrip" role="tablist" aria-label="Browser views">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "active" : ""}
            onClick={() => onTab(entry.id)}
          >{entry.label}<em>{entry.count.toLocaleString()}</em></button>
        ))}
      </div>

      {tab !== "comments" && (
        <div className="dock-search">
          <label className="rv-search">
            <Search size={13} aria-hidden />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={tab === "objects" ? "Filter by id, category, type" : "Filter categories"}
              aria-label={tab === "objects" ? "Filter objects" : "Filter categories"}
            />
          </label>
        </div>
      )}

      {tab === "objects" && (
        records.length ? (
          <ObjectList
            records={records}
            selectedElementId={selectedElementId}
            onSelect={onSelect}
          />
        ) : <p className="dock-note">{emptyNote}</p>
      )}

      {tab === "categories" && (
        <>
          <div className="dock-scroll" role="list">
            {categories.length === 0 && <p className="dock-note">{emptyNote}</p>}
            {categories.map((row) => {
              const hidden = hiddenCategories.has(row.name);
              return (
                <div className={`category-row${hidden ? " off" : ""}`} role="listitem" key={row.name}>
                  <button
                    type="button"
                    className="category-eye"
                    aria-pressed={!hidden}
                    title={hidden ? `Show ${row.name}` : `Hide ${row.name}`}
                    onClick={() => onToggleCategory(row.name)}
                  >{hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}</button>
                  <span>{row.name}</span>
                  <em>{row.count.toLocaleString()}</em>
                </div>
              );
            })}
          </div>
          <div className="dock-footer">
            <button
              type="button"
              className="rv-button rv-button-quiet"
              disabled={!hiddenCategories.size}
              onClick={onShowAllCategories}
            >Show all categories</button>
          </div>
        </>
      )}

      {tab === "comments" && (
        <CommentsPanel
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
          onViewpoint={onCommentViewpoint}
          onArm={onArmComment}
        />
      )}
    </aside>
  );
}
