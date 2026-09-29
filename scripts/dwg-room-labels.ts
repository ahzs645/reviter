/**
 * Room-number labels from a survey DWG, per floor plan.
 *
 * Decodes the DWG in Node with the same LibreDWG build the browser worker uses,
 * flattens it through `dwg-entities.ts` exactly as the worker does, and reports:
 * the drawing's units, its layers, the geometric sections `dwgSections` finds,
 * the named plans its paper-space layouts look at, and every room-number label
 * on each plan with its position, use, layer and entity type.
 *
 * Usage:
 *   node --experimental-strip-types scripts/dwg-room-labels.ts drawing.dwg \
 *     [--json out.json] [--split-ratio 0.05] \
 *     [--svg-dir dir --preview "10 TandL 2000W" --preview "03 CJMH LVL 2"]
 *
 * `--svg-dir` writes one SVG per `--preview` sheet with its room labels ringed;
 * `scripts/render-svg.ts` rasterises them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { convertDwgEntities, dwgBlockDefinitions, modelSpaceHandle } from "../lib/reviter/dwg-entities.ts";
import { dwgLayoutSheets } from "../lib/reviter/dwg-layouts.ts";
import type { DwgLayoutRecord, DwgViewportRecord } from "../lib/reviter/dwg-layouts.ts";
import {
  dwgFeetPerUnit,
  dwgSectionSvg,
  dwgSections,
  entitiesWithin,
  entityBounds,
  unionBounds,
} from "../lib/reviter/dwg-plan.ts";
import type { DwgBounds, DwgEntity } from "../lib/reviter/dwg-plan.ts";
import {
  assignLabelsToPlans,
  dwgAreaTexts,
  dwgPlanTitles,
  dwgRoomLabels,
  overviewSheets,
  parseSheetName,
} from "../lib/reviter/dwg-room-labels.ts";
import type { DwgPlanText, DwgRoomLabel } from "../lib/reviter/dwg-room-labels.ts";
import { declareUsage, isEntryPoint, numberOption, optionalPath, positionals } from "./lib/rvt-harness.ts";

type LibreDwgInstance = {
  dwg_read_data(data: ArrayBuffer, type: number): unknown;
  convert(pointer: unknown): DwgDatabase;
  dwg_free(pointer: unknown): void;
};
type DwgDatabase = {
  entities?: Record<string, unknown>[];
  header?: Record<string, unknown>;
  tables?: {
    LAYER?: { entries?: Record<string, unknown>[] };
    BLOCK_RECORD?: { entries?: unknown[] };
  };
  objects?: { LAYOUT?: DwgLayoutRecord[] };
};

/**
 * LibreDWG in Node.
 *
 * The package's bundled entry (`dist/libredwg-web.js`) is built for browsers:
 * Vite replaced its `import("node:module")` with an empty stub, so
 * `LibreDwg.create()` dies in Node on `createRequire is not a function`. The
 * unbundled Emscripten loader beside the WASM (`wasm/libredwg-web.js`) keeps
 * the real Node branch, and `createByWasmInstance` wraps it in the same class
 * the worker uses.
 */
export async function loadLibreDwg(): Promise<{ lib: LibreDwgInstance; dwgType: number }> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@mlightcad/libredwg-web");
  const wasmLoader = join(entry, "..", "..", "wasm", "libredwg-web.js");
  const [{ LibreDwg, Dwg_File_Type }, { default: createModule }] = await Promise.all([
    import("@mlightcad/libredwg-web") as Promise<unknown> as Promise<{
      LibreDwg: { createByWasmInstance(instance: unknown): LibreDwgInstance };
      Dwg_File_Type: { DWG: number };
    }>,
    import(pathToFileURL(wasmLoader).href) as Promise<{ default: () => Promise<unknown> }>,
  ]);
  return { lib: LibreDwg.createByWasmInstance(await createModule()), dwgType: Dwg_File_Type.DWG };
}

export async function decodeDwg(path: string): Promise<DwgDatabase> {
  const { lib, dwgType } = await loadLibreDwg();
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const pointer = lib.dwg_read_data(buffer as ArrayBuffer, dwgType);
  if (pointer == null) throw new Error(`${path} could not be read as a DWG.`);
  try {
    return lib.convert(pointer);
  } finally {
    lib.dwg_free(pointer);
  }
}

