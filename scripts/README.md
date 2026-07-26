# scripts

Offline measurement for the decoder. Everything here runs under Node with
`--experimental-strip-types`; nothing here is shipped to the browser.

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
