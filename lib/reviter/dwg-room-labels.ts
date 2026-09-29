/**
 * Room numbers off a survey DWG, sorted into the plans they label.
 *
 * On the UNBC survey drawing a room is tagged by a `room_data` block reference
 * whose two attributes carry the number (`ROOMNUM`, e.g. "10-2050") and the
 * use (`ROOMUSE`, e.g. "Office"); a few dozen more numbers are loose TEXT. The
 * number's prefix is the campus building number and the digits after it lead
 * with the floor, which is what lets a label be checked against the sheet it
 * was found on.
 *
 * Pure, and takes the flattened entities `dwg-entities.ts` produces, so it is
 * testable without the WASM decoder.
 */
import type { DwgBounds, DwgEntity } from "./dwg-plan.ts";

/**
 * A campus room number: a two-digit building, a dash, then the room. The room
 * may lead with a letter (`S` stair, `B` basement), trail one (`2078B`), carry
 * a sub-room (`09-200-1`) or name two rooms at once (`04-213,214`).
 */
const ROOM_NUMBER = /^(\d{2})-([A-Z]?)(\d{3,4})([A-Z]?)(?:-([0-9A-Z]))?(?:,\d{3,4})?$/iu;

/** Attribute tags that hold a room's number, and the ones that hold its name. */
const NUMBER_TAG = /^(?:ROOM_?(?:NUM(?:BER)?|NO)|RM_?(?:NUM|NO)|NUMBER)$/iu;
const NAME_TAG = /^(?:ROOM_?(?:USE|NAME)|RM_?NAME|NAME)$/iu;

/** Loose text that states an area, e.g. "19.0 sqr m". */
const AREA_TEXT = /^\d+(?:[.,]\d+)?\s*(?:sq(?:r|\.)?\s*m|m2|m²|sq\.?\s*ft|sf)$/iu;

export type DwgRoomNumber = {
  building: string;
  /** The floor the number's first digit gives, or "B" for a basement prefix. */
  level: string;
};

/** The number as stored, with stray quotes and padding a drafter left removed. */
export function normaliseRoomNumber(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/gu, "").trim().toUpperCase();
}

/**
 * The building and floor a room number encodes, or null when it is not one.
 *
 * The first digit of the room part is the floor on every building in the
 * drawing, whether the room part has three digits (04-246, level 2) or four
 * (10-2050, level 2). A `B` prefix is a basement room.
 */
export function parseRoomNumber(value: string): DwgRoomNumber | null {
  const match = ROOM_NUMBER.exec(normaliseRoomNumber(value));
  if (!match) return null;
  const [, building, prefix, digits] = match;
  const level = prefix?.toUpperCase() === "B" ? "B" : digits!.slice(0, 1);
  return { building: building!, level };
}

export type DwgRoomLabel = {
  /** Normalised room number, e.g. "10-2050". */
  number: string;
  /** Exactly as the file holds it. */
  raw: string;
  /** The room's use from the same tag, e.g. "Office"; null when there is none. */
  name: string | null;
  /** Where the label is pinned: the tag's centre for a justified attribute. */
  position: [number, number];
  /** Where the text starts (left baseline). */
  textStart: [number, number];
  height: number | null;
  type: string;
  layer: string;
  tag: string | null;
  block: string | null;
  /** Handle of the block reference that pairs number and name. */
  insert: string | null;
  source: "attribute" | "text";
  /** Building and floor from the number itself; null when it is malformed. */
  parsed: DwgRoomNumber | null;
};

const pointOf = (value: readonly [number, number]): [number, number] => [value[0], value[1]];

/**
 * Every candidate room-number label in a drawing.
 *
 * Attributes are recognised by tag, whatever their text looks like, so a
 * malformed number in a room tag is still reported (with `parsed: null`) for
 * someone to fix. Loose TEXT and MTEXT are recognised by shape instead, since
 * nothing else says what they are; a loose label that repeats a tagged number
 * is kept, as it marks the same room somewhere else on the sheet.
 */
export function dwgRoomLabels(entities: readonly DwgEntity[]): DwgRoomLabel[] {
  const names = new Map<string, string>();
  for (const entity of entities) {
    if (entity.insert && entity.tag && NAME_TAG.test(entity.tag) && entity.text) {
      names.set(entity.insert, entity.text.replace(/\s*\n\s*/gu, " ").replace(/^"|"$/gu, ""));
    }
  }
  const labels: DwgRoomLabel[] = [];
  for (const entity of entities) {
    if (!entity.text || !entity.centre) continue;
    const byTag = entity.tag != null && NUMBER_TAG.test(entity.tag);
    if (entity.tag != null && !byTag) continue;
    const raw = entity.text;
    const parsed = parseRoomNumber(raw);
    if (!byTag && !parsed) continue;
    labels.push({
      number: normaliseRoomNumber(raw),
      raw,
      name: entity.insert ? names.get(entity.insert) ?? null : null,
      position: pointOf(entity.anchor ?? entity.centre),
      textStart: pointOf(entity.centre),
      height: entity.height ?? null,
      type: entity.type,
      layer: entity.layer,
      tag: entity.tag ?? null,
      block: entity.block ?? null,
      insert: entity.insert ?? null,
      source: byTag ? "attribute" : "text",
      parsed,
    });
  }
  return labels;
}

export type DwgPlanText = {
  text: string;
  position: [number, number];
  height: number | null;
  type: string;
  layer: string;
};

const planText = (entity: DwgEntity): DwgPlanText => ({
  text: entity.text!,
  position: pointOf(entity.anchor ?? entity.centre!),
  height: entity.height ?? null,
  type: entity.type,
  layer: entity.layer,
});

