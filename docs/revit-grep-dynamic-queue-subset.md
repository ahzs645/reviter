# GRep DynamicQueue replay subset

This note records the smallest multi-property `OdBmDynamicQueue` path that can
be reproduced without guessing pair, retained-data, or nested-queue behavior.
It combines clean-room inspection of `TB_LoaderBase.tx` with the independently
framed UNBC GRep roots.

## Native queue node and order

`OdBmDynamicQueue::addProperty` at `0x17359a` copies one
`ValueDisposition` into a 72-byte queue node:

| Queue-node offset | Retained value |
| ---: | --- |
| `+0x10` | object identity |
| `+0x18` | class-property identity |
| `+0x20` | sequence index |
| `+0x28` | pair/alternate property state |
| `+0x38` | resolved scoped class |
| `+0x40` | property token |
| `+0x44`, `+0x45` | pair-orientation/state flags |

The node is hooked at the list tail at `0x173630`. `readPropertyToken` takes
the list front at `0x17541b`, supplies its resolved class to
`ObjectPtrInitReader` at context offset `+0x48`, calls the reader at
`0x175a54`, and unhooks the front node at `0x175600`–`0x175619`. Children
enqueued while that reader runs are therefore appended behind every queue
entry already present.

`readProperties` at `0x17604a` repeats until the queue list is empty. For an
ordinary non-pair property it joins consecutive values with the same object
and property identities, resolves their sequence, and assigns the completed
value. Pair properties branch through `readPairToken`, `dataLeft`, and
`mergeParts`; this subset rejects that branch.

## Tokens and stream advancement

After `ObjectPtrInitReader` returns, `readPropertyToken` handles the retained
integer token at `0x175b1b`:

- token `-1` does not alter the object-token vector;
- tokens `0` and `1` are rejected;
- a positive token equal to the current vector length appends the decoded
  value at `0x175cda`;
- a token beyond the current length grows the vector; and
- a token below the current length overwrites an existing entry.

Only the append case is implemented. It is the exact UNBC GRep shape: every
decoded root starts at token 3 and continues `3, 4, ...` with no gaps,
duplicates, zero/one tokens, negative tokens, overwrites, or reference reuse.

The complete GRep static reader contributes no `addData`, `StaticIntegerReader`,
or pair-reader call. Its initial `AllSubNodes` queue is therefore:

- one non-pair class property;
- stable GRep object identity;
- sequence indexes `0..childCount-1`;
- zero retained `DataKey` values; and
- FIFO child bodies beginning exactly at the complete GRep static end.

## Browser implementation

`certifyRevitGRepInitialQueue` re-decodes the independent frame and issues an
in-process plan only when every child token is the next append index. Each
entry carries the full surrogate `DataKey`, exact descriptor range, token,
and scoped source-class slot.

`replayRevitGRepInitialLeafQueue` implements the safe multi-property leaf
case:

1. consume entries in FIFO order;
2. pass the retained source class to the matching child reader without reading
   another selector;
3. require strictly forward, bounded stream movement;
4. reject a child reader that enqueues any nested property;
5. require all readers together to consume the exact dynamic-payload end; and
6. issue a single-use replay certificate only after complete consumption.

Missing readers, trailing bytes, sparse tokens, pair state, retained data,
nested properties, forged plans, and replay reuse all fail closed.

## Exact UNBC distribution

The exact audit is reproducible with:

```sh
node --experimental-strip-types scripts/audit-revit-grep-queue-replay.ts model.rvt
```

On the current workspace tree:

| Measure | Result |
| --- | ---: |
| Certified initial queue plans | 63,820 |
| One-entry plans | 41,506 |
| Multi-entry plans | 22,314 |
| Sequential append-token plans | 63,820 |
| Non-sequential, duplicate, zero/one, or negative tokens | 0 |
| Plans containing only 2026 leaf slots 2,215/2,248 | 30,667 |
| One-entry 2026-leaf-shaped plans | 30,572 |
| Multi-entry 2026-leaf-shaped plans | 95 |
| Complete exact-model leaf replays | 0 |

Dynamic payload sizes are:

| Queue shape | Minimum | Median | p90 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| One entry | 32 | 140 | 3,524 | 3,524 | 63,763 |
| Multiple entries | 92 | 6,007 | 15,926 | 35,240 | 64,162 |

The zero complete-replay result is intentional. `BasicFileInfo` identifies
the UNBC file as Revit 2027, while the supplied native reader modules stop at
Revit 2026. The common queue mechanics and the GRep static boundary validate
against the file, but a 2026 child class name or body length cannot authorize
consuming a 2027 child body. For example, the 30,572 one-entry slot-2,215
tails are consistently 140 bytes, but the available 2026 `GFlipControl`
contract does not explain that complete 2027 payload.

## Remaining transitions

General replay still requires:

1. release-verified Revit 2027 source-representation and child-reader tables;
2. queue appends from nested child readers while earlier siblings remain
   ahead in the FIFO;
3. `DataKey` retained-value lookup and `mergeParts`;
4. pair orientation and `readPairToken`;
5. token-vector overwrite/reference reuse;
6. sequence joining for nested collections; and
7. ID-reference resolution after dynamic reads.

The implemented leaf FIFO is useful infrastructure and a strict boundary, but
it does not claim geometry from the current model until those release-specific
child readers are proven.
