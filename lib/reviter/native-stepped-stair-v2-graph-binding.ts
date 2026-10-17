/** Exact graph identity replay only. The caller independently reconstructs
 * currentGraphBinding from the current dataset; copied snapshots never grant
 * original-model, material, accessibility, or routing authority. */
type OriginalNode = {
  id: string;
  roomKey: string;
  kind: string;
  levelId: number;
  pointFeet: [number, number, number];
  [key: string]: unknown;
};
type OriginalRecord = {
  key: string;
  levelId: number;
  building: string;
  access: string;
  walkable: boolean;
  circulation: boolean;
  stair: boolean;
};
type OriginalEdgeIdentity = {
  id: string;
  from: string;
  to: string;
  kind: string;
  nativeElementId?: number;
  accessible: string;
  roomKeys: string[];
  direction: string;
};
export type PortableSteppedGraphBinding = {
  sourceModelSha256: string;
  edge: OriginalEdgeIdentity;
  terminals: {
    node: OriginalNode;
    level: { id: number; elevationFeet: number; [key: string]: unknown };
    record: OriginalRecord;
  }[];
};
export type SteppedGraphDataset = {
  source: { modelSha256: string };
  nodes: OriginalNode[];
  edges: (Omit<OriginalEdgeIdentity, "direction"> & { direction?: string })[];
  records: (OriginalRecord & { [key: string]: unknown })[];
  nativeLevels: PortableSteppedGraphBinding["terminals"][number]["level"][];
};
const positive = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) > 0;
const nonempty = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length < 10_000;
const finitePoint = (p: unknown): p is [number, number, number] =>
  Array.isArray(p) &&
  p.length === 3 &&
  [0, 1, 2].every((i) => typeof p[i] === "number" && Number.isFinite(p[i]));
/** Canonical object order only; every original field/value remains exact. */
function canonical(value: unknown): string {
  let count = 0;
  const parents = new Set<object>();
  const visit = (v: unknown, depth: number): string => {
    if (++count > 100_000 || depth > 64)
      throw new Error("Oversized graph identity snapshot");
    if (v === null) return "null";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Nonfinite graph identity");
      return Object.is(v, -0) ? "-0" : JSON.stringify(v);
    }
    if (typeof v === "string" || typeof v === "boolean")
      return JSON.stringify(v);
    if (
      !v ||
      typeof v !== "object" ||
      parents.has(v) ||
      (!Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null)
    )
      throw new Error("Unsupported graph identity value");
    parents.add(v);
    const result = Array.isArray(v)
      ? "[" +
        Array.from({ length: v.length }, (_, i) => {
          if (!(i in v)) throw new Error("Sparse graph identity");
          return visit(v[i], depth + 1);
        }).join(",") +
        "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) +
              ":" +
              visit((v as { [key: string]: unknown })[key], depth + 1),
          )
          .join(",") +
        "}";
    parents.delete(v);
    return result;
  };
  return visit(value, 0);
}
function validate(binding: PortableSteppedGraphBinding) {
  if (!binding || !/^[a-f0-9]{64}$/.test(binding.sourceModelSha256))
    throw new Error("Invalid graph source model binding");
  const edge = binding.edge;
  if (
    !edge ||
    !nonempty(edge.id) ||
    !nonempty(edge.from) ||
    !nonempty(edge.to) ||
    edge.from === edge.to ||
    !["stairs", "local-steps"].includes(edge.kind) ||
    !positive(edge.nativeElementId) ||
    edge.accessible !== "no" ||
    !["both", "from-to", "to-from"].includes(edge.direction) ||
    !Array.isArray(edge.roomKeys) ||
    new Set(edge.roomKeys).size !== edge.roomKeys.length ||
    !edge.roomKeys.every(nonempty) ||
    !Array.isArray(binding.terminals) ||
    binding.terminals.length !== 2
  )
    throw new Error("Invalid stair graph identity/access binding");
  binding.terminals.forEach((terminal, i) => {
    const node = terminal?.node,
      level = terminal?.level,
      record = terminal?.record;
    if (
      !node ||
      node.id !== [edge.from, edge.to][i] ||
      node.kind !== "stair" ||
      !nonempty(node.roomKey) ||
      !positive(node.levelId) ||
      !finitePoint(node.pointFeet) ||
      !level ||
      level.id !== node.levelId ||
      level.elevationFeet !== node.pointFeet[2] ||
      !record ||
      record.key !== node.roomKey ||
      record.levelId !== node.levelId ||
      !nonempty(record.building) ||
      !["public", "staff", "unknown"].includes(record.access) ||
      typeof record.walkable !== "boolean" ||
      typeof record.circulation !== "boolean" ||
      typeof record.stair !== "boolean"
    )
      throw new Error(
        "Original terminal node/level/room/access identity disagrees",
      );
  });
  const keys = [...new Set(binding.terminals.map((t) => t.node.roomKey))];
  if (
    binding.terminals[0]!.node.levelId === binding.terminals[1]!.node.levelId ||
    keys.length !== edge.roomKeys.length ||
    keys.some((k) => !edge.roomKeys.includes(k))
  )
    throw new Error("Stair graph endpoints differ from served identities");
  canonical(binding);
  return binding;
}
/** No full original dataset is required in the visitor. The source producer
 * preserves its independently checked original snapshot on the edge proof. */
export function assertPortableSteppedGraphBindingPreserved(
  expected: PortableSteppedGraphBinding,
  current: PortableSteppedGraphBinding,
) {
  validate(expected);
  validate(current);
  if (canonical(expected) !== canonical(current))
    throw new Error(
      "Current stair graph changed original node, level, edge, source or access identity",
    );
  return current;
}
/** Current runtime graph extraction. Deliberately ignores enabled/length/path
 * output, while preserving EVERY original node/level field and permission. */
export function createCurrentSteppedStairGraphBinding(
  data: SteppedGraphDataset,
  edgeId: string,
): PortableSteppedGraphBinding {
  const unique = <T>(items: T[], message: string) => {
    if (items.length !== 1) throw new Error(message);
    return items[0]!;
  };
  if (
    !data ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges) ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.nativeLevels)
  )
    throw new Error("Missing current stair graph");
  const e = unique(
    data.edges.filter((edge) => edge.id === edgeId),
    "Missing/duplicated current stair edge",
  );
  const edge = {
    id: e.id,
    from: e.from,
    to: e.to,
    kind: e.kind,
    nativeElementId: e.nativeElementId,
    accessible: e.accessible,
    roomKeys: e.roomKeys,
    direction: e.direction ?? "both",
  };
  const terminals = [e.from, e.to].map((id) => {
    const node = unique(
        data.nodes.filter((n) => n.id === id),
        "Missing/duplicated current stair node",
      ),
      level = unique(
        data.nativeLevels.filter((l) => l.id === node.levelId),
        "Missing/duplicated current served level",
      ),
      record = unique(
        data.records.filter((r) => r.key === node.roomKey),
        "Missing/duplicated current stair room",
      );
    return {
      node,
      level,
      record: {
        key: record.key,
        levelId: record.levelId,
        building: record.building,
        access: record.access,
        walkable: record.walkable,
        circulation: record.circulation,
        stair: record.stair,
      },
    };
  });
  return structuredClone(
    validate({ sourceModelSha256: data.source.modelSha256, edge, terminals }),
  );
}
