#!/usr/bin/env node
/** Produce local Chromium fixtures with expectations read independently from
 * owned source graph fields, rather than from the HTML renderer's layout.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { buildNativeScheduleInventory } from "../lib/reviter/native-schedule-inventory.ts";
import { makeNativeScheduleHtml } from "../lib/reviter/native-schedule-html.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, hasFlag, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
type Graph = { objects: Array<{ fields: Record<string, unknown> }>; edges: Array<{ source_object_index: number; pointer_offset: number; target_object_index: number }> };
type Expected = { cells: Array<{ row: number; column: number; sourceObject: number; text: string; rowspan: number; colspan: number }>; sections: Array<{ code: number; hidden: boolean }>; columns: Array<{ index: number; feet: number }>; rows: Array<{ row: number; feet: number }> };
async function run() {
  declareUsage("prepare-native-schedule-html-browser.ts model.rvt --evidence evidence.json --out-dir local-artifacts --manifest manifest.json [--adversarial-text]");
  const [input] = positionals("--evidence", "--out-dir", "--manifest"), evidencePath = optionValue("--evidence"), directory = optionValue("--out-dir"), manifestPath = optionValue("--manifest");
  if (!input || !evidencePath || !directory || !manifestPath) throw new Error("Supply the RVT, exact source evidence, output directory and manifest path.");
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as NativeEvidenceReport;
  if (report.sourceSha256 !== createHash("sha256").update(readFileSync(input)).digest("hex")) throw new Error("HTML browser evidence does not match the supplied RVT bytes.");
  const inventory = buildNativeScheduleInventory(report), label = basename(input).replace(/\.rvt$/iu, ""); mkdirSync(directory, { recursive: true });
  const entries: Array<{ label: string; path: string; sourceSha256: string | null; expected: Expected }> = [];
  for (const schedule of inventory.schedules) {
    const preview = makeNativeScheduleHtml(inventory, { scheduleId: schedule.elementId, includeHiddenSections: true }); if (!preview.html) throw new Error(`No qualified cached HTML for ${schedule.elementId}.`);
    const path = join(directory, `${label}-${schedule.elementId}.html`); writeFileSync(path, preview.html);
    const record = report.source.records[schedule.source.rawRecordIndex] as { graph: Graph }, graph = record.graph, expected: Expected = { cells: [], sections: [], columns: [], rows: [] };
    for (const section of schedule.sections) {
      const fields = graph.objects[section.source.objectIndex].fields; expected.sections.push({ code: fields.m_index as number, hidden: fields.m_hideSection as boolean });
      const target = (p: unknown) => { const pointer = p as { offset: number }; const edges = graph.edges.filter(e => e.source_object_index === section.source.objectIndex && e.pointer_offset === pointer.offset); if (edges.length !== 1) throw new Error("Ambiguous native dimension edge."); return graph.objects[edges[0].target_object_index].fields; };
      (fields.m_cols as unknown[]).forEach((p, index) => expected.columns.push({ index, feet: target(p).m_dWidth as number }));
      (fields.m_rows as unknown[]).forEach((p, row) => expected.rows.push({ row, feet: target(p).m_dHeight as number }));
      const cells = schedule.cells.filter(c => c.sectionCode === section.sectionCode).map(c => ({ objectIndex: c.source.objectIndex, fields: graph.objects[c.source.objectIndex].fields })).sort((a, b) => (a.fields.m_row as number) - (b.fields.m_row as number) || (a.fields.m_column as number) - (b.fields.m_column as number));
      for (const c of cells) { const f = c.fields; if (f.m_coverTop === 0 && f.m_coverLeft === 0) expected.cells.push({ row: f.m_row as number, column: f.m_column as number, sourceObject: c.objectIndex, text: f.m_text as string, rowspan: (f.m_coverBottom as number) - f.m_coverTop + 1, colspan: (f.m_coverRight as number) - f.m_coverLeft + 1 }); }
    }
    entries.push({ label: `${label}:${schedule.elementId}`, path, sourceSha256: inventory.sourceSha256, expected });
  }
  if (hasFlag("--adversarial-text") && inventory.schedules.length) {
    const schedule = inventory.schedules[0], cell = schedule.cells.find(c => c.storedCoverOffsets.top === 0 && c.storedCoverOffsets.left === 0); if (!cell) throw new Error("No anchor cell for the synthetic adversarial fixture.");
    cell.text = '<script>globalThis.unwanted=1</script><img src="https://private.example" onerror="globalThis.unwanted=2">\r\nRetained text';
    const preview = makeNativeScheduleHtml(inventory, { scheduleId: schedule.elementId, includeHiddenSections: true }); if (!preview.html) throw new Error("Synthetic adversarial HTML could not be produced.");
    const path = join(directory, `${label}-synthetic-adversarial-text.html`); writeFileSync(path, preview.html);
    const original = entries.find(e => e.label === `${label}:${schedule.elementId}`)!, expected = structuredClone(original.expected); expected.cells.find(c => c.sourceObject === cell.source.objectIndex)!.text = cell.text;
    entries.push({ label: `${label}:synthetic-adversarial-text-on-qualified-layout`, path, sourceSha256: null, expected });
  }
  writeFileSync(manifestPath, JSON.stringify({ entries }, null, 2) + "\n"); console.log(JSON.stringify({ artifacts: entries.length }));
}
if (isEntryPoint(import.meta.url)) await run();
