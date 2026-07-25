"use client";

/** Read-only summary panels: the fidelity ledger row and the regression report. */
import type { PairedRegressionResult } from "../../lib/reviter";

export function FidelityRow({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "off" }) {
  return (
    <div className="fidelity-row">
      <span>{label}</span>
      <span className={`fidelity-value fidelity-${tone}`}><i />{value}</span>
    </div>
  );
}

export function RegressionPanel({ comparison }: { comparison: PairedRegressionResult }) {
  const reference = comparison.reference;
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

      <div className="match-evidence-grid">
        <div>
          <p className="eyebrow">Object-class matches</p>
          <div className="match-table" role="table" aria-label="IFC object class matches to RVT records">
            {reference.elementTypes.filter((row) => row.matchedRvtRecords).slice(0, 8).map((row) => (
              <div role="row" key={row.ifcType}>
                <span role="cell">{row.ifcType.replace(/^IFC/, "")}</span>
                <strong role="cell">{row.matchedRvtRecords.toLocaleString()} / {row.count.toLocaleString()}</strong>
                <small role="cell">index {row.matchedElemTable.toLocaleString()} · partition {row.matchedPartitionRecords.toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
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
