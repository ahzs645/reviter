/**
 * What a reviewer asserted over a recovered element.
 *
 * Reviter cannot write RVT, so an edit here is never a change to the building.
 * It is a claim laid on top of a recovery, and it only reaches the world through
 * an export. That makes a user-authored value a third provenance class beside
 * decoded and inferred, and the least reliable of the three — so nothing in this
 * module mutates a `ConvertResult`. Overrides live beside it, keyed by Revit
 * element id, and the exporter reads both.
 *
 * The shape deliberately mirrors `room-review.ts`, which has been doing exactly
 * this for derived rooms since before there was a name for it: a per-candidate
 * disposition, user-authored fields, sidecar persistence keyed to the model, and
 * consumption by `makeIfc`. This generalises that pattern from rooms the
 * decoder derived to elements the decoder read.
 *
 * ## What is overridable, and why only this
 *
 * **Category.** The one that matters. On the supplied project on 2026-08-19,
 * 23,440 of 38,978 categorised products — 60.1% — carried a category taken from
 * a record-code consensus rather than read from their own token. That is the
 * largest single inference in the delivered model and the field a reviewer is
 * most likely to know better than the decoder.
 *
 * **Type name.** Decoded for system families, whose type records live in the
 * same partition. Loadable families keep their names inside family-document
 * blobs that are not decoded, so those elements show no type at all and a
 * reviewer supplying one is adding information rather than correcting it.
 *
 * **A note.** Free text, carried into the export, for the case the other two
 * cannot express.
 *
 * Geometry is deliberately not overridable. A reviewer disagreeing with a
 * bounds envelope is right far more often than not, but "this is the wrong
 * shape" is not a shape, and an interface that accepted a corrected body
 * without one would be inviting a claim it cannot store.
 */
import type { ElementBoundsRecord } from "./types.ts";

/** Sidecar format version. Named because it appears in the exported shape. */
export const ELEMENT_OVERRIDE_VERSION = 1 as const;

/** How many snapshots the undo stack keeps before dropping the oldest. */
const MAX_HISTORY = 50;

export type AssertedCategory = {
  /** Revit `BuiltInCategory` id, negative, as the decoder reports them. */
  id: number;
  name: string;
};

export type ElementOverride = {
  elementId: number;
  /** Null when the reviewer has not overridden the decoded category. */
  category: AssertedCategory | null;
  /** Null when the reviewer has not overridden or supplied a type name. */
  typeName: string | null;
  note: string;
  author: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * The fields an override may set, as a patch.
 *
 * `undefined` leaves a field alone; `null` clears an existing assertion back to
 * whatever the decoder said. The two are different actions and a single
 * "falsy means clear" rule would make un-asserting impossible to distinguish
 * from not mentioning.
 */
export type ElementOverridePatch = {
  category?: AssertedCategory | null;
  typeName?: string | null;
  note?: string;
};

export type ElementOverrideState = {
  overrides: ElementOverride[];
  /** Snapshots of `overrides` before each change, oldest first. */
  past: ElementOverride[][];
  future: ElementOverride[][];
};

export type ElementOverrideSidecar = {
  format: "reviter-element-overrides";
  version: typeof ELEMENT_OVERRIDE_VERSION;
  exportedAt: string;
  model: { fileName: string; byteLength: number };
  overrides: ElementOverride[];
};

export function emptyElementOverrideState(): ElementOverrideState {
  return { overrides: [], past: [], future: [] };
}

/** An override that asserts nothing is not an override; it is a deleted one. */
export function isEmptyOverride(override: ElementOverride): boolean {
  return override.category === null && override.typeName === null && !override.note.trim();
}

export function overrideFor(
  overrides: readonly ElementOverride[],
  elementId: number,
): ElementOverride | null {
  return overrides.find((override) => override.elementId === elementId) ?? null;
}

/** The fields this override actually asserts, in a stable order. */
export function assertedFields(override: ElementOverride): string[] {
  const fields: string[] = [];
  if (override.category) fields.push("category");
  if (override.typeName !== null) fields.push("typeName");
  if (override.note.trim()) fields.push("note");
  return fields;
}

function pushHistory(state: ElementOverrideState, next: ElementOverride[]): ElementOverrideState {
  return {
    overrides: next,
    past: [...state.past, state.overrides].slice(-MAX_HISTORY),
    // Any new edit abandons the redo branch; keeping it would let a redo
    // reinstate a value the reviewer has since replaced.
    future: [],
  };
}

/**
 * Apply a patch to one element, creating or removing the override as needed.
 *
 * Returns the state unchanged when the patch is a no-op, so an editor that
 * fires on every keystroke does not fill the undo stack with identical
 * snapshots.
 */
export function setElementOverride(
  state: ElementOverrideState,
  elementId: number,
  patch: ElementOverridePatch,
  author: string,
  now = new Date().toISOString(),
): ElementOverrideState {
  const existing = overrideFor(state.overrides, elementId);
  const candidate: ElementOverride = {
    elementId,
    category: patch.category !== undefined ? patch.category : existing?.category ?? null,
    typeName: patch.typeName !== undefined ? patch.typeName : existing?.typeName ?? null,
    note: patch.note !== undefined ? patch.note : existing?.note ?? "",
    author,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const unchanged = existing
    && existing.category?.id === candidate.category?.id
    && existing.category?.name === candidate.category?.name
    && existing.typeName === candidate.typeName
    && existing.note === candidate.note;
  if (unchanged) return state;

  const others = state.overrides.filter((override) => override.elementId !== elementId);
  if (isEmptyOverride(candidate)) {
    // Clearing every field removes the override rather than leaving an empty
    // one, so the pending-change count in the review dialog stays truthful.
    return existing ? pushHistory(state, others) : state;
  }
  return pushHistory(state, [...others, candidate].sort((left, right) => left.elementId - right.elementId));
}

export function clearElementOverride(
  state: ElementOverrideState,
  elementId: number,
): ElementOverrideState {
  if (!overrideFor(state.overrides, elementId)) return state;
  return pushHistory(state, state.overrides.filter((override) => override.elementId !== elementId));
}

export function clearAllElementOverrides(state: ElementOverrideState): ElementOverrideState {
  if (!state.overrides.length) return state;
  return pushHistory(state, []);
}

export function undoElementOverrides(state: ElementOverrideState): ElementOverrideState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    overrides: previous,
    past: state.past.slice(0, -1),
    future: [state.overrides, ...state.future].slice(0, MAX_HISTORY),
  };
}

