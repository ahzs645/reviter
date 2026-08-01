"use client";

/**
 * The bottom dock: what the recovery found, how far it got, what the container
 * held, and what can be taken away from it.
 *
 * Four tabs, plus `Toolkit` for the local-file utilities that used to fill the
 * left rail and are not about the open model at all.
 */
import { useState } from "react";
import { Download, FileUp, Search, X } from "lucide-react";

import type { BasicFileInfoProperties, ConvertResult, PairedRegressionResult } from "../../lib/reviter";
import { formatBytes, formatNumber, matchesFilter } from "./format.ts";
import { RegressionPanel } from "./panels.tsx";
import { Toolkit } from "./Toolkit.tsx";
import type { ReportTab } from "./types.ts";

export type ExportAction = { id: string; format: string; detail: string; run: () => void };

/**
 * What the container itself says about the file, as distinct from what the
 * recovery made of it. The embedded preview is Revit's own thumbnail — the one
 * part of this report that was not derived by Reviter at all.
 */
export type FileRecord = {
  thumbnail: string | null;
  rows: readonly { label: string; value: string }[];
  note: string | null;
};

const TABS: readonly { id: ReportTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "coverage", label: "Coverage" },
  { id: "streams", label: "Streams" },
  { id: "exports", label: "Exports" },
  { id: "toolkit", label: "Toolkit" },
];

export type ReportCheck = { label: string; value: string; tone: "good" | "warn" | "off" };

