/** Standalone presentation of owned cached schedule cells. Reciprocal cover
 * offsets prove each rectangular span; this does not regenerate schedule rows.
 */
import type { NativeScheduleInventory, ScheduleWitness, StoredNativeSchedule, StoredScheduleCell, StoredScheduleSection } from "./native-schedule-inventory.ts";
export type CachedScheduleMerge = { top: number; bottom: number; left: number; right: number; anchorObjectIndex: number; memberObjectIndices: number[] };
export type CachedScheduleSection = { sectionCode: number; storedHidden: boolean; rowsFeet: number[]; columnsFeet: number[]; cells: StoredScheduleCell[]; merges: CachedScheduleMerge[]; source: ScheduleWitness };
export type CachedScheduleLayout = {
  status: "complete" | "partial" | "unsupported" | "budget-blocked";
  schedule: StoredNativeSchedule | null; sections: CachedScheduleSection[];
  omittedSections: Array<{ sectionCode: number; reason: string }>; diagnostics: string[];
};
export type NativeScheduleHtmlOptions = { scheduleId: string; includeHiddenSections?: boolean };
export type NativeScheduleHtmlPreview = {
  apiVersion: 1; kind: "native-cached-schedule-html"; status: CachedScheduleLayout["status"];
  sourceSha256: string | null; schemaSha256: string | null; readerCommit: string; scheduleId: string;
  html: string | null; renderedSections: number; renderedCells: number; renderedMerges: number;
  renderedCoveredCells: number; hiddenSections: number; omittedSections: CachedScheduleLayout["omittedSections"];
  diagnostics: string[]; limits: typeof LIMITS; scope: string;
};
const LIMITS = { sections: 64, cells: 10_000, columns: 1024, rows: 10_000, textCharacters: 16_384, htmlBytes: 4 * 1024 * 1024, paperFeet: 1000 } as const;
const SHA = /^[a-f0-9]{64}$/;
const finiteLength = (n: number): boolean => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= LIMITS.paperFeet;
const coordinate = (n: number): boolean => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("\r", "&#13;");
const rectKey = (top: number, bottom: number, left: number, right: number) => `${top}:${bottom}:${left}:${right}`;
function sectionLayout(section: StoredScheduleSection, cells: StoredScheduleCell[]): { section?: CachedScheduleSection; reason?: string } {
  if (!section.layoutComplete || typeof section.storedHidden !== "boolean" || !coordinate(section.sectionCode) || section.rows.length > LIMITS.rows || section.columns.length > LIMITS.columns || section.rows.length * section.columns.length > LIMITS.cells || !section.rows.every(d => finiteLength(d.valueFeet)) || !section.columns.every(d => finiteLength(d.valueFeet))) return { reason: "Owned section dimensions or visibility are incomplete, invalid or over budget." };
  const rows = section.rows.length, columns = section.columns.length;
  if (cells.length !== rows * columns || cells.length > LIMITS.cells) return { reason: "Stored cell grid is incomplete; missing cells cannot be synthesized." };
  const coordinates = new Map<string, StoredScheduleCell>(), groups = new Map<string, { top: number; bottom: number; left: number; right: number; members: StoredScheduleCell[] }>();
  for (const cell of cells) {
    if (!coordinate(cell.row) || !coordinate(cell.column) || cell.row >= rows || cell.column >= columns || typeof cell.text !== "string" || cell.text.length > LIMITS.textCharacters || cell.text.includes("\u0000")) return { reason: "Stored cell coordinates/text are outside the owned section grid." };
    const key = `${cell.row}:${cell.column}`; if (coordinates.has(key)) return { reason: "Stored cell coordinates are ambiguous." }; coordinates.set(key, cell);
    const offsets = cell.storedCoverOffsets;
    if (!offsets || ![offsets.top, offsets.bottom, offsets.left, offsets.right].every(n => typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) <= LIMITS.cells)) return { reason: "Stored cover offsets are invalid." };
    const top = cell.row + offsets.top, bottom = cell.row + offsets.bottom, left = cell.column + offsets.left, right = cell.column + offsets.right;
    if (top < 0 || bottom >= rows || left < 0 || right >= columns || top > cell.row || bottom < cell.row || left > cell.column || right < cell.column) return { reason: "Stored cover rectangle lies outside its grid or does not contain its cell." };
    const rect = rectKey(top, bottom, left, right), group = groups.get(rect) ?? { top, bottom, left, right, members: [] }; group.members.push(cell); groups.set(rect, group);
  }
  const merges: CachedScheduleMerge[] = [];
  for (const group of groups.values()) {
    const { top, bottom, left, right, members } = group, area = (bottom - top + 1) * (right - left + 1);
    if (members.length !== area) return { reason: "Stored cover rectangle lacks reciprocal membership for every covered cell." };
    const memberCoordinates = new Set(members.map(c => `${c.row}:${c.column}`));
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) if (!memberCoordinates.has(`${row}:${col}`)) return { reason: "Stored cover rectangle is not a complete reciprocal rectangle." };
    const anchor = coordinates.get(`${top}:${left}`)!;
    if (members.some(cell => (cell.row !== top || cell.column !== left) && cell.text !== "")) return { reason: "A covered non-anchor cell retains text; merging would discard stored content." };
    if (area > 1) merges.push({ top, bottom, left, right, anchorObjectIndex: anchor.source.objectIndex, memberObjectIndices: members.map(c => c.source.objectIndex).sort((a, b) => a - b) });
  }
  return { section: { sectionCode: section.sectionCode, storedHidden: section.storedHidden, rowsFeet: section.rows.map(d => d.valueFeet), columnsFeet: section.columns.map(d => d.valueFeet), cells: [...cells].sort((a, b) => a.row - b.row || a.column - b.column), merges, source: section.source } };
}
/** Qualification is deliberately stricter than a general Revit table renderer:
 * the owned cached grid must be dense, zero-based and reciprocally covered.
 */
