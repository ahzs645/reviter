# Independent-reader verification of the UNBC export — 2026-08-19

The first building-scale run of `scripts/audit-ifc-export-independent.ts`. It
converts the supplied Revit 2027 project, exports IFC4, reads that file back
with an implementation that shares no code with `web-ifc`, and checks every
product against [`tests/fixtures/reviter-recovery.ids`](../tests/fixtures/reviter-recovery.ids).

This is an observation from one run on one model on one day. The model is not in
this repository and nothing here recomputes.

## The pair is the documented one

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `unbc.rvt` | 70,336,512 | `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178` |
| `unbc.ifc` (Autodesk) | 83,798,926 | `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0` |

The IFC hash is the one recorded in
[the geometry-gap inventory](revit-2027-ifc-geometry-gap.md), so this is the
same paired export the dated audits were written against rather than a
re-export of the same building. The figures below are therefore comparable with
the earlier entries; where they differ, the decoder changed, not the file.

**This is not a second building.** It is *the* building every threshold in this
repository was fitted on. The run proves the harness works at building scale and
turns several frozen observations back into computed ones. It says nothing about
whether any rule generalises — that still needs a file nobody here has seen.

## What the independent reader found

```sh
node --experimental-strip-types scripts/audit-ifc-export-independent.ts \
  unbc.rvt --out reviter-recovered.ifc --json independent.json
```

Exit 0.

| Measure | Value |
| --- | ---: |
| Exported IFC | 156,668,898 B |
| Schema | IFC4 |
| STEP entities | 820,041 |
| Products (non-spatial, non-feature) | 38,978 |
| …with geometry | 38,978 (100%) |
| …carrying `Reviter_Recovery` | 38,978 (100%) |
| …declaring `GeometryExact` true | 32,851 (84.3%) |

**Every product that reached the file carries its recovery evidence.** That is
the property the whole export exists to preserve, it had never been measured at
building scale by anything but the exporter itself, and it is now checked by a
reader with no stake in the answer.

By IFC class:

| Class | Products | | Class | Products |
| --- | ---: | --- | --- | ---: |
| `IfcMember` | 20,037 | | `IfcRailing` | 215 |
| `IfcWall` | 9,364 | | `IfcStairFlight` | 108 |
| `IfcPlate` | 6,246 | | `IfcSlab` | 94 |
| `IfcDoor` | 1,921 | | `IfcCovering` | 46 |
| `IfcBuildingElementProxy` | 571 | | `IfcRamp` | 23 |
| `IfcColumn` | 312 | | `IfcWindow` | 22 |
| | | | `IfcRoof` | 19 |

## Geometry provenance, recomputed

| Provenance | Products | Share |
| --- | ---: | ---: |
| `native` | 32,851 | 84.3% |
| `reconstructed` | 3,328 | 8.5% |
| `bounds-fallback` | 2,797 | 7.2% |
| `boundary-clipped-proxy` | 2 | 0.005% |

**2,797 products reach the IFC as an axis-aligned envelope rather than a body.**
They are labelled as such and an IDS check can find them, which is the whole
point of writing the provenance down — but 7.2% of the delivered model is a box
where the building has a shape, and no amount of downstream tooling recovers
that.

## Category evidence, recomputed

| Evidence | Products | Share |
| --- | ---: | ---: |
| `record-code-consensus` | 23,440 | 60.1% |
| `native-token` | 15,360 | 39.4% |
| `native-object` | 152 | 0.4% |
| `unknown` | 26 | 0.07% |

This confirms the README's headline exposure on the current decoder rather than
on the 2026-07-28 snapshot: **60.1% of categorised products still inherit their
category from a record-code consensus instead of reading their own token.** The
earlier figure was 23,462 of 39,159 — 59.9% — so the ratio has not moved.

That number is the reason the editing work is sequenced the way
[the editing review](ifc-lite-interface-and-editing-2026-08-19.md) sequences it.
Three in five categories in the delivered file are an inference. An override UI
built before that inference is scored per element would be letting users correct
a field whose error rate nobody has measured — and the paired IFC cannot score
it directly, because IFC product type is a lossy projection of a Revit category.

The 26 `unknown` rows are the small honest tail: elements the decoder could
neither read nor infer a category for, which say so rather than guessing.

## The IDS gate at building scale

| Specification | Applicable | Passed | Rate |
| --- | ---: | ---: | ---: |
| Walls carry Revit identity | 9,364 | 9,364 | 100% |
| Walls state whether the body is exact | 9,364 | 9,364 | 100% |
| Walls name the evidence behind their category | 9,364 | 9,364 | 100% |
| Doors carry Revit identity | 1,921 | 1,921 | 100% |
| Doors state whether the body is exact | 1,921 | 1,921 | 100% |

Every specification matched thousands of entities rather than passing vacuously,
which is the failure mode the script and the unit test both fail on explicitly.

## What this run does not establish

- **Nothing about a second building.** Same model, same thresholds, same
  fitting. The IDS document is the part that would transfer; it has not been
  run against anything else.
- **Nothing about geometric accuracy.** This checks that products, identity and
  evidence survive the export and are readable by an independent implementation.
  Whether the recovered geometry is *right* is `verify-pair.ts` and
  `audit-ifc-export-roundtrip.ts`, against the paired export.
- **Nothing about the categories being correct.** 100% of products state their
  category evidence. Whether the 60.1% inferred by consensus are *right* needs a
  semantic oracle — see the [editing review](ifc-lite-interface-and-editing-2026-08-19.md).
- **Nothing about STEP number conformance.** Both readers accept a malformed
  REAL, so `nonConformingNumbers()` in `export-ifc.test.ts` remains the only
  check on that defect class.

## Compared with the 2026-08-02 export validation

[That entry](unbc-rvt-to-ifc-export-2026-08-02.md) reported 44,009 IFC elements
and a 162 MB file; this run reports 38,978 products and 156.7 MB. The
denominators differ rather than contradicting: that audit counted every IFC
element including spatial containers, openings and type objects, while this one
counts only non-spatial, non-feature products — the things a recovery has
provenance about.

One difference is worth a second look rather than a reconciliation. That audit
recorded 3,615 `IfcBuildingElementProxy` occurrences; this run finds 571.
Different counting rules explain part of it and the decoder has changed a great
deal since 2 August, but a sixfold drop in unclassified products is a claim
about category recovery improving, and it deserves its own measurement before
anyone repeats it as a fact.
