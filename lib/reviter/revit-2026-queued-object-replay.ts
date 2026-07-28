import {
  claimDynamicQueueReplaySpan,
  isDynamicQueueReplayCertificate,
  SurrogateObjectPropertyRegistry,
  type DynamicQueueReplayCertificate,
  type RegistryResult,
} from "./dynamic-object-registry.ts";
import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import {
  dispatchRevit2026ObjectPtrInit,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
  type Revit2026ObjectPtrInitDispatch,
} from "./revit-2026-object-dispatch.ts";

export type Revit2026QueuedGPolyMeshReplay = {
  parentObjectIdentity: string;
  propertyDescriptor: CondInt16QueueEntry;
  outerReplaySpan: {
    startOffset: number;
    endOffset: number;
  };
  dispatch: Revit2026ObjectPtrInitDispatch;
  /**
   * The nested topology queue is certified only when the GPolyMesh condition
   * is nonzero. A null condition legitimately has no second replay payload.
   */
  topologyReplayCertificate: DynamicQueueReplayCertificate | null;
};

/**
 * Replay the only currently supported nested dynamic-object chain:
 *
 *   one certified parent property (slot 2237 GPolyMesh)
 *     -> selector-free GPolyMesh static body
 *     -> zero or one queued topology property
 *
 * Native `readPropertyToken` passes the class pointer retained by
 * `OdBmCondInt16Reader` into `ObjectPtrInitReader`'s scoped-class field. It
 * therefore consumes no second slot-2237 selector at `replayOffset`.
 *
 * A fresh nested registry is safe only because the input certificate proves
 * that the complete parent queue contains exactly one property, no sequence,
 * and no retained values. General multi-property/native merge semantics
 * remain unsupported.
 */
export function replayCertifiedRevit2026QueuedGPolyMesh(
  data: Uint8Array,
  outerReplayCertificate: DynamicQueueReplayCertificate,
  objectIdentity: string,
): RegistryResult<Revit2026QueuedGPolyMeshReplay> {
  if (!isDynamicQueueReplayCertificate(outerReplayCertificate)) {
    return {
      ok: false,
      error: "outer dynamic queue replay certificate was not issued by the registry",
    };
  }
  if (
    outerReplayCertificate.propertySourceClassSlot !==
    REVIT_2026_GPOLYMESH_SOURCE_CLASS
  ) {
    return {
      ok: false,
      error: "certified parent property is not a Revit 2026 GPolyMesh",
    };
  }

  const decodedDescriptor = decodeCondInt16PropertyDescriptor(
    data,
    outerReplayCertificate.descriptorOffset,
  );
  if (!decodedDescriptor.ok) return decodedDescriptor;
  const propertyDescriptor = decodedDescriptor.descriptor;
  if (
    propertyDescriptor.endOffset !==
      outerReplayCertificate.descriptorEndOffset ||
    propertyDescriptor.token !== outerReplayCertificate.propertyToken ||
    propertyDescriptor.sourceClassSlot !==
      outerReplayCertificate.propertySourceClassSlot
  ) {
    return {
      ok: false,
      error: "certified parent CondInt16 descriptor does not match the stream",
    };
  }

  const nestedRegistry = new SurrogateObjectPropertyRegistry();
  const dispatched = dispatchRevit2026ObjectPtrInit(data, nestedRegistry, {
    byteOffset: outerReplayCertificate.replayOffset,
    objectIdentity,
    parentIdentity: null,
    scopedSourceClassSlot: outerReplayCertificate.propertySourceClassSlot,
  });
  if (!dispatched.ok) return dispatched;

  const sealed = nestedRegistry.sealOuterStaticTraversal(
    objectIdentity,
    dispatched.value.endOffset,
  );
  if (!sealed.ok) return sealed;
  const initialized = nestedRegistry.initializeReferences();
  if (!initialized.ok) return initialized;

  let topologyReplayCertificate: DynamicQueueReplayCertificate | null = null;
  if (nestedRegistry.queueLength !== 0) {
    const certified = nestedRegistry.certifySinglePropertyReplay(
      dispatched.value.endOffset,
    );
    if (!certified.ok) return certified;
    topologyReplayCertificate = certified.value;
  }

  const claimed = claimDynamicQueueReplaySpan(
    outerReplayCertificate,
    outerReplayCertificate.replayOffset,
    dispatched.value.endOffset,
  );
  if (!claimed.ok) return claimed;

  return {
    ok: true,
    value: {
      parentObjectIdentity: outerReplayCertificate.objectIdentity,
      propertyDescriptor,
      outerReplaySpan: claimed.value,
      dispatch: dispatched.value,
      topologyReplayCertificate,
    },
  };
}
