/** Unwired exact original PartMaker identity/dependency prefix and zero-child saved GRep. This grants no physical absence, walking or route authority. */
import type { SchemaStream, SchemaStreamProperty } from "./schema-reader.ts";
export function inspectOriginalPartMakerPrefix(
  data: Uint8Array,
  schema: SchemaStream,
  expectedClass: "PartMaker" = "PartMaker",
) {
  const fail = (message: string): never => {
    throw Error(message);
  };
  if (
    data.length < 38 ||
    data.length > 16 * 1024 * 1024 ||
    schema.trailingBytes ||
    schema.terminatorBytes !== 8 ||
    schema.unresolvedReferences.length ||
    schema.inlineIndexMismatches.length
  )
    fail("Incomplete original semantic frame/schema");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    objectLength = view.getUint32(12, true),
    end = objectLength + 16;
  if (end + 4 !== data.length || view.getUint32(end, true) !== objectLength)
    fail("Original semantic frame echo mismatch");
  const classes = new Map(schema.classes.map((c) => [c.index, c]));
  if (classes.size !== schema.classes.length)
    fail("Duplicate original semantic schema class");
  const slot = view.getUint16(16, true),
    rootClass = classes.get(slot);
  if (rootClass?.name !== expectedClass)
    fail("Original semantic class differs from requested role");
  const ancestors: NonNullable<typeof rootClass>[] = [],
    seen = new Set<number>();
  let current = rootClass;
  while (current) {
    if (seen.has(current.index) || ancestors.length >= 64)
      fail("Original semantic class ancestry cycle");
    seen.add(current.index);
    ancestors.push(current);
    current =
      current.parent.kind === "none"
        ? undefined
        : classes.get(current.parent.index);
  }
  ancestors.reverse();
  if (ancestors[0]?.name !== "Element")
    fail("Original semantic root is not derived from Element");
  let at = 18,
    budget = 0;
  const fields: {
      sourceClassName: string;
      fieldPath: string;
      sourceSchemaFieldOffset: number;
      start: number;
      end: number;
    }[] = [],
    descriptors: {
      sourceClassName: string;
      fieldPath: string;
      token: number;
      sourceClassSlot: number | null;
      start: number;
      end: number;
    }[] = [];
  const take = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || at > end - n)
      fail("Truncated original semantic prefix");
    const start = at;
    at += n;
    return start;
  };
  const count = () => {
    const n = view.getInt32(take(4), true);
    if (n < 0 || n > 100000) fail("Original semantic collection exceeds bound");
    return n;
  };
  const object = (
    index: number,
    path: string,
    depth: number,
  ): Record<string, unknown> => {
    if (depth > 64) fail("Original semantic prefix nesting exceeds bound");
    const c = classes.get(index);
    if (
      !c ||
      c.unknownWord ||
      c.propertyCount !== c.properties.length ||
      c.parent.kind !== "none"
    )
      fail("Unsupported original static semantic member class");
    const v: Record<string, unknown> = {};
    for (const f of c!.properties) {
      if (Object.hasOwn(v, f.name)) fail("Duplicate original static member");
      v[f.name] = field(f, `${path}.${f.name}`, c!.name, depth + 1);
    }
    return v;
  };
  const one = (
    f: SchemaStreamProperty,
    path: string,
    owner: string,
    depth: number,
  ): unknown => {
    if (++budget > 1000000) fail("Original semantic prefix budget exceeded");
    const start = at;
    let value: unknown;
    if (f.fieldType === 14 && [1, 2, 4].includes(f.loadingMode)) {
      const token = view.getInt32(take(4), true),
        sourceClassSlot = token ? view.getInt16(take(2), true) : null;
      if (sourceClassSlot !== null && !classes.has(sourceClassSlot))
        fail("Unknown original semantic descriptor class");
      value = { token, sourceClassSlot, start, end: at };
      descriptors.push({
        sourceClassName: owner,
        fieldPath: path,
        ...(value as {
          token: number;
          sourceClassSlot: number | null;
          start: number;
          end: number;
        }),
      });
    } else if (f.fieldType === 14 && f.loadingMode === 3)
      value = { staticReference: view.getInt32(take(4), true) };
    else if (f.loadingMode !== 0)
      fail("Unsupported original semantic loading mode");
    else if (f.fieldType === 14) {
      if (!f.staticType || f.staticType.kind === "none")
        fail("Unresolved original static semantic class");
      if (f.staticType?.kind !== "reference" && f.staticType?.kind !== "inline")
        throw Error("Unresolved original static semantic class");
      value = object(f.staticType.index, path, depth + 1);
    } else if (f.fieldType === 1) {
      const n = view.getUint8(take(1));
      if (n > 1) fail("Invalid original semantic boolean");
      value = n;
    } else if (f.fieldType === 4) value = view.getInt32(take(4), true);
    else if (f.fieldType === 7) {
      const n = view.getFloat64(take(8), true);
      if (!Number.isFinite(n)) fail("Nonfinite original semantic double");
      value = n;
    } else if (f.fieldType === 11) {
      const n = Number(view.getBigInt64(take(8), true));
      if (!Number.isSafeInteger(n))
        fail("Unrepresentable original semantic identifier");
      value = n;
    } else fail("Unsupported original semantic primitive");
    fields.push({
      sourceClassName: owner,
      fieldPath: path,
      sourceSchemaFieldOffset: f.offset,
      start,
      end: at,
    });
    return value;
  };
  const field = (
    f: SchemaStreamProperty,
    path: string,
    owner: string,
    depth: number,
  ): unknown => {
    if (depth > 64 || f.unknownWord)
      fail("Unsupported flagged/deep original semantic prefix");
    if (f.itemMode === 0) return one(f, path, owner, depth);
    const n =
      f.itemMode === 5
        ? count()
        : f.itemMode === 1 && f.size !== undefined
          ? f.size
          : fail("Unsupported original semantic item mode");
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000)
      fail("Original semantic item count exceeds bound");
    return Array.from({ length: n }, (_, i) =>
      one(f, `${path}[${i}]`, owner, depth),
    );
  };
  const result: Record<string, unknown> = {},
    targetClass = "PartMaker",
    targetField = "m_sketchId";
  let stopped = false;
  for (const c of ancestors) {
    if (c.unknownWord || c.propertyCount !== c.properties.length)
      fail("Incomplete original semantic class declaration");
    for (const f of c.properties) {
      if (Object.hasOwn(result, f.name))
        fail("Duplicate inherited original semantic field");
      result[f.name] = field(f, `${expectedClass}.${f.name}`, c.name, 0);
      if (c.name === targetClass && f.name === targetField) {
        stopped = true;
        break;
      }
    }
    if (stopped) break;
  }
  if (!stopped) fail("Required original semantic named field missing");
  const id = (v: unknown) => {
    const n = (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      (n <= 0 && n !== -1)
    )
      fail(`Invalid original native identifier field: ${JSON.stringify(v)}`);
    return n as number;
  };
  const nativeElementId = Number(view.getBigInt64(0, true));
  if (
    !Number.isSafeInteger(nativeElementId) ||
    nativeElementId <= 0 ||
    id(result.m_id) !== nativeElementId
  )
    fail("Original semantic owner field differs from frame");
  const divided = result.m_dividedElementIds;
  if (!Array.isArray(divided))
    fail("Original PartMaker divided-element list absent");
  const originalDividedElementIds = (divided as unknown[]).map((v) => {
      const p = v as {
        m_linkInstOrHostId?: unknown;
        m_linkRef?: { m_id64?: unknown };
      };
      if (p.m_linkRef?.m_id64 !== -1)
        fail("Linked original PartMaker division is unsupported");
      return id(p.m_linkInstOrHostId);
    }),
    originalSketchId = id(result.m_sketchId);
  if (
    !originalDividedElementIds.length ||
    new Set(originalDividedElementIds).size !==
      originalDividedElementIds.length ||
    originalDividedElementIds.some((i) => i === nativeElementId || i <= 0)
  )
    fail("Original PartMaker divided-element list invalid");
  return {
    nativeElementId,
    sourceClassName: expectedClass,
    sourceClassSlot: slot,
    originalDividedElementIds,
    originalSketchId,
    originalNamedStaticPrefixEnd: at,
    originalNamedStaticPrefixFields: fields,
    retainedDynamicDescriptors: descriptors,
    originalRootByteLength: data.length,
    unreadOriginalRootSuffixBytes: data.length - 4 - at,

    completeNamedStaticPrefixDecoded: true as const,
    completeSemanticRootDecoded: false as const,
    originalSourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}

