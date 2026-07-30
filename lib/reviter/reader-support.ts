/**
 * What the optional standards-aware reader supports, in one place.
 *
 * The vendored Rust/WASM reader (`lib/rvt-wasm`, from `rvt-rs`) declares that
 * it classifies field encodings across Revit 2016–2026. That range was repeated
 * in four places — two comparisons in the worker and two user-facing strings,
 * one of them in the studio — so upgrading the vendored reader meant finding
 * every copy, and a missed copy would either skip a release the reader now
 * handles or hand it a file it cannot read.
 *
 * The range is not a formality. On the supplied Revit 2027 project the reader's
 * `quickSummary` succeeds and reports the release and 10,481 schema classes,
 * but `openRvtBytesWithDiagnostics` traps inside the WebAssembly module
 * (`RuntimeError: unreachable`). The worker catches it, so the app survives,
 * but the check is what turns a panic into an explanation.
 *
 * None of this describes Reviter's own decoders. Those are selected per release
 * by `decoderPlanForVersion`, and the element-bounds, category, identity, and
 * material decoders that carry the supplied model are 2027-specific — a release
 * this reader does not support. The two are independent, and a message about
 * one must not be written as a verdict on the other.
 */

/** Oldest release the vendored standards-aware reader classifies. */
export const STANDARDS_READER_MIN_VERSION = 2016;

/** Newest release the vendored standards-aware reader classifies. */
export const STANDARDS_READER_MAX_VERSION = 2026;

/** Human-readable form of the supported range, for user-facing text. */
export const STANDARDS_READER_RANGE_LABEL =
  `${STANDARDS_READER_MIN_VERSION}–${STANDARDS_READER_MAX_VERSION}`;

/** True when the vendored standards-aware reader claims to handle `version`. */
export function standardsReaderSupports(version: number): boolean {
  return (
    Number.isFinite(version) &&
    version >= STANDARDS_READER_MIN_VERSION &&
    version <= STANDARDS_READER_MAX_VERSION
  );
}
