/**
 * Hold parts of the one building out, and check each rule on the parts it was
 * not fitted to.
 *
 *   node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc
 *   node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc --json run.json
 *
 * ## What this is, and what it is not
 *
 * **It is not the second-model check.** `verify-pair.ts` is that, and it has
 * never run on a second model, because there is no second model: a sweep of this
 * machine by extension, and independently by sniffing the OLE/CFB signature of
 * 40,616 files, finds exactly one `.rvt` and one `.ifc`. Every partition this
 * script makes shares that file's Revit release, its exporter, its family
 * library, its practice's modelling conventions and its structural grid. A rule
 * can hold on every partition here and still be an artefact of this building —
 * of how this office draws a stair, or of what its curtain-wall supplier ships.
 * Nothing in this report licenses the phrase "verified on a second model".
 *
 * **What it is** is the strongest control one building can supply. Several rules
 * were fitted on a *specific population* and then applied to everything:
 *
 *   tighter-of-two-bounds-copies     derived from 757 walls
 *   railing guard height 3.61 ft     derived from the railings whose path fits
 *   unnamed sheet, 10,000 sq ft      derived from 72 large envelopes
 *   door swing geometry              derived from doors with a host wall
 *   stair companion 169671/1         derived from 111 companion records
 *   reserved word at +22             derived from 3 corrupt records
 *   tail placement, objLen-149..-125 derived from one sample of placements
 *
 * If a rule is reading the format, it holds on parts of the building it never
 * saw. If it is fitted to an accident of where it was measured, holding out a
 * storey or a wing splits it. That failure mode has a real precedent in this
 * repository: a stair run's box looked right because a straight stair has one
 * run per storey, and only the switchbacks — which are not spread evenly through
 * a building — showed the record was the assembly's z-band rather than the run's.
 *
 * ## The two partitions
 *
 * Both are chosen because **no rule in the decoder can have keyed on them**.
 * Nothing in `lib/reviter` reads a storey, and nothing splits the plan.
 *
 * - **storey** — the export's own `IfcBuildingStorey` containment, read through
 *   `IfcRelContainedInSpatialStructure` and propagated down `IfcRelAggregates`
 *   so a curtain panel inherits its wall's storey. That covers 100% of the
 *   38,226 tagged building-element products here. An item with no product — a
 *   held-back sheet, a rejected record, a cached shape — has nothing to be
 *   contained by and falls back to the elevation band between consecutive storey
 *   elevations. Each rule reports what share of its population took that
 *   fallback, because a rule measured mostly on band-assigned items is being
 *   partitioned by its own geometry rather than by the export.
 * - **wing** — a plan split of the building's own extent, taken from the export
 *   hull: the longer plan axis, halved at its midpoint. Geometric rather than
 *   semantic on purpose, because a rule that reads coordinates wrongly tends to
 *   fail in a region rather than in a class.
 *
 * ## Reading the result
 *
 * Every rule reports, per partition: **n**, an **accuracy** whose meaning is
 * printed with the rule, the **median** and **worst** per-element figure where
 * one exists, and the **spread** between the best and worst partition that
 * clears `MIN_PARTITION_N`.
 *
 * A spread is only called a split when it is also **outside sampling noise** —
 * a pooled two-proportion z over the best and worst partitions, `|z| > 2`.
 * Without that test a 36-element partition sitting 18 points below a 75-element
 * one reads as a finding when it is a coin toss, and this script would then
 * manufacture exactly the false confidence it exists to remove.
 *
 * Where no two storeys are large enough to compare, the storeys are **pooled**
 * into a lower and an upper half so there is still a storey-based test rather
 * than none. The pooled figure is printed as its own line.
 *
 * Two things are flagged:
 *
 * - **split** — a significant spread over `SPLIT_POINTS`. The rule works better
 *   on some parts of this building than others, which is what overfitting looks
 *   like from the inside.
 * - **silent** — a partition holds an eligible population and the rule fired on
 *   none of it. This is the failure `verify-pair.ts` could not see: a rule that
 *   stops firing does not fail an accuracy threshold, it just quietly stops
 *   contributing, and the loss shows up as coverage somewhere else.
 *
 * ## Cost, and the cache
 *
 * Three passes: the export through `web-ifc`, the conversion, and one extra scan
 * of the inflated partition pages. The extra scan exists because three rules are
 * byte-level and their alternatives never reach `ConvertResult` — the discarded
 * bounds copy, the reserved word of a record the decoder threw away, and the
 * offset a placement basis actually sits at can only be seen by reading the
 * pages again with the rule relaxed.
 *
 * `--cache <path>` writes every measurement the report needs, so the report can
 * be re-derived in seconds without either model. The cache records which pair it
 * came from and is refused for another.
 *
 * Exit status is 1 when a rule is flagged **silent**, because that is a
 * regression. A **split** is reported and does not fail the run, because the
 * splits this model shows are properties of it that are already written up, and a
 * script that always exits 1 teaches its reader to ignore it. `--strict` fails on
 * splits too.
 *
 * ## What it found on the supplied project
 *
 * Recorded here because the point of the exercise is the two rules that did not
 * come out clean. Both are reach rather than accuracy, which is why nothing in
 * `verify-pair.ts` saw either.
 *
 * - **the railing sweep is silent below Floor 1.5.** Its guard height is exactly
 *   3.609 ft on all 70 railings it reaches and on every partition of them, but it
 *   reaches **0 of the 41 railings at or below Floor 1** against 70 of the 124
 *   above. The arithmetic generalises; the sketch curves it needs do not reach
 *   the lower storeys.
 * - **the stair companion adoption splits by storey**, 95.2% on Floor 1 against
 *   55.2% on Floor 2 and 65.0% on Floor 3, z=3.1. Of the 24 owners still over
 *   half a foot out, 11 are the stair flights the exporter splits one product per
 *   storey — a truth-side artefact already known — and 13 are landings the export
 *   writes as slabs, 20 of the 24 on Floors 2 and 3. The companion premise itself
 *   is clean: the export names 0 of 117 companions, on every partition.
 *
 * Everything else holds across both partitions, including three rules whose
 * populations are small enough that they could easily not have.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import { computeCoverage, convertModel } from "./audit-coverage.ts";
import { drawnBounds, readTruthBoxes, type Box } from "./overlay-diff.ts";

import { solidBounds } from "../lib/reviter/bounds-records.ts";
import { doorLeafCorners, type WallRun } from "../lib/reviter/door-leaf.ts";
import {
  chainElementObjects,
  markerObjectSeeds,
  scanObjectMarkers,
  type ElementObject,
} from "../lib/reviter/element-objects.ts";
import {
  instanceCorners,
  readInstancePlacement,
  readLocalBounds,
  type LocalBounds,
} from "../lib/reviter/instanced-geometry.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
} from "../lib/reviter/revit-container.ts";
import { selectDisplayBounds } from "../lib/reviter/scene.ts";

import type { ConvertResult } from "../lib/reviter/types.ts";

// --- thresholds ---------------------------------------------------------------

/** Agreement band, in feet — the same 0.5 ft `overlay-diff.ts` calls "ok". */
const CLOSE_FEET = 0.5;

/**
 * Below this a partition is printed but not compared. A spread between a
 * partition of 400 elements and one of 4 is a statement about the 4.
 */
const MIN_PARTITION_N = 20;

/**
 * Accuracy spread, in percentage points, above which a rule is flagged as
 * splitting — when the spread also clears the noise test below. 15 points is
 * wide enough to survive a 20-element partition's sampling error and narrow
 * enough to catch a rule that works on half a building.
 */
const SPLIT_POINTS = 15;

/**
 * Pooled two-proportion z above which a spread is more than sampling noise.
 * 2 is the conventional 5% two-sided cut. Below it the spread is printed with
 * its z and explicitly not called a split.
 */
const SPLIT_Z = 2;

/**
 * Eligible population a partition must hold before "the rule fired on none of
 * it" is a finding rather than an absence of subject matter.
 */
const MIN_FIRE_POPULATION = 20;

/** The guard height the railing rule was fitted to, in feet, and its slack. */
const FITTED_GUARD_FEET = 3.61;
const GUARD_TOLERANCE_FEET = 0.25;

/** The unnamed-sheet threshold under test, in square feet. */
const UNNAMED_SHEET_AREA_SQ_FEET = 10_000;

/** The stair companion record code under test. */
const STAIR_COMPANION_CODE = 169_671;

/** Revit's door category, as `convert.ts` uses it to find leaves. */
const DOOR_CATEGORY = -2000023;

/** Revit's stair-railing category, as `convert.ts` uses it to sweep paths. */
const RAIL_CATEGORY = -2000126;

/** The shipped tail-placement window, measured back from an object's end. */
const TAIL_WINDOW_FIRST = 149;
const TAIL_WINDOW_LAST = 125;

/**
 * The widened window this script searches, so the shipped one can be measured
 * against something rather than restated.
 */
const TAIL_PROBE_FIRST = 240;
const TAIL_PROBE_LAST = 80;

const FEET_PER_MM = 1 / 304.8;

// --- IFC storey containment ---------------------------------------------------

export type Storey = { expressId: number; name: string; elevationFeet: number };

export type StoreyModel = {
  /** Storeys in elevation order. */
  storeys: Storey[];
  /** Revit element id -> storey name, from containment and aggregation. */
  byElementId: Map<number, string>;
};

