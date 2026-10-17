/** Unwired original-source constructor replay for a narrow system profile.
 *
 * Supported material operation: a SysRectMullionProfile follows its current
 * straight curtain-grid edge. The complete original native range, instance
 * affine and profile dimensions determine a conservative enclosing sweep.
 * Joins, trims, custom profiles, stretch/extra generators and changed native
 * generation versions refuse. Both profile signs are enclosed. This is an
 * obstruction-only outer enclosure; it cannot establish physical absence,
 * walking support, accessibility or a route.
 *
 * Public operation references: Mullion.LocationCurve and
 * CurtainGridLine.AddMullions(Curve,MullionType,Boolean), Revit API 2015–2027.
 * The native recipe is independently checked against complete original
 * nonempty system-profile source operands; it does not use a display mesh.
 */
import { createHash } from "node:crypto";
import type { Bounds3 } from "./types.ts";
import { readSchema } from "./schema-reader.ts";
import { readOriginalMullionSymbolTypedFifo } from "./native-source-mullion-symbol.ts";
import { diagnoseOriginalHostedMullionEnclosure } from "./native-source-mullion-host-enclosure.ts";
import {
  readOriginalForeignEnvelopeScopedSemantic,
  readOriginalForeignEnvelopeScopedFrame,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import {
  activeClassTagTranslation,
  setActiveClassTagTranslation,
} from "./revit-class-tags.ts";
import {
  activeElementIdBytes,
  setActiveElementIdBytes,
} from "./element-id-width.ts";

const recipe = "revit2027-sysrect-mullion-straight-host-edge-v1" as const;
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original constructor object");
  return v as Record<string, unknown>;
}
function elementId(v: unknown) {
  const id = object(object(v).m_id).m_id64;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    throw Error("Invalid original constructor source identity");
  return id;
}
function category(declarations: readonly (number | null)[], expected: number) {
  if (declarations.length !== 1 || declarations[0] !== expected)
    throw Error(
      "Missing, null, foreign or conflicting original category declaration",
    );
}
function instance(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeElementId: number,
) {
  const source = readOriginalForeignEnvelopeScopedSemantic(
    census,
    nativeElementId,
    2031,
  );
  category(source.originalCategoryDeclarations, -2000171);
  const parsed = readSchema(source.originalSourceSchemaBytes);
  if (!parsed.ok) throw Error(parsed.error);
  const native = readOriginalMullionSymbolTypedFifo(
    source.originalFrameBytes,
    parsed.schema,
    "FamilyInstance",
  );
  if (!native.ok) throw Error(native.error);
  const info = native.value.entries.filter(
      (e) => e.sourceClassName === "InstanceInfo",
    ),
    ref = native.value.entries.filter(
      (e) => e.sourceClassName === "MullionFamRef",
    );
  if (info.length !== 1 || ref.length !== 1)
    throw Error("Original instance is not one unambiguous system mullion");
  return {
    source,
    schema: parsed.schema,
    nativeSymbolId: elementId(info[0]!.value.m_symbolId),
    nativeHostId: elementId(ref[0]!.value.m_hostId),
  };
}

/** Source-owned dependencies for a subsequent census's optional frame capture.
 * The source IDs are decoded from the actual native occurrence, never located
 * from a fresh display record or inferred by proximity. */
export function originalRectangularMullionEnvelopeDependencies(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeElementId: number,
) {
  try {
    const r = instance(census, nativeElementId);
    return {
      ok: true as const,
      nativeElementId,
      nativeSymbolId: r.nativeSymbolId,
      nativeHostId: r.nativeHostId,
      requestedOriginalFrameIds: [
        nativeElementId,
        r.nativeSymbolId,
        r.nativeHostId,
      ],
      sourceModelSha256: r.source.sourceModelSha256,
      sourceSchemaSha256: r.source.sourceSchemaSha256,
      originalInstanceFrameSha256: r.source.originalFrameSha256,
      originalSourceAuthorityGranted: false as const,
    };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      originalSourceAuthorityGranted: false as const,
    };
  }
}

const brand: unique symbol = Symbol("OriginalRectangularMullionSourceEnvelope");
export type OriginalRectangularMullionSourceEnvelope = {
  readonly [brand]: true;
  readonly nativeElementId: number;
  readonly sourceModelSha256: string;
  readonly sourceRecipeSha256: string;
};
type Fact = {
  use: "foreign-material-envelope-only";
  constructor: typeof recipe;
  nativeElementId: number;
  nativeSymbolId: number;
  nativeHostId: number;
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  sourceCensusSha256: string;
  sourceRecipeSha256: string;
  originalFrameHashes: {
    role: string;
    nativeElementId: number;
    marker: number;
    sha256: string;
  }[];
  boundsFeet: Bounds3;
  originalGeneratedEdgeRange: unknown;
  profileDimensionsFeet: unknown;
  originalProfileFlip: number;
  completeOriginalNativeAndGraphicsRecipe: true;
  sourceConstructionEnvelopeApproved: true;
  physicalAbsenceApproved: false;
  walkingSupportApproved: false;
  accessibilityApproved: false;
  routeApproved: false;
};
const certificates = new WeakMap<
  OriginalRectangularMullionSourceEnvelope,
  { census: OriginalNativeForeignEnvelopeCensus; fact: Fact }
>();

/** Replays only the explicitly supported original parametric constructor.
 * Empty saved geometry never supplies absence authority: a nonempty outer
 * material enclosure is issued from the native construction operands instead.
 * This remains unwired until the parent source-census consumer is reviewed. */
