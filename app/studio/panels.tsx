"use client";

/** Read-only summary panels: the fidelity ledger row and the regression report. */
import { useMemo } from "react";
import { classCoverage, type PairedRegressionResult } from "../../lib/reviter";

export function FidelityRow({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "off" }) {
  return (
    <div className="fidelity-row">
      <span>{label}</span>
      <span className={`fidelity-value fidelity-${tone}`}><i />{value}</span>
    </div>
  );
}

export function RegressionPanel({
  comparison,
  drawnElementIds,
}: {
  comparison: PairedRegressionResult;
  drawnElementIds: Set<number>;
}) {
  const reference = comparison.reference;
  const coverage = useMemo(() => classCoverage(comparison, drawnElementIds), [comparison, drawnElementIds]);
  return (
    <section className={`regression-panel regression-${comparison.status}`}>
      <div className="regression-heading">
        <div>
          <p className="eyebrow">Paired RVT / IFC regression</p>
          <h3>{comparison.conclusion}</h3>
          <p>{reference.fileName} · {reference.schema} · {(reference.durationMs / 1_000).toFixed(1)}s local analysis</p>
        </div>
        <span>{comparison.status === "pass" ? "accepted" : comparison.status === "warn" ? "review" : "rejected"}</span>
      </div>

      <div className="regression-metrics">
        <div><strong>{reference.matchedElementCount.toLocaleString()}</strong><span>matched RVT records</span></div>
        <div><strong>{(comparison.identityCoverage * 100).toFixed(1)}%</strong><span>IFC tag coverage</span></div>
        <div><strong>{reference.elementCount.toLocaleString()}</strong><span>typed IFC elements</span></div>
        <div><strong>{reference.storeyCount}</strong><span>IFC storeys</span></div>
        <div><strong>{reference.triangleCount.toLocaleString()}</strong><span>IFC triangles</span></div>
      </div>

      <div className="gate-grid">
        {comparison.gates.map((gate) => (
          <div className={`gate-card gate-${gate.status}`} key={gate.id}>
            <span><i />{gate.label}</span><strong>{gate.value}</strong><p>{gate.detail}</p>
          </div>
        ))}
      </div>

      <div className="coverage-block">
        <p className="eyebrow">Coverage by object class</p>
        <p className="coverage-note">
          Every class the export carries, including the ones nothing was recovered for. Recovered means an
          element id was found in the Revit file; drawn means it reached the scene with geometry.
        </p>
        <div className="coverage-table" role="table" aria-label="Per-class coverage against the paired IFC export">
          <div role="row" className="coverage-head">
            <span role="columnheader">Class</span>
            <span role="columnheader">In export</span>
            <span role="columnheader">Recovered</span>
            <span role="columnheader">Drawn</span>
            <span role="columnheader" />
          </div>
          {coverage.map((row) => (
            <div role="row" key={row.ifcType} className={row.drawn === 0 ? "coverage-gap" : undefined}>
              <span role="cell">{row.ifcType}</span>
              <span role="cell">{row.inExport.toLocaleString()}</span>
              <span role="cell">{row.recovered.toLocaleString()}</span>
              <span role="cell">{row.drawn == null ? "—" : row.drawn.toLocaleString()}</span>
              <span role="cell" className="coverage-bar" aria-hidden="true">
                <i style={{ width: `${((row.drawn ?? 0) / row.inExport) * 100}%` }} />
                <b style={{ width: `${(row.recovered / row.inExport) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="match-evidence-grid">
        <div>
          <p className="eyebrow">Matched record samples</p>
          <div className="sample-list">
            {reference.matchedSamples.slice(0, 6).map((sample) => (
              <div key={`${sample.expressId}-${sample.revitElementId}`}>
                <strong>#{sample.revitElementId} · {sample.ifcType.replace(/^IFC/, "")}</strong>
                <span>{sample.evidence.replaceAll("-", " ")}{sample.partitionRecord ? ` · ${sample.partitionRecord.stream} chunk ${sample.partitionRecord.chunkIndex}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