/**
 * Read the export's storeys and what each one contains.
 *
 * Direct containment names 11,838 products here; the rest are children of a
 * curtain wall or a stair that is itself contained, so the storey is propagated
 * down `IfcRelAggregates` until it stops moving. That takes coverage of tagged
 * building-element products to 100%.
 *
 * The join back to Revit is the one every other script uses: the `Tag`
 * attribute. **A Revit element can export as several products**, so a Revit id
 * inherits the *lowest* storey any of its products sits in, which keeps the
 * assignment deterministic when a multistorey stair is split one product per
 * level.
 */
export function readStoreys(ifcPath: string): StoreyModel {
  const text = readFileSync(ifcPath, "latin1");
  const entity = /^#(\d+) *= *([A-Z0-9]+)\(([\s\S]*?)\);\s*$/gm;

  const storeys = new Map<number, Storey>();
  const products = new Map<number, number>();
  const contained: [number[], number][] = [];
  const aggregated: [number, number[]][] = [];

  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const expressId = Number(match[1]!);
    const type = match[2]!;
    const body = match[3]!;
    if (type === "IFCBUILDINGSTOREY") {
      const quoted = [...body.matchAll(/'([^']*)'/g)].map((item) => item[1]!);
      const elevation = Number(body.slice(body.lastIndexOf(",") + 1).trim());
      storeys.set(expressId, {
        expressId,
        name: quoted[1] || `#${expressId}`,
        // IFC lengths here are millimetres; the recovered model is feet.
        elevationFeet: Number.isFinite(elevation) ? elevation * FEET_PER_MM : 0,
      });
      continue;
    }
    if (type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      // ( ...products ) , #storey — the set is the last parenthesised group and
      // the structure is the reference after it.
      const groups = body.match(/\(([^()]*)\)/g);
      const list = groups?.[groups.length - 1] ?? "";
      const children = [...list.matchAll(/#(\d+)/g)].map((item) => Number(item[1]!));
      const structure = Number(body.slice(body.lastIndexOf(")") + 1).match(/#(\d+)/)?.[1]);
      if (children.length && structure) contained.push([children, structure]);
      continue;
    }
    if (type === "IFCRELAGGREGATES") {
      const listAt = body.lastIndexOf("(");
      const children = [...body.slice(listAt).matchAll(/#(\d+)/g)].map((item) => Number(item[1]!));
      const parents = [...body.slice(0, listAt).matchAll(/#(\d+)/g)];
      const parent = Number(parents[parents.length - 1]?.[1]);
      if (parent && children.length) aggregated.push([parent, children]);
      continue;
    }
    if (!type.startsWith("IFC")) continue;
    let tag = 0;
    for (const quoted of body.matchAll(/'([^']*)'/g)) {
      if (/^\d+$/.test(quoted[1]!)) tag = Number(quoted[1]!);
    }
    if (tag) products.set(expressId, tag);
  }

  const storeyOf = new Map<number, number>();
  for (const [children, structure] of contained) {
    for (const child of children) if (!storeyOf.has(child)) storeyOf.set(child, structure);
  }
  const childrenOf = new Map<number, number[]>();
  for (const [parent, children] of aggregated) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), ...children]);
  }
  for (let round = 0, added = 1; added && round < 12; round += 1) {
    added = 0;
    for (const [parent, children] of childrenOf) {
      const structure = storeyOf.get(parent);
      if (structure == null) continue;
      for (const child of children) {
        if (storeyOf.has(child)) continue;
        storeyOf.set(child, structure);
        added += 1;
      }
    }
  }

  const ordered = [...storeys.values()].sort((a, b) => a.elevationFeet - b.elevationFeet);
  const rank = new Map(ordered.map((storey, index) => [storey.expressId, index]));
  const bestRank = new Map<number, number>();
  for (const [expressId, tag] of products) {
    const structure = storeyOf.get(expressId);
    if (structure == null) continue;
    const index = rank.get(structure);
    if (index == null) continue;
    const existing = bestRank.get(tag);
    if (existing == null || index < existing) bestRank.set(tag, index);
  }
  const byElementId = new Map<number, string>();
  for (const [tag, index] of bestRank) byElementId.set(tag, ordered[index]!.name);
  return { storeys: ordered, byElementId };
}

// --- the relaxed re-read of the partition pages -------------------------------

type Bounds6 = [number, number, number, number, number, number];

/**
 * A bounds record as the *bytes* hold it, with the rules under test relaxed.
 *
 * `detectDuplicatedBoundsRecords` applies both rules this script measures — it
 * drops a record whose reserved word at `+22` is unexplained, and it keeps only
 * the tighter of the two bounds copies. Neither the discarded copy nor the
 * dropped record survives into `ConvertResult`, so measuring those rules means
 * reading the pages again with the framing intact and the decisions withheld.
 * The framing checks below are the shipped ones, in the shipped order, minus the
 * `+22` test.
 */
export type RelaxedRecord = {
  elementId: number;
  recordCode: number;
  recordCount: number;
  /** The word at `+22`, which the shipped decoder uses as a corruption check. */
  reserved: number;
  /** The first copy, when it parses as a usable envelope. */
  first: Bounds6 | null;
  /** The second copy, likewise. */
  second: Bounds6 | null;
  /** Whether the two copies are byte-identical. */
  duplicated: boolean;
};

/** Mirror of `bounds-records.ts`'s own envelope sanity test. */
function readUsableBounds(view: DataView, at: number): Bounds6 | null {
  if (at + 48 > view.byteLength) return null;
  const values: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const value = view.getFloat64(at + index * 8, true);
    if (!Number.isFinite(value) || Math.abs(value) > 50_000) return null;
    values.push(value);
  }
  const spans = [values[3]! - values[0]!, values[4]! - values[1]!, values[5]! - values[2]!];
  if (spans.some((span) => span < -1e-8 || span > 5_000)) return null;
  if (spans.filter((span) => span > 0.001).length < 2) return null;
  return values as Bounds6;
}

/** Mirror of the shipped tie-break: whichever copy encloses less volume. */
function enclosedVolume(bounds: Bounds6): number {
  return [0, 1, 2]
    .map((axis) => Math.max(bounds[axis + 3]! - bounds[axis]!, 0.001))
    .reduce((product, span) => product * span, 1);
}

/** The copy the shipped decoder would keep, for a record read relaxed. */
function chosenCopy(record: RelaxedRecord): Bounds6 | null {
  if (record.first && record.second) {
    return enclosedVolume(record.second) <= enclosedVolume(record.first) ? record.second : record.first;
  }
  return record.first ?? record.second;
}

function scanRelaxedRecords(data: Uint8Array, into: Map<number, RelaxedRecord>): void {
  if (data.byteLength < 138) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let tagOffset = data.indexOf(0xc6, 16);
    tagOffset >= 0 && tagOffset + 122 < data.byteLength;
    tagOffset = data.indexOf(0xc6, tagOffset + 1)
  ) {
    if (data[tagOffset + 1] !== 0x08) continue;
    const recordOffset = tagOffset - 16;
    const elementId = view.getUint32(recordOffset, true);
    if (
      !elementId ||
      elementId === 0xffffffff ||
      view.getUint32(recordOffset + 4, true) !== 0 ||
      view.getUint32(recordOffset + 26, true) !== elementId ||
      view.getUint32(recordOffset + 30, true) !== 0 ||
      view.getUint32(recordOffset + 34, true) !== 0x0008_8004 ||
      view.getUint32(recordOffset + 42, true) !== 3
    ) {
      continue;
    }
    const recordCode = view.getUint32(recordOffset + 18, true);
    const reserved = view.getUint32(recordOffset + 22, true);
    const recordCount = view.getUint32(recordOffset + 38, true);
    if (recordCount < 1 || recordCount > 10_000) continue;
    const boundsStart = recordOffset + 42 + recordCount * 6;
    if (boundsStart + 96 > data.byteLength) continue;
    let duplicated = true;
    for (let byte = 0; byte < 48; byte += 1) {
      if (data[boundsStart + byte] !== data[boundsStart + 48 + byte]) {
        duplicated = false;
        break;
      }
    }
    // First occurrence wins, which is what `convert.ts` does with its
    // `boundedElementIds` set, so both passes describe the same record.
    if (into.has(elementId)) continue;
    into.set(elementId, {
      elementId,
      recordCode,
      recordCount,
      reserved,
      first: readUsableBounds(view, boundsStart),
      second: readUsableBounds(view, boundsStart + 48),
      duplicated,
    });
  }
}

/** Mirror of `instanced-geometry.ts`'s shared-shape test, for the tail probe. */
function hasBoundsSubRecord(data: Uint8Array, start: number): boolean {
  if (start + 46 > data.byteLength) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(start + 34, true) !== 0x0008_8004) return false;
  const count = view.getUint32(start + 38, true);
  if (count < 1 || count > 10_000) return false;
  if (view.getUint32(start + 42, true) !== 3) return false;
  const at = start + 42 + count * 6;
  if (at + 96 > data.byteLength) return false;
  for (let byte = 0; byte < 48; byte += 1) {
    if (data[at + byte] !== data[at + 48 + byte]) return false;
  }
  return true;
}

