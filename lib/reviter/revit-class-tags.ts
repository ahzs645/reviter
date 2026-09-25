/**
 * Class indices, translated between a file's own schema and the 2027 numbering
 * the decoders were written in.
 *
 * A partition object names its class by a `u16` at `+16`, and that number is
 * the class's position in the same file's `Formats/Latest`. The decoders were
 * measured on one Revit 2027 project and compare against its numbers: `0x08c6`
 * for `GElement`, `0x07ef` for `FamilyInstance`, `1825` for `Face`. Those
 * numbers are not Revit's; they are that schema's. Between the 2027 schema and a
 * 2025 one, 16 of the 4,553 shared classes keep their index. `GElement` is 2246
 * in 2027, 2166 in 2025 and 2111 in 2024, and the 2025 file's 2246 is
 * `GeomPositioningCell`.
 *
 * Measured, not assumed: labelling each framed object by the element the
 * paired Autodesk property database names, a 2025 wall is headed by 3762 and
 * 2166, the 2025 schema's `SWall` and `GElement`; a 2024 wall by 3669 and 2111,
 * that schema's `SWall` and `GElement`. The marker follows the file.
 *
 * So the decoders keep their 2027 constants, and this module sits where bytes
 * become class numbers:
 *
 *  - a class index **read** from a file goes through `canonicalClassTag`, which
 *    returns the 2027 index of the class with the same name;
 *  - a class index **searched for** in a file's bytes goes through
 *    `fileClassTag`, which returns that file's index for a 2027 class.
 *
 * The translation is by class name and is exact for every class both schemas
 * declare. A file class the 2027 schema lacks translates to a number above any
 * real index, so it can never be mistaken for one; a 2027 class the file lacks
 * has no file index, and a search for it finds nothing. Values outside the
 * schema's range — negatives, the reserved low indices, and runtime slots
 * beyond the last declared class — pass through unchanged.
 *
 * Conversion is synchronous and runs one file at a time in both the worker and
 * the Node command, so the active translation is module state installed by
 * `convertRvtBytes` for the length of one conversion, the way the limit census
 * is.
 */
import {
  REVIT_2027_CLASS_NAMES,
  REVIT_2027_FIRST_CLASS_INDEX,
} from "./revit-2027-class-names.data.ts";

/**
 * Oldest release whose partition records the 2027 decoders read once class
 * indices are translated.
 *
 * The record layouts the decoders depend on are the same from 2024 through
 * 2027: of the 4,553 classes a 2025 schema shares with 2027, 4,321 keep their
 * version and field count, including every geometry class (`Face`, `Edge`,
 * `EdgeLoop`, `Plane`, `CylSurf`, `GArc`, `GInstance`, `Geometry`, `GRep`,
 * `GPolyMesh`) and `Element` itself. What moved is the numbering, which
 * `canonicalClassTag` undoes. Each release in the range was checked against an
 * Autodesk Viewer capture of the same file; see
 * `docs/older-release-decoding-2026-09-25.md`.
 */
export const REVIT_2027_RECORD_LAYOUT_FIRST_RELEASE = 2024;

/** Whether a release's partition records are read by the 2027 decoders. */
export function usesRevit2027RecordLayout(revitVersion: number | null | undefined): boolean {
  return (
    revitVersion != null &&
    Number.isInteger(revitVersion) &&
    revitVersion >= REVIT_2027_RECORD_LAYOUT_FIRST_RELEASE &&
    revitVersion <= 2027
  );
}

/** Last index the 2027 schema declares. */
export const REVIT_2027_LAST_CLASS_INDEX =
  REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.length - 1;

/**
 * Classes a schema must share with 2027 by name before its numbering is
 * trusted to translate: half the 2027 table. Real release schemas clear it by
 * a wide margin (4,447 of the 2024 schema's 4,492 classes are shared).
 */
const MIN_RELEASE_SCHEMA_CLASSES = Math.floor(REVIT_2027_CLASS_NAMES.length / 2);

/** Where a file class with no 2027 counterpart is placed: above every index. */
const UNMATCHED_CLASS_BASE = 0x10000;

export type ClassTagTranslation = {
  /** True when every shared class already has its 2027 index. */
  identity: boolean;
  /** Classes the file declares under the same name as a 2027 class. */
  matchedClasses: number;
  /** Of those, how many sit at a different index than in 2027. */
  movedClasses: number;
  /** File classes with no 2027 counterpart. */
  unmatchedFileClasses: number;
  /** 2027 classes the file does not declare. */
  missingCanonicalClasses: number;
  /** File index -> 2027 index, indexed by the raw `u16`. */
  toCanonical: Int32Array;
  /** 2027 index -> file index, or -1 when the file lacks the class. */
  toFile: Int32Array;
};

let canonicalIndexByName: Map<string, number> | null = null;

