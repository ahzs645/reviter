# Element object framing, the other markers, and the chunks that would not inflate

> **These are observations from dated runs on one building**, the supplied
> 67 MB Revit 2027 project, not standing facts about Reviter. Each figure was
> measured once, on the model and the code as they stood on the date given, and
> nothing re-derives them: there is no model file in this repository, so no test
> and no CI job recomputes any number below. Read them as a record of what was
> seen and why a rule was written the way it was. Recorded 2026-07-28; moved out of
> the README on 2026-08-12.
>
> These entries were one continuous document until that date, so a
> cross-reference to something "above" or "below" — or to "this file" — means
> somewhere in the audit record, which is now this directory. Pointers that
> landed in a *different* entry have been turned into links; the rest still read
> correctly within the entry they are in.

Elements in `Partitions/*` are length-delimited with the length written *behind*
the object. This entry is the decode of that framing, the discovery that
`0x08c6` is not the only object class in the stream, the placement that was
sitting in the objects all along, and the DEFLATE chunks that needed the
previous chunk's output as a preset dictionary.

## Element objects

Elements in `Partitions/*` are length-delimited, and the length is written **behind** the object rather than in front of it:

```text
S+0            u64 element id
S+8            u32 near-unique discriminator (not decoded)
S+12           u32 objLen          // object length, counted from S
S+16           u16 marker          // constant per release: 0x08c6 in the 2027 project
S+18           u64 type code       // element class discriminator
S+26           u64 element id, repeated
...            payload, including the duplicated-bounds sub-record
S+objLen+16    u32 objLen          // echoed
S+objLen+20    next object
```

The echo is what makes the chain safe to walk. It holds for **99.5%** of known records, while probing the echo at `+12` or `+20` instead of `+16`, or testing for `objLen ± 4`, all score **0%**, and shifting the whole probe a megabyte away scores 0.06%. Reading the length as a *header* instead scores only 61.7%, and its failures arrive in symmetric pairs — the signature of reading the previous object's length — so the trailer reading is the correct one.

Chaining forward and backward from records the bounds scanner already found recovers **47,265 objects against 35,677 bounds records**, because an object with no bounds record is still linked into the chain. Element identity coverage against the paired IFC export rises from **65.9% to 77.1%**.

The `u64` at `S+18` is an element class discriminator, and it is sharp: joined against the IFC export its modal purity is **94.58%**, with `116`→`IfcMember`, `114`→`IfcPlate`, `79`→`IfcColumn`, `101`→`IfcRailing`, `54`→`IfcSlab`, `62`→`IfcCovering` all at 1.000, and the one impure code (`30`) impure only in which *kind* of wall it is.

One entry in that table was wrong and is corrected here: `44` was read as `IfcOpeningElement` at purity 1.000, and **`44` is the door class**. The 1.000 was an artefact of the tag aliasing described under openings below — of the 1,480 code-44 records, **1,345 join both an `IfcDoor` and an `IfcOpeningElement`, 88 join a door only, and 0 join an opening only**. A code that never once joins an opening without also joining a door is not the opening's code.

The marker drifts by release exactly as schema tags do — `0x086d` in 2024, `0x08a4` in 2025, `0x08cc` in 2026, `0x08c6` in the 2027 project — so it is measured from the file rather than hard-coded. Releases 2020 and 2023 produce no chains; older releases frame objects differently.

Two limits are worth stating. Chaining runs per inflated page, so the ~0.05% of objects that straddle a page boundary are missed — that is the gap between the 47,265 recovered here and the 49,660 reachable when the whole stream is concatenated in memory, which a browser tab should not do for a 417 MB payload. And the marker was not resolvable through `Formats/Latest`: the scanner that read that stream recovered roughly 200 classes and referenced the rest by tag, so `0x08c6` looked like a tag in a registry the file never names.

That is no longer true, and it was the whole justification for hard-coding a marker. `Formats/Latest` has a grammar; read with it the 2027 project declares 4,757 classes rather than 416, and `0x08c6` is `GElement`. Every class index this repository measured from records resolves the same way — see [`schema-reader.ts`](../lib/reviter/schema-reader.ts) and `scripts/audit-schema-constants.ts`, which resolves all 57 of them against a model's own schema.

## The elements that were nowhere are objects of another class

5,449 elements the export names appeared in no pass at all. They are in the file: searching 385 MB of inflated pages for their ids finds **98.8% of them**, a median of ten times each, against 100% for a control of ids that are recovered. So they were written; they were just not being read.

