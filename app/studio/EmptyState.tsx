"use client";

/**
 * The screen with no model on it.
 *
 * Two columns: the one thing to do, and the files you last did it to. The
 * IndexedDB retains a local browser copy behind each new row, so a row can
 * reopen the parsed model without asking for the source again.
 */
import { Clock, Trash2, Upload } from "lucide-react";

import { formatBytes } from "./format.ts";
import { fileExtensionLabel, relativeTime, type RecentFile } from "./recents.ts";

export function EmptyState({
  recents,
  busy,
  error,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onClearRecents,
}: {
  recents: readonly RecentFile[];
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onOpenRecent: (file: RecentFile) => void;
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
          <button
            type="button"
            className="rv-button rv-button-primary"
            disabled={busy}
            onClick={onOpen}
          >
            <Upload size={16} aria-hidden />
            Open a Revit file
          </button>
          <p className="empty-formats">.rvt · .rfa · .rte · .rft — or drop a file anywhere</p>
          {error && <p className="empty-error" role="alert">{error}</p>}
        </div>

        <div className="recent-card" aria-busy={busy}>
          <div className="recent-head">
            <Clock size={13} aria-hidden />
            <span>Recent</span>
            {recents.length > 0 && (
              <button
                type="button"
                title="Clear recent history and browser-cached copies"
                disabled={busy}
                onClick={onClearRecents}
              >Clear all</button>
            )}
          </div>
          {recents.length ? recents.map((file) => (
            <div className="recent-row" key={`${file.name}:${file.size}:${file.lastModified ?? 0}`}>
              <button
                type="button"
                className="recent-open"
                title={busy ? "A model is already opening" : `Open ${file.name} again`}
                disabled={busy}
                onClick={() => onOpenRecent(file)}
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
                title="Remove from Recents and delete its browser-cached copy"
                aria-label={`Remove ${file.name} from Recents`}
                disabled={busy}
                onClick={() => onRemoveRecent(file)}
              ><Trash2 size={14} aria-hidden /></button>
            </div>
          )) : (
            <p className="recent-empty">
              Files you open are cached in this browser so they can be reopened without another
              file picker. Nothing is uploaded.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