/** Loose area annotations ("19.0 sqr m") — rare, but worth carrying next to a room. */
export function dwgAreaTexts(entities: readonly DwgEntity[]): DwgPlanText[] {
  return entities
    .filter((entity) => entity.text && entity.centre && !entity.tag && AREA_TEXT.test(entity.text.trim()))
    .map(planText);
}

/**
 * The title block text of one plan, e.g. "T&L WEST / LEVEL 1".
 *
 * A title is whatever loose text is drawn largest on the plan, among text that
 * is not a room label or an attribute and says something in words. Plans on
 * this drawing title themselves at 500 units against room tags at 170–770, but
 * a few — the maintenance building's — title at the room-tag size, so the rule
 * is relative to the plan rather than a fixed height.
 */
export function dwgPlanTitles(
  entities: readonly DwgEntity[],
  options: { excludeLayers?: ReadonlySet<string>; ratio?: number } = {},
): DwgPlanText[] {
  const candidates = entities.filter((entity) => {
    if (!entity.text || !entity.centre || entity.tag) return false;
    if (options.excludeLayers?.has(entity.layer)) return false;
    if ((entity.text.match(/\p{L}/gu)?.length ?? 0) < 3) return false;
    return !parseRoomNumber(entity.text) && !AREA_TEXT.test(entity.text.trim());
  });
  const tallest = Math.max(0, ...candidates.map((entity) => entity.height ?? 0));
  if (!(tallest > 0)) return [];
  const floor = tallest * (options.ratio ?? 0.8);
  return candidates
    .filter((entity) => (entity.height ?? 0) >= floor)
    // Reading order: top to bottom, then left to right.
    .sort((a, b) => b.centre![1] - a.centre![1] || a.centre![0] - b.centre![0])
    .map(planText);
}

export type DwgSheetName = {
  /** Campus building number, e.g. "10"; null when the name does not lead with one. */
  building: string | null;
  /** The floors the sheet shows, e.g. ["0", "2"] for "LVL 0 and 2". */
  levels: string[];
  /** A wing or part, e.g. "S", "W", "Atrium". */
  part: string | null;
};

/**
 * What a layout name says about the plan: "04 Res Lab LVL 1S" is building 04,
 * level 1, south; "10 TandL 2500E" is building 10, level 2, east — the
 * Teaching and Learning Centre names its sheets by the first room number on
 * them; "07 Agora LVL 0 and 2" is two floors on one sheet.
 */
export function parseSheetName(name: string): DwgSheetName {
  const building = /^(\d{2})\b/u.exec(name)?.[1] ?? null;
  const rest = building ? name.slice(2) : name;
  const levels: string[] = [];
  let part: string | null = null;
  const lvl = /\blvl\s*([0-9]+(?:\s*(?:and|&|,)\s*[0-9]+)*)([NSEWC])?\b/iu.exec(rest);
  if (lvl) {
    for (const level of lvl[1]!.split(/\s*(?:and|&|,)\s*/iu)) levels.push(level);
    part = lvl[2]?.toUpperCase() ?? null;
  }
  const series = /\b([1-9])[05]00([EW])?\b/u.exec(rest);
  if (!lvl && series) {
    levels.push(series[1]!);
    part = series[2] ?? null;
  }
  if (/\bbase(?:ment)?\b/iu.test(rest) && !levels.includes("B")) levels.unshift("B");
  if (/\batrium\b/iu.test(rest)) part = part ?? "Atrium";
  if (/\bfull\b/iu.test(rest)) part = part ?? "Full";
  return { building, levels, part };
}

export type DwgPlanRegion = { id: number; name: string; bounds: DwgBounds };

function contains(bounds: DwgBounds, [x, y]: readonly [number, number]): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

const area = (bounds: DwgBounds) => (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

/**
 * Which plan each label belongs to, as an index into `plans` or -1.
 *
 * Viewport windows overlap — a sheet crops generously and catches the edge of
 * its neighbour — so a label can sit inside two or three of them. Among those,
 * a plan of the label's own building wins; then one whose levels include the
 * label's floor; then the tightest window, which is the one drawn around it
 * rather than past it.
 */
export function assignLabelsToPlans(
  labels: readonly Pick<DwgRoomLabel, "position" | "parsed">[],
  plans: readonly DwgPlanRegion[],
): number[] {
  const names = plans.map((plan) => parseSheetName(plan.name));
  return labels.map((label) => {
    let best = -1;
    let bestScore = -Infinity;
    plans.forEach((plan, index) => {
      if (!contains(plan.bounds, label.position)) return;
      const sheet = names[index]!;
      let score = 0;
      if (label.parsed && sheet.building === label.parsed.building) score += 4;
      if (label.parsed && sheet.levels.includes(label.parsed.level)) score += 2;
      // Smaller windows break ties; the log keeps area from outvoting the rest.
      score -= Math.log10(Math.max(area(plan.bounds), 1)) / 100;
      if (score > bestScore) { bestScore = score; best = index; }
    });
    return best;
  });
}

/**
 * Layouts that are overview sheets rather than one plan: their window takes in
 * the centres of several other sheets. "Full Campus Main Floor" is one.
 */
export function overviewSheets(plans: readonly DwgPlanRegion[]): Set<number> {
  const overview = new Set<number>();
  plans.forEach((plan, index) => {
    let covered = 0;
    for (const other of plans) {
      if (other === plan) continue;
      const centre: [number, number] = [
        (other.bounds.minX + other.bounds.maxX) / 2,
        (other.bounds.minY + other.bounds.maxY) / 2,
      ];
      if (contains(plan.bounds, centre) && area(other.bounds) < area(plan.bounds)) covered += 1;
    }
    if (covered >= 3) overview.add(index);
  });
  return overview;
}