export function buildNativeCachedScheduleLayout(inventory: NativeScheduleInventory, scheduleId: string): CachedScheduleLayout {
  const result: CachedScheduleLayout = { status: inventory.status, schedule: null, sections: [], omittedSections: [], diagnostics: [] };
  if (inventory.apiVersion !== 1 || inventory.kind !== "native-schedule-inventory" || !inventory.sourceSha256 || !SHA.test(inventory.sourceSha256) || !inventory.schemaSha256 || !SHA.test(inventory.schemaSha256) || inventory.readerCommit !== "1c3d337dbd2a6810e9dfad68fe99857843d67387" || ![2024, 2025, 2026].includes(inventory.revitVersion ?? 0)) { result.status = "unsupported"; result.diagnostics.push("Exact source/schema hashes, qualified release and pinned inventory are required."); return result; }
  if (inventory.status === "unsupported" || inventory.status === "budget-blocked") return result;
  const schedules = inventory.schedules.filter(s => s.elementId === scheduleId);
  if (schedules.length !== 1 || !/^[1-9][0-9]{0,19}$/.test(scheduleId)) { result.status = "unsupported"; result.diagnostics.push("One exact stored schedule element identity is required."); return result; }
  const schedule = schedules[0]; result.schedule = schedule;
  if (!Array.isArray(schedule.sections)) { result.status = "unsupported"; result.diagnostics.push("Owned section dimensions are absent; regenerate the native schedule inventory."); return result; }
  if (schedule.sections.length > LIMITS.sections || schedule.cells.length > LIMITS.cells) { result.status = "budget-blocked"; result.diagnostics.push("Owned section/cell inventory exceeds its layout budget."); return result; }
  const sectionCounts = new Map<number, number>(); for (const section of schedule.sections) sectionCounts.set(section.sectionCode, (sectionCounts.get(section.sectionCode) ?? 0) + 1);
  const coveredCodes = new Set<number>();
  for (const section of schedule.sections) {
    coveredCodes.add(section.sectionCode);
    if (sectionCounts.get(section.sectionCode) !== 1) { result.omittedSections.push({ sectionCode: section.sectionCode, reason: "Duplicate owned section codes are ambiguous." }); continue; }
    const qualified = sectionLayout(section, schedule.cells.filter(cell => cell.sectionCode === section.sectionCode));
    if (qualified.section) result.sections.push(qualified.section); else result.omittedSections.push({ sectionCode: section.sectionCode, reason: qualified.reason! });
  }
  for (const code of new Set(schedule.cells.map(c => c.sectionCode))) if (!coveredCodes.has(code)) result.omittedSections.push({ sectionCode: code, reason: "Stored cells have no qualified owned section dimensions." });
  if (result.omittedSections.length) result.status = result.sections.length ? "partial" : "unsupported";
  return result;
}
/** HTML is a self-contained escaped stored-cell preview, with no executable
 * content or remote resources. CSS uses source feet × 12 as paper inches.
 */
