/** Current original curtain cell/member bindings. A cell is an analytical
 * generator face; this module never calls it an opening or erases a host body.
 * The pure reader and source-issued binding certificate are separate. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readSchema } from "./schema-reader.ts";
import {
  readOriginalCurtainHostTypedFifo,
  type NativeCurtainHostTypedFifo,
} from "./native-source-curtain-host.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027DirectedEdgeUvs,
  walkRevit2027DirectedLoopEdges,
} from "./revit-2027-owner-mesh-trim.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
import { originalDefault3dDirectionSelection } from "./native-source-direction-selection.ts";
import { thresholdSourceOperands } from "./native-filled-threshold-body.ts";
import {
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original curtain object");
  return v as Obj;
};
const array = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw Error("Missing original curtain collection");
  return v;
};
const integer = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    throw Error("Invalid original curtain integer");
  return v;
};
const id = (v: unknown) => integer(obj(obj(v).m_id).m_id64);
const tag = (v: unknown) => {
  const n = integer(v);
  if (n <= 0) throw Error("Nonpositive original curtain tag");
  return n;
};
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const hash = (b: Uint8Array) => bytesToHex(sha256(b));
const pair = (q: Rational) =>
  [q.n.toString(), q.d.toString()] as [string, string];
export function checkedOriginalCurtainFrame(
  bytes: Uint8Array,
  owner: number,
  marker: number,
) {
  if (bytes.length < 40 || bytes.length > 16 * 1024 * 1024)
    throw Error("Original curtain frame exceeds bounds");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    n = v.getUint32(12, true);
  if (
    v.getBigInt64(0, true) !== BigInt(owner) ||
    v.getUint16(16, true) !== marker ||
    n + 20 !== bytes.length ||
    v.getUint32(n + 16, true) !== n
  )
    throw Error("Original curtain frame owner/length/echo mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < n + 16; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original curtain frame checksum mismatch");
  return {
    offset: 0,
    elementId: owner,
    marker,
    objectLength: n,
    typeCode: v.getUint32(18, true),
  };
}
export type OriginalCurtainCellBinding = {
  u: number;
  v: number;
  nativePanelElementId: number;
  sourceFaceTag: number;
  originalFaceToken: number;
  originalLoopToken: number;
  originalEdgeTokens: number[];
  originalEdgeTags: number[];
  originalGridlineIds: number[];
  originalRingFeet: [string, string][][];
  edgeMembers: { sourceEdgeTag: number; nativeMullionElementId: number }[];
};
export type CurtainCellBindingInspection = {
  ok: boolean;
  nativeHostElementId: number;
  cells: OriginalCurtainCellBinding[];
  currentPanelElementIds: number[];
  currentMullionElementIds: number[];
  retainedGeometryTokens: number[];
  retainedFaceTokens: number[];
  sourceFalseFilterCount: number;
  sourceLedger: unknown;
  blockers: string[];
  sourceAuthorityGranted: false;
  hostMaterialOmitted: false;
  materialAbsenceApproved: false;
  walkingSupportApproved: false;
  routeApproved: false;
};

/** Every current cell is matched to its original saved Face and finite loop,
 * including the exact source tag set on all coedges. Unknown view/parameter
 * conditions remain retained. Holes are refused, never silently filled. Every
 * other saved body/control branch stays in the ledger and remains material. */