const round = (value: number) => Math.round(value);
const roundBounds = (bounds: DwgBounds) => ({
  minX: round(bounds.minX), minY: round(bounds.minY), maxX: round(bounds.maxX), maxY: round(bounds.maxY),
});
const roundPoint = ([x, y]: readonly [number, number]) => [round(x), round(y)];

function increment(map: Map<string, Record<string, number>>, key: string, type: string) {
  const counts = map.get(key) ?? {};
  counts[type] = (counts[type] ?? 0) + 1;
  map.set(key, counts);
}

function labelJson(label: DwgRoomLabel, sheetLevels: readonly string[]) {
  return {
    number: label.number,
    ...(label.raw !== label.number ? { raw: label.raw } : {}),
    name: label.name,
    x: round(label.position[0]),
    y: round(label.position[1]),
    textStart: roundPoint(label.textStart),
    height: label.height == null ? null : Math.round(label.height * 10) / 10,
    type: label.type,
    layer: label.layer,
    tag: label.tag,
    block: label.block,
    insert: label.insert,
    source: label.source,
    building: label.parsed?.building ?? null,
    level: label.parsed?.level ?? null,
    levelMatchesSheet: label.parsed && sheetLevels.length ? sheetLevels.includes(label.parsed.level) : null,
  };
}

const textJson = (text: DwgPlanText) => ({
  text: text.text, x: round(text.position[0]), y: round(text.position[1]),
  height: text.height == null ? null : round(text.height), type: text.type, layer: text.layer,
});

/** One sheet's SVG with its room labels ringed and restated in red. */
export function highlightedSheetSvg(
  entities: readonly DwgEntity[],
  bounds: DwgBounds,
  labels: readonly DwgRoomLabel[],
  pixelWidth = 2400,
): string {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  // The plan SVG is sized in drawing units — tens of thousands of "pixels" on
  // a millimetre survey — so the preview is given a screen size instead.
  const svg = dwgSectionSvg(entities, bounds).replace(
    /(<svg[^>]*?) width="[^"]*" height="[^"]*"/u,
    `$1 width="${pixelWidth}" height="${round((pixelWidth * height) / width)}"`,
  );
  const size = Math.max(width, height);
  const ring = size / 300;
  const marks = labels.map((label) => {
    const [x, y] = label.position;
    const escaped = label.number.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);
    return `<circle cx="${round(x)}" cy="${round(-y)}" r="${round(ring)}"/>` +
      `<text x="${round(x + ring * 1.2)}" y="${round(-y - ring * 0.3)}" font-size="${round(ring * 1.4)}">${escaped}</text>`;
  }).join("");
  const overlay = `<g class="room-labels" fill="none" stroke="#dc2626" stroke-width="${round(ring / 5)}">` +
    `${marks.replace(/<text /gu, '<text fill="#dc2626" stroke="none" font-family="system-ui,sans-serif" font-weight="700" ')}</g>`;
  return svg.replace(/<\/svg>\s*$/u, `${overlay}\n</svg>`);
}

