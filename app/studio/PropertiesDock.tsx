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
import { ChevronDown, ChevronUp, MousePointerClick, Redo2, TriangleAlert, Undo2, X } from "lucide-react";

import type { AssertedCategory, ElementOverride, ElementOverridePatch } from "../../lib/reviter";
import type { PropertyProvenance, PropertyRow } from "./types.ts";

/**
 * Why a row is not a plain read.
 *
 * Only the two non-default provenances get a marker. Labelling every decoded
 * row as well would make the distinction disappear into noise, which is the
 * failure this is meant to fix rather than a smaller version of it.
 */
const PROVENANCE_TITLE: Record<Exclude<PropertyProvenance, "decoded">, string> = {
  inferred: "Derived by the decoder — not read from the file",
  edited: "Asserted by a reviewer over the recovered value",
};

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
  editEnabled,
  selectionId,
  override,
  categories,
  canUndo,
  canRedo,
  onAssert,
  onClearAssertion,
  onUndo,
  onRedo,
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
  /** The global edit switch. Every affordance below is gated on it. */
  editEnabled: boolean;
  /** Null when nothing is picked; the editor needs something to assert about. */
  selectionId: number | null;
  override: ElementOverride | null;
  /** Categories present in this building, which is what a correction picks from. */
  categories: readonly AssertedCategory[];
  canUndo: boolean;
  canRedo: boolean;
  onAssert: (patch: ElementOverridePatch) => void;
  onClearAssertion: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
              <div className="property-row" data-provenance={row.provenance} key={row.key}>
                <dt>{row.label}</dt>
                <dd title={row.value}>
                  {row.provenance !== "decoded" && (
                    <span className="property-provenance" title={PROVENANCE_TITLE[row.provenance]}>
                      {row.provenance}
                    </span>
                  )}
                  <span className="property-value">{row.value}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="property-actions">
            <button type="button" className="rv-button" onClick={onZoom}>Zoom to object</button>
            <button type="button" className="rv-button" aria-live="polite" onClick={onCopy}>{copyLabel}</button>
          </div>
          {editEnabled && selectionId != null && (
            <AssertionEditor
              override={override}
              categories={categories}
              canUndo={canUndo}
              canRedo={canRedo}
              onAssert={onAssert}
              onClear={onClearAssertion}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          )}
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

/**
 * The assertion surface: what a reviewer may say over a recovered element.
 *
 * Three fields, and the restraint is the design. Category is the one that
 * matters — 60.1% of categorised products in the supplied building carried a
 * record-code consensus rather than their own token — and it is the only field
 * whose value changes the IFC class the element is exported as. Type name is
 * offered because loadable families keep their names in blobs the decoder does
 * not read, so a reviewer supplying one is adding information rather than
 * correcting it. The note carries whatever the other two cannot express.
 *
 * Geometry is deliberately absent. A reviewer is often right that a bounds
 * envelope is the wrong shape, but "wrong" is not a shape, and a control that
 * accepted the objection without one would be inviting a claim nothing can
 * store.
 */
function AssertionEditor({
  override,
  categories,
  canUndo,
  canRedo,
  onAssert,
  onClear,
  onUndo,
  onRedo,
}: {
  override: ElementOverride | null;
  categories: readonly AssertedCategory[];
  canUndo: boolean;
  canRedo: boolean;
  onAssert: (patch: ElementOverridePatch) => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="assertion-editor">
      <div className="assertion-header">
        <strong>Assert over the recovery</strong>
        <div className="assertion-history">
          <button
            type="button"
            className="rv-icon-button"
            title="Undo assertion"
            aria-label="Undo assertion"
            disabled={!canUndo}
            onClick={onUndo}
          ><Undo2 size={14} aria-hidden /></button>
          <button
            type="button"
            className="rv-icon-button"
            title="Redo assertion"
            aria-label="Redo assertion"
            disabled={!canRedo}
            onClick={onRedo}
          ><Redo2 size={14} aria-hidden /></button>
        </div>
      </div>

      <label className="assertion-field">
        <span>Category</span>
        <select
          value={override?.category ? String(override.category.id) : ""}
          onChange={(event) => {
            const id = Number(event.target.value);
            const chosen = categories.find((category) => category.id === id);
            onAssert({ category: chosen ?? null });
          }}
        >
          <option value="">Leave as recovered</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>

      <label className="assertion-field">
        <span>Type name</span>
        <input
          type="text"
          value={override?.typeName ?? ""}
          placeholder="Leave as recovered"
          onChange={(event) => {
            const value = event.target.value;
            onAssert({ typeName: value.trim() ? value : null });
          }}
        />
      </label>

      <label className="assertion-field">
        <span>Note</span>
        <input
          type="text"
          value={override?.note ?? ""}
          placeholder="Why this was changed"
          onChange={(event) => onAssert({ note: event.target.value })}
        />
      </label>

      <p className="assertion-caveat">
        Assertions are recorded beside the recovery, never written back to the
        Revit file, and carried into the IFC export flagged with what the decoder
        had said.
      </p>

      {override && (
        <button type="button" className="rv-button" onClick={onClear}>
          Clear assertion
        </button>
      )}
    </div>
  );
}