Sixteen bytes past those ids — where an object keeps its marker — sits `0x07ef`, and the rest of the object framing holds there: the length is in range and the trailer echoes it. `0x08c6` is not the only object class in the stream, and it was the only one anything looked for. Scanning a page for the framing itself rather than for one marker turns up **51,455 objects under `0x08c6` and 27,078 under `0x07ef`**, plus a tail of smaller classes, and `0x07ef` alone heads the objects of 4,312 of the missing elements.

The markers are now measured from the file — a sample of twelve pages, keeping any marker that heads at least 24 verified objects — rather than listed in the source, which also survives the tag drift between releases. Elements the scan can account for rise sharply:

| | seen before | seen now | in the export |
| --- | --- | --- | --- |
| `IfcMember` | 16,342 | **19,213** | 19,707 |
| `IfcPlate` | 5,085 | **6,074** | 6,235 |
| `IfcDoor` | 1,405 | **1,827** | 1,912 |
| `IfcColumn` | 256 | **300** | 311 |
| `IfcWindow` | 5 | **20** | 20 |
| `IfcRamp` | 5 | **12** | 12 |
| `IfcRoof` | 18 | **20** | 20 |

Every ramp and every window in the building is now accounted for. The conversion also got faster, 57s to **40s**, because more seeds mean each chain walk is shorter.

**What this does not do is draw them.** A `0x07ef` object carries no bounds sub-record, no instance placement, and — tested directly — no world extent anywhere in its payload. Searching every offset of 24,620 of them for six f64 reproducing the element's exported bounding box returns **nothing at all**, and the same search against a deliberately mismatched target also returns nothing, so the search was sharp rather than merely unlucky. Reading three f64 as a centre finds a best offset with 5 hits out of 24,620, which is noise.

These elements are therefore *known* rather than *drawn*, and the coverage table now says so honestly: the gap between `seen` and `recovered` is the real remaining decoder work, and it is no longer hidden inside a gap between `in IFC` and `seen`. Their geometry lives in the family-document blobs the type-name decoder already cannot reach.

