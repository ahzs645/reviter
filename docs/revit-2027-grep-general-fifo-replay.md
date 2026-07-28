# Revit 2027 GRep general FIFO replay

`lib/reviter/revit-2027-grep-replay.ts` is the browser-safe dynamic-property
replay layer for independently framed Revit 2027 GRep roots. It generalizes the
earlier leaf-only boundary by allowing a decoded child to append more
properties to the same active FIFO.

It does not decode unknown classes, retained `DataKey` values, pair properties,
or token-vector overwrites. Those states fail closed.

## Certified built-in readers

Each call to `createRevit2027GRepReplayRegistry()` returns a new registry with
the existing release-certified readers:

| Source slot | Reader | Nested descriptors exposed |
| ---: | --- | --- |
| 1,423 | `GEdge` | none |
| 1,825 | `Face` | first loop, regions, fillings, then analytic surface |
| 1,973 | `GLine` | none |
| 2,215 | `GArray` | `instanceInfo` plus its retained null embedded-symbol descriptor |
| 2,248 | `GGroup` | `m_subNodes` in collection order |
| 2,276 | `GPolyLine` | none |
| 2,343 | `Geometry` | faces, then edges, then shared-surface info |

The registry is intentionally pluggable. A later independently certified Face,
Edge, loop, curve, or surface reader can be registered by its release-specific
source slot without changing the scheduler. An unregistered slot aborts the
whole replay without returning a partial success.

## FIFO and token rules

The replay starts with the GRep root's `AllSubNodes` descriptors. It removes
the queue front, invokes the scoped reader, and appends that reader's
conditional properties at the queue tail. Therefore every older sibling stays
ahead of every nested child found while reading an earlier sibling.

The token namespace is independent of FIFO insertion order:

- token `0` is a null descriptor; it is retained in the descriptor log but does
  not enter the queue;
- token `-1` is a real queued property; it enters and is consumed in FIFO order
  but does not modify the positive token namespace;
- a positive token must equal the exact next append index, beginning at `3`;
- every other negative token, sparse positive token, reuse, or overwrite is
  rejected.

The `-1` behavior is material for the exact model. `GArray.instanceInfo` uses
it, and the independently decoded Face population contains 148 such children.
Treating it as null would drop bodies; incrementing the positive namespace
would invalidate every later append token.

## Preserved replay evidence

Every conditional descriptor is retained with:

- framed GRep owner element id;
- stable numeric path through root/nested descriptor indexes;
- parent path and parent replay index;
- original token and scoped source-class slot;
- descriptor byte span;
- null or queued state;
- global FIFO insertion sequence.

Every decoded body span additionally retains:

- FIFO insertion sequence and actual dequeue/replay index;
- body start/end offsets;
- registered reader identity;
- decoded reader value.

The path records ownership while the insertion and replay indexes prove
scheduling. For a root with a first `GGroup`, a later root `GLine`, and then the
group's child, the paths are `[0]`, `[1]`, and `[0, 0]`, while replay order is
the same three entries in that order.

## Boundary checks

Replay succeeds only when:

- the root replay envelope is finite and inside the supplied bytes;
- root descriptors end before the dynamic payload;
- nested descriptors lie inside the body that appended them;
- null and queued descriptors have their exact four- and six-byte forms;
- every reader claims a strictly advancing body beginning at the current byte;
- no reader crosses the root replay end;
- queue and descriptor safety limits are respected; and
- emptying the FIFO lands exactly on the root replay end.

A missing reader, reader exception, invalid registration, token failure,
non-contiguous body span, overrun, or trailing boundary gap returns an error.
No scan-forward recovery or class/length inference is attempted.

## Focused proof

`tests/revit-2027-grep-replay.test.ts` uses synthetic bodies accepted by the
existing certified readers and proves:

1. older root siblings replay before nested `GGroup` children;
2. a `GArray` token `-1` child waits behind an older sibling without advancing
   the positive token count;
3. `Geometry` appends all faces before all edges;
4. unknown slots, token `-2`, and sparse positive tokens fail closed; and
5. boundary gaps, overruns, and non-contiguous plugin spans fail closed.

Run it with:

```sh
node --experimental-strip-types --test \
  tests/revit-2027-grep-replay.test.ts
```

These tests certify scheduling and boundaries, not complete UNBC coverage.
Exact-model coverage must be measured separately after more queued source slots
have certified body readers. In particular, the default registry will
deliberately stop at unresolved `GArray.instanceInfo`, Face
loop/filling/surface children, and other unknown nested classes.
