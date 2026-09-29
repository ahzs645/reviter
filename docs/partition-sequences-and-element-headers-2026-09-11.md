# Partition sequences and the element-header record: exact category ownership

Measured 2026-09-11 on the UNBC Revit 2027 project, the three Autodesk sample
models (Revit 2024 and 2025) of
[the release-drift entry](second-buildings-release-drift-2026-09-11.md), the
MIT-licensed `magnetar-io/revit-test-datasets` pair (`2024_Core_Interior.rvt`
with its Autodesk-exported IFC), and the Revit 2024/2025/2026 files a
third-party Revit-writing project ships as fixtures. That project's write-up of
the partition stream was read as a specification and every claim below was
re-measured on our own files; none of its code is used and it carries no
licence.

## The block header before every gzip member

Reviter's partition reader found gzip members by their signature and ignored
what sat between them. What sits there is a header:

```text
u16 tag          // a class index: 3708 in 2024, 3801 in 2025, 3939 in 2027 (3662 in 2023)
u32 flags        // 4 = whole records only; bit 1 = last record continues; bit 0 = first record is a continuation
u32 recordsStarting
u32 sizeHint     // 8 + the member's stored length
u32 bodyBytes    // record body bytes in this block
u32 sequence     // 101, 102 or 103
u32 0
<gzip member>
u16 tag'         // 3701 in 2024
u32 sizeHint     // repeated
```

`readPartitionBlockHeader` in `revit-container.ts` reads it. Every member of
every file measured is headed this way: 4,604 on Snowdon, 1,000 on the
Technical School, 3,666 on UNBC, 15 on the tekton 2024 fixture, 33 on the 2023
Einhoven file. The three sequences interleave through the stream:

| File | 101 element headers | 102 element objects | 103 drawable representations |
| --- | ---: | ---: | ---: |
| Snowdon 2024 | 697 | 2,213 | 1,694 |
| Technical School 2025 | 155 | 467 | 378 |
| UNBC 2027 | 278 | 1,386 | 2,002 |

Sequence 101 blocks always carry `flags = 4`; sequences 102 and 103 also carry
5, 6 and 7, so records there span blocks and would need a per-sequence tail to
walk. Nothing here walks them yet — the existing decoders keep reading every
inflated page as before — but the sequence id is now known per page, which is
what a sequence-103 drawable index would start from.

## The element-header record

Sequence 101 inflates to a run of fixed-framed records, one per element:

```text
i64 elementId      // all ones for a null record with an empty body
u32 bodyBytes
u16 classIndex     // ElementHeader in the file's own schema, resolved like every marker
u16 entryCount     // the 22-byte reference entries that open the body
```

A whole-records block inflates to exactly `16 × recordsStarting + bodyBytes`
bytes — 697 of 697 blocks on Snowdon, 155 of 155 on the Technical School,
278 of 278 on UNBC — and the walk (`walkElementHeaderBlock` in
`element-headers.ts`) stays aligned to the last byte of the concatenated
sequence on all three: 257,890, 59,707 and 112,893 records, every one of them
`ElementHeader`. The class word is sixteen bits; read as thirty-two it carries
`entryCount` in its high half and looks like garbage.

The body opens with `entryCount` reference entries and then names the
element's `BuiltInCategory` as a negative `i64` followed by `ff ff ff ff`,
behind a field tag that varies — `04 00 [u32]` for most, `fe 04 6f 06 00 00`
before the `Walls` value at body offset 2,312 of Snowdon wall 619340, whose
105 entries push it there. A null category is written as all ones and found as
nothing. So the category is read as the first BuiltInCategory value inside the
record's own body, and its owner is the record's id. That is the exact
ownership the token scan could only approximate with the nearest preceding id.

Agreement with the token-derived labels the converter used until now:

| File | Header records | With a category | Audit-labelled elements | Same | Differ | Header only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| UNBC 2027 | 112,893 | 52,730 | 39,165 | 38,718 | 70 | 29,323 |
| Technical School 2025 | 59,707 | 22,787 | 5,537 | 5,537 | 0 | 17,250 |
| Snowdon 2024 | 257,890 | 67,807 | 4,275 | 1,423 | 4 | 66,380 |

