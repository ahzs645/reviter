/** Original curtain-container decomposition. The native wall type and complete
 * current cell/member graph select the assembly; no display filter, category
 * alone or bounding-box shape can erase a host. Every physical member remains
 * in the original census, including a closed door and an underfoot sill. */
import { readSchema } from "./schema-reader.ts";
import { readOriginalCurtainHostTypedFifo } from "./native-source-curtain-host.ts";
import { readOriginalCurtainInstanceTypedFifo } from "./native-source-curtain-instance.ts";
import { readOriginalMullionSymbolTypedFifo } from "./native-source-mullion-symbol.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import {
  checkedOriginalCurtainFrame,
  inspectOriginalCurtainCellFrames,
} from "./native-source-curtain-cell-bindings.ts";
import {
  originalNativeForeignEnvelopeFacts,
  readOriginalForeignEnvelopeScopedFrame,
  readOriginalForeignEnvelopeScopedSemantic,
  readOriginalForeignEnvelopeWallType,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { thresholdSourceOperands } from "./native-filled-threshold-body.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original curtain-container object");
  return v as Obj;
};
const sourceId = (v: unknown) => {
  const n = obj(obj(v).m_id).m_id64;
  if (typeof n !== "number" || !Number.isSafeInteger(n))
    throw Error("Invalid original curtain-container identifier");
  return n;
};
const nil = (v: unknown) =>
  obj(v).token === 0 && obj(v).sourceClassSlot === null;
const empty = (v: unknown) => Array.isArray(v) && v.length === 0;
const typeNames = new Map<
  number,
  "CurtainWallType" | "NRCurtainWallType" | "NewCurtainWallType"
