/** Source-owned annotation preview. This is a parallel view-plane projection,
 * not a regenerated Revit sheet, crop result, family glyph or indoor boundary.
 * Native ownership/provenance gates are centralized in native-record-inventory.
 */
import { nativeDetailArc, type NativeDetailArc } from "./native-drawing-arcs.ts";
import * as DMath from "./deterministic-math.ts";
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";
import { buildNativeRecordInventory, type NativeInventoryRecord } from "./native-record-inventory.ts";

type Vec = [number, number, number];
export type NativeDrawingPreview = {
  kind: "native-drawing-preview"; status: "partial" | "unsupported";
  sourceSha256: string | null; viewId: string; viewName: string | null;
  svg: string | null; renderedElementIds: string[];
  sourceSelection: { status: string; retainedRecords: number; projectedRecords: number; schemaSha256: string | null; revitVersion: number | null };
  viewSource: NativeInventoryRecord["source"] | null;
  primitives: { elementId: string; kind: "straight-leader" | "text" | "tag-head-marker" | "bounded-dimension-line" | "source-detail-line" | "source-detail-arc" | "source-detail-circle"; pointsFeet: number[][]; sourceFields: string[]; rawRecordIndex: number; recordSource: NativeInventoryRecord["source"]; text?: string; curve?: Pick<NativeDetailArc,"centerFeet"|"xDirection"|"yDirection"|"radiusFeet"|"storedIntervalRadians"|"evaluatedIntervalRadians"> }[];
  omitted: { elementId: string; reason: string }[]; diagnostics: string[];
};
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const scalar = (record: NativeInventoryRecord, field: string) => record.values[field]?.value;
const vec = (value: unknown): Vec | null => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9) ? value as Vec : null;
const dot = (a: Vec, b: Vec) => a.reduce((s, n, i) => s + n * b[i], 0);
const subtract = (a: Vec, b: Vec): Vec => a.map((n, i) => n - b[i]) as Vec;
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Bounded plain-text extraction only. Destinations are skipped, no fields or
 * pictures are evaluated, and all font metrics/formatting remain unresolved.
 * RTF fs is half-points; one point is 1/864 foot on paper. */
