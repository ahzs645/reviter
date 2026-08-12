/**
 * One framing walk per inflated page, shared by every decoder that reads the
 * framed-object envelope.
 *
 * **What was wrong.** `element-objects.ts` documents a single envelope — id at
 * `+0`, length at `+12`, marker at `+16`, the length echoed at `+objLen+16` —
 * and eight of the page walk's decoders each rediscovered it independently over
 * the same bytes. On the supplied 421,867,755-byte inflation
 * (3,666 pages, 184,074 framed objects) one such walk costs **2.2 s**, and the
 * page walk was paying it eight times over: the class-evidence pass, the native
 * mesh bridge, the material-element scan, the persisted-relationship scan, the
 * compound-structure scan, the family-symbol material scan, and the host and
 * associated-level relation scans.
 *
 * **What this fixes.** The page is framed once, here, and the result is offered
 * to the decoders instead of each one re-deriving it. Two things fall out:
 *
 *  - Passes whose output is derivable from the frames alone — the class
 *    evidence and the instance placements — are computed from the shared index
 *    rather than from a walk of their own.
 *  - A decoder that can only emit records under one object marker is asked
 *    whether that marker heads any frame on this page before it is run at all.
 *    The gate is exact rather than heuristic: this walk does not skip over a
 *    decoded frame, so its frame set is a superset of every walk that does, and
 *    a marker absent from the superset is absent from all of them. Measured
 *    page coverage on the same model: MaterialElem 0.6%, BasicWallType 0.7%,
 *    FamilySymbol 9.1%, InsertableInst 20.0%.
 *
 * The walk itself is still `scanFramedElementObjects`, which stays the one
 * definition of the envelope. Nothing here re-implements the framing test.
 */
import { scanFramedElementObjects } from "./element-objects.ts";

import type { ElementObject } from "./element-objects.ts";

export type PageFrameIndex = {
  /** Every independently framed object on the page, in ascending offset order. */
  frames: readonly ElementObject[];
  /**
   * Whether any frame on this page is headed by `marker`.
   *
   * A decoder whose records all carry one marker produces nothing at all on a
   * page where this is false, so the whole decoder can be skipped.
   */
  hasMarker(marker: number): boolean;
};

/** Frame one inflated page once, for every decoder that reads framed objects. */
export function indexPageFrames(data: Uint8Array): PageFrameIndex {
  const frames = scanFramedElementObjects(data);
  const markers = new Set<number>();
  for (const frame of frames) markers.add(frame.marker);
  return { frames, hasMarker: (marker) => markers.has(marker) };
}

export type FramedObjectClassEvidence = {
  /** `element id -> marker` of the first frame each element heads. */
  classes: Map<number, number>;
  /** For the exact classes asked about, every one framing each element. */
  trackedByElement: Map<number, Set<number>>;
  /** Offsets of frames under a seed marker, to grow the object chain from. */
  seedOffsets: number[];
};

/**
 * The class evidence `scanFramedObjectClassEvidence` reads with a walk of its
 * own, read instead off the shared index.
 *
 * Both derive from the same frame set in the same order, so this is the same
 * answer: the marker retained per element is the first frame's, the tracked
 * sets accumulate every framing, and the seeds are in ascending offset order.
 */
export function framedObjectClassEvidence(
  index: PageFrameIndex,
  trackedMarkers: ReadonlySet<number>,
  seedMarkers: ReadonlySet<number>,
): FramedObjectClassEvidence {
  const classes = new Map<number, number>();
  const trackedByElement = new Map<number, Set<number>>();
  const seedOffsets: number[] = [];
  for (const frame of index.frames) {
    if (seedMarkers.has(frame.marker)) seedOffsets.push(frame.offset);
    if (!classes.has(frame.elementId)) classes.set(frame.elementId, frame.marker);
    if (trackedMarkers.has(frame.marker)) {
      const markers = trackedByElement.get(frame.elementId) ?? new Set<number>();
      markers.add(frame.marker);
      trackedByElement.set(frame.elementId, markers);
    }
  }
  return { classes, trackedByElement, seedOffsets };
}

/**
 * A collector handed every inflated page of a partition, in stream order.
 *
 * The release-specific collectors are stateful across pages because the records
 * they reassemble cross page boundaries. They arrived spelling the same
 * protocol three ways — `scanPage`, `pushPage`, and `pushPage` returning the
 * frames it completed — so the page walk drove each one differently. They are
 * adapted to this one shape at the call site instead, which is also where the
 * one collector that deliberately does *not* reset per partition says so.
 */
export type PageConsumer = {
  pushPage(page: Uint8Array): void;
  /** Drop incomplete state so bytes from two partition streams never join. */
  finishPartition(): void;
};