function canonicalIndices(): Map<string, number> {
  if (!canonicalIndexByName) {
    canonicalIndexByName = new Map();
    REVIT_2027_CLASS_NAMES.forEach((name, position) => {
      if (!canonicalIndexByName!.has(name)) {
        canonicalIndexByName!.set(name, REVIT_2027_FIRST_CLASS_INDEX + position);
      }
    });
  }
  return canonicalIndexByName;
}

/**
 * Build the translation from a file's declared classes, as `SchemaSummary`
 * reports them. An empty list yields the identity, so a file whose schema did
 * not read is decoded exactly as before.
 */
export function buildClassTagTranslation(
  classes: ReadonlyArray<{ name: string; tag: number }>,
): ClassTagTranslation {
  const canonical = canonicalIndices();
  const targets = new Map<number, number>();
  const seen = new Set<string>();
  let movedClasses = 0;
  let unmatchedFileClasses = 0;
  for (const entry of classes) {
    if (entry.tag < 0 || entry.tag > 0xffff) continue;
    const target = canonical.get(entry.name);
    if (target == null || seen.has(entry.name)) {
      unmatchedFileClasses += 1;
      continue;
    }
    seen.add(entry.name);
    targets.set(entry.tag, target);
    if (target !== entry.tag) movedClasses += 1;
  }

  const toCanonical = new Int32Array(0x10000);
  const toFile = new Int32Array(0x10000);
  for (let value = 0; value < 0x10000; value += 1) {
    toCanonical[value] = value;
    toFile[value] = value;
  }
  const summary = {
    matchedClasses: targets.size,
    movedClasses,
    unmatchedFileClasses,
    missingCanonicalClasses: canonical.size - seen.size,
  };
  // A schema that agrees with the 2027 numbering wherever the two share a
  // class — a 2027 file — is read as written. So is one too small to be a
  // release's schema at all: a Revit project declares thousands of classes
  // (4,757 in 2027, 4,600 in 2025, 4,492 in 2024) and shares more than 4,400
  // of them by name with 2027, while a fixture declaring three classes at
  // arbitrary indices says nothing about the indices it omits.
  if (movedClasses === 0 || targets.size < MIN_RELEASE_SCHEMA_CLASSES) {
    return { identity: true, ...summary, toCanonical, toFile };
  }

  // A real file declares every index from 12 to its last with no gap. Then a
  // 2027 class it does not name is one it does not have, and a 2027-range
  // index it does not declare is not a class number in this file. A schema
  // with gaps says nothing about what it omits, so those pass through.
  const declared = new Set(classes.map((entry) => entry.tag));
  let fileLast = -1;
  for (const entry of classes) fileLast = Math.max(fileLast, entry.tag);
  let complete = fileLast >= REVIT_2027_FIRST_CLASS_INDEX;
  for (let index = REVIT_2027_FIRST_CLASS_INDEX; complete && index <= fileLast; index += 1) {
    if (!declared.has(index)) complete = false;
  }
  if (complete) {
    for (let index = REVIT_2027_FIRST_CLASS_INDEX; index <= REVIT_2027_LAST_CLASS_INDEX; index += 1) {
      toFile[index] = -1;
      if (index <= fileLast) toCanonical[index] = UNMATCHED_CLASS_BASE + index;
    }
  }
  for (const entry of classes) {
    if (entry.tag < 0 || entry.tag > 0xffff) continue;
    const target = targets.get(entry.tag);
    if (target == null) {
      toCanonical[entry.tag] = UNMATCHED_CLASS_BASE + entry.tag;
      continue;
    }
    toCanonical[entry.tag] = target;
    toFile[target] = entry.tag;
  }
  return { identity: false, ...summary, toCanonical, toFile };
}

let active: ClassTagTranslation | null = null;

/** Install `translation` for the conversion about to run; `null` restores the identity. */
export function setActiveClassTagTranslation(translation: ClassTagTranslation | null): void {
  active = translation && !translation.identity ? translation : null;
}

/** The translation currently installed, or `null` when indices are read as written. */
export function activeClassTagTranslation(): ClassTagTranslation | null {
  return active;
}

/** The 2027 index of the class a file's raw index names. */
export function canonicalClassTag(fileIndex: number): number {
  if (active === null || fileIndex < 0 || fileIndex > 0xffff) return fileIndex;
  return active.toCanonical[fileIndex]!;
}

/**
 * The file's index for a 2027 class, or -1 when the file does not declare it.
 *
 * A value `canonicalClassTag` placed above every index — a file class with no
 * 2027 counterpart, measured from the file and searched for again — returns
 * to the file's own number.
 */
export function fileClassTag(canonicalIndex: number): number {
  if (active === null || canonicalIndex < 0) return canonicalIndex;
  if (canonicalIndex >= UNMATCHED_CLASS_BASE) {
    return canonicalIndex < UNMATCHED_CLASS_BASE + 0x10000
      ? canonicalIndex - UNMATCHED_CLASS_BASE
      : canonicalIndex;
  }
  return active.toFile[canonicalIndex]!;
}
