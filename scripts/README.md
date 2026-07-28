# scripts

Offline measurement for the decoder. Everything here runs under Node with
`--experimental-strip-types`; nothing here is shipped to the browser.

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

### One more caveat about the numbers in this directory

The conversion is deterministic — two runs in one process reproduce every count
and the same set of drawn element ids — but the decoder is not frozen. Figures
quoted in these files are from the commit that quoted them, and the ones in
`holdout.ts`'s own header moved twice while it was being written, because the
door leaf, the solid clipping and the cross-chunk inflate window all landed in
the same afternoon. Re-run rather than trust a number's second decimal place.