export function roomLabelReport(database: DwgDatabase, options: { splitRatio?: number; source?: string } = {}) {
  const raw = database.entities ?? [];
  const owner = modelSpaceHandle(database);
  const entities = convertDwgEntities(raw, { ownerHandle: owner, blocks: dwgBlockDefinitions(database) });

  // Layers: what the file declares, what model space holds on each, and what
  // survives flattening (block contents and attribute values included).
  const stored = new Map<string, Record<string, number>>();
  for (const entity of raw) {
    if (owner != null && String(entity.ownerBlockRecordSoftId) !== owner) continue;
    increment(stored, String(entity.layer ?? "0"), String(entity.type));
  }
  const flattened = new Map<string, Record<string, number>>();
  for (const entity of entities) increment(flattened, entity.layer, entity.type);
  const declared = (database.tables?.LAYER?.entries ?? []).map((layer) => String(layer.name ?? ""));
  const layers = [...new Set([...declared, ...stored.keys(), ...flattened.keys()])].sort().map((name) => ({
    name,
    declared: declared.includes(name),
    modelSpace: stored.get(name) ?? {},
    flattened: flattened.get(name) ?? {},
  }));

  const header = database.header ?? {};
  const insunits = typeof header.INSUNITS === "number" ? header.INSUNITS : null;

  const labels = dwgRoomLabels(entities);
  // Titles are loose text on an annotation layer. Text on the room-tag layer is
  // a label, and text on a layer that is mostly linework ("ELEV", "UP") is a
  // note on the drawing, not its name.
  const notTitleLayers = new Set(labels.filter((label) => label.source === "attribute").map((label) => label.layer));
  for (const [layer, counts] of flattened) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const text = (counts.TEXT ?? 0) + (counts.MTEXT ?? 0);
    if (text * 2 < total) notTitleLayers.add(layer);
  }
  const areaTexts = dwgAreaTexts(entities);

  const splitRatio = options.splitRatio ?? 0.05;
  const sections = dwgSections(entities, { splitRatio });
  const defaultSectionCount = dwgSections(entities).length;
  const sectionOf = (point: readonly [number, number]) => sections.find((section) =>
    point[0] >= section.bounds.minX && point[0] <= section.bounds.maxX
    && point[1] >= section.bounds.minY && point[1] <= section.bounds.maxY)?.id ?? null;

  const viewports = raw.filter((entity) => entity.type === "VIEWPORT") as DwgViewportRecord[];
  const sheets = dwgLayoutSheets(database.objects?.LAYOUT ?? [], viewports);
  const overview = overviewSheets(sheets);
  const plans = sheets.filter((_, index) => !overview.has(index));
  const assignment = assignLabelsToPlans(labels, plans);

  const planReports = plans.map((plan, index) => {
    const within = entitiesWithin(entities, plan.bounds);
    const mine = labels.filter((_, labelIndex) => assignment[labelIndex] === index);
    const parsed = parseSheetName(plan.name);
    // The viewport crops loosely; the labels and linework it was drawn for sit
    // inside the geometric section that holds most of its labels.
    const sectionCounts = new Map<number, number>();
    for (const label of mine) {
      const id = sectionOf(label.position);
      if (id != null) sectionCounts.set(id, (sectionCounts.get(id) ?? 0) + 1);
    }
    const labelBounds = unionBounds(mine.map((label) => ({
      minX: label.position[0], minY: label.position[1], maxX: label.position[0], maxY: label.position[1],
    })));
    const levelsFromNumbers: Record<string, number> = {};
    for (const label of mine) {
      const key = label.parsed ? `${label.parsed.building}/${label.parsed.level}` : "unparsed";
      levelsFromNumbers[key] = (levelsFromNumbers[key] ?? 0) + 1;
    }
    // Some titles sit just below the viewport's crop; look a little wider
    // before reporting a plan as untitled.
    let titles = dwgPlanTitles(within, { excludeLayers: notTitleLayers });
    let titlesOutsideViewport = false;
    if (!titles.length) {
      const margin = (plan.bounds.maxY - plan.bounds.minY) * 0.2;
      titles = dwgPlanTitles(entitiesWithin(entities, {
        minX: plan.bounds.minX, maxX: plan.bounds.maxX,
        minY: plan.bounds.minY - margin, maxY: plan.bounds.maxY + margin,
      }), { excludeLayers: notTitleLayers });
      titlesOutsideViewport = titles.length > 0;
    }
    return {
      sheet: plan.name,
      building: parsed.building,
      levels: parsed.levels,
      part: parsed.part,
      bounds: roundBounds(plan.bounds),
      labelBounds: labelBounds ? roundBounds(labelBounds) : null,
      entityCount: within.length,
      geometricSections: [...sectionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      titles: titles.map(textJson),
      titlesOutsideViewport,
      levelsFromNumbers,
      labelCount: mine.length,
      areaTexts: areaTexts.filter((text) => text.position[0] >= plan.bounds.minX
        && text.position[0] <= plan.bounds.maxX && text.position[1] >= plan.bounds.minY
        && text.position[1] <= plan.bounds.maxY).map(textJson),
      labels: mine.map((label) => labelJson(label, parsed.levels)),
    };
  });

  const unassigned = labels.filter((_, index) => assignment[index] === -1);

  const report = {
    source: options.source ?? null,
    units: {
      INSUNITS: insunits,
      feetPerUnit: dwgFeetPerUnit(insunits ?? undefined),
      MEASUREMENT: header.MEASUREMENT ?? null,
      LUNITS: header.LUNITS ?? null,
      LUPREC: header.LUPREC ?? null,
      DIMSCALE: header.DIMSCALE ?? null,
      LTSCALE: header.LTSCALE ?? null,
      TEXTSIZE: header.TEXTSIZE ?? null,
      EXTMIN: header.EXTMIN ?? null,
      EXTMAX: header.EXTMAX ?? null,
    },
    counts: {
      rawEntities: raw.length,
      modelSpaceEntities: owner == null ? null : raw.filter((entity) => String(entity.ownerBlockRecordSoftId) === owner).length,
      flattenedEntities: entities.length,
      roomLabels: labels.length,
      roomLabelsFromAttributes: labels.filter((label) => label.source === "attribute").length,
      roomLabelsFromText: labels.filter((label) => label.source === "text").length,
      malformedRoomNumbers: labels.filter((label) => !label.parsed).map((label) => label.raw),
      unassignedLabels: unassigned.length,
    },
    layers,
    sections: {
      splitRatio,
      defaultSplitSectionCount: defaultSectionCount,
      list: sections.map((section) => ({
        id: section.id,
        bounds: roundBounds(section.bounds),
        entityCount: section.entityCount,
        sheets: plans.filter((plan) => {
          const cx = (plan.bounds.minX + plan.bounds.maxX) / 2;
          const cy = (plan.bounds.minY + plan.bounds.maxY) / 2;
          return cx >= section.bounds.minX && cx <= section.bounds.maxX
            && cy >= section.bounds.minY && cy <= section.bounds.maxY;
        }).map((plan) => plan.name),
        labelCount: labels.filter((label) => sectionOf(label.position) === section.id).length,
      })),
    },
    overviewSheets: sheets.filter((_, index) => overview.has(index))
      .map((sheet) => ({ sheet: sheet.name, bounds: roundBounds(sheet.bounds) })),
    plans: planReports,
    unassignedLabels: unassigned.map((label) => ({ ...labelJson(label, []), section: sectionOf(label.position) })),
  };
  return { report, entities, labels, plans, assignment };
}