export function makeNativeScheduleHtml(inventory: NativeScheduleInventory, options: NativeScheduleHtmlOptions): NativeScheduleHtmlPreview {
  const layout = buildNativeCachedScheduleLayout(inventory, options.scheduleId);
  if (options.includeHiddenSections !== undefined && typeof options.includeHiddenSections !== "boolean") { layout.status = "unsupported"; layout.diagnostics.push("Hidden-section inclusion must be an explicit boolean."); }
  const preview: NativeScheduleHtmlPreview = { apiVersion: 1, kind: "native-cached-schedule-html", status: layout.status,
    sourceSha256: inventory.sourceSha256, schemaSha256: inventory.schemaSha256, readerCommit: inventory.readerCommit, scheduleId: options.scheduleId,
    html: null, renderedSections: 0, renderedCells: 0, renderedMerges: 0, renderedCoveredCells: 0, hiddenSections: 0,
    omittedSections: layout.omittedSections, diagnostics: layout.diagnostics, limits: LIMITS,
    scope: "Owned stored cell text and paper-space dimensions with reciprocal cover rectangles. This is a cached source preview, not recalculated Revit body rows, formulas, typography or generated quantities.",
  };
  const schedule = layout.schedule; if (!schedule || ["unsupported", "budget-blocked"].includes(layout.status)) return preview;
  // Bound text expansion before concatenating the document. The allowance for
  // fixed per-cell/row/dimension markup is conservative and remains explicit.
  let preflightBytes = 16_384 + new TextEncoder().encode(escape(schedule.name)).byteLength * 2;
  for (const section of layout.sections) {
    if (section.storedHidden && !options.includeHiddenSections) continue;
    preflightBytes += 512 + section.rowsFeet.length * 128 + section.columnsFeet.length * 160;
    for (const cell of section.cells) {
      preflightBytes += 384 + new TextEncoder().encode(escape(cell.text)).byteLength;
      if (preflightBytes > LIMITS.htmlBytes) { preview.status = "budget-blocked"; preview.diagnostics.push("Cached schedule text/markup exceeds the conservative HTML byte preflight."); return preview; }
    }
    if (preflightBytes > LIMITS.htmlBytes) { preview.status = "budget-blocked"; preview.diagnostics.push("Cached schedule dimensions exceed the conservative HTML byte preflight."); return preview; }
  }
  const sections: string[] = [];
  for (const section of layout.sections) {
    if (section.storedHidden) { preview.hiddenSections++; if (!options.includeHiddenSections) continue; }
    preview.renderedSections++; preview.renderedMerges += section.merges.length; preview.renderedCoveredCells += section.merges.reduce((n, m) => n + m.memberObjectIndices.length, 0);
    const anchors = new Map(section.merges.map(m => [`${m.top}:${m.left}`, m])), suppressed = new Set<string>();
    for (const m of section.merges) for (let row = m.top; row <= m.bottom; row++) for (let col = m.left; col <= m.right; col++) if (row !== m.top || col !== m.left) suppressed.add(`${row}:${col}`);
    const rows: string[] = [], cellsByRow = new Map<number, StoredScheduleCell[]>();
    for (const cell of section.cells) { const cells = cellsByRow.get(cell.row) ?? []; cells.push(cell); cellsByRow.set(cell.row, cells); }
    for (let row = 0; row < section.rowsFeet.length; row++) {
      const cells: string[] = [];
      for (const cell of cellsByRow.get(row) ?? []) {
        const key = `${cell.row}:${cell.column}`; if (suppressed.has(key)) continue;
        const merge = anchors.get(key), rowspan = merge ? merge.bottom - merge.top + 1 : 1, colspan = merge ? merge.right - merge.left + 1 : 1;
        preview.renderedCells++;
        cells.push(`<td data-row="${cell.row}" data-column="${cell.column}" data-source-object="${cell.source.objectIndex}" data-parameter-id="${escape(cell.parameterId ?? "")}" rowspan="${rowspan}" colspan="${colspan}">${escape(cell.text)}</td>`);
      }
      rows.push(`<tr data-row="${row}" data-height-feet="${section.rowsFeet[row]}" style="height:${(section.rowsFeet[row] * 12).toPrecision(12)}in">${cells.join("")}</tr>`);
    }
    sections.push(`<section data-section-code="${section.sectionCode}" data-stored-hidden="${section.storedHidden}"><h2>Stored section ${section.sectionCode}${section.storedHidden ? " (source hidden; explicitly included)" : ""}</h2><div class="table-scroll"><table aria-label="Stored section ${section.sectionCode}" style="width:${(section.columnsFeet.reduce((sum, feet) => sum + feet, 0) * 12).toPrecision(12)}in"><colgroup>${section.columnsFeet.map((feet, col) => `<col data-column="${col}" data-width-feet="${feet}" style="width:${(feet * 12).toPrecision(12)}in">`).join("")}</colgroup><tbody>${rows.join("")}</tbody></table></div></section>`);
  }
  const omissionText = layout.omittedSections.map(o => `Section ${o.sectionCode}: ${o.reason}`).join(" ");
  const title = escape(schedule.name), html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title} — stored schedule cells</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#17202a}h1{font-size:1.4rem}h2{font-size:1rem}.scope{max-width:90ch}.identity{overflow-wrap:anywhere;font:12px monospace}.table-scroll{overflow:auto;max-width:100%}table{border-collapse:collapse;table-layout:fixed;margin-bottom:24px}td{border:1px solid #66717d;padding:0;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top;font-size:10pt}section{margin-top:24px}</style></head><body><h1>${title}</h1><p class="scope">${escape(preview.scope)}</p><p class="identity">Schedule ${escape(schedule.elementId)} · source SHA-256 ${escape(inventory.sourceSha256!)} · schema SHA-256 ${escape(inventory.schemaSha256!)} · status ${escape(preview.status)}</p><p>${preview.hiddenSections} source-hidden section(s)${options.includeHiddenSections ? " explicitly included" : " omitted"}. ${escape(omissionText)}</p>${sections.join("")}</body></html>`;
  if (new TextEncoder().encode(html).byteLength > LIMITS.htmlBytes) { preview.status = "budget-blocked"; preview.diagnostics.push("Generated cached schedule HTML exceeds its byte budget."); return preview; }
  preview.html = html; return preview;
}