export function redoElementOverrides(state: ElementOverrideState): ElementOverrideState {
  const [next, ...rest] = state.future;
  if (!next) return state;
  return {
    overrides: next,
    past: [...state.past, state.overrides].slice(-MAX_HISTORY),
    future: rest,
  };
}

/**
 * The record as the exporter should see it, plus what was asserted.
 *
 * The decoded values are returned alongside rather than discarded: an export
 * that shows only the asserted category has replaced evidence with an opinion,
 * and the whole point of writing this down is that a reader can tell which is
 * which and see what the decoder had said.
 */
export type OverriddenRecord = {
  record: ElementBoundsRecord;
  asserted: string[];
  decoded: { categoryId?: number; categoryName?: string; typeName?: string };
  override: ElementOverride;
};

export function applyOverrideToRecord(
  record: ElementBoundsRecord,
  override: ElementOverride,
): OverriddenRecord {
  const asserted = assertedFields(override);
  const next: ElementBoundsRecord = { ...record };
  if (override.category) {
    next.categoryId = override.category.id;
    next.categoryName = override.category.name;
  }
  if (override.typeName !== null) next.typeName = override.typeName;
  return {
    record: next,
    asserted,
    decoded: {
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      typeName: record.typeName,
    },
    override,
  };
}

/**
 * Every record in the result, with any override applied.
 *
 * `ConvertResult.elementBounds` can hold more than one record per element — the
 * manifest picks the best by evidence rank — so the override is applied to each
 * record for that id rather than to the first one found.
 */
export function applyElementOverrides(
  records: readonly ElementBoundsRecord[],
  overrides: readonly ElementOverride[],
): { records: ElementBoundsRecord[]; overridden: Map<number, OverriddenRecord> } {
  if (!overrides.length) return { records: [...records], overridden: new Map() };
  const byElement = new Map(overrides.map((override) => [override.elementId, override]));
  const overridden = new Map<number, OverriddenRecord>();
  const applied = records.map((record) => {
    const override = byElement.get(record.elementId);
    if (!override) return record;
    const result = applyOverrideToRecord(record, override);
    if (!overridden.has(record.elementId)) overridden.set(record.elementId, result);
    return result.record;
  });
  return { records: applied, overridden };
}

function isAssertedCategory(value: unknown): value is AssertedCategory {
  if (!value || typeof value !== "object") return false;
  const category = value as AssertedCategory;
  return Number.isSafeInteger(category.id) && typeof category.name === "string" && category.name.length > 0;
}

export function isElementOverride(value: unknown): value is ElementOverride {
  if (!value || typeof value !== "object") return false;
  const override = value as ElementOverride;
  return Number.isSafeInteger(override.elementId)
    && (override.category === null || isAssertedCategory(override.category))
    && (override.typeName === null || typeof override.typeName === "string")
    && typeof override.note === "string"
    && typeof override.author === "string"
    && typeof override.createdAt === "string"
    && typeof override.updatedAt === "string";
}

/** Later `updatedAt` wins, matching how room review merges an incoming sidecar. */
export function mergeElementOverrides(
  current: readonly ElementOverride[],
  incoming: readonly ElementOverride[],
): ElementOverride[] {
  const byElement = new Map(current.map((override) => [override.elementId, override]));
  for (const override of incoming) {
    const prior = byElement.get(override.elementId);
    if (!prior || Date.parse(override.updatedAt) >= Date.parse(prior.updatedAt)) {
      byElement.set(override.elementId, override);
    }
  }
  return [...byElement.values()].sort((left, right) => left.elementId - right.elementId);
}
