/// <reference lib="webworker" />

/**
 * DWG decoding, off the main thread.
 *
 * LibreDWG's WASM takes about nine seconds to decode a 9 MB survey drawing and
 * cannot be interrupted, so it cannot run on the UI thread. The decoder is
 * imported dynamically rather than at module scope so its 4 MB binary is only
 * fetched once somebody actually opens a DWG — most sessions never do.
 */
import { convertDwgEntities, dwgBlockDefinitions, modelSpaceHandle } from "./dwg-entities.ts";
import {
  dwgDrawingBounds,
  dwgFeetPerUnit,
  dwgSectionSvg,
  dwgSections,
  entitiesWithin,
} from "./dwg-plan.ts";
import type { DwgBounds, DwgEntity } from "./dwg-plan.ts";
import { dwgLayoutSheets } from "./dwg-layouts.ts";
import type { DwgLayoutRecord, DwgViewportRecord } from "./dwg-layouts.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;

export type DwgWorkerRequest = {
  type: "dwg";
  id: number;
  bytes: ArrayBuffer;
};

export type DwgWorkerSection = {
  id: number;
  bounds: DwgBounds;
  entityCount: number;
  widthUnits: number;
  heightUnits: number;
};

/** One named plan off the drawing, ready to show on its own. */
export type DwgWorkerSheet = {
  id: number;
  /** The layout's own title, e.g. "03 CJMH LVL 1". */
  name: string;
  svg: string;
  entityCount: number;
  bounds: DwgBounds;
};

export type DwgWorkerResponse =
  | { id: number; type: "progress"; stage: string }
  | {
    id: number;
    type: "result";
    svg: string;
    entityCount: number;
    droppedCount: number;
    layerNames: string[];
    sections: DwgWorkerSection[];
    /** Named plans from the drawing's own layouts; empty when it has none. */
    sheets: DwgWorkerSheet[];
    /** Feet per drawing unit when `$INSUNITS` says; null when the file does not. */
    feetPerUnit: number | null;
    insunits: number | null;
  }
  | { id: number; type: "error"; error: string };

type LibreDwgModule = {
  LibreDwg: { create(): Promise<LibreDwgInstance> };
  Dwg_File_Type: { DWG: number };
};
type LibreDwgInstance = {
  dwg_read_data(data: ArrayBuffer, type: number): unknown;
  convert(pointer: unknown): DwgDatabase;
  dwg_free(pointer: unknown): void;
};
type DwgDatabase = {
  entities?: unknown[];
  header?: Record<string, unknown>;
  tables?: { LAYER?: { entries?: { name?: unknown }[] } };
  objects?: { LAYOUT?: DwgLayoutRecord[] };
};

/**
 * A layout is only a usable plan if the model actually has content where its
 * viewport is looking. Drawings that were never laid out for printing still
 * carry a stub "Layout1" whose viewport points at empty space — the campus map
 * in the sample set is one — and offering that as a plan would be a lie.
 */
const SHEET_MIN_ENTITIES = 24;

function namedSheets(database: DwgDatabase, entities: readonly DwgEntity[]) {
  const viewports = (database.entities ?? []).filter(
    (entity): entity is DwgViewportRecord =>
      typeof entity === "object" && entity !== null
      && (entity as { type?: unknown }).type === "VIEWPORT",
  );
  const sheets: DwgWorkerSheet[] = [];
  for (const sheet of dwgLayoutSheets(database.objects?.LAYOUT ?? [], viewports)) {
    const within = entitiesWithin(entities, sheet.bounds);
    if (within.length < SHEET_MIN_ENTITIES) continue;
    sheets.push({
      id: sheets.length,
      name: sheet.name,
      svg: dwgSectionSvg(within, sheet.bounds),
      entityCount: within.length,
      bounds: sheet.bounds,
    });
  }
  // One sheet is not a choice, and re-drawing the whole drawing under a name it
  // did not earn is worse than showing it plainly.
  return sheets.length > 1 ? sheets : [];
}

let decoder: Promise<LibreDwgInstance> | null = null;
function libreDwg(): Promise<LibreDwgInstance> {
  decoder ??= (async () => {
    const libredwg = (await import("@mlightcad/libredwg-web")) as unknown as LibreDwgModule;
    return await libredwg.LibreDwg.create();
  })();
  return decoder;
}

context.onmessage = async (event: MessageEvent<DwgWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "dwg") return;
  const progress = (stage: string) =>
    context.postMessage({ id: request.id, type: "progress", stage } satisfies DwgWorkerResponse);

  try {
    progress("Loading the CAD decoder");
    const lib = await libreDwg();
    const { Dwg_File_Type } = (await import("@mlightcad/libredwg-web")) as unknown as LibreDwgModule;

    progress("Reading the drawing");
    const pointer = lib.dwg_read_data(request.bytes, Dwg_File_Type.DWG);
    if (pointer == null) throw new Error("This file could not be read as a DWG.");

    let database: DwgDatabase;
    try {
      progress("Decoding entities");
      database = lib.convert(pointer);
    } finally {
      // The decoded pointer owns WASM heap; leaking it on a second drawing
      // would grow the worker's memory by the size of the first.
      lib.dwg_free(pointer);
    }

    progress("Building the plan");
    const raw = database.entities ?? [];
    const entities = convertDwgEntities(raw, {
      ownerHandle: modelSpaceHandle(database),
      blocks: dwgBlockDefinitions(database),
    });
    if (!entities.length) {
      throw new Error("No model-space linework was found in this drawing.");
    }
    progress("Reading the sheets");
    const sheets = namedSheets(database, entities);

    progress("Drawing the plan");
    const sections = dwgSections(entities);
    // A drawing too small or too scattered to yield sections still has an
    // extent, and it is the entities' own. Falling back to a unit square while
    // emitting real coordinates drew every line outside the viewBox and
    // returned a blank image reported as a successful decode.
    const bounds = dwgDrawingBounds(entities, sections);
    if (!bounds) {
      throw new Error("No drawable linework was found in this drawing.");
    }
    const drawn = entitiesWithin(entities, bounds);
    const svg = dwgSectionSvg(drawn, bounds);

    const insunits = typeof database.header?.INSUNITS === "number"
      ? database.header.INSUNITS as number
      : null;
    context.postMessage({
      id: request.id,
      type: "result",
      svg,
      entityCount: drawn.length,
      droppedCount: raw.length - entities.length,
      layerNames: (database.tables?.LAYER?.entries ?? [])
        .map((layer) => (typeof layer?.name === "string" ? layer.name : ""))
        .filter(Boolean),
      sections: sections.map((section) => ({
        id: section.id,
        bounds: section.bounds,
        entityCount: section.entityCount,
        widthUnits: section.widthUnits,
        heightUnits: section.heightUnits,
      })),
      sheets,
      feetPerUnit: dwgFeetPerUnit(insunits ?? undefined),
      insunits,
    } satisfies DwgWorkerResponse);
  } catch (error) {
    context.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies DwgWorkerResponse);
  }
};
