const replayCertificateBrand = Symbol("reviter.dynamicQueueReplayCertificate");
const issuedReplayCertificates = new WeakSet<object>();
const replayCertificateState = new WeakMap<
  object,
  { replayOffset: number; consumedEndOffset: number | null }
>();

export type SurrogateDataKey = {
  objectIdentity: string;
  classPropertyIdentity: string;
  sequenceIndex: number;
};

export type SurrogateObjectRecord = {
  identity: string;
  sourceClassSlot: number;
  parentIdentity: string | null;
};

export type SurrogateClassPropertyRecord = {
  identity: string;
  declaringSourceClassSlot: number;
  name: string;
};

export type SurrogateDynamicProperty = {
  dataKey: SurrogateDataKey;
  propertyToken: number;
  propertySourceClassSlot: number;
  collectionEndOffset: number;
};

export type DynamicQueueReplayCertificate = {
  readonly [replayCertificateBrand]: true;
  readonly collectionEndOffset: number;
  readonly outerStaticEndOffset: number;
  readonly replayOffset: number;
  readonly objectIdentity: string;
  readonly objectSourceClassSlot: number;
  readonly classPropertyIdentity: string;
  readonly declaringSourceClassSlot: number;
  readonly sequenceIndex: number;
  readonly propertyToken: number;
  readonly propertySourceClassSlot: number;
  readonly retainedValueCount: 0;
  readonly nextUnreadEntryIndex: 0;
  readonly queueLength: 1;
};

export type RegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type RegistryPhase =
  | "static-traversal"
  | "static-sealed"
  | "references-initialized"
  | "replay-certified";

function validIdentity(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}

function validSourceClassSlot(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 0x7fff;
}

function validInt32(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= -0x80000000 &&
    value <= 0x7fffffff
  );
}

function dataKeyString(key: SurrogateDataKey): string {
  return JSON.stringify([
    key.objectIdentity,
    key.classPropertyIdentity,
    key.sequenceIndex,
  ]);
}

/**
 * Browser-safe surrogate for the state created while
 * `OdBmObjectPtrInitReader::read` walks the outer static object graph.
 *
 * It intentionally implements only the unambiguous subset needed to prove a
 * single dynamic property. Pair joining, sequence reconstruction, reference
 * tokens, and retained-value merging remain unsupported and fail closed.
 */
export class SurrogateObjectPropertyRegistry {
  readonly #objects = new Map<string, SurrogateObjectRecord>();
  readonly #properties = new Map<string, SurrogateClassPropertyRecord>();
  readonly #queue: SurrogateDynamicProperty[] = [];
  readonly #retainedCounts = new Map<string, number>();
  #phase: RegistryPhase = "static-traversal";
  #outerObjectIdentity: string | null = null;
  #outerStaticEndOffset: number | null = null;

  get phase(): RegistryPhase {
    return this.#phase;
  }

  get objectCount(): number {
    return this.#objects.size;
  }

