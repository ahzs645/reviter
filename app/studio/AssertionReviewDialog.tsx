"use client";

/**
 * The last look before an assertion leaves in a file.
 *
 * Grouped by element, decoded on the left and asserted on the right, because
 * "17 changes" tells a reviewer nothing about whether the seventeenth was the
 * one they meant. The confirm button re-derives the rows from live state and
 * refuses when they no longer match what is on screen — the export path is the
 * one place where reviewing a stale list is worse than not reviewing at all.
 */
import { ArrowRight, TriangleAlert, X } from "lucide-react";

import type { AssertionReviewRow } from "./assertion-review.ts";

export function AssertionReviewDialog({
  rows,
  stale,
  onCancel,
  onConfirm,
}: {
  rows: readonly AssertionReviewRow[];
  /** Set when a confirm was refused because the assertions moved underneath it. */
  stale: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const changeCount = rows.reduce((total, row) => total + row.changes.length, 0);

  return (
    <div className="assertion-review-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="assertion-review"
        role="dialog"
        aria-modal="true"
        aria-label="Review assertions before export"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assertion-review-header">
          <div>
            <strong>Review before export</strong>
            <span>
              {changeCount.toLocaleString()} assertion{changeCount === 1 ? "" : "s"} across{" "}
              {rows.length.toLocaleString()} element{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            className="rv-icon-button"
            aria-label="Cancel export"
            title="Cancel"
            onClick={onCancel}
          ><X size={15} aria-hidden /></button>
        </div>

        {stale && (
          <p className="assertion-review-stale" role="alert">
            <TriangleAlert size={13} aria-hidden />
            The assertions changed while this was open. The list below is the current
            one — read it again before exporting.
          </p>
        )}

        <div className="assertion-review-body">
          {rows.map((row) => (
            <div className="assertion-review-row" key={row.elementId}>
              <div className="assertion-review-element">
                <strong>Element {row.elementId}</strong>
                <span>{row.decodedCategory}</span>
                {row.orphaned && (
                  <span className="assertion-review-orphan">
                    not in this conversion — will not be exported
                  </span>
                )}
              </div>
              <dl>
                {row.changes.map((change) => (
                  <div key={change.field}>
                    <dt>{change.label}</dt>
                    <dd>
                      <span className="assertion-review-decoded">
                        {change.decoded ?? "—"}
                      </span>
                      <ArrowRight size={12} aria-hidden />
                      <span className="assertion-review-asserted">{change.asserted}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <div className="assertion-review-actions">
          <p>
            Assertions are exported flagged with what the decoder had said, so a
            reader can tell them from the recovery.
          </p>
          <div>
            <button type="button" className="rv-button" onClick={onCancel}>Cancel</button>
            <button type="button" className="rv-button primary" onClick={onConfirm}>
              Export with {changeCount.toLocaleString()} assertion{changeCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
