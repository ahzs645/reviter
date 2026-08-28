# scripts

Offline measurement for the decoder. Everything here runs under Node with
`--experimental-strip-types`; nothing here is shipped to the browser.

## What is in here, and what each kind of file is for

There are 107 executable scripts and they are not one kind of thing. Read as a
flat list they look like 107 tools, which is wrong in both directions: it makes
the dozen that other code depends on look optional, and it makes eighty
single-question probes look like a toolkit somebody is expected to learn. They
divide three ways, and the division is the first thing to know before changing
anything here.

**85 of the 107 have exactly one commit.** That is not neglect. Most of them
were written to answer one question about one building, printed their answer,
and were correct to stop.

### Load-bearing — something else breaks if these break

Thirteen files. Four are invoked by `package.json`, eight are imported or
spawned by `tests/`, and one is the recorded provenance of a checked-in data
file. Nothing here may change behaviour without a test run.

| script | what depends on it |
| --- | --- |
| `extract-geometry.ts` | `npm run extract`; `tests/basic-file-info.test.ts` imports `parseExtractArguments`; `tests/downstream-cli-contract.test.ts` pins the entry path, the `--out *.ifc` form and the `engines.node` declaration that an out-of-repo consumer shells out against |
| `build-pages.mjs` | `npm run build:pages` |
| `prepare-sites-build.mjs` | `npm run build:sites` |
| `audit-ifc-export-roundtrip.ts` | `npm run audit:ifc-roundtrip` |
| `holdout.ts` | `tests/holdout.test.ts` |
| `overlay-diff.ts` | `tests/overlay-diff-mesh-bounds.test.ts`, `tests/holdout.test.ts` |
| `footprint-audit.ts` | `tests/footprint-audit.test.ts` |
| `glb-surface-diff.ts` | `tests/glb-surface-diff.test.ts` |
| `glb-statistics.ts` | `tests/glb-statistics.test.ts` |
| `audit-stair-vertical-residuals.ts` | `tests/glb-surface-diff.test.ts` imports `readIfcStairFlightCounts` |
| `revit-2027-placement-owner-selection.ts` | `tests/revit-2027-placement-owner-selection.test.ts` |
| `audit-native-tessellator-stack.mjs` | `tests/native-tessellator-stack-audit.test.ts` spawns it |
| `generate-legacy-revit-api.ts` | the provenance of `lib/reviter/legacy-revit-2021.data.ts`; see below |

Two notes on that table. `generate-legacy-revit-api.ts` has **no npm alias** —
it was removed on 2026-08-12 because the input it needs is not in this
repository — so it is load-bearing as a record rather than as a command.
And `audit-coverage.ts` belongs on the list transitively: it is not in
`package.json` and no test imports it, but **26 other scripts do**, including
five of the thirteen above. Breaking it breaks a quarter of this directory.

### Reusable tooling — meant to be run again, on a second model

The commands this directory exists to offer, plus the modules they share.
`verify-pair.ts` is the entry point of record and has nine references across
`docs/`; `audit-coverage.ts`, `overlay-diff.ts` and `glb-surface-diff.ts` are
the measurements it composes.

- `verify-pair.ts` — the whole check, coverage plus overlay plus named assertions
- `audit-coverage.ts` — is this element present
- `overlay-diff.ts` — is it in the right place and the right size
- `footprint-audit.ts` — is its plan outline right
- `glb-surface-diff.ts`, `glb-statistics.ts` — recovered GLB against a reference GLB
- `holdout.ts` — the partitioned single-building check
- `extract-geometry.ts` — the converter as a command
- `audit-ifc-export-roundtrip.ts` — reopen Reviter's own IFC
- `compare-view.ts`, `browser-check.mjs` — visual comparison
- `scripts/lib/` — the shared harness, described below

### Single-investigation artifacts — the record of one question

Everything else, and the majority of the directory. Each was written to settle
one thing about the one supplied Revit 2027 project: whether a source-class slot
decodes, whether a record carries the field it looks like it carries, where a
placement basis really sits. They print a JSON answer and exit.

They are kept, not deleted, because **the answer is only as good as the
measurement that produced it**, and several decoder rules in `lib/reviter/` cite
these files as their evidence. Deleting one deletes the argument for a rule that
is still shipping.