  get propertyCount(): number {
    return this.#properties.size;
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  registerObject(record: SurrogateObjectRecord): RegistryResult<void> {
    if (this.#phase !== "static-traversal") {
      return { ok: false, error: "objects can only be registered during static traversal" };
    }
    if (
      !validIdentity(record.identity) ||
      !validSourceClassSlot(record.sourceClassSlot) ||
      (record.parentIdentity != null && !validIdentity(record.parentIdentity))
    ) {
      return { ok: false, error: "surrogate object identity or source-class slot is invalid" };
    }
    if (this.#objects.has(record.identity)) {
      return { ok: false, error: "surrogate object identity is already registered" };
    }
    this.#objects.set(record.identity, Object.freeze({ ...record }));
    return { ok: true, value: undefined };
  }

  registerClassProperty(
    record: SurrogateClassPropertyRecord,
  ): RegistryResult<void> {
    if (this.#phase !== "static-traversal") {
      return { ok: false, error: "properties can only be registered during static traversal" };
    }
    if (
      !validIdentity(record.identity) ||
      !validSourceClassSlot(record.declaringSourceClassSlot) ||
      !validIdentity(record.name)
    ) {
      return { ok: false, error: "surrogate class-property identity is invalid" };
    }
    if (this.#properties.has(record.identity)) {
      return { ok: false, error: "surrogate class-property identity is already registered" };
    }
    this.#properties.set(record.identity, Object.freeze({ ...record }));
    return { ok: true, value: undefined };
  }

  enqueueDynamicProperty(
    property: SurrogateDynamicProperty,
  ): RegistryResult<void> {
    if (this.#phase !== "static-traversal") {
      return { ok: false, error: "dynamic properties can only be queued during static traversal" };
    }
    if (
      !validIdentity(property.dataKey.objectIdentity) ||
      !validIdentity(property.dataKey.classPropertyIdentity) ||
      !Number.isSafeInteger(property.dataKey.sequenceIndex) ||
      property.dataKey.sequenceIndex < -1 ||
      !validInt32(property.propertyToken) ||
      !validSourceClassSlot(property.propertySourceClassSlot) ||
      !Number.isSafeInteger(property.collectionEndOffset) ||
      property.collectionEndOffset < 0
    ) {
      return { ok: false, error: "dynamic property descriptor or DataKey is invalid" };
    }
    if (!this.#objects.has(property.dataKey.objectIdentity)) {
      return { ok: false, error: "dynamic property references an unregistered object" };
    }
    if (!this.#properties.has(property.dataKey.classPropertyIdentity)) {
      return { ok: false, error: "dynamic property references an unregistered class property" };
    }
    this.#queue.push(
      Object.freeze({
        ...property,
        dataKey: Object.freeze({ ...property.dataKey }),
      }),
    );
    return { ok: true, value: undefined };
  }

  noteRetainedValue(dataKey: SurrogateDataKey): RegistryResult<void> {
    if (this.#phase !== "static-traversal") {
      return { ok: false, error: "retained values can only be noted during static traversal" };
    }
    if (
      !this.#objects.has(dataKey.objectIdentity) ||
      !this.#properties.has(dataKey.classPropertyIdentity) ||
      !Number.isSafeInteger(dataKey.sequenceIndex) ||
      dataKey.sequenceIndex < -1
    ) {
      return { ok: false, error: "retained value has an unknown or invalid DataKey" };
    }
    const key = dataKeyString(dataKey);
    this.#retainedCounts.set(key, (this.#retainedCounts.get(key) ?? 0) + 1);
    return { ok: true, value: undefined };
  }

