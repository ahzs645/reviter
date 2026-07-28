import type {
  RegistryResult,
  SurrogateDataKey,
} from "./dynamic-object-registry.ts";
import type { ElementObject } from "./element-objects.ts";
import {
  decodeRevit2026GRepRoot,
  REVIT_2026_GREP_SOURCE_CLASS_SLOT,
  type Revit2026GRepRoot,
} from "./revit-2026-grep-root.ts";

export const GREP_ALL_SUBNODES_PROPERTY =
  "OdBmGGroup.m_pAllSubNodes";
export const GREP_QUEUE_INITIAL_TOKEN_COUNT = 3;

const queuePlanBrand = Symbol("reviter.grepQueueReplayPlan");
const queueCertificateBrand = Symbol("reviter.grepQueueReplayCertificate");
const issuedPlans = new WeakMap<
  object,
  { data: Uint8Array; attempted: boolean }
>();
const issuedCertificates = new WeakSet<object>();

export type RevitGRepQueueEntry = {
  queueIndex: number;
  dataKey: SurrogateDataKey;
  propertyToken: number;
  propertySourceClassSlot: number;
  descriptorOffset: number;
  descriptorEndOffset: number;
};

export type RevitGRepQueueReplayPlan = {
  readonly [queuePlanBrand]: true;
  readonly ownerElementId: bigint;
  readonly objectIdentity: string;
  readonly objectSourceClassSlot: number;
  readonly classPropertyIdentity: string;
  readonly replayOffset: number;
  readonly replayEndOffset: number;
  readonly initialTokenCount: number;
  readonly retainedValueCount: 0;
  readonly pairProperty: false;
  readonly entries: readonly RevitGRepQueueEntry[];
};

export type RevitGRepChildReaderContext = {
  byteOffset: number;
  replayEndOffset: number;
  queueIndex: number;
  dataKey: SurrogateDataKey;
  propertyToken: number;
  scopedSourceClassSlot: number;
};

export type RevitGRepChildReadResult =
  | {
      ok: true;
      endOffset: number;
      /**
       * The initial-only subset cannot yet merge child-enqueued properties
       * into the active FIFO. A proven leaf reader must report zero.
       */
      queuedPropertyCount: number;
      value?: unknown;
    }
  | { ok: false; error: string };

export type RevitGRepChildReader = (
  data: Uint8Array,
  context: RevitGRepChildReaderContext,
) => RevitGRepChildReadResult;

export type RevitGRepQueueReplaySpan = {
  queueIndex: number;
  dataKey: SurrogateDataKey;
  propertyToken: number;
  propertySourceClassSlot: number;
  startOffset: number;
  endOffset: number;
  value?: unknown;
};

export type RevitGRepQueueReplayCertificate = {
  readonly [queueCertificateBrand]: true;
  readonly ownerElementId: bigint;
  readonly objectIdentity: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly initialTokenCount: number;
  readonly finalTokenCount: number;
  readonly retainedValueCount: 0;
  readonly pairProperty: false;
  readonly spans: readonly RevitGRepQueueReplaySpan[];
};

function planFromRoot(
  data: Uint8Array,
  root: Revit2026GRepRoot,
): RegistryResult<RevitGRepQueueReplayPlan> {
  if (root.children.length === 0) {
    return {
      ok: false,
      error: "GRep initial-only replay requires at least one queued child",
    };
  }
  const objectIdentity = `revit-grep:${root.ownerElementId}`;
  const entries: RevitGRepQueueEntry[] = [];
  for (let index = 0; index < root.children.length; index += 1) {
    const child = root.children[index]!;
    if (child.sourceClassSlot == null) {
      return {
        ok: false,
        error: "GRep child has no scoped source-class slot",
      };
    }
    const expectedToken = GREP_QUEUE_INITIAL_TOKEN_COUNT + index;
    if (child.token !== expectedToken) {
      return {
        ok: false,
        error:
          `GRep child token ${child.token} is not append-only index ` +
          `${expectedToken}`,
      };
    }
    entries.push({
      queueIndex: index,
      dataKey: {
        objectIdentity,
        classPropertyIdentity: GREP_ALL_SUBNODES_PROPERTY,
        sequenceIndex: index,
      },
      propertyToken: child.token,
      propertySourceClassSlot: child.sourceClassSlot,
      descriptorOffset: child.byteOffset,
      descriptorEndOffset: child.endOffset,
    });
  }

  const plan: RevitGRepQueueReplayPlan = {
    [queuePlanBrand]: true,
    ownerElementId: root.ownerElementId,
    objectIdentity,
    objectSourceClassSlot: REVIT_2026_GREP_SOURCE_CLASS_SLOT,
    classPropertyIdentity: GREP_ALL_SUBNODES_PROPERTY,
    replayOffset: root.dynamicPayloadOffset,
    replayEndOffset: root.dynamicPayloadEndOffset,
    initialTokenCount: GREP_QUEUE_INITIAL_TOKEN_COUNT,
    retainedValueCount: 0,
    pairProperty: false,
    entries,
  };
  issuedPlans.set(plan, { data, attempted: false });
  return { ok: true, value: plan };
}