The clearest case is the staircase. **Eight separate scripts probe the same
single stair** —

`probe-riser-gaps.ts`, `probe-riser-offsets.ts`, `probe-riser-arc-angles.ts`,
`probe-riser-line-evidence.ts`, `probe-dogleg-segments.ts`,
`probe-tread-quads.ts`, `probe-stairflight-offsets.ts`,
`probe-monolithic-hex.mjs`

— each asking a different question about it, in the order they were asked.
Read as tools that is eight redundant tools. Read as what they are, it is one
investigation with eight steps, and the sequence is the finding.

**39 of the 107 are referenced by nothing at all** — no test, no npm script, no
document, no other script. That is the honest signature of this category, and
it is a question for the reader of this repository rather than something to
resolve by deletion.

## The shared harness, `scripts/lib/`

Opening an RVT is the same nine lines everywhere: read the compound file, strip
the page checksums, find the gzip members, inflate each chunk against the
previous chunk's window, salvage the ones that desync. That sequence was
written out at 51 sites across 48 files, and it is exactly the sequence that
must not drift — the cross-chunk dictionary alone recovers 273 of 332 otherwise
unreadable chunks, so a copy that forgets it silently measures a smaller
building than the conversion did.

`scripts/lib/rvt-harness.ts` is that sequence, once. It decodes nothing:
`lib/reviter/revit-container.ts` remains the definition of what a Revit stream
is, and the harness is only the loop around it.

```ts
import {
  countsByFrequency,
  increment,
  iterateInflatedChunks,
  openRvt,
  optionalPath,
  requireModelPath,
  writeJsonReport,
} from "./lib/rvt-harness.ts";

const model = openRvt(requireModelPath("audit-thing.ts model.rvt"));
const release = model.requireRelease(2027);
const schema = model.requireSchema();          // inflated Formats/Latest

const seen = new Map<number, number>();
let failed = 0;
for (const { data } of iterateInflatedChunks(model, {
  onFailure: () => { failed += 1; },
})) {
  increment(seen, data.length);
}
writeJsonReport(optionalPath("--json"), { release, failed, seen: countsByFrequency(seen) });
```

What it covers:

- **the container** — `openRvt`, `model.streams/streamsMatching/stream`,
  `model.firstInflatedStream`, `model.requireSchema`, `model.release`,
  `model.requireRelease`, and `iterateInflatedChunks` /
  `inflatedChunksWithCensus` for the partition walk
- **arguments, in one signature** — `requirePath` throws, `optionalPath`
  returns null, `optionValue` does not resolve a path, plus `hasFlag`,
  `numberOption`, `positionals(...valueFlags)`, `requireModelPath`, `declareUsage`,
  `isEntryPoint`. The twelve copies this replaces had four incompatible
  signatures, so `option("--json")` meant something different depending on
  which file you were reading.
- **reports** — `writeJsonReport`, `percent`, `ratio`, `sha256`
- **counting** — `increment`, `countsByFrequency`, `countsByKey`
- **schema reading** — `matchesAscii`, `findNameOffset`, `requireNameOffset`,
  `decodeSchemaFields`, `sourceNameAtSlot`
- **IFC text** — `splitStepArgs`, `stepReferences`, `decodeIfcString`,
  `ifcScalar`

`scripts/lib/revit-2027-decoders.ts` is a re-export barrel for the
`decodeRevit2027*` / `REVIT_2027_*_SOURCE_CLASS_SLOT` pairs. Each pair lives in
its own module under `lib/reviter/`, which is right for the browser and wrong
for an audit covering a dozen classes: `audit-revit-2027-planar-topology.ts`
opened with 72 lines of imports and
`audit-revit-2027-cylinder-cone-trims.ts` with 68, overlapping heavily without
ever being identical. The barrel re-exports them unchanged, so `lib/reviter/`
stays the single definition.

**Usage and `--help`.** A script that takes arguments calls `declareUsage` (or
`requireModelPath`, which calls it) once. That one string is what `--help`
prints and what a missing-argument error appends, so a script's invocation is
written in one place rather than pasted into each `throw` — which is how
several of the replaced copies came to name flags their script no longer took.

### What has not been migrated