/** Mirror of the shipped orthonormality test on a row-major 3x3's columns. */
function rightHandedOrthonormal(basis: number[]): boolean {
  const column = (index: number) => [basis[index]!, basis[index + 3]!, basis[index + 6]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const columns = [column(0), column(1), column(2)];
  for (const axis of columns) if (Math.abs(dot(axis, axis) - 1) > 1e-6) return false;
  if (Math.abs(dot(columns[0]!, columns[1]!)) > 1e-6) return false;
  if (Math.abs(dot(columns[0]!, columns[2]!)) > 1e-6) return false;
  if (Math.abs(dot(columns[1]!, columns[2]!)) > 1e-6) return false;
  const [a, b, c] = columns as [number[], number[], number[]];
  const determinant =
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
    a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  return Math.abs(determinant - 1) < 1e-6;
}

export type TailHit = {
  elementId: number;
  /** How far back from the object's end the basis was found. */
  offsetFromEnd: number;
  geometryId: number;
  basis: number[];
  origin: [number, number, number];
};

/**
 * The same placement `readTailPlacement` reads, over a wider window.
 *
 * The shipped read searches `objLen-149` to `objLen-125` because that is where
 * the basis sat in the objects it was measured on. Searching 80 to 240 turns the
 * window into a measurement: a hit outside 125-149 is either a placement the
 * shipped decoder never finds, or a false positive the shipped window is right
 * to exclude — and which of those it is can be decided by whether the placement
 * reproduces the export.
 */
function probeTailPlacement(data: Uint8Array, object: ElementObject): TailHit | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = object.offset + object.objectLength;
  for (let at = end - TAIL_PROBE_FIRST; at <= end - TAIL_PROBE_LAST; at += 1) {
    if (at < object.offset || at + 104 > data.byteLength) continue;
    const basis: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const value = view.getFloat64(at + index * 8, true);
      if (!Number.isFinite(value) || Math.abs(value) > 1.0001) break;
      basis.push(value);
    }
    if (basis.length !== 9 || !rightHandedOrthonormal(basis)) continue;
    const origin: [number, number, number] = [
      view.getFloat64(at + 72, true),
      view.getFloat64(at + 80, true),
      view.getFloat64(at + 88, true),
    ];
    if (!origin.every((value) => Number.isFinite(value) && Math.abs(value) <= 5e4)) continue;
    if (view.getUint32(at + 100, true) !== 0) continue;
    const geometryId = view.getUint32(at + 96, true);
    if (!geometryId) continue;
    return { elementId: object.elementId, offsetFromEnd: end - at, geometryId, basis, origin };
  }
  return null;
}

export type RescanResult = {
  records: Map<number, RelaxedRecord>;
  /** Tail placements found in the widened window, by element id. */
  tailHits: Map<number, TailHit>;
  /** Shared shape bounds, so a tail placement can be turned into a world box. */
  shapes: Map<number, LocalBounds>;
  pagesRead: number;
};

/**
 * One extra pass over the inflated partition pages, gathering only what the
 * conversion cannot hand over: the bounds copy that was discarded, the reserved
 * word of records the decoder dropped, and where a placement basis really sits.
 */
export function rescanPartitions(rvtPath: string): RescanResult {
  const bytes = readFileSync(rvtPath);
  const cfb = CFB.read(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    type: "buffer",
  });
  const partitions = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .filter(({ entry, path }) => entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path));

  const records = new Map<number, RelaxedRecord>();
  const tailHits = new Map<number, TailHit>();
  const shapes = new Map<number, LocalBounds>();
  let pagesRead = 0;

  for (const partition of partitions) {
    const data = asBytes(partition.entry.content);
    const offsets = gzipOffsets(data);

    // Markers are measured from the file exactly as `convert.ts` measures them,
    // so the object chain this pass walks is the chain the conversion walked.
    const markerCounts = new Map<number, number>();
    const stride = Math.max(1, Math.floor(offsets.length / 12));
    for (let index = 0; index < offsets.length; index += stride) {
      const page = inflateRevitChunk(data, offsets[index]!, offsets[index + 1]);
      if (!page) continue;
      for (const [marker, count] of scanObjectMarkers(page)) {
        markerCounts.set(marker, (markerCounts.get(marker) ?? 0) + count);
      }
    }
    const markers = [...markerCounts]
      .filter(([, count]) => count >= 24)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([marker]) => marker);

    // The window is carried exactly as `convert.ts` carries it: a minority of
    // chunks reference bytes behind their own start and inflate only against the
    // previous chunk's tail. Without it this pass would read fewer pages than the
    // conversion did and its record population would not be the same population.
    let window: Uint8Array | null = null;
    for (let index = 0; index < offsets.length; index += 1) {
      const page = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
      if (!page) continue;
      window = revitWindowTail(page);
      pagesRead += 1;
      scanRelaxedRecords(page, records);
      const seeds: number[] = [];
      for (const marker of markers) for (const seed of markerObjectSeeds(page, marker)) seeds.push(seed);
      if (!seeds.length) continue;
      for (const object of chainElementObjects(page, seeds)) {
        if (object.objectLength === 300) {
          // The 300-byte instance object is a different read with fixed offsets;
          // it is not what the tail window is for.
          readInstancePlacement(page, object);
          continue;
        }
        if (hasBoundsSubRecord(page, object.offset)) {
          const local = readLocalBounds(page, object);
          if (local && !shapes.has(local.elementId)) shapes.set(local.elementId, local);
          continue;
        }
        if (tailHits.has(object.elementId)) continue;
        const hit = probeTailPlacement(page, object);
        if (hit) tailHits.set(object.elementId, hit);
      }
    }
  }
  return { records, tailHits, shapes, pagesRead };
}

// --- the conversion, reduced to what the report reads -------------------------

/**
 * One recovered element, in the terms the rules are stated in.
 *
 * The rules need the geometry the viewer draws, the record's own envelope, the
 * decoded category, the record code and the rail guard — and nothing else out of
 * a 400 MB conversion. Reducing it here is what lets `--cache` re-derive the
 * whole report without either model, and keeps each rule reading one shape
 * rather than three.
 */
export type RecordView = {
  elementId: number;
  /** What the viewer draws, following `buildBoundsMeshes`'s precedence. */
  box: Box;
  /** The record's own axis-aligned envelope, which the sheet rule measures. */
  envelope: Box;
  categoryId: number | null;
  hasCategoryName: boolean;
  recordCode: number | null;
  recordCount: number | null;
  /** The rail guard height, where the railing's own path was believed. */
  guardHeightFeet: number | null;
  /**
   * Which route gave a door its leaf, since there are now two and they are
   * separate rules fitted on separate populations.
   *
   * `wall` is the older one — the record's extent along its host wall, the wall's
   * thickness across it. It is recomputed here from `doorLeafCorners` and the
   * same wall runs `convert.ts` feeds it, and a door is credited to it when the
   * box it is drawn with is that construction corner for corner.
   *
   * `shape` is the newer fold of the door's own swing shape, which takes
   * precedence in `convert.ts`. It cannot be recomputed from `ConvertResult`
   * alone — the placement and the shared shape do not survive into it — so it is
   * identified by elimination: a drawn box that is not the wall construction.
   * The count is cross-checked against the converter's own tally.
   */
  doorLeafRoute: "shape" | "wall" | "none";
  /** Whether the record survived the scene's own display selection. */
  drawn: boolean;
  /**
   * Whether the record has the extent the display gate requires, which is the
   * population the sheet rule is applied to.
   */
  withVolume: boolean;
};

export type ModelView = {
  records: RecordView[];
  /** Per-class context, and the converter's own counts of cut door leaves. */
  inIfc: number;
  drawnElements: number;
  doorLeaves: number;
  doorLeavesFromShape: number;
};

export function buildModelView(outcome: ConvertResult, ifcPath: string): ModelView {
  const withVolume = outcome.elementBounds.filter(
    (record) => solidBounds(record) || (record.loops?.length ?? 0) > 0,
  );
  const volumeIds = new Set(withVolume.map((record) => record.elementId));
  const drawn = new Set(selectDisplayBounds(withVolume).records.map((record) => record.elementId));
  const coverage = computeCoverage(outcome, ifcPath);

  // The door-swing rule is `doorLeafCorners` plus every wall run in the model,
  // so the wall runs are rebuilt here exactly as `convert.ts` builds them. That
  // makes "this door found a host wall" a measurement of the rule rather than of
  // a side effect of it.
  const wallRuns: WallRun[] = [];
  for (const record of outcome.elementBounds) {
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    for (const solid of solids) {
      wallRuns.push({
        x0: solid.start.x, y0: solid.start.y, x1: solid.end.x, y1: solid.end.y,
        thickness: solid.thickness,
        minZ: record.boundsFeet.min.z,
        maxZ: record.boundsFeet.max.z,
      });
    }
  }

  /** Same corners, to 1e-9 ft — the wall construction is exact, not fitted. */
  const sameCorners = (
    a: [number, number, number][] | undefined,
    b: [number, number, number][] | null,
  ): boolean => {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((corner, index) =>
      corner.every((value, axis) => Math.abs(value - b[index]![axis]!) < 1e-9));
  };

  return {
    records: outcome.elementBounds.map((record) => ({
      elementId: record.elementId,
      box: drawnBounds(record),
      envelope: [
        record.boundsFeet.min.x, record.boundsFeet.min.y, record.boundsFeet.min.z,
        record.boundsFeet.max.x, record.boundsFeet.max.y, record.boundsFeet.max.z,
      ] as Box,
      categoryId: record.categoryId ?? null,
      hasCategoryName: Boolean(record.categoryName),
      recordCode: record.recordCode ?? null,
      recordCount: record.recordCount ?? null,
      guardHeightFeet: record.railPath?.guardHeightFeet ?? null,
      doorLeafRoute:
        record.categoryId !== DOOR_CATEGORY || !record.orientedBox
          ? "none"
          : sameCorners(record.orientedBox, wallRuns.length ? doorLeafCorners(record, wallRuns) : null)
            ? "wall"
            : "shape",
      drawn: drawn.has(record.elementId),
      withVolume: volumeIds.has(record.elementId),
    })),
    inIfc: coverage.totals.inIfc,
    drawnElements: coverage.totals.drawn,
    doorLeaves: coverage.stats.doorLeaves ?? 0,
    doorLeavesFromShape: coverage.stats.doorLeavesFromShape ?? 0,
  };
}