>([
  [1060, "CurtainWallType"],
  [2845, "NRCurtainWallType"],
  [2848, "NewCurtainWallType"],
]);
/** Pure transport inspection. It cannot construct a source-issued capability. */
export function inspectOriginalCurtainHostTypeFrames(
  schemaBytes: Uint8Array,
  hostBytes: Uint8Array,
  graphicsBytes: Uint8Array,
  typeBytes: Uint8Array,
) {
  const view = new DataView(
      hostBytes.buffer,
      hostBytes.byteOffset,
      hostBytes.byteLength,
    ),
    hostId = Number(view.getBigInt64(0, true)),
    typeView = new DataView(
      typeBytes.buffer,
      typeBytes.byteOffset,
      typeBytes.byteLength,
    ),
    typeId = Number(typeView.getBigInt64(0, true)),
    marker = typeView.getUint16(16, true),
    typeName = typeNames.get(marker);
  if (!typeName)
    throw Error("Original host type is not an admitted curtain wall type");
  checkedOriginalCurtainFrame(hostBytes, hostId, 3899);
  checkedOriginalCurtainFrame(typeBytes, typeId, marker);
  const schema = readSchema(schemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const host = readOriginalCurtainHostTypedFifo(hostBytes, schema.schema);
  if (!host.ok) throw Error(host.error);
  const type = inspectOriginalElementLevelPrefix(
      typeBytes,
      schema.schema,
      typeName,
    ),
    bindings = inspectOriginalCurtainCellFrames(
      schemaBytes,
      hostBytes,
      graphicsBytes,
    );
  if (!bindings.ok) throw Error(bindings.blockers.join("; "));
  if (sourceId(host.value.root.m_WallAttributesId) !== type.nativeElementId)
    throw Error("Original wall names a different native type");
  const one = (name: string) => {
    const es = host.value.entries.filter((e) => e.sourceClassName === name);
    if (es.length !== 1)
      throw Error(`Original curtain container requires one ${name}`);
    return es[0]!.value;
  };
  const root = host.value.root,
    misc = one("HostObjMiscData"),
    driver = one("WallCGDriver"),
    table = one("GeomTable"),
    pattern = one("VWallPatternHelper");
  // These source roles can introduce a second physical owner or generator;
  // they are refused until a separate complete decomposition exists.
  if (
    ![
      root.m_oGeomToElemMap,
      root.m_wallRunTimeData,
      root.m_oUserData,
      root.m_oDefiningFaceRefs,
      misc.m_oCurtainGridDriver,
      misc.m_oSurfaceOffsetOptions,
      misc.m_infillInfo,
      misc.m_hostPanelInfo,
      driver.m_nbrCornerMullionData,
      driver.m_oOrigGridSurf,
      driver.m_oCGDriverCSys,
      table.m_bigTableOwner,
    ].every(nil) ||
    ![
      root.m_embeddedTo,
      misc.m_aFaces,
      driver.m_mullionJoins,
      table.m_materialMarkers,
      table.m_faceTypeMarkers,
      pattern.m_PatternPositionMap,
      pattern.m_substituteFaceMap,
    ].every(empty) ||
    !Array.isArray(misc.m_oCGDrivers) ||
    misc.m_oCGDrivers.length !== 1 ||
    driver.m_mullionJoinId !== 0 ||
    root.m_subWallGridIdInType !== -1
  )
    throw Error(
      "Original curtain container has an additional unresolved generator or member role",
    );
  const memberIds = [
    ...bindings.currentPanelElementIds,
    ...bindings.currentMullionElementIds,
  ];
  if (new Set(memberIds).size !== memberIds.length)
    throw Error("Original curtain member identities overlap");
  return {
    nativeHostElementId: hostId,
    nativeWallTypeElementId: typeId,
    originalWallTypeClass: typeName,
    currentBindings: bindings,
    sourceWallTypePrefix: type,
    retainedOriginalWallTypeBytes: Uint8Array.from(typeBytes),
    originalHostOperandLedger: thresholdSourceOperands(host.value),
    currentMemberElementIds: memberIds,
    sourceAuthorityGranted: false as const,
    physicalMemberMaterialOmitted: false as const,
    apertureApproved: false as const,
    routeApproved: false as const,
  };
}
const brand: unique symbol = Symbol("OriginalCurtainMaterialContainer");
export type OriginalCurtainMaterialContainer = {
  readonly [brand]: true;
  readonly nativeHostElementId: number;
  readonly sourceModelSha256: string;
  readonly sourceSchemaSha256: string;
  readonly routeApproved: false;
};
const certificates = new WeakMap<
  OriginalCurtainMaterialContainer,
  {
    census: OriginalNativeForeignEnvelopeCensus;
    fact: ReturnType<typeof inspectOriginalCurtainHostTypeFrames>;
    originalMemberFrameChecks: {
      nativeElementId: number;
      originalFrameSha256: string;
      originalSymbolId: number;
    }[];
  }
>();
/** Every member is read from this exact RVT census. Complete reciprocal native
 * references and all retained bounded physical member rows are mandatory.
 * The certificate delegates the host container ONLY to that unchanged set. */
export function certifyOriginalCurtainMaterialContainer(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeHostElementId: number,
): OriginalCurtainMaterialContainer {
  const host = readOriginalForeignEnvelopeScopedSemantic(
      census,
      nativeHostElementId,
      3899,
    ),
    schema = readSchema(host.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  if (
    host.originalCategoryDeclarations.length !== 1 ||
    host.originalCategoryDeclarations[0] !== -2000011
  )
    throw Error("Original curtain container category absent or ambiguous");
  const typed = readOriginalCurtainHostTypedFifo(
    host.originalFrameBytes,
    schema.schema,
  );
  if (!typed.ok) throw Error(typed.error);
  const typeId = sourceId(typed.value.root.m_WallAttributesId),
    wallType = readOriginalForeignEnvelopeWallType(census, typeId),
    fact = inspectOriginalCurtainHostTypeFrames(
      host.originalSourceSchemaBytes,
      host.originalFrameBytes,
      readOriginalForeignEnvelopeScopedFrame(census, nativeHostElementId),
      wallType.originalFrameBytes,
    ),
    facts = originalNativeForeignEnvelopeFacts(census),
    checks = [];
  for (const memberId of fact.currentMemberElementIds) {
    const source = readOriginalForeignEnvelopeScopedSemantic(
        census,
        memberId,
        2031,
      ),
      isPanel = fact.currentBindings.currentPanelElementIds.includes(memberId),
      parsed = isPanel
        ? readOriginalCurtainInstanceTypedFifo(
            source.originalFrameBytes,
            schema.schema,
          )
        : readOriginalMullionSymbolTypedFifo(
            source.originalFrameBytes,
            schema.schema,
            "FamilyInstance",
          );
    if (!parsed.ok) throw Error(parsed.error);
    checkedOriginalCurtainFrame(source.originalFrameBytes, memberId, 2031);
    const native = parsed.value,
      referenceName = isPanel ? "CurtainCellFamRef" : "MullionFamRef",
      refs = native.entries.filter((e) => e.sourceClassName === referenceName),
      infos = native.entries.filter(
        (e) => e.sourceClassName === "InstanceInfo",
      ),
      categories = source.originalCategoryDeclarations;
    if (
      native.nativeElementId !== memberId ||
      sourceId(native.root.m_hostId) !== nativeHostElementId ||
      refs.length !== 1 ||
      sourceId(refs[0]!.value.m_hostId) !== nativeHostElementId ||
      refs[0]!.value.m_driverId !== -1 ||
      infos.length !== 1 ||
      infos[0]!.value.m_GRepId !== 0 ||
      categories.length !== 1 ||
      !(isPanel
        ? [-2000170, -2000023].includes(categories[0]!)
        : categories[0] === -2000171)
    )
      throw Error(
        "Original curtain member native identity, category or host conflicts",
      );
    const cell = fact.currentBindings.cells.filter((c) =>
      isPanel
        ? c.nativePanelElementId === memberId
        : c.edgeMembers.some((m) => m.nativeMullionElementId === memberId),
    );
    if (
      !cell.length ||
      (isPanel &&
        (cell.length !== 1 ||
          ["m_gridId0", "m_gridId1"].some(
            (k) =>
              !cell[0]!.originalGridlineIds.includes(
                sourceId(refs[0]!.value[k]),
              ),
          ))) ||
      (!isPanel &&
        cell.some(
          (c) =>
            !c.edgeMembers.some(
              (m) =>
                m.nativeMullionElementId === memberId &&
                m.sourceEdgeTag === refs[0]!.value.m_edgeTag,
            ),
        ))
    )
      throw Error(
        "Original curtain member differs from current cell/grid/edge",
      );
    const rows = facts.rows.filter((r) => r.nativeElementId === memberId);
    if (!rows.length || rows.some((r) => !r.boundsFeet || r.blocker))
      throw Error(
        "Original curtain physical member has no complete bounded census envelope",
      );
    checks.push({
      nativeElementId: memberId,
      originalFrameSha256: source.originalFrameSha256,
      originalSymbolId: sourceId(infos[0]!.value.m_symbolId),
    });
  }
  const certificate = Object.freeze({
    [brand]: true as const,
    nativeHostElementId,
    sourceModelSha256: census.sourceModelSha256,
    sourceSchemaSha256: census.sourceSchemaSha256,
    routeApproved: false as const,
  });
  certificates.set(certificate, {
    census,
    fact,
    originalMemberFrameChecks: checks,
  });
  return certificate;
}
export function originalCurtainMaterialContainerFact(
  census: OriginalNativeForeignEnvelopeCensus,
  certificate: OriginalCurtainMaterialContainer,
) {
  const stored = certificates.get(certificate);
  if (!stored || stored.census !== census)
    throw Error("Untrusted or different original curtain-container census");
  return structuredClone({
    ...stored.fact,
    originalMemberFrameChecks: stored.originalMemberFrameChecks,
    originalMemberRowsRetained: true as const,
    hostAssemblyDelegatedToCompleteCurrentMembers: true as const,
    physicalMemberMaterialOmitted: false as const,
    fullHumanClearanceApproved: false as const,
    routeApproved: false as const,
  });
}