async function main() {
  declareUsage(
    "dwg-room-labels.ts drawing.dwg [--json out.json] [--split-ratio 0.05] [--svg-dir dir --preview \"sheet name\" ...]",
  );
  const [input] = positionals("--json", "--split-ratio", "--svg-dir", "--preview");
  if (!input) throw new Error("usage: dwg-room-labels.ts drawing.dwg [--json out.json]");
  const started = Date.now();
  const database = await decodeDwg(input);
  const decoded = Date.now();
  const { report: json, entities, labels, plans, assignment } = roomLabelReport(database, {
    splitRatio: numberOption("--split-ratio", 0.05),
    source: input,
  });

  const out = optionalPath("--json");
  const text = `${JSON.stringify(json, null, 1)}\n`;
  if (out) writeFileSync(out, text); else process.stdout.write(text);

  const svgDir = optionalPath("--svg-dir");
  if (svgDir) {
    mkdirSync(svgDir, { recursive: true });
    const argv = process.argv;
    const wanted = argv.flatMap((value, index) => (argv[index - 1] === "--preview" ? [value] : []));
    for (const name of wanted) {
      const index = plans.findIndex((plan) => plan.name === name);
      if (index < 0) throw new Error(`No sheet named ${JSON.stringify(name)}.`);
      const plan = plans[index]!;
      const within = entitiesWithin(entities, plan.bounds)
        .filter((entity) => entityBounds(entity) != null);
      const mine = labels.filter((_, labelIndex) => assignment[labelIndex] === index);
      const file = join(svgDir, `${name.replace(/[^\w.-]+/gu, "-")}.svg`);
      writeFileSync(file, highlightedSheetSvg(within, plan.bounds, mine));
      process.stderr.write(`wrote ${file} (${mine.length} labels)\n`);
    }
  }
  process.stderr.write(
    `decoded in ${decoded - started} ms; ${json.counts.roomLabels} labels on ${json.plans.length} plans ` +
    `(${json.counts.unassignedLabels} unassigned) in ${Date.now() - started} ms\n`,
  );
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