/** Complete source zero-child root. Unlike the legacy page/GRep minimum, the
 * fixed tail may occupy the entire16-byte region before the length echo.
 * This explains ALL original bytes; it proves no generic physical absence. */
export function inspectOriginalZeroChildGElement(data: Uint8Array) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    data.length !== 158 ||
    v.getUint32(12, true) !== 138 ||
    v.getUint32(154, true) !== 138 ||
    v.getUint16(16, true) !== 2246 ||
    v.getUint32(4, true) !== 0 ||
    v.getUint32(38, true) !== 0
  )
    throw Error("Original zero-child GElement framing mismatch");
  const id = v.getBigInt64(0, true);
  if (
    id <= 0n ||
    id > 0x7fffffffn ||
    v.getBigInt64(138, true) !== id ||
    v.getInt32(146, true) !== 3 ||
    v.getUint32(150, true) !== 0
  )
    throw Error("Original zero-child GElement owner/tail mismatch");
  let a = 1,
    b = 0;
  for (let i = 16; i < 154; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
    throw Error("Original zero-child GElement checksum mismatch");
  for (let i = 0; i < 12; i++)
    if (v.getFloat64(42 + i * 8, true) !== (i % 6 < 3 ? 1e30 : -1e30))
      throw Error("Original zero-child bounds are not exact empty sentinels");
  return {
    nativeElementId: Number(id),
    originalGStyleElementId: Number(v.getBigInt64(18, true)),
    originalTag: v.getInt32(26, true),
    originalControlCommand: v.getInt32(30, true),
    originalGInfoFlags: v.getUint32(34, true),
    completeOriginalGRepByteReplay: true as const,
    originalChildCount: 0 as const,
    originalSavedPhysicalBranchCount: 0 as const,
    genericPhysicalAbsenceApproved: false as const,
    routeApproved: false as const,
  };
}