Every disagreement is a donated token: on UNBC, 22 railing rail-path drawing
aids the token called `Railing Rail Path Extension Lines` are `C Lines`, 34
stair drawing aids called `Stair Paths` are `Stairs`, and ten records the
record-code consensus had filed under `Top Rails` are `Multistory Stairs`. On
Snowdon the 45 walls the Autodesk viewer draws that the token scan had
labelled `Sun Path` — the defect the release-drift entry left open — are
`Walls` in their own headers.

## What changed in the converter

`convert-partition-scan.ts` reads the block header of every member; for a
whole-records sequence-101 block it walks the records and keeps each element's
category. `applyNativeCategories` takes that map ahead of the tokens: a header
category is `element-header` evidence, tokens label only elements the header
sequence did not reach, the consensus learns from the merged map, and the
donated-token override no longer applies to a header label. The audit reports
`headerElements` and `headerRecords`; the warning line names all three sources.

Measured after the change:

| File | Categorised | From header | From token | Inherited | Effect |
| --- | ---: | ---: | ---: | ---: | --- |
| UNBC 2027 | 40,317 | 39,892 | 189 | 236 | was 39,159 (15,632 token / 23,527 inherited); verify-pair 21 of 21; GLB recovered-only 159 → 64 voxels, reference-only 223 unchanged |
| Snowdon 2024 | 11,108 | 10,326 | 54 | 728 | drawn walls displayed 1,016 → 1,061 of 1,061; reference coverage 98.5% → 99.7% |
| Technical School 2025 | 5,547 | 5,547 | 0 | 0 | unchanged coverage |
| RAC 2025 | 649 | 520 | 1 | 128 | unchanged |
| 2024 Core Interior (MIT pair) | 13,652 | 13,641 | 2 | 9 | verify-pair: 834 of 834 building elements drawn, walls/columns/doors 100% centre and size agreement |

One consequence had to be handled: the ten UNBC `Multistory Stairs` records,
correctly labelled at last, escaped the `Top Rails` hold-back and drew their
placed shape over the stairs beneath them (597 recovered-only voxels). The
paired export tags a product with none of the ten ids, so they are excluded
ahead of every route in `convert-display-scene.ts` on the same evidence as the
baluster-set rule.

## The wider corpus

- **`magnetar-io/revit-test-datasets`** (MIT): the binaries are Git LFS
  pointers in the archive and were fetched from GitHub's media endpoint.
  `2024_Core_Interior.rvt` (33.7 MB, Revit 2024) with its IFC is the second
  RVT/IFC pair `verify-pair.ts` has ever run on: 7 assertions pass, 4 fail —
  88 records past the export's hull (three uncategorised records 317 ft out,
  then facade members up to 29 ft, on an export the repository calls "slim"),
  and the two "fires at least once" assertions that were fitted to UNBC
  features this building does not have. `Revit_IFC5_Einhoven.rvt` is Revit
  2023 with eight partitions; its header walk misaligns at once, so 2023
  framing differs and stays outside what is claimed.
- **tekton fixtures**: the TEST-KIT Revit 2026 files convert with all 67
  classes resolved, bounds, header categories and native meshes — the first
  2026 files Reviter has read. Its self-authored `G_ABPD` files walk cleanly
  (555 categorised headers in the 2024 one) but carry no bounds records for the
  converter to draw.

## Next, in order

1. Index sequences 102 and 103 by element id with a per-sequence tail, and
   read the drawable `GElement` graph from 103 by ownership instead of by
   page-wide framing; that is where site surfaces (`GPolyMesh`) live.
2. Appearance-backed materials through `Material.m_appearanceAssetId`.
3. A reader for `GImposter`, logged by runtime class before anything is
   assumed about it.
4. Revit 2023 framing, once a real 2023 project is available.
