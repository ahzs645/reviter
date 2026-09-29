/**
 * Class indices resolved from the file's own schema, per release.
 *
 * Every release-gated decoder finds its records by a class index — the object
 * marker at `+16` of a framed object, the source-class slot of a GRep node —
 * and each of those indices is a position in the file's own `Formats/Latest`
 * stream. The indices were measured on the supplied Revit 2027 project and
 * written into the decoders as constants named for that release.
 *
 * Measured 2026-09-11 on three Autodesk sample models (Revit 2024, 2025 and
 * 2025) against the 2027 project: all 57 constants exist by *name* in every
 * file, and every one sits at a different index in each release — 57 shifted,
 * 0 unchanged, 0 missing, with the two 2025 files agreeing on all 4,600 of
 * their classes. The record layouts underneath do not drift: the duplicated
 * bounds signature run with the 2025 file's own `GElement` index finds 8,506
 * records on the Technical School model covering 5,443 of the 5,479 elements
 * the Autodesk viewer draws, and finds nothing under the 2027 constant.
 * `docs/second-buildings-release-drift-2026-09-11.md` is the record.
 *
 * So the constants stay where they are and keep their 2027 values as the
 * default, but each one registers the class name it stands for, and a
 * conversion resolves every name against the schema it just read before any
 * decoder runs. The registered bindings are `let` exports: ES module bindings
 * are live, so every importer reads the resolved value without being touched.
 * Tables built at module load from those bindings go through {@link releaseMemo},
 * which rebuilds them when the resolution changes.
 *
 * Resolution is all-or-nothing. A schema that lacks any registered class
 * leaves the 2027 defaults in place and the release gates closed for any file
 * that is not 2027 — exactly the behaviour before this module existed — and
 * reports which names were missing, so the reason is visible rather than
 * inferred from an empty scene.
 */

import type { SchemaStream } from "./schema-reader.ts";

/** The release whose class indices the constants hold by default. */
export const REFERENCE_RELEASE = 2027;

type Registration = {
  className: string;
  revit2027: number;
  apply: (value: number) => void;
};

export type ReleaseMarkerResolution = {
  /** Release the markers currently describe; the decoders gate on this. */
  release: number;
  /** Whether the schema resolved every registered class. */
  resolved: boolean;
  /** Registered class names the schema did not declare. */
  missing: string[];
  /** Names whose resolved index differs from the 2027 constant. */
  shifted: { className: string; revit2027: number; index: number }[];
  /** Classes registered, for the audit. */
  registered: number;
};

const registrations: Registration[] = [];
let activeRelease_ = REFERENCE_RELEASE;
let generation = 0;
let lastResolution: ReleaseMarkerResolution = {
  release: REFERENCE_RELEASE,
  resolved: false,
  missing: [],
  shifted: [],
  registered: 0,
};

/**
 * Register a class-index constant. Returns the 2027 value so the declaration
 * reads `export let X = registerReleaseMarker("GElement", 2246, (v) => { X = v; })`.
 */
export function registerReleaseMarker(
  className: string,
  revit2027: number,
  apply: (value: number) => void,
): number {
  registrations.push({ className, revit2027, apply });
  return revit2027;
}

/** Put every constant back to its 2027 value. */
export function resetReleaseMarkers(): void {
  for (const registration of registrations) registration.apply(registration.revit2027);
  activeRelease_ = REFERENCE_RELEASE;
  generation += 1;
  lastResolution = {
    release: REFERENCE_RELEASE,
    resolved: false,
    missing: [],
    shifted: [],
    registered: registrations.length,
  };
}

/**
 * Resolve every registered class against a file's schema and, when all of them
 * are declared, point the constants at that file's indices and open the
 * release gates for `revitVersion`. Anything short of a complete resolution
 * resets to the 2027 defaults.
 */
export function applyReleaseMarkers(
  schema: SchemaStream | null | undefined,
  revitVersion: number | null | undefined,
): ReleaseMarkerResolution {
  resetReleaseMarkers();
  const release = Number.isInteger(revitVersion) ? revitVersion! : null;
  if (!schema || release == null) {
    lastResolution = { ...lastResolution, missing: schema ? [] : ["(no schema stream)"] };
    return lastResolution;
  }
  const byName = new Map<string, number>();
  for (const schemaClass of schema.classes) {
    if (!byName.has(schemaClass.name)) byName.set(schemaClass.name, schemaClass.index);
  }
  const missing: string[] = [];
  const shifted: ReleaseMarkerResolution["shifted"] = [];
  const values: number[] = [];
  for (const registration of registrations) {
    const index = byName.get(registration.className);
    if (index == null) {
      missing.push(registration.className);
      continue;
    }
    values.push(index);
    if (index !== registration.revit2027) {
      shifted.push({ className: registration.className, revit2027: registration.revit2027, index });
    }
  }
  if (missing.length) {
    lastResolution = {
      release: REFERENCE_RELEASE,
      resolved: false,
      missing: [...new Set(missing)],
      shifted: [],
      registered: registrations.length,
    };
    return lastResolution;
  }
  registrations.forEach((registration, position) => registration.apply(values[position]!));
  activeRelease_ = release;
  generation += 1;
  lastResolution = {
    release,
    resolved: true,
    missing: [],
    shifted,
    registered: registrations.length,
  };
  return lastResolution;
}

/** The release whose class indices the constants currently hold. */
export function activeRelease(): number {
  return activeRelease_;
}

/** The most recent resolution, for the conversion report. */
export function releaseMarkerResolution(): ReleaseMarkerResolution {
  return lastResolution;
}

/**
 * Whether the release-gated decoders may run for a file of `revitVersion`:
 * true when the constants currently hold that release's indices. With no
 * resolution applied this is `revitVersion === 2027`, as before.
 */
export function releaseDecodersApply(revitVersion: number | null | undefined): boolean {
  return revitVersion != null && revitVersion === activeRelease_;
}

/**
 * A table built from registered constants, rebuilt whenever the resolution
 * changes. Use for module-level maps and sets that would otherwise freeze the
 * 2027 values at import time.
 */
export function releaseMemo<T>(build: () => T): () => T {
  let builtAt = -1;
  let value: T;
  return () => {
    if (builtAt !== generation) {
      value = build();
      builtAt = generation;
    }
    return value;
  };
}