  sealOuterStaticTraversal(
    outerObjectIdentity: string,
    outerStaticEndOffset: number,
  ): RegistryResult<void> {
    if (this.#phase !== "static-traversal") {
      return { ok: false, error: "outer static traversal is already sealed" };
    }
    if (!this.#objects.has(outerObjectIdentity)) {
      return { ok: false, error: "outer object identity is not registered" };
    }
    if (
      !Number.isSafeInteger(outerStaticEndOffset) ||
      outerStaticEndOffset < 0
    ) {
      return { ok: false, error: "outer static end offset is invalid" };
    }
    if (
      this.#queue.some(
        (property) => property.collectionEndOffset > outerStaticEndOffset,
      )
    ) {
      return {
        ok: false,
        error: "a dynamic property collection ends after the outer static boundary",
      };
    }
    this.#outerObjectIdentity = outerObjectIdentity;
    this.#outerStaticEndOffset = outerStaticEndOffset;
    this.#phase = "static-sealed";
    return { ok: true, value: undefined };
  }

  initializeReferences(): RegistryResult<void> {
    if (this.#phase !== "static-sealed") {
      return { ok: false, error: "references require a sealed outer static traversal" };
    }
    for (const object of this.#objects.values()) {
      if (
        object.parentIdentity != null &&
        !this.#objects.has(object.parentIdentity)
      ) {
        return {
          ok: false,
          error: `object ${object.identity} has an unresolved parent identity`,
        };
      }
    }
    for (const property of this.#queue) {
      if (
        !this.#objects.has(property.dataKey.objectIdentity) ||
        !this.#properties.has(property.dataKey.classPropertyIdentity)
      ) {
        return { ok: false, error: "dynamic queue contains an unresolved DataKey" };
      }
    }
    this.#phase = "references-initialized";
    return { ok: true, value: undefined };
  }

  certifySinglePropertyReplay(
    replayOffset: number,
  ): RegistryResult<DynamicQueueReplayCertificate> {
    if (this.#phase !== "references-initialized") {
      return { ok: false, error: "references must be initialized before replay" };
    }
    if (
      !Number.isSafeInteger(replayOffset) ||
      replayOffset !== this.#outerStaticEndOffset
    ) {
      return {
        ok: false,
        error: "replay offset must equal the sealed outer static boundary",
      };
    }
    if (this.#queue.length !== 1) {
      return {
        ok: false,
        error: "only a single globally queued dynamic property can be certified",
      };
    }
    let retainedValueCount = 0;
    for (const count of this.#retainedCounts.values()) retainedValueCount += count;
    if (retainedValueCount !== 0) {
      return {
        ok: false,
        error: "retained DynamicQueue values require unsupported merge semantics",
      };
    }
    const queued = this.#queue[0]!;
    if (queued.dataKey.sequenceIndex !== -1) {
      return {
        ok: false,
        error: "dynamic sequence replay is not yet supported",
      };
    }
    const object = this.#objects.get(queued.dataKey.objectIdentity)!;
    const classProperty = this.#properties.get(
      queued.dataKey.classPropertyIdentity,
    )!;
    const certificate = Object.freeze({
      [replayCertificateBrand]: true as const,
      collectionEndOffset: queued.collectionEndOffset,
      outerStaticEndOffset: this.#outerStaticEndOffset,
      replayOffset,
      objectIdentity: object.identity,
      objectSourceClassSlot: object.sourceClassSlot,
      classPropertyIdentity: classProperty.identity,
      declaringSourceClassSlot: classProperty.declaringSourceClassSlot,
      sequenceIndex: queued.dataKey.sequenceIndex,
      propertyToken: queued.propertyToken,
      propertySourceClassSlot: queued.propertySourceClassSlot,
      retainedValueCount: 0 as const,
      nextUnreadEntryIndex: 0 as const,
      queueLength: 1 as const,
    });
    issuedReplayCertificates.add(certificate);
    replayCertificateState.set(certificate, {
      replayOffset,
      consumedEndOffset: null,
    });
    this.#phase = "replay-certified";
    return { ok: true, value: certificate };
  }
}

export function isDynamicQueueReplayCertificate(
  value: unknown,
): value is DynamicQueueReplayCertificate {
  return (
    typeof value === "object" &&
    value != null &&
    issuedReplayCertificates.has(value) &&
    replayCertificateBrand in value &&
    value[replayCertificateBrand] === true
  );
}

/**
 * Advance one issued replay certificate across exactly one decoded payload.
 * Certificates are single-use so the same owner/property proof cannot be
 * attached to a second byte span.
 */
export function claimDynamicQueueReplaySpan(
  certificate: DynamicQueueReplayCertificate,
  startOffset: number,
  endOffset: number,
): RegistryResult<{ startOffset: number; endOffset: number }> {
  if (!isDynamicQueueReplayCertificate(certificate)) {
    return { ok: false, error: "replay certificate was not issued by this registry module" };
  }
  const state = replayCertificateState.get(certificate)!;
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset !== state.replayOffset ||
    endOffset <= startOffset
  ) {
    return {
      ok: false,
      error: "replay span must advance from the certified replay offset",
    };
  }
  if (state.consumedEndOffset != null) {
    return { ok: false, error: "replay certificate has already consumed a payload" };
  }
  state.consumedEndOffset = endOffset;
  return { ok: true, value: Object.freeze({ startOffset, endOffset }) };
}
