/** Complete current native curtain-door definition. Source dimensions, every
 * reference face and all physical generator/history operands remain intact.
 * A source door category or a closed saved leaf is not itself an opening or
 * an operational/access permission. */
import { readSchema } from "./schema-reader.ts";
import { readOriginalMullionSymbolTypedFifo } from "./native-source-mullion-symbol.ts";
import { readOriginalCurtainInstanceTypedFifo } from "./native-source-curtain-instance.ts";
import { checkedOriginalCurtainFrame } from "./native-source-curtain-cell-bindings.ts";
import {
  originalCurtainMaterialContainerFact,
  type OriginalCurtainMaterialContainer,
} from "./native-source-curtain-material-container.ts";
import {
  readOriginalForeignEnvelopeScopedSemantic,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
import { thresholdSourceOperands } from "./native-filled-threshold-body.ts";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Missing original curtain-door object");
  return v as Obj;
};
const id = (v: unknown) => {
  const n = obj(obj(v).m_id).m_id64;
  if (typeof n !== "number" || !Number.isSafeInteger(n))
    throw Error("Invalid original curtain-door identifier");
  return n;
};
const array = (v: unknown) => {
  if (!Array.isArray(v))
    throw Error("Missing original curtain-door collection");
  return v;
};
const number = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw Error("Nonfinite original curtain-door operand");
  return v;
};
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const pair = (q: Rational) =>
  [q.n.toString(), q.d.toString()] as [string, string];
