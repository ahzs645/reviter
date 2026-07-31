"use client";

/**
 * The local-file utilities: family library, DWG preview, OmniClass, shared
 * parameters, and the personal Revit 2021 API tables.
 *
 * None of these are about the model that is open — they read other files from
 * disk — which is why they are one tab of the report dock rather than a
 * permanent rail beside the viewport, where they used to sit. Each owns its own
 * state, so nothing here is loaded until the tab is.
 */
import { useEffect, useMemo, useState } from "react";

import {
  compareSharedParameterDocuments,
  downloadBlob,
  dwgThumbnailBlob,
  extractDwgThumbnail,
  indexFamilyLibraryFiles,
  loadBundledOmniClassTaxonomy,
  loadLegacyRevit2021Api,
  mergeSharedParameterDocuments,
  parseSharedParameterBytes,
  searchFamilyLibrary,
  searchOmniClassTaxonomy,
  validateSharedParameterDocument,
  writeSharedParameterFile,
  type DecodedSharedParameterDocument,
  type FamilyLibraryIndex,
  type LegacyRevit2021Api,
  type OmniClassItem,
} from "../../lib/reviter";

function BlobThumbnail({ blob, alt }: { blob?: Blob; alt: string }) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="toolkit-thumb" src={url} alt={alt} />
    : <span className="toolkit-fallback">RFA</span>;
}