// --- partitioning -------------------------------------------------------------

export type Assignment = {
  storey: string;
  wing: string;
  /** True when the storey came from an elevation band, not from the export. */
  storeyFromBand?: boolean;
};

export type Partitioner = {
  storeyNames: string[];
  wingNames: string[];
  /** Elements whose storey came from the elevation-band fallback. */
  bandFallbacks: Set<number>;
  assign: (elementId: number, box: Box) => Assignment;
};

function centreOf(box: Box): [number, number, number] {
  return [(box[0]! + box[3]!) / 2, (box[1]! + box[4]!) / 2, (box[2]! + box[5]!) / 2];
}

/**
 * Build the two partitions.
 *
 * The storey comes from the export where the element is a product, and from the
 * elevation band between consecutive storey elevations where it is not — a
 * held-back sheet or a rejected record has no product to be contained by. The
 * band reads the box's *base* rather than its centre, because Revit contains an
 * element by the level it is drawn from and a wall spans into the storey above.
 *
 * The wing halves the longer plan axis of the export's hull. Halves rather than
 * quadrants because the smallest populations under test — 68 swept railings, 111
 * stair companions — have to survive the split with enough n to say anything.
 */
export function buildPartitioner(storeyModel: StoreyModel, hull: Box): Partitioner {
  const elevations = storeyModel.storeys.map((storey) => storey.elevationFeet);
  const spanX = hull[3]! - hull[0]!;
  const spanY = hull[4]! - hull[1]!;
  const axis = spanX >= spanY ? 0 : 1;
  const mid = (hull[axis]! + hull[axis + 3]!) / 2;
  const label = axis === 0 ? "x" : "y";
  const wingNames = [`${label} < ${mid.toFixed(0)}`, `${label} >= ${mid.toFixed(0)}`];

  // Counted as a set of element ids rather than a tally, because every rule asks
  // for the same element's partition and a tally would count it twice.
  const bandFallbacks = new Set<number>();
  return {
    storeyNames: storeyModel.storeys.map((storey) => storey.name),
    wingNames,
    bandFallbacks,
    assign(elementId, box) {
      const contained = storeyModel.byElementId.get(elementId);
      let storey = contained;
      if (!storey) {
        bandFallbacks.add(elementId);
        const base = box[2]! + 0.5;
        let index = 0;
        for (let candidate = 0; candidate < elevations.length; candidate += 1) {
          if (elevations[candidate]! <= base) index = candidate;
        }
        storey = storeyModel.storeys[index]?.name ?? "(no storey)";
      }
      const centre = centreOf(box);
      const wing = centre[axis]! < mid ? wingNames[0]! : wingNames[1]!;
      return { storey, wing, storeyFromBand: !contained };
    },
  };
}

// --- per-partition arithmetic -------------------------------------------------

/** One measured element: which partitions it is in, and whether the rule held. */
export type Sample = {
  partition: Assignment;
  /** True when the rule's claim holds for this element. */
  ok: boolean;
  /** An optional per-element number to report a median and a worst case of. */
  value?: number;
};

export type PartitionRow = {
  partition: string;
  n: number;
  okPercent: number;
  median: number | null;
  worst: number | null;
  /** Share of this partition's items whose storey came from the band fallback. */
  bandPercent: number;
  /** Excluded from the spread for being under `MIN_PARTITION_N`. */
  thin: boolean;
};

export type SchemeReport = {
  scheme: "storey" | "wing";
  rows: PartitionRow[];
  /** Best minus worst accuracy over the partitions that clear the floor. */
  spreadPoints: number | null;
  /** Pooled two-proportion z for that comparison. */
  z: number | null;
  comparedPartitions: number;
  best: string | null;
  worst: string | null;
  /**
   * The same comparison with the storeys pooled into a lower and an upper half,
   * used when no two individual partitions are large enough to compare.
   */
  pooled: { lowerN: number; lowerPercent: number; upperN: number; upperPercent: number; spreadPoints: number; z: number } | null;
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/**
 * Pooled two-proportion z. A spread that does not clear this is a coin toss,
 * and calling it a split would be the same overclaiming this script exists to
 * catch — one direction of it rather than the other.
 */
function twoProportionZ(okA: number, nA: number, okB: number, nB: number): number {
  if (!nA || !nB) return 0;
  const pooled = (okA + okB) / (nA + nB);
  const variance = pooled * (1 - pooled) * (1 / nA + 1 / nB);
  if (variance <= 0) return 0;
  return (okA / nA - okB / nB) / Math.sqrt(variance);
}

export function summarise(
  samples: Sample[],
  scheme: "storey" | "wing",
  order: string[],
): SchemeReport {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = scheme === "storey" ? sample.partition.storey : sample.partition.wing;
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }
  const rank = new Map(order.map((name, index) => [name, index]));
  const rows: PartitionRow[] = [...groups]
    .sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99))
    .map(([partition, group]) => {
      const values = group.map((sample) => sample.value).filter((value): value is number => value != null);
      return {
        partition,
        n: group.length,
        okPercent: (group.filter((sample) => sample.ok).length / group.length) * 100,
        median: median(values),
        worst: values.length ? Math.max(...values) : null,
        bandPercent:
          (group.filter((sample) => sample.partition.storeyFromBand).length / group.length) * 100,
        thin: group.length < MIN_PARTITION_N,
      };
    });

  // Pooling the storeys into halves gives a rule with a small population one
  // storey-based comparison rather than none. It is not offered for the wing
  // scheme, which is already two partitions.
  let pooled: SchemeReport["pooled"] = null;
  if (scheme === "storey" && order.length > 2) {
    const half = Math.ceil(order.length / 2);
    const lower = samples.filter((sample) => (rank.get(sample.partition.storey) ?? 99) < half);
    const upper = samples.filter((sample) => (rank.get(sample.partition.storey) ?? 99) >= half);
    if (lower.length >= MIN_PARTITION_N && upper.length >= MIN_PARTITION_N) {
      const lowerOk = lower.filter((sample) => sample.ok).length;
      const upperOk = upper.filter((sample) => sample.ok).length;
      pooled = {
        lowerN: lower.length,
        lowerPercent: (lowerOk / lower.length) * 100,
        upperN: upper.length,
        upperPercent: (upperOk / upper.length) * 100,
        spreadPoints: Math.abs((lowerOk / lower.length - upperOk / upper.length) * 100),
        z: twoProportionZ(lowerOk, lower.length, upperOk, upper.length),
      };
    }
  }

  const compared = rows.filter((row) => !row.thin);
  if (compared.length < 2) {
    return {
      scheme, rows, spreadPoints: null, z: null,
      comparedPartitions: compared.length, best: null, worst: null, pooled,
    };
  }
  const best = compared.reduce((a, b) => (b.okPercent > a.okPercent ? b : a));
  const worst = compared.reduce((a, b) => (b.okPercent < a.okPercent ? b : a));
  return {
    scheme,
    rows,
    spreadPoints: best.okPercent - worst.okPercent,
    z: twoProportionZ(
      Math.round((best.okPercent / 100) * best.n), best.n,
      Math.round((worst.okPercent / 100) * worst.n), worst.n,
    ),
    comparedPartitions: compared.length,
    best: best.partition,
    worst: worst.partition,
    pooled,
  };
}

export type RuleReport = {
  /** Named after the rule, matching `verify-pair.ts` where one exists. */
  rule: string;
  /** The population the rule was originally fitted on. */
  fittedOn: string;
  /** What "accuracy" counts here, in one line. */
  accuracyIs: string;
  n: number;
  overallPercent: number | null;
  /** Share of the population whose storey came from the band fallback. */
  bandPercent: number;
  byStorey: SchemeReport;
  byWing: SchemeReport;
  /**
   * The rule's measured population against the population it could have fired
   * on, per partition.
   *
   * Accuracy and reach are different questions and a rule can be perfect at one
   * and absent at the other — the railing guard is 100% accurate on every
   * partition it reaches and reaches **none** of the 41 railings at or below
   * Floor 1. Only this table shows that.
   *
   * The numerator is what was measured, so where a rule's measurement needs an
   * export join it is bounded by that too, and where the two populations are
   * assigned differently — a companion record by elevation band against a stair
   * product by containment — the numerator can exceed the denominator. Read it as
   * reach, not as a percentage.
   */
  firing: { scheme: "storey" | "wing"; partition: string; fired: number; eligible: number }[];
  /** Partitions holding an eligible population the rule never fired on. */
  silentPartitions: string[];
  /** Extra numbers worth printing under the tables. */
  notes: string[];
  verdict: "holds" | "split" | "silent" | "untestable";
};

