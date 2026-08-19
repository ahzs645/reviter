# Stream coverage and the embedded schema

Reviter reports what is inside a Revit file and how much of it is understood,
stream by stream, so the remaining gap is measurable instead of invisible. Every
CFB stream is listed whether or not anything is decoded from it, with its stored
size, chunk count, inflated size, and the decoder that claims it.

Each stream is graded by **depth** rather than weighed by bytes. Weighing by
bytes would be flattering and wrong: the partition stream is 69 MB of a 70 MB
file, so "claiming" it would read as 99% coverage while the decoders recover
element envelopes and category tokens from a payload that inflates to 417 MB.

## What the rules grade

Unlike almost everything else in this directory, this table is **not** a
measurement of one building. It is read straight out of `STREAM_RULES` in
[`lib/reviter/stream-coverage.ts`](../lib/reviter/stream-coverage.ts), so it is
checkable at any time by reading that file, and it changes only when a decoder
changes.

The rule table recognises 14 stream classes and grades them
**5 full, 5 partial, and 4 not decoded**:

| Stream | Depth | Decoder | What is read |
| --- | --- | --- | --- |
| `BasicFileInfo` | full | metadata | Revit release, build, locale, and document identity |
| `RevitPreview*` | full | thumbnail | embedded preview image |
| `ProjectInformation` | full | metadata | PKZip Atom metadata: project identity, design file, and property groups |
| `TransmissionData` | full | external-references | length-framed external-reference types, element identities, redacted filenames, path types, and saved/desired load states |
| `PartAtom` | full | metadata | family/type title, category, parameters, and taxonomies from PartAtom XML |
| `Partitions/*` | partial | element-records | element bounds records and `BuiltInCategory` tokens; element shapes, materials, and parameters are not decoded |
| `Global/ElemTable` | partial | element-index | native element-ID index and the persisted `OwningElementId` graph; pointer fields remain outside this decoder |
| `Global/History` | partial | element-index | episode GUIDs and history indexes, used with `Global/ElemTable` to reconstruct native Revit `UniqueId`s; the remaining edit history is not decoded |
| `Formats/Latest` | partial | schema | serializable class inventory with tags and base classes; field lists not walked |
| `Global/PartitionTable` | partial | partition-names | workset or family partition names |
| `Global/Latest` | none | — | document-level object graph; wire format not decoded |
| `Global/ContentDocuments` | none | — | structured content index on a different ID space |
| `Global/DocumentIncrementTable` | none | — | incremental save table |
| `Contents` | none | — | container contents record |

Anything the table does not match is reported as `Not recognised` at depth
`none` rather than omitted.

**A headline count is per file, not per rule.** `summariseCoverage` counts the
streams a given file actually carries, so the figure a report prints depends on
what is in the file. `PartAtom` is a family-file stream: a project file that
carries the other thirteen and nothing else grades **4 full, 5 partial, 4 not
decoded**. A file carrying several `Partitions/NN` streams counts each of them.

> **Correction, 2026-08-12.** The README carried "2 streams read fully, 4 read
> partially, and 8 not decoded at all" as a standing figure, and listed
> `ProjectInformation`, `TransmissionData` and `Global/History` as undecoded.
> All three now have decoders — the first two graded `full`, `Global/History`
> `partial` — so the old counts and those three rows were wrong at the time they
> were read, not merely stale in emphasis. The counts above are derived from the
> rule table rather than transcribed from a run.

## The largest unread payload was probed rather than assumed

`Global/ContentDocuments` is the largest fully-unread stream. Of the 38,223
element IDs recovered from the partition stream of the supplied 2027 project,
306 — 0.8% — appear anywhere in its 2.76 MB of inflated bytes, at any alignment.
That is chance, so the stream indexes something other than model elements. It
independently reproduces the same conclusion `rvt-rs` reached from the other
direction, against `ElemTable` rather than against recovered element records.

That paragraph *is* a measurement of one building, on one date: 2026-07-28.

## Embedded schema

`Formats/Latest` is Autodesk's own dictionary for the on-disk object graph —
roughly half a megabyte of class names, inheritance, and field declarations
shipped inside every Revit file. A class that is serializable at the top level is
written as:

```text
[u16 nameLen] [name] [u16 tag | 0x8000] [u16 pad]
[u16 parentLen] [parent name]
[u16 flag] [u32 version] [u32 declared field count]
```

The class's index is what identifies it in `Partitions/NN` records, and it drifts
between releases as Autodesk inserts classes into the ordering — in the local
corpus `ArcWall` moves `0x14e` → `0x1b7` → `0x1c2` across 2020, 2026, and 2027
while its parent stays `VWall`.

Those figures were each one too high until the word after a class name was
identified as the *parent's* type reference rather than the class's own index. A
class is registered before the parent it defines inline, so its index is one
below that word; `0x1c3` in the 2027 project is `VWall`, not `ArcWall`. `NN` is
unrelated — it is a save counter, not a type code, and is documented in
[the ODA note](oda-label-resource-tables.md#what-partitionsnnn-counts).

**The parent name is what makes the record trustworthy.** A name-and-tag pattern
alone also matches compressed noise: scanning for it loosely over the supplied
2027 project yields 232 candidates, of which 48 are mangled strings such as
`Cuuuuuuuaaaas` and `HostTrfCreatDr`, including one name carrying four different
tags. Requiring a well-formed parent-class name to begin exactly four bytes after
the class name removes every one of those and leaves 184 classes, each with its
base class — `ArcWall` → `VWall`, `HostObjAttr` → `Symbol`, `Cell` →
`CellInterface`, `GeomStep` → `GeomGenerator`.

The inventory used to be described as corroborated against an independent source:
across the Revit 2020, 2023, and 2026 family files it reproduces all 218
checkable class-to-tag pairs in the tag-drift dataset published by `rvt-rs`, with
no disagreements. It still does, and that is now a caution rather than a
comfort — `rvt-rs` reads the same word the same way, so the agreement was between
two readers of one field, not about what the field means. The check that settled
it came from the other direction: the class index carried by element records in
`Partitions/*`, which this repository had already measured as `0x08c6` for
`GElement` while the schema reader published `0x08c7`.

The field *list* is deliberately not walked. The declared count and schema
version are read because they sit at a fixed offset after the parent name, but
the field records that follow contain inline class definitions whose layout does
not close across the corpus. Several framings fit the observed bytes and each
leaves a variable unexplained remainder — measured over the 2026 family file, the
bytes following a zero-field class run 18, 33, 34, 40, 42, 54, 55, 82, and
longer. `rvt-rs` reports the same gap as field-count mismatches. A field graph
that is probably wrong would be worse than none, so the parser stops at what the
bytes prove.

`Global/PartitionTable` is also read, for its UTF-16 partition names. In a
project these are worksets; in a family the stream carries the family partition
path instead, so the decoder reports the names without asserting which kind they
are.

The class counts in this section are observations from runs on the local corpus
on 2026-07-28.
