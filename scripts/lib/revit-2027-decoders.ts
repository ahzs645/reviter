/**
 * One import for the Revit 2027 static decoders the audits share.
 *
 * The large audits under `scripts/` reach for the same set: a
 * `decodeRevit2027X` and the `REVIT_2027_X_SOURCE_CLASS_SLOT` that says which
 * schema slot `X` occupies in `Formats/Latest`. Because the two halves live in
 * one module per class, an audit covering a dozen classes opened with a dozen
 * import blocks — `audit-revit-2027-planar-topology.ts` spent 72 lines on
 * imports, `audit-revit-2027-cylinder-cone-trims.ts` 68 — and the blocks
 * overlapped heavily between files without ever being identical, so a reader
 * comparing two audits had to diff their preambles before reaching the
 * measurement.
 *
 * This barrel changes nothing about the decoders. It re-exports them from
 * `lib/reviter/` unchanged, so the modules there remain the single definition
 * and browser code keeps importing them directly; scripts get to say what they
 * decode in one line instead of fifteen.
 *
 * ```ts
 * import {
 *   decodeRevit2027FramedGRepRoot,
 *   decodeRevit2027GeometryStatic,
 *   REVIT_2027_GELEMENT_OBJECT_MARKER,
 *   REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
 * } from "./lib/revit-2027-decoders.ts";
 * ```
 *
 * A class not listed here is not excluded on purpose — it simply had one
 * caller when this was written. Add it when it gets a second.
 */

/* The framed GRep root every replay starts from. */
export {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../../lib/reviter/revit-2027-framed-grep-root.ts";
export type {
  Revit2027FramedGRepRoot,
  Revit2027FramedGRepRootResult,
} from "../../lib/reviter/revit-2027-framed-grep-root.ts";

/* Geometry, slot 2343. */
export {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-geometry.ts";
export type {
  Revit2027GeometryDecodeOptions,
  Revit2027GeometryStatic,
  Revit2027GeometryStaticDecodeResult,
  Revit2027TessEpsCntrl,
} from "../../lib/reviter/revit-2027-geometry.ts";

/* Face. */
export {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-face-static.ts";
export type {
  Revit2027FaceDecodeOptions,
  Revit2027FaceStatic,
  Revit2027FaceStaticDecodeResult,
} from "../../lib/reviter/revit-2027-face-static.ts";

/* GArray and the GGroup prefix. */
export {
  decodeRevit2027GArray,
  decodeRevit2027GGroupPrefix,
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-grep-prefixes.ts";
export type {
  Revit2027GArray,
  Revit2027GArrayDecodeResult,
  Revit2027GGroupPrefix,
  Revit2027GGroupPrefixDecodeResult,
  Revit2027GInfo,
} from "../../lib/reviter/revit-2027-grep-prefixes.ts";

/* The GGroup FIFO body. */
export {
  decodeRevit2027GGroupStatic,
  locateRevit2027FirstGGroupNestedFifo,
} from "../../lib/reviter/revit-2027-ggroup-fifo.ts";
export type {
  Revit2027FirstGGroupNestedFifo,
  Revit2027FirstGGroupNestedFifoResult,
  Revit2027GGroupStatic,
  Revit2027GGroupStaticDecodeResult,
  Revit2027InitialSiblingSpan,
} from "../../lib/reviter/revit-2027-ggroup-fifo.ts";

/* Edge loops. */
export {
  decodeRevit2027EdgeLoopStatic,
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-edge-loop-static.ts";
export type {
  Revit2027EdgeChainWithEnvelope,
  Revit2027EdgeLoopStatic,
  Revit2027EdgeLoopStaticDecodeResult,
  Revit2027EdgeLoopWithChainEnvelopesStatic,
  Revit2027EdgeLoopWithChainEnvelopesStaticDecodeResult,
} from "../../lib/reviter/revit-2027-edge-loop-static.ts";

/* GEdge, slot 1423. */
export {
  decodeRevit2027GEdgeStatic,
  revit2027GEdgeLoopDirection,
  revit2027GEdgeLoopNextReference,
  revit2027GEdgeLoopPreviousReference,
  revit2027GEdgeNativeCurveKind,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-edge-1423.ts";
export type {
  Revit2027EdgePoint,
  Revit2027GEdgeNativeCurveKind,
  Revit2027GEdgeStatic,
  Revit2027GEdgeStaticDecodeResult,
} from "../../lib/reviter/revit-2027-edge-1423.ts";

/* The analytic surfaces. */
export {
  decodeRevit2027AnalyticSurface,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-surfaces.ts";
export type {
  Revit2027AnalyticSurface,
  Revit2027ConeSurface,
  Revit2027CylinderSurface,
  Revit2027PlaneSurface,
  Revit2027RuledSurface,
  Revit2027SurfaceBase,
  Revit2027SurfaceDecodeResult,
  Revit2027SurfaceOfRevolution,
  // `revit-2027-gpolyline.ts` declares an identical `RevitPoint3d`; the two
  // are the same tuple, so the barrel carries one of them.
  RevitPoint2d,
  RevitPoint3d,
} from "../../lib/reviter/revit-2027-surfaces.ts";

/* Fill patterns. */
export {
  decodeRevit2027GFilling,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-gfilling.ts";
export type {
  Revit2027FillPatternPlacer,
  Revit2027GFilling,
  Revit2027GFillingDecodeResult,
  Revit2027Point2d,
} from "../../lib/reviter/revit-2027-gfilling.ts";
export {
  decodeRevit2027FillGrid,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-fill-grid.ts";
export type {
  Revit2027FillGrid,
  Revit2027FillGridDecodeResult,
} from "../../lib/reviter/revit-2027-fill-grid.ts";
export {
  decodeRevit2027FillPatternData,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-fill-pattern-data.ts";
export type {
  Revit2027FillPatternData,
  Revit2027FillPatternDataDecodeResult,
} from "../../lib/reviter/revit-2027-fill-pattern-data.ts";

/* The curve classes. */
export {
  decodeRevit2027GArc,
  REVIT_2027_GARC_BODY_BYTES,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-garc.ts";
export type {
  Revit2027GArc,
  Revit2027GArcDecodeResult,
} from "../../lib/reviter/revit-2027-garc.ts";
export {
  decodeRevit2027GLine,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-gline.ts";
export type {
  Revit2027GLine,
  Revit2027GLineDecodeResult,
} from "../../lib/reviter/revit-2027-gline.ts";
export {
  decodeRevit2027GPolyLine,
  REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-gpolyline.ts";
export type {
  Revit2027GPolyLine,
  Revit2027GPolyLineDecodeResult,
} from "../../lib/reviter/revit-2027-gpolyline.ts";

/* Instances. */
export {
  decodeRevit2027GInstanceStatic,
  decodeRevit2027InstanceInfo,
  REVIT_2027_GINSTANCE_BODY_BYTES,
  REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES,
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
  REVIT_2027_INSTANCE_INFO_BODY_BYTES,
  REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
} from "../../lib/reviter/revit-2027-ginstance.ts";
export type {
  Revit2027GInstance,
  Revit2027GInstanceDecodeResult,
  Revit2027InstanceInfo,
  Revit2027InstanceInfoDecodeResult,
} from "../../lib/reviter/revit-2027-ginstance.ts";