function Filter({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rv-search" style={{ marginTop: 10, maxWidth: 320 }}>
      <input
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Toolkit({ onOpenFile }: { onOpenFile: (file: File) => void }) {
  const [familyLibrary, setFamilyLibrary] = useState<FamilyLibraryIndex | null>(null);
  const [familySearch, setFamilySearch] = useState("");
  const [familyBusy, setFamilyBusy] = useState(false);
  const [familyMessage, setFamilyMessage] = useState("Choose a folder containing .rfa files");
  const [dwgPreview, setDwgPreview] = useState<{
    url: string;
    fileName: string;
    width?: number;
    height?: number;
  } | null>(null);
  const [dwgError, setDwgError] = useState<string | null>(null);
  const [omniClass, setOmniClass] = useState<OmniClassItem[] | null>(null);
  const [omniSearch, setOmniSearch] = useState("");
  const [omniBusy, setOmniBusy] = useState(false);
  const [omniError, setOmniError] = useState<string | null>(null);
  const [sharedFiles, setSharedFiles] = useState<Array<{
    name: string;
    decoded: DecodedSharedParameterDocument;
  }>>([]);
  const [legacyApi, setLegacyApi] = useState<LegacyRevit2021Api | null>(null);
  const [legacySearch, setLegacySearch] = useState("");
  const [legacyLoading, setLegacyLoading] = useState(false);
  const [legacyError, setLegacyError] = useState<string | null>(null);

  useEffect(() => () => {
    if (dwgPreview) URL.revokeObjectURL(dwgPreview.url);
  }, [dwgPreview]);

  const familyMatches = useMemo(
    () => familyLibrary ? searchFamilyLibrary(familyLibrary, familySearch, 30) : [],
    [familyLibrary, familySearch],
  );
  const omniMatches = useMemo(
    () => omniClass && omniSearch.trim() ? searchOmniClassTaxonomy(omniClass, omniSearch, 60) : [],
    [omniClass, omniSearch],
  );
  const legacyMatches = useMemo(
    () => legacyApi && legacySearch.trim() ? legacyApi.search(legacySearch, 60) : [],
    [legacyApi, legacySearch],
  );
  const mergedSharedParameters = useMemo(
    () => sharedFiles.length
      ? mergeSharedParameterDocuments(sharedFiles.map((file) => file.decoded.document))
      : null,
    [sharedFiles],
  );
  const sharedIssues = useMemo(
    () => mergedSharedParameters ? validateSharedParameterDocument(mergedSharedParameters) : [],
    [mergedSharedParameters],
  );
  const sharedComparison = useMemo(
    () => sharedFiles.length >= 2
      ? compareSharedParameterDocuments(sharedFiles[0]!.decoded.document, sharedFiles[1]!.decoded.document)
      : null,
    [sharedFiles],
  );

  const loadOmniClass = async () => {
    if (omniClass) return omniClass;
    setOmniBusy(true);
    setOmniError(null);
    try {
      const taxonomy = await loadBundledOmniClassTaxonomy();
      setOmniClass(taxonomy);
      setOmniSearch((current) => current || "23.10");
      return taxonomy;
    } catch (caught) {
      setOmniError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setOmniBusy(false);
    }
  };

  const processFamilyFolder = async (selected: File[]) => {
    setFamilyBusy(true);
    setFamilyMessage("Loading OmniClass taxonomy");
    try {
      const taxonomy = await loadOmniClass();
      setFamilyMessage("Indexing local Revit families");
      const index = await indexFamilyLibraryFiles(selected, {
        ...(taxonomy ? { taxonomy } : {}),
        onProgress: ({ completed, total, fileName }) => {
          setFamilyMessage(
            total
              ? `${completed.toLocaleString()} / ${total.toLocaleString()} · ${fileName}`
              : "No .rfa files found",
          );
        },
      });
      setFamilyLibrary(index);
      setFamilyMessage(
        `${index.entries.length.toLocaleString()} families · ` +
        `${index.catalogFiles.toLocaleString()} type catalogs · ` +
        `${index.errors.length.toLocaleString()} errors`,
      );
    } catch (caught) {
      setFamilyMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFamilyBusy(false);
    }
  };

  const processDwgFile = async (selected: File) => {
    setDwgError(null);
    try {
      const thumbnail = extractDwgThumbnail(new Uint8Array(await selected.arrayBuffer()));
      if (!thumbnail) throw new Error("This DWG does not contain a supported embedded preview.");
      const url = URL.createObjectURL(dwgThumbnailBlob(thumbnail));
      setDwgPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          url,
          fileName: selected.name,
          ...(thumbnail.width != null ? { width: thumbnail.width } : {}),
          ...(thumbnail.height != null ? { height: thumbnail.height } : {}),
        };
      });
    } catch (caught) {
      setDwgError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const processSharedParameterFiles = async (selected: File[]) => {
    setSharedFiles(await Promise.all(selected.map(async (file) => ({
      name: file.name,
      decoded: parseSharedParameterBytes(new Uint8Array(await file.arrayBuffer())),
    }))));
  };

  const loadLegacyApi = async () => {
    setLegacyLoading(true);
    setLegacyError(null);
    try {
      setLegacyApi(await loadLegacyRevit2021Api());
      setLegacySearch((current) => current || "-2000011");
    } catch (caught) {
      setLegacyError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLegacyLoading(false);
    }
  };

  return (
    <>
      <section className="toolkit-block">
        <p className="report-heading">
          Local family library · {familyLibrary ? `${familyLibrary.entries.length.toLocaleString()} families` : "folder"}
        </p>
        <div className="report-actions">
          <label className="rv-button">
            {familyBusy ? "Indexing family folder…" : "Choose family folder"}
            <input
              className="visually-hidden"
              type="file"
              accept=".rfa,.txt"
              multiple
              disabled={familyBusy}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (selected.length) void processFamilyFolder(selected);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <span className="report-disclaimer" style={{ margin: 0 }}>{familyMessage}</span>
        </div>
        {familyLibrary && (
          <>
            <Filter
              label="Search families"
              value={familySearch}
              placeholder="manufacturer, voltage, type…"
              onChange={setFamilySearch}
            />
            <div className="toolkit-list">
              {familyMatches.slice(0, 12).map((entry) => (
                <button
                  type="button"
                  key={entry.fileName}
                  title={`Open ${entry.fileName}`}
                  onClick={() => onOpenFile(entry.sourceFile)}
                >
                  <BlobThumbnail blob={entry.thumbnail} alt="" />
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {[entry.category, entry.manufacturer, entry.voltage].filter(Boolean).join(" · ") || entry.fileName}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="toolkit-block">
        <p className="report-heading">DWG preview · local</p>
        <div className="report-actions">
          <label className="rv-button">
            Choose DWG
            <input
              className="visually-hidden"
              type="file"
              accept=".dwg"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void processDwgFile(selected);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {dwgPreview && (
          <div className="dwg-preview">
            {/* An embedded CFB preview is a local object URL, not a Next.js image asset. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dwgPreview.url} alt={`Embedded preview from ${dwgPreview.fileName}`} />
            <small>
              {dwgPreview.fileName}
              {dwgPreview.width && dwgPreview.height ? ` · ${dwgPreview.width}×${dwgPreview.height}` : ""}
            </small>
          </div>
        )}
        {dwgError && <p className="report-disclaimer">{dwgError}</p>}
      </section>

      <section className="toolkit-block">
        <p className="report-heading">
          Bundled OmniClass browser · {omniClass ? `${omniClass.length.toLocaleString()} rows` : "optional"}
        </p>
        {omniClass ? (
          <>
            <Filter
              label="Number, title, or category ID"
              value={omniSearch}
              placeholder="23.10, retaining wall…"
              onChange={setOmniSearch}
            />
            <div className="table-scroll">
              <table className="data-table">
                <tbody>
                  {omniMatches.map((item) => (
                    <tr key={`${item.number}-${item.title}-${item.categoryId ?? ""}`}>
                      <td>{item.number}</td>
                      <td>{item.title}</td>
                      <td>Level {item.level}</td>
                      <td>{item.categoryId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="report-actions">
            <button type="button" className="rv-button" disabled={omniBusy} onClick={() => void loadOmniClass()}>
              {omniBusy ? "Loading classifications…" : "Load OmniClass editions"}
            </button>
          </div>
        )}
        {omniError && <p className="report-disclaimer">{omniError}</p>}
      </section>

      <section className="toolkit-block">
        <p className="report-heading">
          Shared-parameter manager · {sharedFiles.length ? `${sharedFiles.length} files` : "local files"}
        </p>
        <div className="report-actions">
          <label className="rv-button">
            Choose shared-parameter files
            <input
              className="visually-hidden"
              type="file"
              accept=".txt"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                if (selected.length) void processSharedParameterFiles(selected);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {mergedSharedParameters && (
            <button
              type="button"
              className="rv-button"
              onClick={() => downloadBlob(
                new Blob([writeSharedParameterFile(mergedSharedParameters)], { type: "text/plain;charset=utf-8" }),
                "merged-shared-parameters.txt",
              )}
            >Download merged file</button>
          )}
        </div>
        {mergedSharedParameters && (
          <>
            <div className="toolkit-chips">
              <span>{mergedSharedParameters.groups.length.toLocaleString()} groups</span>
              <span>{mergedSharedParameters.parameters.length.toLocaleString()} parameters</span>
              <span>{sharedIssues.filter((issue) => issue.severity === "error").length} errors</span>
              <span>{sharedIssues.filter((issue) => issue.severity === "warning").length} warnings</span>
            </div>
            {sharedComparison && (
              <p className="report-disclaimer">
                First-two-file comparison: {sharedComparison.added.length} added ·{" "}
                {sharedComparison.removed.length} removed · {sharedComparison.renamed.length} renamed ·{" "}
                {sharedComparison.incompatibleDataTypes.length} incompatible datatypes ·{" "}
                {sharedComparison.movedGroups.length} regrouped.
              </p>
            )}
            {sharedIssues.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {sharedIssues.slice(0, 30).map((issue, index) => (
                      <tr key={`${issue.code}-${issue.guid ?? issue.groupId ?? index}`}>
                        <td>{issue.severity}</td>
                        <td>{issue.code}</td>
                        <td>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="toolkit-block">
        <p className="report-heading">
          Personal Revit 2021 API vocabulary · {legacyApi ? "5,426 enum members" : "optional · lazy loaded"}
        </p>
        {legacyApi ? (
          <>
            <Filter
              label="ID or enum member"
              value={legacySearch}
              placeholder="-2000011, OST_Walls, SupplyAir…"
              onChange={setLegacySearch}
            />
            <div className="table-scroll">
              <table className="data-table">
                <tbody>
                  {legacyMatches.map((entry, index) => (
                    <tr key={`${entry.enumName}-${entry.name}-${index}`}>
                      <td>{entry.enumName}</td>
                      <td>{entry.name}</td>
                      <td>{entry.value}</td>
                      <td>{entry.label ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-disclaimer">
              Personal compatibility data transposed from the toolkit&apos;s Revit 2021 decompiled
              folder; it is not geometry-decoder evidence.
            </p>
          </>
        ) : (
          <>
            <p className="report-disclaimer" style={{ marginTop: 0 }}>
              Load the transposed RevitAPI compatibility tables to inspect legacy IDs, aliases,
              parameter groups, MEP classifications, units, and symbols.
            </p>
            <div className="report-actions">
              <button type="button" className="rv-button" disabled={legacyLoading} onClick={() => void loadLegacyApi()}>
                {legacyLoading ? "Loading compatibility data…" : "Load legacy API data"}
              </button>
            </div>
          </>
        )}
        {legacyError && <p className="report-disclaimer">{legacyError}</p>}
      </section>
    </>
  );
}