export function inspectOriginalCurtainDoorDefinition(
  schemaBytes: Uint8Array,
  doorBytes: Uint8Array,
  symbolBytes: Uint8Array,
) {
  const schema = readSchema(schemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const doorOwner = Number(
      new DataView(
        doorBytes.buffer,
        doorBytes.byteOffset,
        doorBytes.byteLength,
      ).getBigInt64(0, true),
    ),
    symbolOwner = Number(
      new DataView(
        symbolBytes.buffer,
        symbolBytes.byteOffset,
        symbolBytes.byteLength,
      ).getBigInt64(0, true),
    );
  checkedOriginalCurtainFrame(doorBytes, doorOwner, 2031);
  checkedOriginalCurtainFrame(symbolBytes, symbolOwner, 2064);
  const door = readOriginalCurtainInstanceTypedFifo(doorBytes, schema.schema),
    symbol = readOriginalMullionSymbolTypedFifo(
      symbolBytes,
      schema.schema,
      "FamilySymbol",
    );
  if (!door.ok) throw Error(door.error);
  if (!symbol.ok) throw Error(symbol.error);
  const one = (es: typeof symbol.value.entries, name: string) => {
    const a = es.filter((e) => e.sourceClassName === name);
    if (a.length !== 1)
      throw Error(`Original curtain door requires one ${name}`);
    return a[0]!;
  };
  const info = one(door.value.entries, "InstanceInfo"),
    reference = one(door.value.entries, "CurtainCellFamRef"),
    cell = one(symbol.value.entries, "CurtainCellSymFamRef"),
    step = one(symbol.value.entries, "BaseFamilySymbolGStep"),
    pattern = one(symbol.value.entries, "FamilySymbolPatternHelper");
  if (
    id(door.value.root.m_id) !== doorOwner ||
    id(symbol.value.root.m_id) !== symbolOwner ||
    id(info.value.m_symbolId) !== symbolOwner ||
    info.value.m_GRepId !== 0 ||
    id(door.value.root.m_hostId) !== id(reference.value.m_hostId) ||
    reference.value.m_driverId !== -1
  )
    throw Error("Original current door/definition/host identities differ");
  const width = number(cell.value.m_width),
    height = number(cell.value.m_height);
  if (
    width <= 0 ||
    height <= 0 ||
    cell.value.m_isRect !== 1 ||
    ![0, 1].includes(number(cell.value.m_flipped))
  )
    throw Error("Unsupported original finite curtain-door cell role");
  for (const key of [
    "m_subInstData",
    "m_subElemData",
    "m_complexCutGeoms",
    "m_dummyHostGeoms",
    "m_nonBRepGeomPtrs",
    "m_closurePlanes",
    "m_arrProfileLoops",
    "m_lightSrcGReps",
    "m_notRotatedNodes",
    "m_arrFamSymRegenData",
  ])
    if (array(symbol.value.root[key]).length)
      throw Error(`Additional unresolved original curtain-door role ${key}`);
  if (
    obj(step.value.m_oExtraDatas).token !== 0 ||
    array(pattern.value.m_PatternPositionMap).length ||
    array(pattern.value.m_substituteFaceMap).length
  )
    throw Error("Additional original curtain-door generator operands");
  const loops = array(cell.value.m_pCurveLoops);
  if (loops.length !== 1)
    throw Error(
      "Original finite curtain-door profile has a hole or unresolved branch",
    );
  const loopEntries = symbol.value.entries.filter(
    (e) =>
      e.sourceClassName === "CurveLoop" &&
      e.descriptor.start === obj(loops[0]).start,
  );
  if (loopEntries.length !== 1 || loopEntries[0]!.value.m_open !== 0)
    throw Error(
      "Original finite curtain-door profile is not a named closed source loop",
    );
  const curveDescriptors = array(loopEntries[0]!.value.m_curves);
  if (curveDescriptors.length !== 4)
    throw Error(
      "Original curtain-door profile is not four complete original lines",
    );
  const curves = curveDescriptors.map((d) => {
    const es = symbol.value.entries.filter(
      (e) =>
        e.sourceClassName === "GLine" &&
        e.descriptor.start === obj(d).start &&
        e.descriptor.token === obj(d).token,
    );
    if (es.length !== 1)
      throw Error("Unresolved original curtain-door profile curve");
    const e = es[0]!,
      origin = array(e.value.m_origin).map(number),
      direction = array(e.value.m_dirVec).map(number),
      parameters = array(e.value.m_endParams).map(number);
    if (
      origin.length !== 3 ||
      direction.length !== 3 ||
      parameters.length !== 2 ||
      parameters[0]! >= parameters[1]!
    )
      throw Error("Invalid original curtain-door finite line");
    return {
      sourceToken: e.descriptor.token,
      sourceTag: obj(e.value.m_GInfo).m_tag,
      originalOriginFeet: origin,
      originalDirection: direction,
      originalParameters: parameters,
      exactEndpointsFeet: parameters.map((t) =>
        origin.map((o, i) =>
          pair(add(rational(o), mul(rational(direction[i]!), rational(t)))),
        ),
      ),
    };
  });
  const planeDescriptor = obj(cell.value.m_pSurf),
    planeEntries = symbol.value.entries.filter((e) =>
      e.sourceClassName === "Plane" &&
      e.descriptor.start === planeDescriptor.start &&
      e.descriptor.token === planeDescriptor.token,
    );
  if (planeEntries.length !== 1)
    throw Error("Unresolved original curtain-cell profile plane");
  const joins = curves.map((c, i) => ({
    from: c.exactEndpointsFeet[1],
    to: curves[(i + 1) % curves.length]!.exactEndpointsFeet[0],
  }));
  return {
    nativeDoorElementId: doorOwner,
    nativeDefinitionElementId: symbolOwner,
    nativeHostElementId: id(reference.value.m_hostId),
    originalWidthFeet: width,
    originalHeightFeet: height,
    originalCellPlaneDescriptor: cell.value.m_pSurf,
    originalCellPlaneOperands: planeEntries[0]!.value,
    originalNativePlacementOperands: info.value.m_Trf,
    originalProfileCurves: curves,
    retainedOriginalJoinEndpointPairs: joins,
    completeOriginalDoorNativeByteReplay:
      door.value.endOffset === doorBytes.length - 4,
    completeOriginalDefinitionByteReplay:
      symbol.value.endOffset === symbolBytes.length - 4,
    originalDefinitionLedger: thresholdSourceOperands(symbol.value),
    originalInstanceLedger: thresholdSourceOperands(door.value),
    sourceAuthorityGranted: false as const,
    sourceApertureApproved: false as const,
    sourceLeafOperationApproved: false as const,
    sourceMaterialOmitted: false as const,
    routeApproved: false as const,
  };
}
/** Current source membership and category are read afresh. This is a source
 * constructor receipt, not a leaf-operation or hole-free opening certificate. */
export function inspectOriginalCurrentCurtainDoorDefinition(
  census: OriginalNativeForeignEnvelopeCensus,
  container: OriginalCurtainMaterialContainer,
  nativeDoorElementId: number,
) {
  const assembly = originalCurtainMaterialContainerFact(census, container),
    door = readOriginalForeignEnvelopeScopedSemantic(
      census,
      nativeDoorElementId,
      2031,
    );
  if (
    door.originalCategoryDeclarations.length !== 1 ||
    door.originalCategoryDeclarations[0] !== -2000023 ||
    !assembly.currentBindings.currentPanelElementIds.includes(
      nativeDoorElementId,
    )
  )
    throw Error(
      "Original current curtain-door category/membership is absent or contradictory",
    );
  const schema = readSchema(door.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const d = readOriginalCurtainInstanceTypedFifo(
    door.originalFrameBytes,
    schema.schema,
  );
  if (!d.ok) throw Error(d.error);
  const infos = d.value.entries.filter(
    (e) => e.sourceClassName === "InstanceInfo",
  );
  if (infos.length !== 1)
    throw Error("Ambiguous original curtain-door definition");
  const symbol = readOriginalForeignEnvelopeScopedSemantic(
    census,
    id(infos[0]!.value.m_symbolId),
    2064,
  );
  if (
    symbol.originalCategoryDeclarations.length !== 1 ||
    symbol.originalCategoryDeclarations[0] !== -2000023
  )
    throw Error(
      "Original curtain-door definition category is absent or contradictory",
    );
  const fact = inspectOriginalCurtainDoorDefinition(
    door.originalSourceSchemaBytes,
    door.originalFrameBytes,
    symbol.originalFrameBytes,
  );
  if (fact.nativeHostElementId !== assembly.nativeHostElementId)
    throw Error("Original curtain-door belongs to another current assembly");
  return {
    ...fact,
    sourceModelSha256: door.sourceModelSha256,
    sourceSchemaSha256: door.sourceSchemaSha256,
    originalNativeInstanceSha256: door.originalFrameSha256,
    originalNativeDefinitionSha256: symbol.originalFrameSha256,
    originalCurrentSourceMembershipRevalidated: true as const,
  };
}
