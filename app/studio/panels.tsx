"use client";

/** The shared control that carries its own reason, and the regression report. */
import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { classCoverage, type PairedRegressionResult } from "../../lib/reviter";
import { matchesFilter } from "./format.ts";

/**
 * A control that carries its own reason for being off.
 *
 * Removing an unavailable control teaches nobody that the feature exists — the
 * geometry-source switcher hid `Reference` and `IFC` outright, so a model with
 * no paired export looked like a model that could not have one. The button is
 * only `aria-disabled`, never `disabled`, because a disabled element receives
 * no mouse events and a `title` on one never appears; the click is dropped here
 * instead, and `data-reason` is what the stylesheet shows on hover or keyboard
 * focus.
 */
export function ToolButton({
  className,
  reason,
  onClick,
  onUnavailable,
  pressed,
  role,
  title,
  ariaKeyShortcuts,
  children,
}: {
  className?: string;
  reason?: string | null;
  onClick: () => void;
  /** Optional action that can satisfy `reason`, such as choosing a missing reference file. */
  onUnavailable?: () => void;
  pressed?: boolean;
  role?: string;
  title?: string;
  ariaKeyShortcuts?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => { if (reason) onUnavailable?.(); else onClick(); }}
      aria-disabled={reason && !onUnavailable ? true : undefined}
      aria-pressed={pressed}
      aria-keyshortcuts={ariaKeyShortcuts}
      role={role}
      title={reason ?? title}
      data-reason={reason ?? undefined}
    >{children}</button>
  );
}

export function RegressionPanel({
  comparison,
  recoveredElementIds,
  drawnElementIds,
}: {
  comparison: PairedRegressionResult;
  recoveredElementIds: Set<number>;
  drawnElementIds: Set<number>;
}) {
  const reference = comparison.reference;
  const coverage = useMemo(
    () => classCoverage(comparison, recoveredElementIds, drawnElementIds),
    [comparison, drawnElementIds, recoveredElementIds],
  );
  const [classFilter, setClassFilter] = useState("");
  // Past a dozen classes the row you came to read is one you have to hunt for.
  const visibleCoverage = useMemo(
    () => coverage.filter((row) => matchesFilter(classFilter, row.ifcType)),
    [classFilter, coverage],
  );

  return (
    <section className="report-block">
      <p className="report-heading">
        Paired RVT / IFC regression ·{" "}
        {comparison.status === "pass" ? "accepted" : comparison.status === "warn" ? "review" : "rejected"}
      </p>
      <p className="report-disclaimer" style={{ marginTop: 0 }}>
        {comparison.conclusion} — {reference.fileName} · {reference.schema} ·{" "}
        {(reference.durationMs / 1_000).toFixed(1)}s local analysis.
      </p>

      <div className="metric-grid" style={{ marginTop: 12 }}>
        <div className="metric-card">
          <strong>{reference.matchedElementCount.toLocaleString()}</strong>
          <span>matched RVT records</span>
        </div>
        <div className="metric-card">
          <strong>{(comparison.identityCoverage * 100).toFixed(1)}%</strong>
          <span>IFC tag coverage</span>
        </div>
        <div className="metric-card">
          <strong>{reference.elementCount.toLocaleString()}</strong>
          <span>typed IFC elements</span>
        </div>
        <div className="metric-card">
          <strong>{reference.storeyCount}</strong>
          <span>IFC storeys</span>
        </div>
        <div className="metric-card">
          <strong>{reference.triangleCount.toLocaleString()}</strong>
          <span>IFC triangles</span>
        </div>
      </div>

      <div className="check-grid">
        {comparison.gates.map((gate) => (
          <div
            key={gate.id}
            className={`check-card ${gate.status === "pass" ? "good" : gate.status === "warn" ? "warn" : "bad"}`}
          >
            <i />
            <div>
              <strong>{gate.label}</strong>
              <span>{gate.value} · {gate.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="report-heading" style={{ marginTop: 18 }}>
        Coverage by object class ·{" "}
        {visibleCoverage.length === coverage.length
          ? `${coverage.length} classes`
          : `${visibleCoverage.length} of ${coverage.length} classes`}
      </p>
      <p className="report-disclaimer" style={{ marginTop: 0 }}>
        Every class the export carries, including the ones nothing was recovered for. <b>Seen</b> is
        an element id the scan proved is in the Revit file; <b>recovered</b> is one that yielded an
        envelope; <b>drawn</b> is one on screen. The distance between seen and recovered is decoder
        work; between recovered and drawn, display work.
      </p>
      <label className="rv-search" style={{ margin: "10px 0", maxWidth: 320 }}>
        <Search size={13} aria-hidden />
        <input
          value={classFilter}
          onChange={(event) => setClassFilter(event.target.value)}
          placeholder="Class name, e.g. Door"
          aria-label="Filter classes"
        />
      </label>
      <div className="coverage-grid" role="table" aria-label="Per-class coverage against the paired IFC export">
        <div className="grid-head" role="row">
          <span role="columnheader">Class</span>
          <span role="columnheader" className="num">In export</span>
          <span role="columnheader" className="num">Seen</span>
          <span role="columnheader" className="num">Drawn</span>
          <span role="columnheader" />
        </div>
        {visibleCoverage.map((row) => (
          <div className="grid-row" role="row" key={row.ifcType}>
            <span role="cell" className="path">{row.ifcType}</span>
            <span role="cell" className="num">{row.inExport.toLocaleString()}</span>
            <span role="cell" className="num">{row.seen.toLocaleString()}</span>
            <span role="cell" className="num">{row.drawn == null ? "—" : row.drawn.toLocaleString()}</span>
            <span role="cell" className="coverage-bar" aria-hidden="true">
              <b style={{ width: `${Math.min(100, ((row.recovered ?? 0) / row.inExport) * 100)}%` }} />
              <i style={{ width: `${Math.min(100, ((row.drawn ?? 0) / row.inExport) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <p className="report-heading" style={{ marginTop: 18 }}>Matched record samples</p>
      <div className="stream-grid">
        {reference.matchedSamples.slice(0, 6).map((sample) => (
          <div className="grid-row" role="row" key={`${sample.expressId}-${sample.revitElementId}`}>
            <span className="path">#{sample.revitElementId} · {sample.ifcType.replace(/^IFC/, "")}</span>
            <span />
            <span />
            <span className="path">
              {sample.evidence.replaceAll("-", " ")}
              {sample.partitionRecord
                ? ` · ${sample.partitionRecord.stream} chunk ${sample.partitionRecord.chunkIndex}`
                : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