/** Every comparison the rule offers, significant or not. */
function comparisons(report: RuleReport | Omit<RuleReport, "verdict">): { spread: number; z: number }[] {
  const found: { spread: number; z: number }[] = [];
  for (const scheme of [report.byStorey, report.byWing]) {
    if (scheme.spreadPoints != null && scheme.z != null) {
      found.push({ spread: scheme.spreadPoints, z: scheme.z });
    }
    if (scheme.pooled) found.push({ spread: scheme.pooled.spreadPoints, z: scheme.pooled.z });
  }
  return found;
}

function verdictFor(report: Omit<RuleReport, "verdict">): RuleReport["verdict"] {
  if (report.silentPartitions.length) return "silent";
  if (report.n < MIN_PARTITION_N) return "untestable";
  const found = comparisons(report);
  if (!found.length) return "untestable";
  return found.some((entry) => entry.spread > SPLIT_POINTS && Math.abs(entry.z) > SPLIT_Z)
    ? "split"
    : "holds";
}

export function ruleReport(options: {
  rule: string;
  fittedOn: string;
  accuracyIs: string;
  samples: Sample[];
  partitioner: Partitioner;
  /** Eligible population per partition, for the silent-rule test. */
  eligible?: { storey: Map<string, number>; wing: Map<string, number> };
  notes?: string[];
}): RuleReport {
  const { samples, partitioner } = options;
  const byStorey = summarise(samples, "storey", partitioner.storeyNames);
  const byWing = summarise(samples, "wing", partitioner.wingNames);
  const silent: string[] = [];
  const firing: RuleReport["firing"] = [];
  if (options.eligible) {
    for (const [scheme, counts, report] of [
      ["storey", options.eligible.storey, byStorey],
      ["wing", options.eligible.wing, byWing],
    ] as const) {
      const firedIn = new Map(report.rows.map((row) => [row.partition, row.n]));
      const order = scheme === "storey" ? partitioner.storeyNames : partitioner.wingNames;
      const rank = new Map(order.map((name, index) => [name, index]));
      for (const [partition, population] of [...counts].sort(
        (a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99),
      )) {
        const fired = firedIn.get(partition) ?? 0;
        firing.push({ scheme, partition, fired, eligible: population });
        if (population >= MIN_FIRE_POPULATION && !fired) {
          silent.push(`${scheme} ${partition} (${population} eligible)`);
        }
      }
      // A rule can also go quiet across a whole half of the building while no
      // single storey holds enough of the population to say so on its own: 41
      // railings sit at or below Floor 1 here and not one of them is swept, in
      // partitions of 21, 10, 9 and 1. Pooling the halves is what catches that.
      if (scheme === "storey" && order.length > 2) {
        const half = Math.ceil(order.length / 2);
        for (const [name, lower] of [["lower", true], ["upper", false]] as const) {
          let eligible = 0;
          let fired = 0;
          for (const entry of firing.filter((item) => item.scheme === "storey")) {
            const index = rank.get(entry.partition) ?? 99;
            if (lower !== index < half) continue;
            eligible += entry.eligible;
            fired += entry.fired;
          }
          if (eligible >= MIN_FIRE_POPULATION && !fired) {
            silent.push(`the ${name} half of the storeys (${eligible} eligible)`);
          }
        }
      }
    }
  }
  const partial = {
    rule: options.rule,
    fittedOn: options.fittedOn,
    accuracyIs: options.accuracyIs,
    n: samples.length,
    overallPercent: samples.length
      ? (samples.filter((sample) => sample.ok).length / samples.length) * 100
      : null,
    bandPercent: samples.length
      ? (samples.filter((sample) => sample.partition.storeyFromBand).length / samples.length) * 100
      : 0,
    byStorey,
    byWing,
    firing,
    silentPartitions: silent,
    notes: options.notes ?? [],
  };
  return { ...partial, verdict: verdictFor(partial) };
}

// --- the rules ----------------------------------------------------------------

type Truth = Map<number, { type: string; box: Box }>;

/** Largest centre disagreement on any axis, in feet. */
export function centreError(got: Box, want: Box): number {
  let worst = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    worst = Math.max(
      worst,
      Math.abs((got[axis]! + got[axis + 3]!) / 2 - (want[axis]! + want[axis + 3]!) / 2),
    );
  }
  return worst;
}

const asBox = (bounds: Bounds6): Box => [...bounds] as Box;

const mean = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

/** Eligible-population counters, in the shape the silent test wants. */
function eligibleCounts(
  items: { elementId: number; box: Box }[],
  partitioner: Partitioner,
): { storey: Map<string, number>; wing: Map<string, number> } {
  const storey = new Map<string, number>();
  const wing = new Map<string, number>();
  for (const item of items) {
    const where = partitioner.assign(item.elementId, item.box);
    storey.set(where.storey, (storey.get(where.storey) ?? 0) + 1);
    wing.set(where.wing, (wing.get(where.wing) ?? 0) + 1);
  }
  return { storey, wing };
}

/**
 * **The tighter-of-two-copies rule**, fitted on 757 walls.
 *
 * Only the records whose copies actually differ are informative — where they
 * agree the choice is moot — so the population is those, joined to an export
 * box. Accuracy is whether the copy the decoder chose lands within half a foot
 * of the export's centre, and the same figure for "always the first" and "always
 * the second" is reported beside it: a partition where the rule holds and the
 * alternatives hold equally well is not evidence about the rule.
 *
 * The rule's stated purpose is the tail rather than the median — always taking
 * the second copy admitted a box 8,701 ft across — so the worst case per
 * partition is printed, and that is the column to read.
 */
function tighterCopyRule(
  rescan: RescanResult,
  truth: Truth,
  partitioner: Partitioner,
): RuleReport {
  const samples: Sample[] = [];
  const errors = { chosen: [] as number[], first: [] as number[], second: [] as number[] };
  let differing = 0;
  for (const record of rescan.records.values()) {
    if (record.duplicated) continue;
    if (!record.first || !record.second) continue;
    differing += 1;
    const want = truth.get(record.elementId);
    if (!want) continue;
    const chosen = chosenCopy(record)!;
    const errorChosen = centreError(asBox(chosen), want.box);
    errors.chosen.push(errorChosen);
    errors.first.push(centreError(asBox(record.first), want.box));
    errors.second.push(centreError(asBox(record.second), want.box));
    samples.push({
      partition: partitioner.assign(record.elementId, asBox(chosen)),
      ok: errorChosen < CLOSE_FEET,
      value: errorChosen,
    });
  }
  const line = (name: string, values: number[]) =>
    `${name}: ${((values.filter((value) => value < CLOSE_FEET).length / (values.length || 1)) * 100).toFixed(1)}% ` +
    `within ${CLOSE_FEET} ft, mean ${mean(values).toFixed(3)} ft, worst ${(values.length ? Math.max(...values) : 0).toFixed(1)} ft`;
  return ruleReport({
    rule: "tighter-of-two-bounds-copies",
    fittedOn: "757 walls whose two bounds copies disagree",
    accuracyIs: "the chosen copy is within 0.5 ft of the export's centre",
    samples,
    partitioner,
    notes: [
      `${differing.toLocaleString()} records have differing copies; ${samples.length.toLocaleString()} join an export box`,
      line("the tighter copy, as shipped", errors.chosen),
      line("always the first copy     ", errors.first),
      line("always the second copy    ", errors.second),
    ],
  });
}

/**
 * **The railing guard height**, 3.61 ft, fitted on the railings whose path
 * reproduces their envelope.
 *
 * Accuracy is whether a believed path's guard lands within 0.25 ft of that
 * figure. The decoder's own filter is 1.5-5 ft, so this is a test rather than a
 * restatement of the filter: a partition whose guards cluster at 2 ft would pass
 * the filter and fail here.
 */
function railingGuardRule(model: ModelView, partitioner: Partitioner): RuleReport {
  const samples: Sample[] = [];
  for (const record of model.records) {
    if (record.guardHeightFeet == null) continue;
    samples.push({
      partition: partitioner.assign(record.elementId, record.box),
      ok: Math.abs(record.guardHeightFeet - FITTED_GUARD_FEET) <= GUARD_TOLERANCE_FEET,
      value: record.guardHeightFeet,
    });
  }
  return ruleReport({
    rule: "railing-guard-height",
    fittedOn: "the 68 railings whose sketch path fits their envelope",
    accuracyIs: `the guard is within ${GUARD_TOLERANCE_FEET} ft of the fitted ${FITTED_GUARD_FEET} ft`,
    samples,
    partitioner,
    // Eligible: a drawn railing is a railing the rule could have swept.
    eligible: eligibleCounts(
      model.records.filter((record) => record.drawn && record.categoryId === RAIL_CATEGORY),
      partitioner,
    ),
    notes: [`the median column is the guard in feet; the fitted value is ${FITTED_GUARD_FEET} ft`],
  });
}