**Stair flights are drawn from the wrong source after all — see [Native faces were outranking the element itself](unbc-stair-and-railing-geometry-2026-07-28.md#native-faces-were-outranking-the-element-itself).** This paragraph originally recorded the opposite: that preferring the element's envelope over its single face measured *worse*, 7.95 ft against 5.413, so no change was made. That comparison used a truth map keeping one export box per Revit id, and an element the exporter splits into several products was therefore compared against a piece of itself. Re-measured with those boxes unioned, the envelope wins for 168 of the 225 elements that own faces, and faces are no longer drawn.

**This was where the wall gap was wrongly written off.** An earlier reading of this section concluded that the 748 walls proven real and yielding no geometry needed a new record type decoded, on the evidence that 745 of them owned zero decoded surface patches. Surface patches were the wrong place to look: those walls had a duplicated-bounds record the whole time, and the copy check above was rejecting it. After that fix, only **14 walls are seen without being recovered**, not 748. The paragraph is kept rather than deleted because the mistake is instructive — an absence measured through one decoder is not an absence in the file.

The record-code consensus floor was also widened, so that a cluster too small to reach the old flat support floor of 8 can qualify by being near-unanimous instead — a building holds a dozen ramps and their cluster could never reach 8 no matter how consistent the evidence was. On this model it changes almost nothing: the small categories are limited by not being seen, not by failing to reach consensus. It is kept because the bias it removes is real and the tail categories are the ones a widened floor exists for, but it is recorded here as having produced no measurable gain.

## The missing elements were never in a family document

The largest remaining gap — 3,708 curtain-wall mullions, 1,262 panels, 513 doors, all *seen* and never recovered — was attributed in the README to family definitions the decoder could not reach. **That was wrong, and the section that said so is replaced by this one.**

**`revit.local.family:<40 hex>-1.0.0` is not a document reference. It is a parameter id.** Dumping a carrier object whole shows the string sitting in the middle of a three-part identifier triple:

```text
autodesk.parameter.group:dimensions-1.0.0
revit.local.family:bcd13b0166914fd3ba97077a6c6280ae00000665-1.0.0
autodesk.spec.aec:length-1.0.0
```

Parameter group, identifier, data type. It is the ForgeTypeId namespace Revit gives a **family-local parameter**, and there are 546 occurrences of 502 distinct ones — not the 193 "documents" a sampled count suggested. The 20-byte binary form of those digests appears **0 times** in all 384.5 MB of inflated pages. Nothing points at a definition blob because nothing is being pointed at.

**What a recovered mullion has that a missing one does not is a second object, and the placement is in the first one anyway.** Same page, same family, byte for byte:

| | objects |
| --- | --- |
| recovered mullion 300149 | `0x07ef` len 567 **+** `0x08c6` len 300 |
| missing mullion 303358 | `0x07ef` len 567 only |

which holds for 3,140 of 3,223 missing members, 1,086 of 1,101 plates, 426 of 428 doors and 36 of 36 columns. But the two `0x07ef` objects differ in exactly one region, `+418` to `+517`, and that region is a rigid placement:

```text
+418   9 x f64   orthonormal basis — identity for 300149, a 45° rotation for 303358
+490   3 x f64   world origin in feet
+514   u64       element id of the shared geometry object
```

The same three fields, in the same order, as the 300-byte instance object the library has read since the placed-instance work. `readInstancePlacement` returned early on `objectLength !== 300`, so it had never been read.

**Reading it closes most of the gap:**

| | before | after |
| --- | --- | --- |
| building elements drawn | 30,628 · 80.1% | **34,457 · 90.1%** |
| `IfcMember` drawn | 15,912 | **18,658** |
| `IfcPlate` drawn | 4,972 | **5,917** |
| `IfcMember` centre within 0.5 ft | 98.8% | **99.0%** |
| elements placed from an instance alone | 3 | **3,901** |

Accuracy went *up* while 2,746 mullions and 948 panels were added: the newly placed elements land within **0.25 ft for 100.0% of members and plates, median error 0.0001 ft**, and the residual is truth-side — the export's box comes from tessellated triangles.

**The controls are what make it safe to believe.** On the 19,584 elements that carry *both* objects the rule finds exactly one transform per object, and its origin agrees with the instance object's for 19,582 of them; the geometry reference agrees for 21,637 of 21,637. Shuffling the target scores 0.1% within 0.25 ft against 100%, shuffling the origin 0.1%, shuffling the geometry reference 6.3%, and transposing the basis 62.8% — that last failing only on the non-90° curtain walls, which is exactly where the columns-are-axes convention is the one that matters. The composite rule fires on 0.0% of seven other object classes, while an orthonormal basis *alone* fires on 99.7% of one of them: the live geometry reference behind the basis is what makes it specific, not the basis.

The basis offset is not fixed — `+418` for 22,511 objects, `+412` for 2,323, `+414` for 1,442 — so it is found by orthonormality in a 25-byte window rather than indexed. A shared geometry object is excluded before the search runs, by the bounds sub-record it carries and a placement object does not; without that test a shape whose tail happened to hold an orthonormal basis would be taken for an instance and lose its own box.

**What is still missing, and it is now a small list.** 716 references resolve to an object under marker `0x10dc`, `0x10de` or `0x0810` that carries no bounds sub-record at all — 383 members, 157 doors, 135 plates — a different shape class, probably a real solid rather than a box. A further 1,078 elements have no object in the stream at all. And **doors gain nothing in accuracy** from this: the 138 newly placed ones carry the same 2.9 ft leaf error as every other door, because the record is the opening.

One negative result, recorded so it is not retried. **Object coverage of the stream is 67%, and the uncovered remainder is not geometry** — full-offset seeding raises objects from 140,812 to 154,431 and newly placed export elements only from 3,929 to 3,966, so the gain does not depend on changing the seeding.

An earlier version of this section claimed the opposite of what follows, and was wrong twice over: that all 328 inflation failures were 40-byte per-chunk descriptors, and that an apparent 7.3 MB of unclaimed bytes was node `zlib` failing where `fflate` succeeds. Both are corrected below — the bytes are real payload, and it is node `zlib` *with a dictionary* that reads them.

### Chunks that reference the chunk before them

7.24 MB of `Partitions/325` never inflated: 332 of its 3,666 chunks, none of them inside a successful chunk's span, so they were payload nothing read. They fail with `invalid distance too far back` — the body reaches for bytes behind its own start.

That is a DEFLATE stream written against a window the previous chunk left behind. Supplying the preceding chunk's output tail as a **preset dictionary** reads them: 273 of the 332 failures inflate, 5.76 MB stored becoming 32.4 MB, and the partition's payload goes from 384.1 MB to 416.5 MB. `fflate` has supported `dictionary` since 0.8.0, so this needs no new dependency and works unchanged in the browser; the read is stateless when no window is passed, which is what the strided marker sample wants.

The recovered bytes are real geometry, not noise that happens to decode. 29 of 35 newly found bounds blocks land within 0.5 ft of the same element in the export, against **0 of 35 for a null pairing**, and on the paired model the continuation read moves coverage from 91.6% to **91.8%** (35,009 → 35,103 elements) with every per-type agreement figure holding or improving: doors 88.3% → 89.0% centre, stair flights 84.8% → 86.1%, columns 266 → 274 at 100.0%. Elements with no object anywhere in the stream fall from 1,005 to 920.

### The chunks that desync partway, and what they were hiding

The remaining chunks fail differently — `invalid block type`, `invalid length/literal`, `unexpected EOF` — with or without the window. Four explanations were separated and three ruled out.

**They are not false gzip signatures.** All 63 (node `zlib`'s count; the shipped `fflate` read tolerates four of them) carry a *byte-identical* canonical header, `1f 8b 08 00 00000000 00 0b`, and all 63 open with a well-formed dynamic-Huffman block — BFINAL=0, BTYPE=2, **63 of 63**, where random bytes would spread the block type over four values. The header validation is not letting them through by luck.

**Not another codec, and not stored data.** They decode as ordinary DEFLATE for 16 KiB to 115 KiB of the ~128 KiB a chunk holds, and the decoded bytes are Revit payload: `c6 08` object markers, `ff ff ff ff` field terminators, and duplicated-bounds records the export corroborates.

**Not a different dictionary.** Sweeping the previous 64 chunk tails, and a correct rolling 32 KiB window over the concatenated prior output, makes only **7 of 63** decode without erroring — exactly the 7 whose predecessor emitted under 32 KiB. Their content is *not* corroborated: 2 of 12 export-named records within 0.5 ft, median 0.930 ft, against 168 of 181 for the salvage read below. A preset dictionary makes any out-of-range distance legal, so a wrong one decodes cleanly while copying the wrong bytes — which is exactly why the check has to be against the export and not against whether it threw. Recorded and not shipped.

**Not truncation or an inserted structure.** Each chunk is followed by a 40-byte descriptor (constant `0x0f630000`, whose field[1] is the chunk's inflated length, exact for 2,533 of 3,507), and that descriptor never appears inside a failing chunk's body — 0 of 63, against 0 of 400 for a control. The desync lands at input offsets 2,102–65,111 with no alignment and no marker.

So it is a **genuine mid-stream discontinuity inside an otherwise valid DEFLATE stream, and its cause is still not identified.** The error sequence is consistent with a length or distance code this decoder reads differently — Deflate64's symbol 285 and distance codes 30 and 31 — but that is a candidate, not a proof, and testing it needs a Deflate64 decoder.

**The prefix in front of the desync is ordinary payload, and throwing it away was costing elements.** `inflateSync` raises before returning anything, so a chunk that desyncs partway lost everything it had already decoded correctly; a streaming read keeps it. That recovers 2.69 MB of the ~8.3 MB those chunks hold, and it is verified rather than assumed: the prefixes carry **213 duplicated-bounds records no other read reaches, the export names 181, and 168 land within 0.5 ft of the export's own box against 0 for a null pairing**, median error 0.000 ft.

| | before | after |
| --- | --- | --- |
| building elements drawn | 35,261 · 92.6% | **35,338 · 92.8%** |
| records recovered | 38,960 | **39,042** |
| `IfcMember` drawn | 19,063 · 97.0% | **19,120 · 97.3%** |
| `IfcPlate` / `IfcColumn` | 6,058 / 275 | **6,068 / 277** |

Accuracy is unmoved — members 99.1%, plates 99.9%, columns 100.0%, walls 98.9% — and neither tripwire shifts. A salvaged prefix is deliberately **not** allowed to seed the next chunk's window, because it is short of that chunk's true trailing 32 KiB.

**And it settles a question the census left open.** The `seen` column is identical in every class before and after: 911 building elements are never seen either way. The salvaged payload gives geometry to elements that were *already known* and adds no new element. On the third of these chunks that can now be read, the never-seen population is not there — strong evidence rather than proof, since the ~5.6 MB past each desync point is still unreadable.

## Three things that turned out not to be the problem

Each of these was a plausible cause with a cheap test, and the test said no. They are recorded so they are not tried again.

**Page seams do not hide the missing elements.** Chaining and record detection run per inflated page, so an object spanning two pages should be invisible to both. Objects are under 64 KB, so joining each page's tail to the next page's head contains every straddler. Scanning those seams across the whole stream finds **1 extra object and 0 extra bounds records**. The 3,439 elements the export knows about and no pass sees are not there to be found.

**Chain breaks were real but minor.** Chaining walks until an object fails to verify, and about one record in two hundred does, so a chain grown from a few seeds loses everything downstream of its first break. Seeding from every validated object marker rather than only from bounds records makes a break local instead of terminal, and takes recovered objects from 48,488 to **51,457**. It moves `seen` a little — walls 7,151 → 7,173, railings 157 → 174, openings 2,458 → 2,501 — and `drawn` almost not at all.
