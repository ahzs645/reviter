import type { SchemaStream, SchemaStreamProperty } from "./schema-reader.ts";

type ObjectValue = Record<string, unknown>;
export type NativeCurtainHostRootClassName = "SWall" | "CurtainGridLine";
export type NativeCurtainHostTypedDescriptor = {
  token: number;
  sourceClassSlot: number | null;
  start: number;
  end: number;
  path: string;
};
export type NativeCurtainHostTypedField = {
  path: string;
  sourceClassName: string;
  schemaFieldOffset: number;
  start: number;
  end: number;
  omitted?: true;
};
export type NativeCurtainHostTypedFifoEntry = {
  replayIndex: number;
  descriptor: NativeCurtainHostTypedDescriptor;
  sourceClassName: string;
  start: number;
  end: number;
  value: ObjectValue;
  fields: NativeCurtainHostTypedField[];
};
export type NativeCurtainHostTypedFifo = {
  nativeElementId: number;
  rootClassName: NativeCurtainHostRootClassName;
  rootClassSlot: number;
  rootStaticEnd: number;
  endOffset: number;
  root: ObjectValue;
  rootFields: NativeCurtainHostTypedField[];
  entries: NativeCurtainHostTypedFifoEntry[];
  completeOriginalTypedRootAndFifoByteReplay: true;
};

const DYNAMIC_CLASSES = new Set([
  "CurtainGrid",
  "GeomStepList",
  "GeomTable",
  "CellList",
  "GLine",
  "CurveLoop",
  "Plane",
  "Face",
  "Edge",
  "EdgeLoop",
  "CurtainGridLineGStep",
  "SkipGridLineSeg",
  "ParamValueSetDouble",
  "HostObjMiscData",
  "AnalyticalSpaceBoundingCell",
  "HostObjPatternHelper",
  "SpacingRuleInst",
  "VWallDriver",
  "WallRefPlanesGStep",
  "BaseWallGStep",
  "ExtrusionGStep",
  "VerticalExtensionOfLayersGStep",
  "JoinEndGStep",
  "WallJoinTweakGStep",
  "WallCutoutGStep",
  "VCWSplitFaceGStep",
  "CWallGridFaceGStep",
  "CGridDivideFaceGStep",
  "SnapshotData",
  "CoverSettingsCell",
  "VWallExtrusionHelper",
  "VWallPatternHelper",
  "WallCGDriver",
  "GeometryTopology",
  "CDJoinInfo",
  "GElement",
  "ParamValueSetElementId",
  "CGDriverMullionData",
  "ElementIdIndexPairSet",
  "SpacingRuleElemCtrl",
]);
/** These named runtime fields are absent from the stored object. Each admitted flag/field declaration is checked explicitly; a changed or
 * unfamiliar flag is refused. Full frame and FIFO closure are required. */
const OMITTED_FIELDS = new Map([
  ["CurtainGrid.m_splitterGrids", 2],
  ["CGDriver.m_suspended", 2],
  ["VWall.m_moveInfo", 2],
  ["VWall.m_freshWall", 2],
  ["VWall.m_splitting", 2],
  ["GeomTable.m_cacheIsCurrent", 34],
  ["GeomTabEntry.m_pGNode", 34],
]);
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const MAX_ENTRIES = 100_000;
const MAX_FIELDS = 1_000_000;
const MAX_DEPTH = 64;

/** Unwired typed SWall3899/CurtainGridLine1049 root and complete FIFO reader.
 * Every stored operand consumes exact source bytes. Only the named original
 * runtime flag2/34 fields below omit bytes (pinned rvt-rs1c3d337,
 * native_parameters.rs469–480); all other flags/classes refuse. The caller
 * separately checks actual RVT membership, embedded schema, checksum and
 * placement. This pure reader grants no material enclosure/absence, source
 * authority, clearance or route approval. */