/**
 * **The 10,000 sq ft unnamed-sheet threshold.**
 *
 * The rule is not "big envelopes are sheets" — the largest real slab here is
 * bigger than any of them. It is "big **and** claimed by no category". So the
 * population is every envelope over the threshold, and accuracy is whether the
 * rule's verdict agrees with the export: an uncategorised one the export does
 * not name, or a categorised one it does.
 */
function unnamedSheetRule(
  model: ModelView,
  truth: Truth,
  partitioner: Partitioner,
): RuleReport {
  const samples: Sample[] = [];
  let uncategorised = 0;
  let uncategorisedNamed = 0;
  let categorised = 0;
  let categorisedNamed = 0;
  for (const record of model.records) {
    // The rule runs inside the display gate, so its population is the records
    // that reach it: an envelope with no extent is dropped before the threshold
    // is ever applied, and scoring those would grade the rule on records it
    // never sees.
    if (!record.withVolume) continue;
    const area = (record.envelope[3]! - record.envelope[0]!) * (record.envelope[4]! - record.envelope[1]!);
    if (area <= UNNAMED_SHEET_AREA_SQ_FEET) continue;
    const named = truth.has(record.elementId);
    const hasCategory = record.categoryId != null || record.hasCategoryName;
    if (hasCategory) {
      categorised += 1;
      if (named) categorisedNamed += 1;
    } else {
      uncategorised += 1;
      if (named) uncategorisedNamed += 1;
    }
    samples.push({
      partition: partitioner.assign(record.elementId, record.box),
      ok: hasCategory ? named : !named,
      value: area,
    });
  }
  return ruleReport({
    rule: "unnamed-sheet-threshold",
    fittedOn: `72 envelopes over ${UNNAMED_SHEET_AREA_SQ_FEET.toLocaleString()} sq ft`,
    accuracyIs: "the size-and-no-category verdict agrees with the export",
    samples,
    partitioner,
    notes: [
      `over the threshold with a category: ${categorised}, of which the export names ${categorisedNamed}`,
      `over the threshold with none: ${uncategorised}, of which the export names ${uncategorisedNamed}` +
        " — each of those is a real element the rule holds back",
      "the median and worst columns are plan area in square feet",
    ],
  });
}

/**
 * **The door swing geometry**, which is now two rules with two populations.
 *
 * A door's record is its opening plus the quarter-circle swing. The older rule
 * cuts the leaf out of it with the *host wall's* centreline and thickness, fitted
 * on the doors that find a wall. The newer one folds the door's *own* shared
 * shape, which is the swing written in the family frame, fitted on the 1,067
 * doors whose shape resolves — and it takes precedence, so the wall rule is now
 * the fallback rather than the rule.
 *
 * They are reported separately because a partition can starve one and not the
 * other, and averaging them would hide exactly that. Doors drawn with no leaf at
 * all are the control, printed with both.
 */
function doorSwingRules(
  model: ModelView,
  truth: Truth,
  partitioner: Partitioner,
): { fromWall: RuleReport; fromShape: RuleReport } {
  const wall: Sample[] = [];
  const shape: Sample[] = [];
  let withoutLeaf = 0;
  let withoutLeafOk = 0;
  const counts = { wall: 0, shape: 0, none: 0 };
  const doors = model.records.filter((record) => record.drawn && record.categoryId === DOOR_CATEGORY);
  for (const record of doors) {
    counts[record.doorLeafRoute] += 1;
    const want = truth.get(record.elementId);
    if (!want) continue;
    const error = centreError(record.box, want.box);
    const sample: Sample = {
      partition: partitioner.assign(record.elementId, record.box),
      ok: error < CLOSE_FEET,
      value: error,
    };
    if (record.doorLeafRoute === "wall") wall.push(sample);
    else if (record.doorLeafRoute === "shape") shape.push(sample);
    else {
      withoutLeaf += 1;
      if (error < CLOSE_FEET) withoutLeafOk += 1;
    }
  }
  const control =
    `control: ${withoutLeaf.toLocaleString()} drawn doors got no leaf from either route, ` +
    `${withoutLeaf ? ((withoutLeafOk / withoutLeaf) * 100).toFixed(1) : "-"}% of them within ${CLOSE_FEET} ft`;
  const tally =
    `routes over ${doors.length.toLocaleString()} drawn doors: ${counts.shape.toLocaleString()} from the ` +
    `door's own shape, ${counts.wall.toLocaleString()} from a host wall, ${counts.none.toLocaleString()} neither; ` +
    `the converter reports ${model.doorLeavesFromShape.toLocaleString()} and ` +
    `${model.doorLeaves.toLocaleString()} over every record, drawn or not`;
  return {
    fromShape: ruleReport({
      rule: "door-leaf-from-own-shape",
      fittedOn: "the 1,067 doors whose own swing shape resolves",
      accuracyIs: "the folded leaf is within 0.5 ft of the export's door",
      samples: shape,
      partitioner,
      eligible: eligibleCounts(doors, partitioner),
      notes: [tally, control],
    }),
    fromWall: ruleReport({
      rule: "door-leaf-from-host-wall",
      fittedOn: "the doors that find a host wall, now the fallback route",
      accuracyIs: "the cut leaf is within 0.5 ft of the export's door",
      samples: wall,
      partitioner,
      notes: [tally, control],
    }),
  };
}

/**
 * **The stair companion record**, `169671` with one field.
 *
 * Two claims, measured apart. The premise: a companion is **not a building
 * element** — the export names none of the 111, which is what licenses holding
 * them back. The consequence: the stair part one id below adopts the companion's
 * box and lands on the export.
 *
 * Whether an owner record exists at `id - 1` is deliberately *not* folded into
 * the premise. A missing owner is a recovery gap belonging to whatever failed to
 * read that stair part, and mixing it in produced a wing split that was about
 * recovery rather than about this rule. It is reported as adoption coverage
 * instead.
 */
function stairCompanionRule(
  rescan: RescanResult,
  model: ModelView,
  truth: Truth,
  partitioner: Partitioner,
): { premise: RuleReport; adoption: RuleReport } {
  const byId = new Map(model.records.map((record) => [record.elementId, record]));
  const premise: Sample[] = [];
  const adoption: Sample[] = [];
  let namedByExport = 0;
  let ownerMissing = 0;
  let improved = 0;
  let worsened = 0;
  for (const record of rescan.records.values()) {
    if (record.recordCode !== STAIR_COMPANION_CODE || record.recordCount !== 1) continue;
    const own = chosenCopy(record);
    if (!own) continue;
    const named = truth.has(record.elementId);
    const owner = byId.get(record.elementId - 1);
    if (named) namedByExport += 1;
    if (!owner) ownerMissing += 1;
    premise.push({
      partition: partitioner.assign(record.elementId, asBox(own)),
      ok: !named,
    });

    // The consequence: the owner is drawn from the companion's box, so measure
    // it against the export, and against the box it had before adopting.
    if (!owner) continue;
    const want = truth.get(owner.elementId);
    if (!want) continue;
    const after = centreError(owner.box, want.box);
    const before = rescan.records.get(owner.elementId);
    const beforeBox = before ? chosenCopy(before) : null;
    if (beforeBox) {
      const errorBefore = centreError(asBox(beforeBox), want.box);
      if (after < errorBefore - 1e-9) improved += 1;
      else if (after > errorBefore + 1e-9) worsened += 1;
    }
    adoption.push({
      partition: partitioner.assign(owner.elementId, owner.box),
      ok: after < CLOSE_FEET,
      value: after,
    });
  }
  // Eligible: a storey with stairs and no companion record is a storey where
  // every run is drawn to its assembly's z-band and nothing says so.
  const stairs = [...truth]
    .filter(([, product]) => product.type === "IFCSTAIRFLIGHT" || product.type === "IFCSTAIR")
    .map(([elementId, product]) => ({ elementId, box: product.box }));
  return {
    premise: ruleReport({
      rule: "stair-companion-not-an-element",
      fittedOn: "111 companion records with code 169671/1",
      accuracyIs: "the export does not name the companion, so holding it back costs nothing",
      samples: premise,
      partitioner,
      eligible: eligibleCounts(stairs, partitioner),
      notes: [
        `${namedByExport} of ${premise.length} companions are named by the export (the rule expects none)`,
        `adoption coverage: ${ownerMissing} of ${premise.length} have no record at id-1, so nothing ` +
          "adopts their box — a recovery gap in the stair part, not in this rule",
        "the eligible column below is stair products, placed by the export's containment, against " +
          "companions, which have no product and are placed by elevation band; the two do not divide",
      ],
    }),
    adoption: ruleReport({
      rule: "stair-companion-adoption",
      fittedOn: "the same 111 records",
      accuracyIs: "the adopting owner is within 0.5 ft of the export",
      samples: adoption,
      partitioner,
      notes: [
        `adoption moved the owner closer for ${improved} and further for ${worsened} of ${adoption.length}`,
      ],
    }),
  };
}

/**
 * **The reserved word at `+22`.**
 *
 * The check assumes the word is either zero, or all-ones beside an all-ones
 * record code, and rejects anything else as corrupt. The claim that partitions
 * is that invariant: what share of each partition's records match one of the two
 * self-consistent patterns.
 *
 * The rule's *cost* is measured separately and carefully. A rejected record is
 * only a loss when the element has no other record the decoder kept, so the cost
 * is the rejected ids that are absent from the conversion's own output — and of
 * those, the ones the export names. The three corrupt records this rule was
 * written for are too few to partition, and the report says so rather than
 * reporting a 100% that means nothing.
 */