46 scripts are on the harness. The rest still carry their own copy, and the
next cluster worth taking is the index-form partition walk
(`for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; …)`) shared by
about a dozen probes. The `.mjs` scripts are deliberately untouched:
`package.json` declares `node >=22.13`, and importing a `.ts` module from
`.mjs` needs the type stripping that only became default in 22.18.

## Extracting recovered geometry

The core converter detects the Revit release from `BasicFileInfo`, so a caller
does not need to parse metadata before asking for geometry:

```sh
npm run extract -- model.rvt --out model.glb
npm run extract -- model.rvt --out model.obj
npm run extract -- model.rvt --out model.ifc
npm run extract -- model.rvt --out audit.json
```

GLB, OBJ, DXF, SVG, IFC proxy, and JSON audit outputs use the same recovered
scene as the browser. `--revit-version 2027` remains available as an explicit
override for malformed fixtures, but normal RVT files should not need it.

The same browser-safe library also exposes `parsePartAtomXml`,
`parseSharedParameterFile` / `writeSharedParameterFile`, `parseTypeCatalog` /
`writeTypeCatalog`, and `parseOmniClassTaxonomy` /
`writeOmniClassTaxonomy`. These are the portable pieces brought over from the
Revitless toolkit; they do not require Revit, .NET, or a server.

The real Revitless text corpus is retained under
`tests/fixtures/revitless-toolkit`: 18 valid and 6 intentionally invalid
shared-parameter files, four type catalogs, the Revit 2014 family, and three
DWGs exercising both preview encodings. These fixtures verify multilingual and
large-file behavior rather than only synthetic happy paths.

## The personal Revit 2021 compatibility data, and why it cannot be regenerated

`lib/reviter/legacy-revit-2021.data.ts` is the artifact of record for the
optional legacy API vocabulary — 8,075 rows across 11 enums and 12 maps. It was
written once by `generate-legacy-revit-api.ts` from a Revitless toolkit
checkout's `src/Decompiled` C#.

**That checkout is not in this repository, so the generator cannot be run
here.** There are no `.cs` files and no `Decompiled` directory; the script
throws on the missing argument, or on the missing directory if given a path
that does exist. Its `npm run generate:legacy-revit-api` alias was removed on
2026-08-12 for that reason — an npm script is a list of things a reader can
run. The script itself is kept, unrun, because it is the precise record of
which declarations were extracted and how, and its header states what input
would be needed.

Browser code loads the data only through `loadLegacyRevit2021Api()`, which
imports it dynamically and keeps it out of the initial viewer chunk;
`tests/pages-build.test.mjs` asserts that split survives a real build. The
tables are compatibility vocabulary and are not used as evidence for native RVT
geometry.

## Checking a model against its own IFC export

