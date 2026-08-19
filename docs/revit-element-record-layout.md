# How an element record is laid out

Revit frames each element object with a length and an echo, and
[`element-objects.ts`](../lib/reviter/element-objects.ts) has walked that
framing for a long time. What the bytes *inside* the frame were is a separate
question, and the answer is that the file's own schema already says.

This note records the layout, because three decoders now depend on it and
because most of it was previously described as padding, magic signatures, or
offsets that had to be guessed.

## The frame

```text
S+0            u64 element id
S+8            u32 discriminator
S+12           u32 objectLength
S+16           u16 class index          // the class in Formats/Latest
S+18 .. S+objectLength+16               // body
S+objectLength+16   u32 objectLength    // echoed
S+objectLength+20   next object
```

The body runs to `objectLength + 16`, with nothing spare. The sixteen bytes
before the echo were documented as "release-specific late payload / padding";
they are ordinary fields. Records that defer no sub-objects end exactly there,
which settles it without needing to know what the deferred region holds.

`S+16` is the class's index in the file's own `Formats/Latest`, which
[`schema-reader.ts`](../lib/reviter/schema-reader.ts) reads. `0x08c6` is
`GElement` in the supplied 2027 project.

## The fields

An object writes its class's fields, ancestors first, in declaration order. The
schema gives the list and each field's type, loading mode and item mode:

| Form | Bytes |
| --- | --- |
| `bool`, `int8` | 1 |
| `int16` | 2 |
| `int32`, `float` | 4 |
| `double`, `int64` | 8 |
| GUID | 16 |
| string | `[i32 charCount]` then that many UTF-16LE units |
| collection (`itemMode` 5) | `[i32 count]` then that many items |
| fixed array (`itemMode` 1) | exactly `size` items, no prefix |
| object, `loadingMode` 0 | the declared class's fields, inline |
| object, `loadingMode` 1, 2 or 4 | `[i32 handle]`, then `[u16 class]` when the handle is non-zero |
| object, `loadingMode` 3 | `[i32 handle]` only |

A field whose flags word has bit `0x02` set is transient and is not written at
all.

**A pointer is four bytes when null and six when live**, which is why a field's
offset is a property of the record rather than a constant. `Element` declares
seven pointers and a counted collection before `m_assocLevelId`, so that field
lands anywhere in `+62`…`+76`; it used to be read by trying five offsets, which
missed `+62` entirely — one in four of the model's element objects.

## The deferred objects

A live pointer does not write its target inline. It appends the target to a
single FIFO queue for the record, and once the owner's own fields are written
the queue is drained from the front, each object's fields laid down contiguously
**with no header of any kind** — the class is already in the pointer. An object
taken from the queue appends its own targets to the back, so the order is
breadth-first.

This was measured over the whole partition set of the supplied project: the
layout consumes exactly `objectLength` for **175,785 of 175,785** chain-linked
records, across **280 of 280** classes. Discipline matters and the alternatives
are not close — depth-first scores 9.1% and last-in-first-out 0.3%.

## What this explains

Three things in the decoders stop being magic.

**The parameter anchor.** `ff ff ff ff 10 03 01 00 00 00` followed by the
element id is not a signature. It is `m_cellList` as a pointer whose class is
`CellList` (`0x0310`), then `m_docAccess.m_pDoc` as a four-byte stub, then
`m_id`. The element id is behind it because that is the next field.

**The field slots.** Every `ff ff ff ff` followed by a `u16` is a pointer, and
the `u16` names a class: `0x0c93` is `ParamValueSetDouble`, `0x116f` is
`VWallDriver`, `0x1104` is `TaperableWallTypeWidthAtParametersCell`, `0x11ab`
is `VerticalRegionsStructure`.

**The value sets.** `Element`'s first four fields are four parameter tables —
doubles, integers, strings and element ids. Being fields 0 to 3, they are the
first things in the deferred queue, so an element's parameters are written
immediately after its own fields, contiguous and in that order. That is the
ownership test [`element-parameters.ts`](../lib/reviter/element-parameters.ts)
uses, and it is what a forward search for anything that parses cannot do:
searching gave 2,007 elements a neighbour's table, whose values are real and
therefore undetectable from their contents.

## What is not established

The transient bit is empirical. The reference reader reads that word and discards
it, so this build would mis-decode a 2027 `GeomTable`; the bit is absent from
the 2014 and family-file schemas. Masking `0x02` scores 100% against 1.7% for
any other bit, which is as strong as an ablation gets, but the mechanism is
inferred rather than read.

Field type `0x0a` never occurs in the corpus, so its width is unknown. Flag bits
`0x10` and `0x20` always accompany `0x02` and mean nothing determined. And the
family file available here frames its partitions differently, so none of the
above is cross-validated on a second model.