export function inspectOriginalCurtainCellBindings(
  host: NativeCurtainHostTypedFifo,
  graphics: Revit2027GRepReplay,
): CurtainCellBindingInspection {
  const out: CurtainCellBindingInspection = {
    ok: false,
    nativeHostElementId: host.nativeElementId,
    cells: [],
    currentPanelElementIds: [],
    currentMullionElementIds: [],
    retainedGeometryTokens: [],
    retainedFaceTokens: [],
    sourceFalseFilterCount: 0,
    sourceLedger: thresholdSourceOperands({ host, graphics }),
    blockers: [],
    sourceAuthorityGranted: false,
    hostMaterialOmitted: false,
    materialAbsenceApproved: false,
    walkingSupportApproved: false,
    routeApproved: false,
  };
  try {
    if (
      !host.completeOriginalTypedRootAndFifoByteReplay ||
      host.rootClassName !== "SWall" ||
      graphics.ownerElementId !== BigInt(host.nativeElementId) ||
      id(host.root.m_id) !== host.nativeElementId
    )
      throw Error("Original host root/graphics identity differs");
    const spans = graphics.spans;
    if (
      !spans.length ||
      spans.length > 100000 ||
      spans.some(
        (s, i) =>
          s.replayIndex !== i ||
          s.ownerElementId !== graphics.ownerElementId ||
          (s.parentReplayIndex !== null &&
            (!Number.isSafeInteger(s.parentReplayIndex) ||
              s.parentReplayIndex < 0 ||
              s.parentReplayIndex >= i)),
      )
    )
      throw Error("Invalid original curtain graphics parent/owner graph");
    const positive = spans.filter((s) => s.propertyToken > 0);
    if (new Set(positive.map((s) => s.propertyToken)).size !== positive.length)
      throw Error("Repeated original curtain body token");
    for (const s of positive) {
      const ds = graphics.descriptors.filter(
        (d) => d.token === s.propertyToken,
      );
      if (
        ds.length !== 1 ||
        ds[0]!.state !== "queued" ||
        ds[0]!.parentReplayIndex !== s.parentReplayIndex ||
        ds[0]!.sourceClassSlot !== s.propertySourceClassSlot ||
        ds[0]!.descriptorOffset !== s.descriptorOffset ||
        ds[0]!.descriptorEndOffset !== s.descriptorEndOffset
      )
        throw Error("Reused or unbound original curtain body descendant");
    }
    const selection = originalDefault3dDirectionSelection(graphics);
    if (selection.unresolvedAliasedFilters)
      throw Error("Aliased original curtain view selection");
    out.sourceFalseFilterCount = selection.sourceFalseFilters.length;
    // This census never drops even source-false branches: it establishes only
    // current semantic bindings, not absence of any stored physical operand.
    out.retainedGeometryTokens = spans
      .filter((s) => s.readerId === "Revit2027Geometry")
      .map((s) => s.propertyToken);
    out.retainedFaceTokens = spans
      .filter((s) => s.readerId === "Revit2027Face")
      .map((s) => s.propertyToken);
    const one = (name: string) => {
      const es = host.entries.filter((e) => e.sourceClassName === name);
      if (es.length !== 1) throw Error(`Ambiguous original curtain ${name}`);
      return es[0]!;
    };
    const grid = one("CurtainGrid"),
      divide = one("CGridDivideFaceGStep"),
      driver = one("WallCGDriver"),
      members = one("CGDriverMullionData");
    const owns = (descriptor: unknown, entry: typeof grid) => {
      const d = obj(descriptor);
      return (
        d.start === entry.descriptor.start &&
        d.end === entry.descriptor.end &&
        d.sourceClassSlot === entry.descriptor.sourceClassSlot
      );
    };
    if (
      !owns(driver.value.m_pCurtainGrid, grid) ||
      !owns(driver.value.m_mullionData, members) ||
      obj(driver.value.m_pWall).staticReference !== 2 ||
      obj(divide.value.m_pElem).staticReference !== 2 ||
      divide.value.m_driverId !== -1 ||
      obj(divide.value.m_oExtraDatas).token !== 0
    )
      throw Error("Unresolved original current curtain driver ownership");
    const panels = array(grid.value.m_panelIds).map(id),
      cells = array(divide.value.m_cellMap);
    if (
      !panels.length ||
      panels.some((n) => n <= 0) ||
      new Set(panels).size !== panels.length ||
      cells.length !== panels.length
    )
      throw Error("Incomplete original current panel/cell census");
    out.currentPanelElementIds = [...panels];
    const mapping = (v: unknown) =>
      array(v).map((row) => {
        const m = obj(row);
        return {
          sourceEdgeTag: tag(m.m_edgeTag),
          nativeMullionElementId: id(m.m_mullionId),
        };
      });
    const byId = mapping(members.value.m_mullionsById),
      byEdge = mapping(members.value.m_mullionsByEdge);
    const key = (m: (typeof byId)[number]) =>
      `${m.sourceEdgeTag}:${m.nativeMullionElementId}`;
    if (
      byId.some((m) => m.nativeMullionElementId <= 0) ||
      new Set(byId.map((m) => m.nativeMullionElementId)).size !== byId.length ||
      new Set(byId.map((m) => m.sourceEdgeTag)).size !== byId.length ||
      JSON.stringify(byId.map(key).sort()) !==
        JSON.stringify(byEdge.map(key).sort())
    )
      throw Error("Incomplete or contradictory original mullion membership");
    out.currentMullionElementIds = byId.map((m) => m.nativeMullionElementId);
    const index = revit2027OwnerMeshIndex(graphics),
      usedPanels = new Set<number>(),
      usedFaces = new Set<number>(),
      usedUv = new Set<string>();
    for (const row of cells) {
      const cell = obj(row),
        uv = obj(cell.first),
        v = obj(cell.second),
        panel = id(v.m_panelId),
        sourceTag = tag(v.m_faceTag),
        u = integer(uv.m_u),
        w = integer(uv.m_v);
      if (
        u < 0 ||
        w < 0 ||
        usedUv.has(`${u}:${w}`) ||
        usedPanels.has(panel) ||
        !panels.includes(panel)
      )
        throw Error("Repeated, foreign or unsupported original current cell");
      usedUv.add(`${u}:${w}`);
      usedPanels.add(panel);
      const faces = [...index.faces].filter(
        ([, f]) => f.gInfo.tag === sourceTag,
      );
      if (faces.length !== 1 || usedFaces.has(faces[0]![0]))
        throw Error("Current curtain cell lacks one original tagged Face");
      const [token, face] = faces[0]!;
      usedFaces.add(token);
      const span = spans.find(
        (s) => s.readerId === "Revit2027Face" && s.propertyToken === token,
      )!;
      if (
        selection.excludedReplayIndices.has(span.replayIndex) ||
        ![4, 6].includes(face.faceFlags) ||
        face.cutType !== 0 ||
        face.faceRegions.count ||
        face.foregroundFilling.token ||
        face.backgroundFilling.token ||
        face.firstLoop.token <= 0 ||
        face.surface.sourceClassSlot !== 634
      )
        throw Error("Unsupported original current cell Face semantics");
      const loop = index.loops.get(face.firstLoop.token),
        plane = revit2027OwnerSurface<Revit2027PlaneSurface>(index, 634, token);
      if (
        !loop ||
        loop.loop.nextLoop.token !== 0 ||
        loop.loop.open ||
        !plane ||
        plane.kind !== "plane" ||
        [...plane.origin, ...plane.xVector, ...plane.yVector].some(
          (n) => !Number.isFinite(n),
        )
      )
        throw Error(
          "Current cell has a hole, missing loop or unsupported source plane",
        );
      const walked = walkRevit2027DirectedLoopEdges({
        faceToken: token,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (!walked.ok || walked.edges.length !== 4)
        throw Error(
          "Current cell lacks its complete original four-edge boundary",
        );
      const sourceEdgeTags = array(v.m_edgeTags).map(tag),
        actualTags = walked.edges.map((e) => e.edge.gInfo.tag);
      if (
        sourceEdgeTags.length !== 4 ||
        new Set(sourceEdgeTags).size !== 4 ||
        JSON.stringify([...sourceEdgeTags].sort((a, b) => a - b)) !==
          JSON.stringify([...actualTags].sort((a, b) => a - b))
      )
        throw Error(
          "Original current cell edge tags differ from native generator",
        );
      const ring = walked.edges.map((e) => {
        const points = revit2027DirectedEdgeUvs(e);
        if (
          points.length !== 2 ||
          points.some(
            (p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)),
          )
        )
          throw Error("Unsupported curved/nonfinite original cell edge");
        const p = points[0]!;
        return [0, 1, 2].map((i) =>
          pair(
            add(
              add(
                rational(plane.origin[i]!),
                mul(rational(plane.xVector[i]!), rational(p[0]!)),
              ),
              mul(rational(plane.yVector[i]!), rational(p[1]!)),
            ),
          ),
        );
      });
      out.cells.push({
        u,
        v: w,
        nativePanelElementId: panel,
        sourceFaceTag: sourceTag,
        originalFaceToken: token,
        originalLoopToken: loop.token,
        originalEdgeTokens: walked.edges.map((e) => e.token),
        originalEdgeTags: actualTags,
        originalGridlineIds: [
          v.m_uGridline,
          v.m_uGridline2,
          v.m_vGridline,
          v.m_vGridline2,
        ].map(id),
        originalRingFeet: ring,
        edgeMembers: byId.filter((m) =>
          sourceEdgeTags.includes(m.sourceEdgeTag),
        ),
      });
    }
    const knownTags = new Set(out.cells.flatMap((c) => c.originalEdgeTags));
    if (byId.some((m) => !knownTags.has(m.sourceEdgeTag)))
      throw Error(
        "Original mullion lies outside complete current cell edge census",
      );
    out.ok = true;
  } catch (e) {
    out.blockers.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}

export function inspectOriginalCurtainCellFrames(
  schemaBytes: Uint8Array,
  nativeHost: Uint8Array,
  hostGraphics: Uint8Array,
) {
  const owner = Number(
    new DataView(
      nativeHost.buffer,
      nativeHost.byteOffset,
      nativeHost.length,
    ).getBigInt64(0, true),
  );
  checkedOriginalCurtainFrame(nativeHost, owner, 3899);
  const frame = checkedOriginalCurtainFrame(hostGraphics, owner, 2246),
    schema = readSchema(schemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const host = readOriginalCurtainHostTypedFifo(nativeHost, schema.schema),
    root = decodeRevit2027FramedGRepRoot(hostGraphics, frame, 2027);
  if (!host.ok) throw Error(host.error);
  if (!root.ok) throw Error(root.error);
  const r = replayRevit2027GRepFifo(hostGraphics, root.value);
  if (!r.ok) throw Error(r.error);
  if (r.value.endOffset !== root.value.dynamicPayloadEndOffset)
    throw Error("Unconsumed original curtain graphics bytes");
  return inspectOriginalCurtainCellBindings(host.value, r.value);
}

const brand: unique symbol = Symbol("OriginalCurtainCellBindingCertificate");
export type OriginalCurtainCellBindingCertificate = {
  readonly [brand]: true;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly nativeHostElementId: number;
  readonly use: "current-curtain-cell-member-bindings-only";
  readonly materialAbsenceApproved: false;
  readonly routeApproved: false;
};
const certificates = new WeakMap<
  OriginalCurtainCellBindingCertificate,
  {
    inspection: CurtainCellBindingInspection;
    nativeFrameSha256: string;
    graphicsFrameSha256: string;
  }
>();
/** Fresh original-RVT membership is checked by the existing private full-page
 * census. Replayed JSON/ASTs cannot mint this identity-only capability. */
export function certifyOriginalCurtainCellBindings(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeHostElementId: number,
): OriginalCurtainCellBindingCertificate {
  const source = readOriginalForeignEnvelopeScopedSemantic(
      census,
      nativeHostElementId,
      3899,
    ),
    graphics = readOriginalForeignEnvelopeScopedFrame(
      census,
      nativeHostElementId,
    );
  if (
    source.originalCategoryDeclarations.length !== 1 ||
    source.originalCategoryDeclarations[0] !== -2000011
  )
    throw Error("Original current curtain host category is absent/ambiguous");
  const inspection = inspectOriginalCurtainCellFrames(
    source.originalSourceSchemaBytes,
    source.originalFrameBytes,
    graphics,
  );
  if (!inspection.ok) throw Error(inspection.blockers.join("; "));
  const certificate = Object.freeze({
    [brand]: true as const,
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    nativeHostElementId,
    use: "current-curtain-cell-member-bindings-only" as const,
    materialAbsenceApproved: false as const,
    routeApproved: false as const,
  });
  certificates.set(certificate, {
    inspection,
    nativeFrameSha256: source.originalFrameSha256,
    graphicsFrameSha256: hash(graphics),
  });
  return certificate;
}
export function originalCurtainCellMemberBinding(
  certificate: OriginalCurtainCellBindingCertificate,
  nativePanelElementId: number,
  nativeMullionElementId: number,
) {
  const stored = certificates.get(certificate);
  if (!stored)
    throw Error("Untrusted original curtain cell binding certificate");
  const cells = stored.inspection.cells.filter(
    (c) =>
      c.nativePanelElementId === nativePanelElementId &&
      c.edgeMembers.some(
        (m) => m.nativeMullionElementId === nativeMullionElementId,
      ),
  );
  if (cells.length !== 1)
    throw Error(
      "Original panel/mullion do not bind one current curtain cell edge",
    );
  return {
    sourceModelSha256: certificate.sourceModelSha256,
    sourceSchemaSha256: certificate.sourceSchemaSha256,
    nativeHostElementId: certificate.nativeHostElementId,
    nativePanelElementId,
    nativeMullionElementId,
    cell: structuredClone(cells[0]!),
    nativeFrameSha256: stored.nativeFrameSha256,
    graphicsFrameSha256: stored.graphicsFrameSha256,
    originalSourceMembershipRevalidated: true as const,
    materialAbsenceApproved: false as const,
    routeApproved: false as const,
  };
}
