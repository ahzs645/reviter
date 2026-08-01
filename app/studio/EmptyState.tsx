"use client";

/**
 * The screen with no model on it.
 *
 * Two columns: the one thing to do, and the files you last did it to. The
 * recent list is a description of a file, not a handle to it — no browser this
 * runs in can be relied on to persist one — so a row re-opens the picker with
 * the file it is asking for named on the button.
 */
import { Clock, Trash2, Upload } from "lucide-react";

import { formatBytes } from "./format.ts";
import { fileExtensionLabel, relativeTime, type RecentFile } from "./recents.ts";

export function EmptyState({
  recents,
  error,
  onOpen,
  onRemoveRecent,
  onClearRecents,
}: {
  recents: readonly RecentFile[];
  error: string | null;
  onOpen: () => void;
  onRemoveRecent: (file: RecentFile) => void;
  onClearRecents: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-grid">
        <div>
          <p className="empty-eyebrow">Revit files, read in your browser</p>
          <h1>Open a model. Nothing leaves this machine.</h1>
          <p className="empty-lede">
            Metadata is read directly from the file. Geometry is recovered separately, in a
            worker in this tab, and always labelled as such.
          </p>
          <button type="button" className="rv-button rv-button-primary" onClick={onOpen}>
            <Upload size={16} aria-hidden />
            Open a Revit file
          </button>
          <p className="empty-formats">.rvt · .rfa · .rte · .rft — or drop a file anywhere</p>
          {error && <p className="empty-error" role="alert">{error}</p>}
        </div>

        <div className="recent-card">
          <div className="recent-head">
            <Clock size={13} aria-hidden />
            <span>Recent</span>
            {recents.length > 0 && (
              <button
                type="button"
                title="Clear recent history (source files are not deleted)"
                onClick={onClearRecents}
              >Clear all</button>
            )}
          </div>
          {recents.length ? recents.map((file) => (
            <div className="recent-row" key={`${file.name}:${file.size}`}>
              <button
                type="button"
                className="recent-open"
                title={`Open ${file.name} again`}
                onClick={onOpen}
              >
                <span className="recent-thumb">{fileExtensionLabel(file.name)}</span>
                <span>
                  <b>{file.name}</b>
                  <small>
                    {formatBytes(file.size)}
                    {file.revitVersion ? ` · Revit ${file.revitVersion}` : ""}
                    {` · ${relativeTime(file.openedAt)}`}
                  </small>
                </span>
                <span className={`recent-tag${file.status === "partial" ? " partial" : ""}`}>{file.status}</span>
              </button>
              <button
                type="button"
                className="recent-delete"
                title="Remove from Recents (does not delete the source file)"
                aria-label={`Remove ${file.name} from Recents`}
                onClick={() => onRemoveRecent(file)}
              ><Trash2 size={14} aria-hidden /></button>
            </div>
          )) : (
            <p className="recent-empty">
              Files you open are listed here. Only their name, size and release are kept — the
              file itself is never stored.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