Every rule in this decoder was fitted on one building. `verify-pair.ts` is the
one command that says whether those rules still hold on a different one:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc
```

It prints three things and exits non-zero if any assertion fails:

1. the **per-class coverage** table — in IFC / seen / recovered / drawn, from
   `audit-coverage.ts`
2. the **per-class geometric agreement** table — centre and size, from
   `overlay-diff.ts`
3. **named assertions with thresholds**, one per fitted rule, so a rule that
   does not generalise fails by name rather than showing up as a number that
   looks slightly worse

Both tables come out of a single conversion, which is the expensive part —
about 40s on a workstation, a couple of minutes in a constrained container for
a 67 MB project.

### What the two files have to be

The join between them is the Revit element id that every IFC product carries in
its `Tag` attribute. So the `.ifc` must be **exported from that same `.rvt`**,
not merely a model of the same building. Nothing is uploaded; both files are
read locally.

### Reading the report

Assertions are named after the rule they guard —
`railing-guard-height`, `door-swing-geometry`, `sheets-held-back-small`,
`no-records-outside-hull`, `centre-agreement/<class>`. A class the export does
not contain is reported `skip`, not `fail`, so a building with no railings or no
curtain wall still gets a clean report on what it does have.

The thresholds are the numbers measured on the supplied Revit 2027 project with
deliberately generous slack, and each one's provenance is written out in the
header comment of `verify-pair.ts`. They are a tripwire for a rule that has
stopped working, not a pin on today's figures.

### Reopening Reviter's own IFC export

`verify-pair.ts` compares against the Autodesk IFC. The complementary
round-trip gate exports Reviter's recovered scene, reopens that generated IFC4
with `web-ifc`, and verifies that every tagged geometry element keeps its id,
position, and size to 0.01 ft:

```sh
npm run audit:ifc-roundtrip -- model.rvt
npm run audit:ifc-roundtrip -- model.rvt --out recovered.ifc --json roundtrip.json
```

The temporary IFC is deleted when `--out` is omitted. Anonymous display
context is preserved by the exporter but is intentionally outside the tag
identity gate because it has no Revit element id to assert.

### The control on the gate itself

A gate that cannot fail is decoration. Shifting every `Tag` in the export past
any real Revit id and re-running takes `building-element-coverage` to **0.0%,
FAIL, exit 1**, and every assertion that depends on the join reports `skip` with
its reason rather than passing vacuously. That is the only discrimination check
available while there is one model.

### Differencing two models

```sh
node --experimental-strip-types scripts/verify-pair.ts a.rvt a.ifc --json a.json
node --experimental-strip-types scripts/verify-pair.ts b.rvt b.ifc --json b.json
diff <(jq -S . a.json) <(jq -S . b.json)
```

## Holding parts of the one building out

`verify-pair.ts` is the check for a second model, and there is no second model.
`holdout.ts` is the next best thing, and it has an honest ceiling: it splits the
one building into parts **no rule could have keyed on** and asks whether each
fitted rule holds on the parts it was not fitted to.

```sh
node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc
node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc --cache probe.json --json run.json
```

Two partitions, neither of them visible to anything in `lib/reviter`:

- **storey**, from the export's `IfcBuildingStorey` containment, propagated down
  `IfcRelAggregates` so a curtain panel inherits its wall's storey — 100% of the
  38,226 tagged building-element products here. An item with no product falls
  back to the elevation band between storeys, and every rule reports what share
  of its population took that fallback.
- **wing**, the longer plan axis of the export's hull halved at its midpoint.

Ten rules are reported, each with per-partition **n**, **accuracy**, median,
worst case, and the spread between the best and worst partition. A spread is
only called a **split** when it also clears a pooled two-proportion `|z| > 2`:
without that a 36-element partition sitting 18 points below a 75-element one
reads as a finding when it is a coin toss.

Where no two storeys are large enough to compare, the storeys are pooled into a
lower and an upper half so there is still a storey test rather than none.

### Reach is measured separately from accuracy

A rule can be perfect on the population it reaches and reach almost none of the
building, and no accuracy threshold anywhere in this directory notices. So every
rule with an identifiable eligible population also reports **measured against
eligible** per partition, and a partition holding an eligible population the rule
never fired on is flagged **SILENT** — which is the one condition that makes
`holdout.ts` exit non-zero. A **split** is a finding and does not fail the run
without `--strict`, because two of them are known properties of this model and a
gate that always fails teaches its reader to ignore it.

That check earned its place immediately: the railing sweep is 100% accurate on
every partition it reaches and reaches **0 of the 41 railings at or below Floor
1**, against 70 of the 124 above it.

So on the supplied project `holdout.ts` **exits 1 today**, for that gap. That is
the check working rather than the harness being broken, and it is worth deciding
whether to wire it into CI before or after the gap is closed.

### It is not the second-model check

Every partition shares the file's Revit release, its exporter, its family
library, its practice's conventions and its structural grid. A rule can hold on
all thirteen storeys and both wings and still be an artefact of this building.
The header of `holdout.ts` says so, the report prints it before the first table,
and the JSON carries it in a `caveat` field, because the one thing this script
must not do is read as the confirmation that is still missing.

### The cache

The three passes — the export through `web-ifc`, the conversion, and one extra
scan of the inflated pages — take about ten minutes on the supplied project. The
extra scan exists because three rules are byte-level and their alternatives never
reach `ConvertResult`: the discarded bounds copy, the reserved word of a record
the decoder threw away, and the offset a placement basis actually sits at. It
carries the cross-chunk inflate window exactly as `convert.ts` does, so both
passes describe the same pages.

`--cache <path>` writes every per-element measurement the report needs. Re-deriving
the whole report from it takes **two seconds** and needs neither model, which is
what makes the flagging thresholds cheap to argue with. The cache records the
pair it came from and is refused for another.

## The two measurements on their own

Both still run standalone, and both export their computation so `verify-pair.ts`
can reuse it rather than keeping a second copy that could drift:

```sh
node --experimental-strip-types scripts/audit-coverage.ts model.rvt model.ifc [--json out.json]
node --experimental-strip-types scripts/overlay-diff.ts   model.rvt model.ifc
```

`audit-coverage.ts` answers *is this element present*. `overlay-diff.ts` answers
*is it in the right place and the right size* — an element can be drawn, and
drawn wrong, and only the second table sees that.

One detail in `overlay-diff.ts` is load-bearing and must stay: **one Revit
element can leave the exporter as several IFC products sharing its `Tag`**, so
the ground-truth box for an id is the **union** of every product carrying it.
Keeping only the last box made floors look oversized by the distance between
their sketch regions — 20% of slabs measured over a foot out, against 3% once
unioned.

## What models exist to check against

One: the supplied Revit 2027 project and its paired export. There is no second
`.rvt`, `.rfa`, `.rte`, `.rft` or `.ifc` anywhere on this machine, so every
threshold above is fitted on a single building and none of them has yet been
confirmed against a second one. That is the gap this script exists to close
cheaply the moment a second pair appears.

`holdout.ts` narrows that gap without closing it. Partitioning one building
catches a rule fitted to *where in the building* it was measured, which is a real
failure mode with a precedent here — a stair run's box looked right because a
straight stair has one run per storey, and only the switchbacks showed otherwise.
It cannot catch a rule fitted to this Revit release, this exporter version, this
family library or this practice's conventions, because every partition shares all
four. Only a second file can.

## Three things in here that belong in `lib/`

Recorded rather than moved, because these are recommendations about `lib/` and
this directory does not own it. All three are the same shape: code that is not
a script sitting in the scripts directory, where nothing in the browser build
can reach it and where a second copy grew unnoticed.

**`holdout.ts` and `glb-surface-diff.ts` are libraries, not commands.** Both are
imported by `tests/` and neither is run as a CLI by anything. `holdout.ts` goes
further and is a *shadow copy*: its `readUsableBounds` and
`lib/reviter/bounds-records.ts`'s `readBounds` measure at 0.94 similarity, and
its instance reading duplicates `lib/reviter/instanced-geometry.ts`. The pass
that reads them (`rescanPartitions`) exists precisely because three of the
holdout rules are byte-level and their alternatives never reach `ConvertResult`
— which is an argument for the reader living in `lib/` beside the reader it
shadows, not for a second one here. The same goes for
`revit-2027-placement-owner-selection.ts`, which is 46 lines of pure selection
logic with no I/O at all and only one consumer besides its test.

**`lib/reviter/drawn-bounds.ts`'s `drawnBounds` reads orphaned because it is the
stale copy.** `scripts/footprint-audit.ts:47` imports `drawnBounds` from
`./overlay-diff.ts` rather than from `lib/`, and so does `compare-view.ts`, and
so does `holdout.ts`. That is not an oversight in the imports: the two
implementations have **diverged, and the `lib/` one is behind**. The
`scripts/overlay-diff.ts` copy honours `solid.startCorners` / `endCorners` —
the mitred wall-join corners — and the `lib/` copy still expands a rectangle
from the segment normal. Every caller moved to the newer one and the export in
`lib/reviter/index.ts` was left pointing at the older.

So `drawnBounds` should be reconciled in `lib/` — taking the `scripts/` body —
and `scripts/overlay-diff.ts` should re-export it rather than define it. Note
that `boxDifference` and `Box` from the same module are *not* orphaned:
`lib/reviter/ifc-reference.ts`, `lib/reviter/mesh-element-bounds.ts` and
`tests/reviter-regression.test.ts` all use them, so the module cannot simply be
deleted, and a fix that only deletes the unused-looking export would delete the
wrong half of the divergence.

### One more caveat about the numbers in this directory

The conversion is deterministic — two runs in one process reproduce every count
and the same set of drawn element ids — but the decoder is not frozen. Figures
quoted in these files are from the commit that quoted them, and the ones in
`holdout.ts`'s own header moved twice while it was being written, because the
door leaf, the solid clipping and the cross-chunk inflate window all landed in
the same afternoon. Re-run rather than trust a number's second decimal place.