function reservedWordRule(
  rescan: RescanResult,
  model: ModelView,
  truth: Truth,
  partitioner: Partitioner,
): RuleReport {
  const recovered = new Set(model.records.map((record) => record.elementId));
  const samples: Sample[] = [];
  let rejected = 0;
  let lost = 0;
  let lostNamed = 0;
  let allOnes = 0;
  for (const record of rescan.records.values()) {
    const own = chosenCopy(record);
    const selfConsistent = record.reserved === 0 || record.recordCode === 0xffff_ffff;
    if (!selfConsistent) {
      rejected += 1;
      if (!recovered.has(record.elementId)) {
        lost += 1;
        if (truth.has(record.elementId)) lostNamed += 1;
      }
    }
    if (record.reserved === 0xffff_ffff) allOnes += 1;
    samples.push({
      partition: partitioner.assign(record.elementId, own ? asBox(own) : [0, 0, 0, 0, 0, 0]),
      ok: selfConsistent,
    });
  }
  return ruleReport({
    rule: "reserved-word-corruption-check",
    fittedOn: "3 corrupt records out of 42,333",
    accuracyIs: "the record matches one of the two self-consistent +22 patterns",
    samples,
    partitioner,
    notes: [
      `${rejected} records rejected as corrupt; ${lost} of those elements end with no envelope at all, ` +
        `and the export names ${lostNamed} of them`,
      `${allOnes.toLocaleString()} records carry 0xffffffff at +22, all beside an all-ones record code`,
      "the rejected population is too small to partition; the invariant above is what the split tests",
    ],
  });
}

/**
 * **The tail placement window**, `objLen-149` to `objLen-125`.
 *
 * The window is measured by searching a much wider one and asking where the
 * placements that are *demonstrably real* actually sit. A placement is real when
 * it resolves a shared shape and reproduces the export's box for that element;
 * accuracy is then whether the shipped window covers it. That framing matters:
 * the widened search also finds candidates outside the window, and most of them
 * are false positives the shipped window is right to exclude, so scoring every
 * candidate would grade the rule on the noise its narrowness removes.
 *
 * The second report is the shipped rule's own accuracy — of the placements the
 * shipped window does find, how many land on the export.
 */
function tailWindowRule(
  rescan: RescanResult,
  truth: Truth,
  partitioner: Partitioner,
): { window: RuleReport; placement: RuleReport } {
  const verified: Sample[] = [];
  const placement: Sample[] = [];
  const offsets = new Map<number, number>();
  let outside = 0;
  let outsideJoined = 0;
  let outsideVerified = 0;
  let unresolved = 0;
  const eligible: { elementId: number; box: Box }[] = [];

  for (const hit of rescan.tailHits.values()) {
    offsets.set(hit.offsetFromEnd, (offsets.get(hit.offsetFromEnd) ?? 0) + 1);
    const inWindow = hit.offsetFromEnd >= TAIL_WINDOW_LAST && hit.offsetFromEnd <= TAIL_WINDOW_FIRST;
    const shape = rescan.shapes.get(hit.geometryId);
    if (!shape) {
      unresolved += 1;
      if (!inWindow) outside += 1;
      continue;
    }
    const corners = instanceCorners(
      { elementId: hit.elementId, basis: hit.basis, origin: hit.origin, geometryId: hit.geometryId },
      shape,
    );
    const box: Box = [
      Math.min(...corners.map((corner) => corner[0])), Math.min(...corners.map((corner) => corner[1])),
      Math.min(...corners.map((corner) => corner[2])), Math.max(...corners.map((corner) => corner[0])),
      Math.max(...corners.map((corner) => corner[1])), Math.max(...corners.map((corner) => corner[2])),
    ];
    const want = truth.get(hit.elementId);
    const error = want ? centreError(box, want.box) : null;
    const isReal = error != null && error < CLOSE_FEET;
    if (!inWindow) {
      outside += 1;
      if (want) outsideJoined += 1;
      if (isReal) outsideVerified += 1;
    }
    if (isReal) {
      // The population is the placements that are provably placements. Anything
      // the shipped window misses here is a real loss rather than noise.
      verified.push({
        partition: partitioner.assign(hit.elementId, box),
        ok: inWindow,
        value: hit.offsetFromEnd,
      });
    }
    if (inWindow && want) {
      placement.push({
        partition: partitioner.assign(hit.elementId, box),
        ok: error! < CLOSE_FEET,
        value: error!,
      });
      eligible.push({ elementId: hit.elementId, box });
    }
  }
  const histogram = [...offsets].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([offset, count]) => `${offset}:${count.toLocaleString()}`).join("  ");
  return {
    window: ruleReport({
      rule: "tail-placement-window",
      fittedOn: `one sample of placement objects; window objLen-${TAIL_WINDOW_FIRST}..-${TAIL_WINDOW_LAST}`,
      accuracyIs: `a placement that reproduces the export sits inside the shipped window`,
      samples: verified,
      partitioner,
      notes: [
        `offsets back from the object's end, commonest first: ${histogram}`,
        `${outside.toLocaleString()} candidates fall outside the shipped window; ` +
          `${outsideJoined.toLocaleString()} join an export element and ${outsideVerified.toLocaleString()} ` +
          "reproduce it — so the window's narrowness costs almost nothing and excludes false positives",
        `${unresolved.toLocaleString()} candidates reference a shared shape that never resolved, so they cannot be scored`,
        "the median and worst columns are the offset in bytes",
      ],
    }),
    placement: ruleReport({
      rule: "tail-placement-accuracy",
      fittedOn: "the same objects",
      accuracyIs: "a placement the shipped window finds is within 0.5 ft of the export",
      samples: placement,
      partitioner,
      // Eligible: curtain-wall families are what this route places, so a
      // partition full of them and no placements is the rule going quiet.
      eligible: eligibleCounts(
        [...truth]
          .filter(([, product]) => product.type === "IFCMEMBER" || product.type === "IFCPLATE")
          .map(([elementId, product]) => ({ elementId, box: product.box })),
        partitioner,
      ),
      notes: [],
    }),
  };
}

// --- printing ----------------------------------------------------------------

const pad = (value: string, width: number) =>
  value.length >= width ? value : value + " ".repeat(width - value.length);
const padStart = (value: string, width: number) =>
  value.length >= width ? value : " ".repeat(width - value.length) + value;

const number = (value: number | null, digits = 3) =>
  value == null ? "-" : Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(digits);

function printScheme(report: SchemeReport): void {
  const label = report.scheme === "storey" ? "by storey" : "by wing";
  console.log(
    `    ${pad(label, 18)}${padStart("n", 8)}${padStart("accuracy", 11)}` +
      `${padStart("median", 12)}${padStart("worst", 12)}${padStart("band", 8)}`,
  );
  for (const row of report.rows) {
    console.log(
      `    ${pad(row.partition + (row.thin ? " *" : ""), 18)}${padStart(row.n.toLocaleString(), 8)}` +
        `${padStart(`${row.okPercent.toFixed(1)}%`, 11)}${padStart(number(row.median), 12)}` +
        `${padStart(number(row.worst, 1), 12)}${padStart(`${row.bandPercent.toFixed(0)}%`, 8)}`,
    );
  }
  if (report.spreadPoints == null) {
    console.log(`    spread: not comparable, ${report.comparedPartitions} partition(s) over ${MIN_PARTITION_N}`);
  } else {
    const significant = Math.abs(report.z ?? 0) > SPLIT_Z;
    console.log(
      `    spread: ${report.spreadPoints.toFixed(1)} points over ${report.comparedPartitions} partitions` +
        ` (best ${report.best}, worst ${report.worst}), z=${(report.z ?? 0).toFixed(1)}` +
        `${significant ? "" : " — within sampling noise"}`,
    );
  }
  if (report.pooled) {
    const significant = Math.abs(report.pooled.z) > SPLIT_Z;
    console.log(
      `    pooled halves: lower ${report.pooled.lowerPercent.toFixed(1)}% of ${report.pooled.lowerN.toLocaleString()}` +
        ` against upper ${report.pooled.upperPercent.toFixed(1)}% of ${report.pooled.upperN.toLocaleString()}` +
        `, spread ${report.pooled.spreadPoints.toFixed(1)} points, z=${report.pooled.z.toFixed(1)}` +
        `${significant ? "" : " — within sampling noise"}`,
    );
  }
}