export function readOriginalCurtainHostTypedFifo(
  data: Uint8Array,
  schema: SchemaStream,
  expectedRootClassName: NativeCurtainHostRootClassName = "SWall",
):
  | { ok: true; value: NativeCurtainHostTypedFifo }
  | { ok: false; error: string; offset: number } {
  let at = 18;
  try {
    function fail(message: string): never {
      throw Error(message);
    }
    if (
      data.byteLength < 38 ||
      data.byteLength > MAX_FRAME_BYTES ||
      schema.trailingBytes !== 0 ||
      schema.terminatorBytes !== 8 ||
      schema.unresolvedReferences.length ||
      schema.inlineIndexMismatches.length
    )
      fail("Incomplete source frame or embedded schema");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const objectLength = view.getUint32(12, true);
    const end = objectLength + 16;
    if (
      end + 4 !== data.byteLength ||
      view.getUint32(end, true) !== objectLength
    )
      fail("Original source root length echo does not match");
    const nativeSourceOwnerId = Number(view.getBigInt64(0, true));
    if (!Number.isSafeInteger(nativeSourceOwnerId) || nativeSourceOwnerId <= 0)
      fail("Invalid original owner id");
    const classes = new Map(schema.classes.map((c) => [c.index, c]));
    if (classes.size !== schema.classes.length)
      fail("Duplicate source schema class");
    const rootClassSlot = view.getUint16(16, true);
    if (!["SWall", "CurtainGridLine"].includes(expectedRootClassName))
      fail("Unsupported expected original curtain host root class");
    if (classes.get(rootClassSlot)?.name !== expectedRootClassName)
      fail(`Original root is not ${expectedRootClassName}`);
    const descriptors: NativeCurtainHostTypedDescriptor[] = [];
    const fields: NativeCurtainHostTypedField[] = [];
    const take = (n: number) => {
      if (!Number.isSafeInteger(n) || n < 0 || at > end - n)
        fail("Truncated original source field");
      const start = at;
      at += n;
      return start;
    };
    const count = () => {
      const n = view.getInt32(take(4), true);
      if (n < 0 || n > MAX_ITEMS) fail("Source collection count exceeds bound");
      return n;
    };
    const primitive = (type: number): unknown => {
      switch (type) {
        case 1: {
          const b = view.getUint8(take(1));
          if (b > 1) fail("Invalid source boolean");
          return b;
        }
        case 2:
          return view.getInt8(take(1));
        case 3:
        case 10:
          return view.getInt16(take(2), true);
        case 4:
        case 5:
          return view.getInt32(take(4), true);
        case 6: {
          const n = view.getFloat32(take(4), true);
          if (!Number.isFinite(n)) fail("Non-finite source float");
          return n;
        }
        case 7: {
          const n = view.getFloat64(take(8), true);
          if (!Number.isFinite(n)) fail("Non-finite source double");
          return n;
        }
        case 8: {
          const n = count(),
            start = take(n * 2);
          return new TextDecoder("utf-16le", { fatal: true }).decode(
            data.subarray(start, at),
          );
        }
        case 9:
          return Array.from(data.subarray(take(16), at));
        case 11: {
          const n = Number(view.getBigInt64(take(8), true));
          if (!Number.isSafeInteger(n)) fail("Unrepresentable source integer");
          return n;
        }
        default:
          return fail(`Unsupported source primitive ${type}`);
      }
    };
    let fieldBudget = 0;
    const readObject = (
      index: number,
      path: string,
      depth: number,
    ): ObjectValue => {
      if (depth > MAX_DEPTH) fail("Source schema recursion exceeds bound");
      const c = classes.get(index);
      if (!c || c.propertyCount !== c.properties.length || c.unknownWord !== 0)
        fail("Unresolved source class");
      const result: ObjectValue =
        c.parent.kind === "none"
          ? {}
          : readObject(c.parent.index, path, depth + 1);
      for (const f of c.properties) {
        const key = f.name;
        if (Object.hasOwn(result, key))
          fail("Duplicate same-class source field");
        result[key] = readField(f, `${path}.${key}`, c.name, depth + 1);
      }
      return result;
    };
    const readOne = (
      f: SchemaStreamProperty,
      path: string,
      owner: string,
      depth: number,
    ): unknown => {
      if (++fieldBudget > MAX_FIELDS) fail("Source field count exceeds bound");
      const start = at;
      let value: unknown;
      if ([1, 2, 4].includes(f.loadingMode) && f.fieldType === 14) {
        const token = view.getInt32(take(4), true);
        const sourceClassSlot = token ? view.getInt16(take(2), true) : null;
        if (sourceClassSlot !== null && !classes.has(sourceClassSlot))
          fail("Unknown conditional source class");
        const descriptor = { token, sourceClassSlot, start, end: at, path };
        descriptors.push(descriptor);
        value = descriptor;
      } else if (f.loadingMode === 3 && f.fieldType === 14) {
        value = { staticReference: view.getInt32(take(4), true) };
      } else if (f.loadingMode !== 0) {
        return fail(`Unsupported source loading mode ${f.loadingMode}`);
      } else if (f.fieldType === 14) {
        if (!f.staticType || f.staticType.kind === "none")
          return fail("Unresolved static source member");
        value = readObject(f.staticType.index, path, depth + 1);
      } else if (f.fieldType === 13) {
        if (!f.element) return fail("Missing source tuple element");
        value = readField(f.element, `${path}.tuple`, owner, depth + 1);
      } else value = primitive(f.fieldType);
      fields.push({
        path,
        sourceClassName: owner,
        schemaFieldOffset: f.offset,
        start,
        end: at,
      });
      return value;
    };
    const readField = (
      f: SchemaStreamProperty,
      path: string,
      owner: string,
      depth: number,
    ): unknown => {
      if (depth > MAX_DEPTH) fail("Source member recursion exceeds bound");
      const omittedFlag = OMITTED_FIELDS.get(`${owner}.${f.name}`);
      if (omittedFlag !== undefined) {
        const key = `${owner}.${f.name}`;
        const expected =
          key === "VWall.m_moveInfo"
            ? [14, 1, 0]
            : key === "GeomTabEntry.m_pGNode"
              ? [14, 3, 0]
              : key === "CurtainGrid.m_splitterGrids"
                ? [14, 0, 5]
                : [1, 0, 0];
        if (
          f.unknownWord !== omittedFlag ||
          f.fieldType !== expected[0] ||
          f.loadingMode !== expected[1] ||
          f.itemMode !== expected[2]
        )
          fail("Changed omitted source field declaration");
        fields.push({
          path,
          sourceClassName: owner,
          schemaFieldOffset: f.offset,
          start: at,
          end: at,
          omitted: true,
        });
        return { omitted: true };
      }
      if (f.unknownWord !== 0)
        fail(
          `Unsupported flagged source field ${owner}.${f.name}=${f.unknownWord}`,
        );
      if (
        f.itemMode === 0 ||
        (f.itemMode === 6 && f.fieldType === 8 && f.loadingMode === 0)
      )
        return readOne(f, path, owner, depth);
      let n: number;
      if (f.itemMode === 1 && f.size !== undefined) n = f.size;
      else if (f.itemMode === 5) n = count();
      else return fail(`Unsupported source item mode ${f.itemMode}`);
      if (!Number.isSafeInteger(n) || n < 0 || n > MAX_ITEMS)
        fail("Invalid fixed source tuple count");
      return Array.from({ length: n }, (_, i) =>
        readOne(f, `${path}[${i}]`, owner, depth),
      );
    };
    const root = readObject(rootClassSlot, expectedRootClassName, 0);
    const rootStaticEnd = at,
      rootFieldCount = fields.length;
    const sourceOwner = (
      root.m_id as { m_id?: { m_id64?: number } } | undefined
    )?.m_id?.m_id64;
    if (sourceOwner !== nativeSourceOwnerId)
      fail("Root owner field differs from source frame");
    const queue: NativeCurtainHostTypedDescriptor[] = [];
    const tokens = new Map<number, number>();
    let nextToken = 3;
    const enqueue = (list: readonly NativeCurtainHostTypedDescriptor[]) => {
      for (const d of list) {
        if (!d.token) continue;
        if (d.sourceClassSlot === null) fail("Missing queued source class");
        if (d.token > 0) {
          const prior = tokens.get(d.token);
          if (prior !== undefined) {
            if (prior !== d.sourceClassSlot)
              fail("Reused token changed source class");
            continue;
          }
          if (d.token !== nextToken) fail("Non-append original source token");
          tokens.set(d.token, d.sourceClassSlot);
          nextToken++;
        } else if (d.token !== -1) fail("Unsupported negative source token");
        if (queue.length >= MAX_ENTRIES) fail("Original FIFO exceeds bound");
        queue.push(d);
      }
    };
    enqueue(descriptors);
    const entries: NativeCurtainHostTypedFifoEntry[] = [];
    for (let head = 0; head < queue.length; head++) {
      const descriptor = queue[head]!,
        c = classes.get(descriptor.sourceClassSlot!)!;
      if (!DYNAMIC_CLASSES.has(c.name))
        fail(`Unsupported dynamic source class ${c.name}`);
      const start = at,
        descriptorCount = descriptors.length,
        fieldCount = fields.length;
      const value = readObject(c.index, c.name, 0);
      entries.push({
        replayIndex: head,
        descriptor,
        sourceClassName: c.name,
        start,
        end: at,
        value,
        fields: fields.slice(fieldCount),
      });
      enqueue(descriptors.slice(descriptorCount));
    }
    if (at !== end)
      fail("Original FIFO does not consume complete source frame");
    return {
      ok: true,
      value: {
        nativeElementId: nativeSourceOwnerId,
        rootClassName: expectedRootClassName,
        rootClassSlot,
        rootStaticEnd,
        endOffset: at,
        root,
        rootFields: fields.slice(0, rootFieldCount),
        entries,
        completeOriginalTypedRootAndFifoByteReplay: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      offset: at,
    };
  }
}