export function extractNativeRtfPlainText(bytes: unknown): { text: string | null; firstFontSizeHalfPoints: number | null; diagnostics: string[] } {
  const fail = (reason: string) => ({ text: null, firstFontSizeHalfPoints: null, diagnostics: [reason] });
  if (!Array.isArray(bytes) || bytes.length > 262_144 || bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return fail("RTF byte shape/limit is unsupported.");
  const input = new TextDecoder("windows-1252").decode(Uint8Array.from(bytes)).replace(/\0+$/, "");
  if (!input.startsWith("{\\rtf1")) return fail("Owned bytes are not supported RTF1.");
  type State = { skip: boolean; hidden: boolean; uc: number };
  let state: State = { skip: false, hidden: false, uc: 1 }, text = "", firstFontSizeHalfPoints: number | null = null, fallback = 0;
  const stack: State[] = [];
  const append = (s: string) => { if (!state.skip && !state.hidden) { if (fallback) { fallback--; return; } text += s; } };
  for (let i = 0; i < input.length;) {
    if (text.length > 8192 || stack.length > 64) return fail("RTF text/group depth budget exceeded.");
    const ch = input[i++];
    if (ch === "{") { stack.push({ ...state }); continue; }
    if (ch === "}") { const previous = stack.pop(); if (!previous) return fail("Unbalanced RTF groups."); state = previous; continue; }
    if (ch !== "\\") { if (ch !== "\r" && ch !== "\n") append(ch); continue; }
    const next = input[i++];
    if (next === "\\" || next === "{" || next === "}") { append(next); continue; }
    if (next === "*") { state.skip = true; continue; }
    if (next === "'") {
      const hex = input.slice(i, i + 2); if (!/^[a-f\d]{2}$/i.test(hex)) return fail("Invalid RTF hex escape.");
      append(new TextDecoder("windows-1252").decode(Uint8Array.of(parseInt(hex, 16)))); i += 2; continue;
    }
    if (next === "~") { append("\u00a0"); continue; }
    if (next === "-") { append("\u00ad"); continue; }
    if (!next || !/[a-z]/i.test(next)) continue;
    const match = input.slice(i - 1).match(/^([a-z]+)(-?\d+)? ?/i)!;
    i = i - 1 + match[0].length;
    const control = match[1], number = match[2] === undefined ? null : Number(match[2]);
    if (["bin","upr","trowd","mac","pc","pca"].includes(control)) return fail("Binary, alternate Unicode, table or non-ANSI RTF is unsupported.");
    if (["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "field", "fldinst", "fldrslt", "header", "footer", "footnote"].includes(control)) { state.skip = true; continue; }
    if (state.skip) continue;
    if (control === "v" || control === "deleted") { state.hidden = number !== 0; continue; }
    if (control === "ansicpg" && number !== 1252) return fail("RTF code page is unsupported; bytes are retained.");
    if (control === "uc") { if (number === null || number < 0 || number > 16) return fail("RTF Unicode fallback length is unsupported."); state.uc = number; }
    else if (control === "u") { if (number === null || number < -32768 || number > 32767) return fail("RTF Unicode value is invalid."); if (!state.hidden) text += String.fromCharCode(number < 0 ? number + 65536 : number); fallback = state.uc; }
    else if (control === "par" || control === "line") append("\n");
    else if (control === "tab") append("\t");
    else if (control === "fs" && number !== null && firstFontSizeHalfPoints === null && number > 0 && number <= 2000) firstFontSizeHalfPoints = number;
  }
  if (stack.length) return fail("Unbalanced RTF groups.");
  return { text: text.replace(/\n+$/, ""), firstFontSizeHalfPoints, diagnostics: ["RTF plain text only: font substitution, alignment, wrapping and formatting are unresolved."] };
}

export function listNativeDrawingViews(report: NativeEvidenceReport): { elementId: string; name: string; className: string }[] {
  return buildNativeRecordInventory(report).records.filter(r => ["DBViewPlan", "DBViewSection", "DBViewDrafting", "DBViewLegend"].includes(r.className) && scalar(r, "isTemplate") === false)
    .map(r => ({ elementId: r.elementId, name: typeof scalar(r, "name") === "string" ? scalar(r, "name") as string : r.elementId, className: r.className }));
}

export function makeNativeDrawingSvg(report: NativeEvidenceReport, options: { viewId: string; maxAnnotations?: number }): NativeDrawingPreview {
  const output: NativeDrawingPreview = {
    kind: "native-drawing-preview", status: "unsupported", sourceSha256: report.sourceSha256, viewId: options.viewId, viewName: null,
    svg: null, renderedElementIds: [], sourceSelection: {status: report.source.status, retainedRecords: report.source.records.length, projectedRecords:0, schemaSha256:null,revitVersion:null}, viewSource:null, primitives: [], omitted: [], diagnostics: [
      "Partial source annotation preview: model geometry, category/template/filter visibility, crop boundaries, family glyphs, dimension formatting and sheet layout are unresolved.",
      "Only exact owner-view IDs are selected; primary/dependent-view inheritance is not evaluated. Coordinates use the stored parallel view frame in Revit feet.",
      "Only stored straight text leaders are drawn; curved leaders are omitted. Tag head markers show source positions, not family glyphs or tag text.",
      "SVG framing uses annotation extents for presentation; these extents are not native drawing lines or indoor enclosures.",
    ],
  };
  if (!/^[1-9]\d{0,19}$/.test(options.viewId)) { output.diagnostics.push("A positive exact native view ID is required."); return output; }
  const inventory = buildNativeRecordInventory(report), views = inventory.records.filter(r => r.elementId === options.viewId && ["DBViewPlan", "DBViewSection", "DBViewDrafting", "DBViewLegend"].includes(r.className));
  output.sourceSelection = {status: report.source.status, retainedRecords:report.source.records.length,projectedRecords:inventory.records.length,schemaSha256:inventory.schemaSha256,revitVersion:inventory.revitVersion};
  if (report.source.status !== "complete") output.diagnostics.push(`Source selection is ${report.source.status}; annotations outside retained records may be absent. Inspect source evidence selection budgets and diagnostics.`);
  if (views.length !== 1 || scalar(views[0], "isTemplate") !== false) { output.diagnostics.push("The selected non-template 2D view is absent or unresolved in the source selection."); return output; }
  const view = views[0], origin = vec(scalar(view, "originFeet")), x = vec(scalar(view, "horizontalDirection")), y = vec(scalar(view, "verticalDirection")), z = vec(scalar(view, "viewDirection"));
  output.viewSource = view.source;
  output.viewName = typeof scalar(view, "name") === "string" ? scalar(view, "name") as string : null;
  if (!origin || !x || !y || !z || [x, y, z].some(v => Math.abs(norm(v) - 1) > 1e-6) || Math.abs(dot(x, y)) > 1e-6 || Math.abs(dot(x, z)) > 1e-6 || Math.abs(dot(y, z)) > 1e-6 || dot([x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0]], z) < 1-1e-6) { output.diagnostics.push("The stored frame is missing, non-orthonormal or not right-handed."); return output; }
  const project = (p: Vec): [number, number] => { const d = subtract(p, origin); return [dot(d, x), -dot(d, y)]; };
  const hidden = new Set(Array.isArray(scalar(view, "explicitlyHiddenElementIds")) ? scalar(view, "explicitlyHiddenElementIds") as string[] : []);
  const max = finite(options.maxAnnotations ?? 1000) ? Math.min(2048, Math.max(1, Math.floor(options.maxAnnotations ?? 1000))) : 1000, owners = inventory.records.filter(r => scalar(r, "ownerViewId") === options.viewId && !r.className.startsWith("DBView"));
  const shapes: string[] = [], bounds: number[][] = [], scale = scalar(view, "storedScaleRatio");
  const coordinates = (points: Vec[]) => points.map(project).map(p => p.map(n => Number(n.toPrecision(12))).join(",")).join(" ");
  const retain = (record: NativeInventoryRecord, kind: NativeDrawingPreview["primitives"][number]["kind"], points: Vec[], sourceFields: string[], text?: string) => {
    output.primitives.push({ elementId: record.elementId, kind, pointsFeet: points, sourceFields, rawRecordIndex:record.rawRecordIndex, recordSource:record.source, ...(text === undefined ? {} : { text }) });
    if (!output.renderedElementIds.includes(record.elementId)) output.renderedElementIds.push(record.elementId);
    bounds.push(...points.map(project));
  };
  owners.forEach((record, index) => {
    if (index >= max) { output.omitted.push({ elementId: record.elementId, reason: "Annotation retention budget." }); return; }
    if (hidden.has(record.elementId)) { output.omitted.push({ elementId: record.elementId, reason: "Explicitly hidden in the exact source view." }); return; }
    const before = output.primitives.length;
    if (record.kind === "text-note") {
      for (const key of Object.keys(record.values).filter(k => /^leader\d+Straight$/.test(k))) {
        const prefix = key.replace("Straight", ""), fields = ["AnchorFeet", "ElbowFeet", "EndFeet"].map(k => prefix + k), points = fields.map(k => vec(scalar(record, k)));
        if (scalar(record, key) === true && points.every((p): p is Vec => p !== null)) {
          shapes.push(`<polyline data-element-id="${xml(record.elementId)}" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke" points="${coordinates(points)}"/>`);
          retain(record, "straight-leader", points, [...fields, key]);
        }
      }
      const point = vec(scalar(record, "originFeet")), base = vec(scalar(record, "baseDirection")), up = vec(scalar(record, "upDirection")), rtf = extractNativeRtfPlainText(scalar(record, "storedRtfBytes"));
      const fontsize = rtf.firstFontSizeHalfPoints !== null && finite(scale) && scale > 0 && scale <= 1 ? rtf.firstFontSizeHalfPoints / (2 * 864 * scale) : null;
      if (point && base && up && rtf.text && fontsize !== null && Math.abs(norm(base)-1) < 1e-6 && Math.abs(norm(up)-1) < 1e-6 && Math.abs(dot(base,up)) < 1e-6 && Math.abs(dot(base,z)) < 1e-6 && Math.abs(dot(up,z)) < 1e-6 && dot([base[1]*up[2]-base[2]*up[1],base[2]*up[0]-base[0]*up[2],base[0]*up[1]-base[1]*up[0]],z) > 1-1e-6) {
        const p = project(point), angle = DMath.atan2(-dot(base,y), dot(base,x)) * 180 / Math.PI;
        const lines = rtf.text.split("\n"), content = lines.map((line,i) => `<tspan x="0" y="${(i+1)*fontsize}">${xml(line)}</tspan>`).join("");
        shapes.push(`<g data-element-id="${xml(record.elementId)}" transform="translate(${p.join(" ")}) rotate(${angle})"><text font-family="sans-serif" font-size="${fontsize}">${content}</text></g>`);
        retain(record, "text", [point], ["originFeet", "baseDirection", "upDirection", "storedRtfBytes"], rtf.text);
        // Presentation-only estimates; no rectangle/line is emitted for these extents.
        const width = Math.max(...lines.map(l => l.length)) * fontsize * .75, height = lines.length * fontsize * 1.3;
        for (const [localX,localY] of [[0,0],[width,0],[0,height],[width,height]]) bounds.push([p[0]+dot(base,x)*localX-dot(up,x)*localY,p[1]-dot(base,y)*localX+dot(up,y)*localY]);
      } else output.omitted.push({ elementId: record.elementId, reason: "Text placement, plane, font size or supported owned RTF is unresolved; straight owned leaders may still appear." });
    } else if (record.kind === "tag" || record.kind === "spatial-tag") {
      const point = vec(scalar(record, "headLocationFeet"));
      if (point) {
        const p = project(point); shapes.push(`<circle data-element-id="${xml(record.elementId)}" data-kind="tag-head-marker" cx="${p[0]}" cy="${p[1]}" r="0.15" fill="currentColor"><title>Stored tag head ${xml(record.elementId)}; source symbol and displayed tag text unresolved.</title></circle>`);
        retain(record, "tag-head-marker", [point], ["headLocationFeet"]);
      }
    } else if (record.kind === "linear-dimension" || (record.kind === "source-curve" && scalar(record,"detailCurve") === true && scalar(record,"usesOffsetPosition") === false)) {
      const point = vec(scalar(record, "storedLineOriginFeet")), direction = vec(scalar(record, "storedLineDirection")), interval = scalar(record, "storedLineEndParameters");
      if (point && direction && Array.isArray(interval) && interval.length === 2 && interval.every(finite) && interval[1] > interval[0] && interval.every(n=>Math.abs(n)<1e9) && Math.abs(norm(direction)-1)<1e-6 && Math.abs(dot(direction,z))<1e-6) {
        const ends = interval.map(t => point.map((n,i)=>n+direction[i]*(t as number)) as Vec);
        shapes.push(`<polyline data-element-id="${xml(record.elementId)}" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke" points="${coordinates(ends)}"/>`);
        retain(record, record.kind === "source-curve" ? "source-detail-line" : "bounded-dimension-line", ends, ["storedLineOriginFeet", "storedLineDirection", "storedLineEndParameters"]);
      }
    }
    if (record.kind === "source-curve" && scalar(record,"storedArcRadiusFeet") !== undefined) {
      const recovered = nativeDetailArc(record,{origin,right:x,up:y,normal:z});
      if(recovered.curve){
        const curve=recovered.curve;
        if(curve.svgCircle){const [cx,cy,r]=curve.svgCircle;shapes.push(`<circle data-element-id="${xml(record.elementId)}" data-kind="source-detail-circle" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke"/>`);}
        else shapes.push(`<path data-element-id="${xml(record.elementId)}" data-kind="source-detail-arc" d="${curve.svgPath}" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke"/>`);
        retain(record,curve.kind,curve.pointsFeet,curve.sourceFields);
        output.primitives.at(-1)!.curve={centerFeet:curve.centerFeet,xDirection:curve.xDirection,yDirection:curve.yDirection,radiusFeet:curve.radiusFeet,storedIntervalRadians:curve.storedIntervalRadians,evaluatedIntervalRadians:curve.evaluatedIntervalRadians};
        bounds.push(...curve.bounds2d);
      } else output.omitted.push({elementId:record.elementId,reason:recovered.reason??"Source detail arc is unresolved."});
    }
    if (output.primitives.length === before && !output.omitted.some(o => o.elementId === record.elementId)) output.omitted.push({ elementId: record.elementId, reason: "No supported finite source annotation primitive; reference points and dimensions are not regenerated." });
  });
  if (!bounds.length) { output.diagnostics.push("No supported annotation primitives were retained for the selected exact view."); return output; }
  const xs = bounds.map(p=>p[0]), ys = bounds.map(p=>p[1]), loX = Math.min(...xs), hiX = Math.max(...xs), loY = Math.min(...ys), hiY = Math.max(...ys), padding = Math.max(1, (hiX-loX)*.04, (hiY-loY)*.04);
  output.status = "partial";
  const metadata = { ...output, svg: undefined };
  output.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="${[loX-padding,loY-padding,Math.max(1,hiX-loX)+2*padding,Math.max(1,hiY-loY)+2*padding].join(" ")}" color="#1d3557"><title>${xml(output.viewName ?? options.viewId)} — partial source annotation preview</title><desc>${xml(output.diagnostics.join(" "))}</desc><metadata>${xml(JSON.stringify(metadata))}</metadata>${shapes.join("")}</svg>\n`;
  return output;
}