export function ReportDock({
  tab,
  onTab,
  onClose,
  result,
  comparison,
  privateFileInfo,
  metricCards,
  checks,
  fileRecord,
  exports,
  exporting,
  recoveredElementIds,
  drawnElementIds,
  exportDisclaimer,
  onImportReview,
  reviewImportMessage,
  onPairIfc,
  onPairReferenceModel,
  pairingStatus,
  ifcPairingLabel,
  referenceModelLabel,
  onOpenFile,
}: {
  tab: ReportTab;
  onTab: (tab: ReportTab) => void;
  onClose: () => void;
  result: ConvertResult;
  comparison: PairedRegressionResult | null;
  privateFileInfo: BasicFileInfoProperties | null;
  metricCards: readonly { label: string; value: string }[];
  checks: readonly ReportCheck[];
  fileRecord: FileRecord | null;
  exports: readonly ExportAction[];
  exporting: string | null;
  recoveredElementIds: Set<number>;
  drawnElementIds: Set<number>;
  exportDisclaimer: string;
  onImportReview: () => void;
  reviewImportMessage: string | null;
  onPairIfc: () => void;
  onPairReferenceModel: () => void;
  /** Progress of an in-flight IFC pairing, or null when none has been asked for. */
  pairingStatus: string | null;
  ifcPairingLabel: string;
  referenceModelLabel: string;
  onOpenFile: (file: File) => void;
}) {
  const [schemaSearch, setSchemaSearch] = useState("");
  const levels = result.levels.slice(0, 6);

  return (
    <section className="report-dock" aria-label="Recovery report">
      <div className="report-tabs" role="tablist" aria-label="Report views">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "active" : ""}
            onClick={() => onTab(entry.id)}
          >{entry.label}</button>
        ))}
        <button type="button" className="rv-icon-button" title="Close" aria-label="Close report" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="report-body">
        {tab === "summary" && (
          <>
            <div className="metric-grid">
              {metricCards.map((card) => (
                <div className="metric-card" key={card.label}>
                  <strong>{card.value}</strong>
                  <span>{card.label}</span>
                </div>
              ))}
            </div>
            <div className="check-grid">
              {checks.map((check) => (
                <div className={`check-card ${check.tone}`} key={check.label}>
                  <i />
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.value}</span>
                  </div>
                </div>
              ))}
            </div>
            {fileRecord && (
              <div className="report-block">
                <p className="report-heading">File record · read from the container</p>
                <div className="file-record">
                  {fileRecord.thumbnail
                    // An embedded CFB preview is a local object URL, not a Next.js image asset.
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={fileRecord.thumbnail} alt="Embedded Revit preview" />
                    : <span className="file-record-fallback">RVT</span>}
                  <dl>
                    {fileRecord.rows.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd title={row.value}>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {fileRecord.note && <p className="report-disclaimer">{fileRecord.note}</p>}
              </div>
            )}

            {levels.length > 0 && (
              <div className="report-block">
                <p className="report-heading">Dominant elevations</p>
                <div className="toolkit-chips">
                  {levels.map((level) => (
                    <span key={level.elevation}>
                      {level.elevation.toFixed(1)}′ · {formatNumber(level.candidates)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "coverage" && (
          <>
            {/* The two pairing controls live here because this is the tab the
                comparison fills in, and because the toolbar's IFC, Overlay and
                Reference sources point at it when they are unavailable. */}
            <div className="report-actions">
              <button type="button" className="rv-button" onClick={onPairIfc}>{ifcPairingLabel}</button>
              <button type="button" className="rv-button" onClick={onPairReferenceModel}>{referenceModelLabel}</button>
              {pairingStatus && <span className="report-disclaimer" style={{ margin: 0 }}>{pairingStatus}</span>}
            </div>
            {comparison ? (
              <RegressionPanel
                comparison={comparison}
                recoveredElementIds={recoveredElementIds}
                drawnElementIds={drawnElementIds}
              />
            ) : (
              <>
                <p className="report-disclaimer" style={{ marginTop: 0 }}>
                  Per-class coverage can only be reported against a file that already carries the
                  classes. Pair this model&apos;s IFC export to fill this tab in, and to turn on the
                  IFC and Overlay sources in the toolbar. Both files are read in this tab and never
                  uploaded.
                </p>
                {result.elementIndex && (
                  <p className="report-disclaimer">
                    {result.elementIndex.uniqueElementIds.length.toLocaleString()} indexed IDs ·{" "}
                    {result.elementIndex.partitionRecordIds.length.toLocaleString()} partition IDs are
                    ready to match against it.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {tab === "streams" && (
          <>
            {result.coverage && (
              <div className="report-block">
                <p className="report-heading">
                  Container streams · {result.coverage.fullStreams} full ·{" "}
                  {result.coverage.partialStreams} partial · {result.coverage.undecodedStreams} undecoded
                </p>
                <div className="stream-grid" role="table" aria-label="Container streams">
                  <div className="grid-head" role="row">
                    <span role="columnheader">Stream</span>
                    <span role="columnheader" className="num">Stored</span>
                    <span role="columnheader" className="num">Inflated</span>
                    <span role="columnheader">Read</span>
                  </div>
                  {result.coverage.streams.map((stream) => (
                    <div className="grid-row" role="row" key={stream.path}>
                      <span role="cell" className="path" title={stream.path}>{stream.path}</span>
                      <span role="cell" className="num">{formatBytes(stream.storedBytes)}</span>
                      <span role="cell" className="num">
                        {stream.inflatedBytes == null ? "—" : formatBytes(stream.inflatedBytes)}
                      </span>
                      <span
                        role="cell"
                        className={`note tone-${stream.depth === "full" ? "good" : stream.depth === "partial" ? "warn" : "off"}`}
                        title={stream.note}
                      >{stream.depth}</span>
                    </div>
                  ))}
                </div>
                <p className="report-disclaimer">
                  Depth is graded per stream rather than weighted by bytes: the partition stream is
                  most of the file, so counting it as covered because a decoder reads part of it
                  would overstate the result.
                </p>
              </div>
            )}

            {result.schema && result.schema.taggedClasses.length > 0 && (
              <div className="report-block">
                <p className="report-heading">
                  Embedded schema · Formats/Latest · {result.schema.taggedClasses.length} tagged classes
                  {result.schema.rejectedCandidates ? ` · ${result.schema.rejectedCandidates} rejected` : ""}
                </p>
                <label className="rv-search" style={{ margin: "0 0 10px", maxWidth: 320 }}>
                  <Search size={13} aria-hidden />
                  <input
                    value={schemaSearch}
                    onChange={(event) => setSchemaSearch(event.target.value)}
                    placeholder="Class or base class, e.g. Wall"
                    aria-label="Filter schema classes"
                  />
                </label>
                <div className="table-scroll">
                  <table className="data-table">
                    <tbody>
                      {result.schema.taggedClasses
                        .filter((entry) => matchesFilter(schemaSearch, entry.name, entry.parent))
                        .slice(0, 60)
                        .map((entry) => (
                          <tr key={`${entry.tag}-${entry.name}`}>
                            <td>{entry.name}</td>
                            <td>0x{entry.tag.toString(16).padStart(4, "0")}</td>
                            <td>{entry.parent}</td>
                            <td>{entry.version == null ? "—" : `v${entry.version}`}</td>
                            <td>
                              {entry.declaredFieldCount == null
                                ? "—"
                                : `${entry.declaredFieldCount} field${entry.declaredFieldCount === 1 ? "" : "s"} declared`}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="report-disclaimer">
                  Class names, serialization tags, and base classes are decoded from the file. Field
                  lists are declared but not walked — their layout does not close across the corpus,
                  so they are counted, not invented.
                </p>
              </div>
            )}

            {privateFileInfo && (
              <div className="report-block">
                <p className="report-heading">Local-only file metadata · excluded from exports</p>
                <table className="data-table">
                  <tbody>
                    <tr><td>Worksharing</td><td>{privateFileInfo.worksharing ?? "—"}</td></tr>
                    <tr><td>Username</td><td>{privateFileInfo.username ?? "—"}</td></tr>
                    <tr><td>Central model path</td><td>{privateFileInfo.centralModelPath ?? "—"}</td></tr>
                    <tr><td>Last save path</td><td>{privateFileInfo.lastSavePath ?? "—"}</td></tr>
                    <tr><td>Central identity</td><td>{privateFileInfo.centralModelIdentity ?? "—"}</td></tr>
                    <tr><td>Document GUID</td><td>{privateFileInfo.uniqueDocumentGuid ?? "—"}</td></tr>
                    <tr><td>Document increment</td><td>{privateFileInfo.uniqueDocumentIncrements ?? "—"}</td></tr>
                    <tr>
                      <td>Saved to central</td>
                      <td>
                        {privateFileInfo.allLocalChangesSavedToCentral == null
                          ? "—"
                          : privateFileInfo.allLocalChangesSavedToCentral ? "Yes" : "No"}
                      </td>
                    </tr>
                    <tr><td>Open workset default</td><td>{privateFileInfo.openWorksetDefault ?? "—"}</td></tr>
                    <tr><td>Build architecture</td><td>{privateFileInfo.architecture ?? "—"}</td></tr>
                    <tr><td>Locale</td><td>{privateFileInfo.locale ?? "—"}</td></tr>
                  </tbody>
                </table>
                <p className="report-disclaimer">
                  Paths and usernames are held only in this component&apos;s state and are not
                  attached to the conversion result or the JSON audit.
                </p>
              </div>
            )}
          </>
        )}

        {tab === "exports" && (
          <>
            <div className="export-grid">
              {exports.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="export-card"
                  disabled={Boolean(exporting)}
                  onClick={entry.run}
                >
                  <span>
                    <Download size={15} aria-hidden />
                    <strong>{entry.format}</strong>
                  </span>
                  <small>{exporting === entry.id ? "Writing…" : entry.detail}</small>
                </button>
              ))}
            </div>
            <div className="review-import">
              <span>
                <strong>Open a shared review</strong>
                <small>Open the matching source model, then import a comments or markup sidecar.</small>
              </span>
              <button type="button" className="rv-button" onClick={onImportReview}>
                <FileUp size={14} aria-hidden />
                Import review
              </button>
            </div>
            {reviewImportMessage && (
              <p className="review-import-status" role="status">{reviewImportMessage}</p>
            )}
            <p className="report-disclaimer">{exportDisclaimer}</p>
          </>
        )}

        {tab === "toolkit" && <Toolkit onOpenFile={onOpenFile} />}
      </div>
    </section>
  );
}