export function certifyOriginalRectangularMullionSourceEnvelope(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeElementId: number,
) {
  const previousTranslation = activeClassTagTranslation(),
    previousWidth = activeElementIdBytes();
  try {
    const r = instance(census, nativeElementId),
      symbol = readOriginalForeignEnvelopeScopedSemantic(
        census,
        r.nativeSymbolId,
        4316,
      ),
      host = readOriginalForeignEnvelopeScopedSemantic(
        census,
        r.nativeHostId,
        3899,
      );
    category(symbol.originalCategoryDeclarations, -2000171);
    category(host.originalCategoryDeclarations, -2000011);
    for (const original of [symbol, host])
      if (
        original.sourceModelSha256 !== r.source.sourceModelSha256 ||
        original.sourceSchemaSha256 !== r.source.sourceSchemaSha256 ||
        hash(original.originalSourceSchemaBytes) !== r.source.sourceSchemaSha256
      )
        throw Error(
          "Original constructor operands do not share one source model/schema",
        );
    const occurrenceGraphics = readOriginalForeignEnvelopeScopedFrame(
        census,
        nativeElementId,
      ),
      definitionGraphics = readOriginalForeignEnvelopeScopedFrame(
        census,
        r.nativeSymbolId,
      ),
      hostGraphics = readOriginalForeignEnvelopeScopedFrame(
        census,
        r.nativeHostId,
      );
    // The real census constructor has already required identity 2027 class
    // translation and eight-byte source IDs. Preserve surrounding conversions.
    setActiveClassTagTranslation(null);
    setActiveElementIdBytes(8);
    const replay = diagnoseOriginalHostedMullionEnclosure({
      schema: r.schema,
      nativeInstance: r.source.originalFrameBytes,
      nativeSymbol: symbol.originalFrameBytes,
      occurrenceGraphics,
      definitionGraphics,
      nativeHost: host.originalFrameBytes,
      hostGraphics,
    });
    if (replay.status !== "candidate") throw Error(replay.blockers.join("; "));
    if (
      replay.independentBodyControl ||
      !replay.completeOriginalHostFifo ||
      !replay.currentOriginalHostMembership ||
      !replay.bothProfileSignsEnclosed
    )
      throw Error(
        "An empirical control or incomplete native recipe cannot mint an original material certificate",
      );
    const frames = [
      {
        role: "occurrence-native",
        nativeElementId,
        marker: 2031,
        sha256: r.source.originalFrameSha256,
      },
      {
        role: "symbol-native",
        nativeElementId: r.nativeSymbolId,
        marker: 4316,
        sha256: symbol.originalFrameSha256,
      },
      {
        role: "host-native",
        nativeElementId: r.nativeHostId,
        marker: 3899,
        sha256: host.originalFrameSha256,
      },
      {
        role: "occurrence-graphics",
        nativeElementId,
        marker: 2246,
        sha256: hash(occurrenceGraphics),
      },
      {
        role: "symbol-graphics",
        nativeElementId: r.nativeSymbolId,
        marker: 2246,
        sha256: hash(definitionGraphics),
      },
      {
        role: "host-graphics",
        nativeElementId: r.nativeHostId,
        marker: 2246,
        sha256: hash(hostGraphics),
      },
    ];
    const sourceRecipeSha256 = hash(
      new TextEncoder().encode(
        JSON.stringify({
          constructor: recipe,
          sourceModelSha256: r.source.sourceModelSha256,
          sourceSchemaSha256: r.source.sourceSchemaSha256,
          frames,
          boundsFeet: replay.candidateBoundsFeet,
          range: replay.originalGeneratedEdgeRange,
          profile: replay.profileDimensionsFeet,
          flip: replay.originalProfileFlip,
        }),
      ),
    );
    const fact: Fact = {
      use: "foreign-material-envelope-only",
      constructor: recipe,
      nativeElementId,
      nativeSymbolId: r.nativeSymbolId,
      nativeHostId: r.nativeHostId,
      sourceModelSha256: r.source.sourceModelSha256,
      sourceSchemaSha256: r.source.sourceSchemaSha256,
      sourceCensusSha256: census.sourceCensusSha256,
      sourceRecipeSha256,
      originalFrameHashes: frames,
      boundsFeet: structuredClone(replay.candidateBoundsFeet),
      originalGeneratedEdgeRange: structuredClone(
        replay.originalGeneratedEdgeRange,
      ),
      profileDimensionsFeet: structuredClone(replay.profileDimensionsFeet),
      originalProfileFlip: replay.originalProfileFlip,
      completeOriginalNativeAndGraphicsRecipe: true,
      sourceConstructionEnvelopeApproved: true,
      physicalAbsenceApproved: false,
      walkingSupportApproved: false,
      accessibilityApproved: false,
      routeApproved: false,
    };
    const certificate: OriginalRectangularMullionSourceEnvelope = Object.freeze(
      {
        [brand]: true as const,
        nativeElementId,
        sourceModelSha256: r.source.sourceModelSha256,
        sourceRecipeSha256,
      },
    );
    certificates.set(certificate, { census, fact });
    return { ok: true as const, certificate };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      physicalAbsenceApproved: false as const,
      walkingSupportApproved: false as const,
      routeApproved: false as const,
    };
  } finally {
    setActiveClassTagTranslation(previousTranslation);
    setActiveElementIdBytes(previousWidth);
  }
}

/** Read-only transport receipt. A cloned receipt cannot be replayed as a
 * certificate, and certificates cannot cross original source census handles. */
export function originalRectangularMullionSourceEnvelopeFact(
  census: OriginalNativeForeignEnvelopeCensus,
  certificate: OriginalRectangularMullionSourceEnvelope,
): Fact {
  const original = certificates.get(certificate);
  if (!original || original.census !== census)
    throw Error("Untrusted or foreign original mullion material certificate");
  return structuredClone(original.fact);
}