function printRule(report: RuleReport): void {
  const mark = report.verdict === "holds"
    ? "holds"
    : report.verdict === "split"
      ? "SPLIT"
      : report.verdict === "silent"
        ? "SILENT"
        : "untestable";
  console.log(`\n  ${report.rule}   [${mark}]`);
  console.log(`    fitted on ${report.fittedOn}`);
  console.log(`    accuracy = ${report.accuracyIs}`);
  console.log(
    `    overall: ${report.n.toLocaleString()} measured, ` +
      `${report.overallPercent == null ? "-" : `${report.overallPercent.toFixed(1)}%`}` +
      `, ${report.bandPercent.toFixed(0)}% of them assigned a storey by elevation band`,
  );
  for (const note of report.notes) console.log(`    ${note}`);
  console.log("");
  printScheme(report.byStorey);
  console.log("");
  printScheme(report.byWing);
  if (report.firing.length) {
    console.log("");
    for (const scheme of ["storey", "wing"] as const) {
      const rows = report.firing.filter((entry) => entry.scheme === scheme);
      if (!rows.length) continue;
      console.log(
        `    measured against eligible, by ${scheme}: ` +
          rows.map((row) => `${row.partition} ${row.fired}/${row.eligible}`).join("  "),
      );
    }
  }
  for (const silent of report.silentPartitions) {
    console.log(`    SILENT: the rule fired on nothing in ${silent}`);
  }
}

// --- the cache ---------------------------------------------------------------

/**
 * Every measurement the report needs, without either model.
 *
 * The three passes cost minutes and produce a few megabytes of per-element
 * numbers, so they are separable from the report. This is a cache and not a
 * fixture: it records the pair it came from, and the loader refuses another.
 */
type Cached = {
  rvt: string;
  ifc: string;
  hull: Box;
  storeys: Storey[];
  storeyByElementId: [number, string][];
  truth: [number, { type: string; box: Box }][];
  records: RelaxedRecord[];
  tailHits: TailHit[];
  shapes: [number, LocalBounds][];
  pagesRead: number;
  model: ModelView;
};

// --- run ---------------------------------------------------------------------

/** True when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const positional: string[] = [];
  let jsonPath: string | undefined;
  let cachePath: string | undefined;
  let strict = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]!;
    if (argument === "--json") { jsonPath = process.argv[index + 1]; index += 1; continue; }
    if (argument === "--cache") { cachePath = process.argv[index + 1]; index += 1; continue; }
    if (argument === "--strict") { strict = true; continue; }
    if (argument.startsWith("--")) continue;
    positional.push(argument);
  }
  const [rvtPath, ifcPath] = positional;
  if (!rvtPath || !ifcPath) {
    console.error("usage: holdout.ts <model.rvt> <model.ifc> [--json <path>] [--cache <path>] [--strict]");
    process.exit(2);
  }

  const rvtName = rvtPath.split("/").pop()!;
  const ifcName = ifcPath.split("/").pop()!;

  const cached = cachePath && existsSync(cachePath)
    ? (JSON.parse(readFileSync(cachePath, "utf8")) as Cached)
    : null;
  if (cached && (cached.rvt !== rvtName || cached.ifc !== ifcName)) {
    console.error(`the cache at ${cachePath} is for ${cached.rvt} / ${cached.ifc}, not this pair`);
    process.exit(2);
  }

  let truth: Truth;
  let storeyModel: StoreyModel;
  let rescan: RescanResult;
  let hull: Box;
  let model: ModelView;

  if (cached) {
    console.log(`reusing the measurements cached in ${cachePath}`);
    truth = new Map(cached.truth);
    storeyModel = { storeys: cached.storeys, byElementId: new Map(cached.storeyByElementId) };
    hull = cached.hull;
    model = cached.model;
    rescan = {
      records: new Map(cached.records.map((record) => [record.elementId, record])),
      tailHits: new Map(cached.tailHits.map((hit) => [hit.elementId, hit])),
      shapes: new Map(cached.shapes),
      pagesRead: cached.pagesRead,
    };
  } else {
    storeyModel = readStoreys(ifcPath);
    truth = await readTruthBoxes(ifcPath);
    hull = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const { box } of truth.values()) {
      for (let axis = 0; axis < 3; axis += 1) {
        hull[axis] = Math.min(hull[axis]!, box[axis]!);
        hull[axis + 3] = Math.max(hull[axis + 3]!, box[axis + 3]!);
      }
    }
    model = buildModelView(convertModel(rvtPath), ifcPath);
    rescan = rescanPartitions(rvtPath);
    if (cachePath) {
      const payload: Cached = {
        rvt: rvtName,
        ifc: ifcName,
        hull,
        storeys: storeyModel.storeys,
        storeyByElementId: [...storeyModel.byElementId],
        truth: [...truth],
        records: [...rescan.records.values()],
        tailHits: [...rescan.tailHits.values()],
        shapes: [...rescan.shapes],
        pagesRead: rescan.pagesRead,
        model,
      };
      writeFileSync(cachePath, JSON.stringify(payload));
      console.log(`measurements cached in ${cachePath}`);
    }
  }

  const partitioner = buildPartitioner(storeyModel, hull);
  const stair = stairCompanionRule(rescan, model, truth, partitioner);
  const tail = tailWindowRule(rescan, truth, partitioner);
  const doors = doorSwingRules(model, truth, partitioner);
  const reports: RuleReport[] = [
    tighterCopyRule(rescan, truth, partitioner),
    railingGuardRule(model, partitioner),
    unnamedSheetRule(model, truth, partitioner),
    doors.fromShape,
    doors.fromWall,
    stair.premise,
    stair.adoption,
    reservedWordRule(rescan, model, truth, partitioner),
    tail.window,
    tail.placement,
  ];

  console.log(`\n${rvtName} against ${ifcName}, held out by storey and by wing\n`);
  console.log("This is a partition of ONE building. Every partition shares its Revit");
  console.log("release, its exporter, its families and its modelling conventions, so a");
  console.log("rule that holds across all of them may still be an artefact of this file.");
  console.log("It is not the second-model check: verify-pair.ts is, and it has never run");
  console.log("on a second model, because there is no second model on this machine.\n");
  console.log(
    `storeys: ${storeyModel.storeys.length}, ${storeyModel.storeys[0]?.name} at ` +
      `${storeyModel.storeys[0]?.elevationFeet.toFixed(1)} ft up to ` +
      `${storeyModel.storeys.at(-1)?.name} at ${storeyModel.storeys.at(-1)?.elevationFeet.toFixed(1)} ft`,
  );
  console.log(`wings: ${partitioner.wingNames.join("  |  ")}  (the export hull's longer plan axis, halved)`);
  console.log(
    `export products with a Revit id and geometry: ${truth.size.toLocaleString()}; ` +
      `records recovered: ${model.records.length.toLocaleString()}; ` +
      `pages re-read: ${rescan.pagesRead.toLocaleString()}`,
  );
  console.log(
    `building-element coverage, for context: ${model.drawnElements.toLocaleString()} of ` +
      `${model.inIfc.toLocaleString()} drawn`,
  );
  console.log(
    `\npartitions marked * hold under ${MIN_PARTITION_N} measured elements and are left out of the spread.` +
      `\nthe band column is the share of a partition's items whose storey came from an elevation band` +
      `\nrather than from the export's containment.` +
      `\nthe "measured against eligible" line is reach rather than a percentage: the numerator is what` +
      `\nthe rule was measured on, which for some rules needs an export join as well.`,
  );

  for (const report of reports) printRule(report);

  const split = reports.filter((report) => report.verdict === "split");
  const silent = reports.filter((report) => report.verdict === "silent");
  const untestable = reports.filter((report) => report.verdict === "untestable");

  console.log("\nsummary\n");
  const width = Math.max(...reports.map((report) => report.rule.length));
  for (const report of reports) {
    const worst = comparisons(report)
      .sort((a, b) => b.spread - a.spread)[0];
    console.log(
      `  ${pad(report.verdict.toUpperCase(), 11)}${pad(report.rule, width + 2)}` +
        `n=${padStart(report.n.toLocaleString(), 7)}  ` +
        `overall ${padStart(report.overallPercent == null ? "-" : `${report.overallPercent.toFixed(1)}%`, 7)}  ` +
        `widest spread ${padStart(worst ? `${worst.spread.toFixed(1)}pp` : "-", 8)}` +
        `${worst ? ` at z=${worst.z.toFixed(1)}` : ""}`,
    );
  }

  console.log(
    `\n${silent.length ? "FAIL" : "PASS"} — ${split.length} split, ${silent.length} silent, ` +
      `${untestable.length} untestable, ` +
      `${reports.length - split.length - silent.length - untestable.length} holding\n`,
  );
  if (split.length) {
    console.log("A split rule works better on some parts of this building than others.");
    console.log("That is what overfitting looks like from the inside. It is a finding");
    console.log("rather than a regression, so it does not fail the run without --strict.\n");
  }
  if (silent.length) {
    console.log("A silent rule stopped firing on a partition holding a population it");
    console.log("should have fired on. No accuracy threshold catches that, which is why");
    console.log("this exits non-zero.\n");
  }

  if (jsonPath) {
    writeFileSync(
      jsonPath,
      `${JSON.stringify(
        {
          rvt: rvtName,
          ifc: ifcName,
          caveat:
            "Partitions of one building. Every partition shares its release, exporter, " +
            "families and modelling conventions. This is not a second-model check.",
          partitions: {
            storeys: storeyModel.storeys,
            wings: partitioner.wingNames,
            bandFallbacks: partitioner.bandFallbacks.size,
          },
          rules: reports,
          verdict: silent.length || (strict && split.length) ? "FAIL" : "PASS",
        },
        null,
        2,
      )}\n`,
    );
    console.log(`machine-readable report written to ${jsonPath}`);
  }

  process.exit(silent.length || (strict && split.length) ? 1 : 0);
}
