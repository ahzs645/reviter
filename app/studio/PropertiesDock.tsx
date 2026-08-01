"use client";

/**
 * The right dock: what is selected, and how honest the geometry behind it is.
 *
 * The collapsible "How this geometry was made" at the bottom replaces the
 * sixteen-row fidelity ledger that used to fill the left rail. It carries the
 * same admission — this is a recovery, not a native decode — in four rows
 * instead of a wall of them, and it is present whether or not anything is
 * selected.
 */
import { ChevronDown, ChevronUp, MousePointerClick, TriangleAlert, X } from "lucide-react";

import type { PropertyRow } from "./types.ts";

export type EvidenceRow = {
  label: string;
  value: string;
  tone: "good" | "warn" | "off";
};

export function PropertiesDock({
  title,
  subtitle,
  rows,
  copyLabel,
  evidenceOpen,
  evidenceSummary,
  evidenceRows,
  onClose,
  onZoom,
  onCopy,
  onToggleEvidence,
}: {
  title: string;
  subtitle: string;
  rows: readonly PropertyRow[];
  copyLabel: string;
  evidenceOpen: boolean;
  evidenceSummary: string;
  evidenceRows: readonly EvidenceRow[];
  onClose: () => void;
  onZoom: () => void;
  onCopy: () => void;
  onToggleEvidence: () => void;
}) {
  return (
    <aside className="right-dock" aria-label="Element properties">
      <div className="properties-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <button
          type="button"
          className="rv-icon-button"
          aria-label="Close properties"
          title="Close"
          onClick={onClose}
        ><X size={15} aria-hidden /></button>
      </div>

      {rows.length ? (
        <>
          <dl className="property-rows">
            {rows.map((row) => (
              <div className="property-row" key={row.key}>
                <dt>{row.label}</dt>
                <dd title={row.value}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="property-actions">
            <button type="button" className="rv-button" onClick={onZoom}>Zoom to object</button>
            <button type="button" className="rv-button" aria-live="polite" onClick={onCopy}>{copyLabel}</button>
          </div>
        </>
      ) : (
        <div className="properties-empty">
          <MousePointerClick size={22} aria-hidden />
          <strong>Nothing selected</strong>
          <p>Pick an object in the viewport or choose one from the list.</p>
        </div>
      )}

      <div className="evidence">
        <button
          type="button"
          className="evidence-toggle"
          aria-expanded={evidenceOpen}
          onClick={onToggleEvidence}
        >
          <TriangleAlert size={13} aria-hidden />
          How this geometry was made
          {evidenceOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
        {evidenceOpen && (
          <div className="evidence-body">
            <p>{evidenceSummary}</p>
            {evidenceRows.map((row) => (
              <div className="evidence-row" key={row.label}>
                <span>{row.label}</span>
                <span className={`tone-${row.tone}`}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