/**
 * Certify the native initial `GGroup.AllSubNodes` queue subset.
 *
 * The complete GRep static reader has only the child `CondInt16` collection
 * and inline primitive fields. It calls neither `addData` nor a pair reader,
 * so this initial queue has no retained `DataKey` values and is a non-pair
 * sequence. Tokens must append to the native object-token vector at indexes
 * 3, 4, ...; reference reuse and sparse writes fail closed.
 */
export function certifyRevitGRepInitialQueue(
  data: Uint8Array,
  frame: ElementObject,
): RegistryResult<RevitGRepQueueReplayPlan> {
  const decoded = decodeRevit2026GRepRoot(data, frame);
  if (!decoded.ok) return decoded;
  return planFromRoot(data, decoded.value);
}

/**
 * Replay only leaf children from a certified initial GRep FIFO.
 *
 * Native `readProperties` consumes the queue front, passes its retained class
 * as scoped state to `ObjectPtrInitReader`, appends the resulting value at its
 * positive token index, and continues in FIFO order. This subset requires
 * every supplied child reader to enqueue zero nested properties and requires
 * the readers collectively to consume the complete dynamic payload.
 */
export function replayRevitGRepInitialLeafQueue(
  data: Uint8Array,
  plan: RevitGRepQueueReplayPlan,
  readers: ReadonlyMap<number, RevitGRepChildReader>,
): RegistryResult<RevitGRepQueueReplayCertificate> {
  const state = issuedPlans.get(plan);
  if (!state || plan[queuePlanBrand] !== true || state.data !== data) {
    return {
      ok: false,
      error: "GRep queue plan was not issued for this byte buffer",
    };
  }
  if (state.attempted) {
    return { ok: false, error: "GRep queue plan is single-use" };
  }
  state.attempted = true;

  let offset = plan.replayOffset;
  const spans: RevitGRepQueueReplaySpan[] = [];
  for (const entry of plan.entries) {
    const reader = readers.get(entry.propertySourceClassSlot);
    if (!reader) {
      return {
        ok: false,
        error:
          `no proven leaf reader for GRep child source slot ` +
          `${entry.propertySourceClassSlot}`,
      };
    }
    let read: RevitGRepChildReadResult;
    try {
      read = reader(data, {
        byteOffset: offset,
        replayEndOffset: plan.replayEndOffset,
        queueIndex: entry.queueIndex,
        dataKey: entry.dataKey,
        propertyToken: entry.propertyToken,
        scopedSourceClassSlot: entry.propertySourceClassSlot,
      });
    } catch {
      return { ok: false, error: "GRep child reader threw during replay" };
    }
    if (!read.ok) return read;
    if (
      !Number.isSafeInteger(read.endOffset) ||
      read.endOffset <= offset ||
      read.endOffset > plan.replayEndOffset
    ) {
      return {
        ok: false,
        error: "GRep child reader returned an invalid stream advancement",
      };
    }
    if (
      !Number.isSafeInteger(read.queuedPropertyCount) ||
      read.queuedPropertyCount < 0
    ) {
      return {
        ok: false,
        error: "GRep child reader returned an invalid queued-property count",
      };
    }
    if (read.queuedPropertyCount !== 0) {
      return {
        ok: false,
        error: "nested dynamic properties require the general FIFO replay path",
      };
    }
    spans.push({
      queueIndex: entry.queueIndex,
      dataKey: entry.dataKey,
      propertyToken: entry.propertyToken,
      propertySourceClassSlot: entry.propertySourceClassSlot,
      startOffset: offset,
      endOffset: read.endOffset,
      value: read.value,
    });
    offset = read.endOffset;
  }

  if (offset !== plan.replayEndOffset) {
    return {
      ok: false,
      error: "leaf readers did not consume the complete GRep dynamic payload",
    };
  }

  const certificate: RevitGRepQueueReplayCertificate = {
    [queueCertificateBrand]: true,
    ownerElementId: plan.ownerElementId,
    objectIdentity: plan.objectIdentity,
    startOffset: plan.replayOffset,
    endOffset: offset,
    initialTokenCount: plan.initialTokenCount,
    finalTokenCount: plan.initialTokenCount + plan.entries.length,
    retainedValueCount: 0,
    pairProperty: false,
    spans,
  };
  issuedCertificates.add(certificate);
  return { ok: true, value: certificate };
}

export function isRevitGRepQueueReplayCertificate(
  value: unknown,
): value is RevitGRepQueueReplayCertificate {
  return (
    typeof value === "object" &&
    value !== null &&
    issuedCertificates.has(value) &&
    (value as Partial<RevitGRepQueueReplayCertificate>)[
      queueCertificateBrand
    ] === true
  );
}
