# Worktree report

## Phase 4 — close railing 1833657 from its measured native top-rail family

The file-wide measurement gate passed before implementation. Exact nested GRep
joins found 208 already-native railings with certified TopRailType curve
frames. A local horizontal-band probe certified 165 sections; all 165 belong to
the `0.164041995 ft` separation family and all match height within `1e-12 ft`.
Two are bit-for-bit equal, the maximum absolute deviation is
`1.4364e-13 ft`, and there are no certified counterexamples. The other 43
joined railings fail closed as measurements (38 have fewer than three
supporting local faces and five have no measurable horizontal band).

The implemented assumption is explicit: for this model's measured
`0.164041995 ft` family, the native top-rail section is square (`n=165`).
The bounded solid uses the persisted two-edge perimeter for every plan
coordinate and for width; only height is completed by setting it equal to the
decoded edge separation. Admission requires a flat, GLine-only, closed,
non-degenerate frame in the measured family. Existing marker-2246 definitions
remain authoritative, and the unchanged all-occurrences-complete composer
admits the fallback only when a definition is genuinely missing.

Result:

- `1833657`: native, 259 parts, 3,340 triangles;
- parts/triangles: `258 × 12` balusters plus `1 × 244` top rail;
- paired IFC: the same 259 parts and triangle histogram;
- 259/259 one-to-one station/AABB matches within `1e-6 ft`;
- median maximum-corner error `6.15e-10 ft`, worst `8.78e-7 ft`;
- RVT aggregate AABB is contained by the element's own decoded record
  envelope;
- `1856525` remains unchanged and out of scope because no station frame was
  located; and
- railing display alpha remains unchanged at 1.

Native controls are unchanged:

| railing | faces | triangles |
| ---: | ---: | ---: |
| 1842055 | 548 | 1,096 |
| 1496333 | 282 | 564 |
| 1498371 | 564 | 1,128 |
| 1500202 | 282 | 564 |

`verify-pair.ts` preserves the railing result at 215/215 drawn, 98.6% centre
agreement, 98.6% size agreement, median centre error `0.011 ft`, and median
size error `0.142 ft`. It reports 20 passes and the same single known,
out-of-scope failure: 27 elements exceed their own IFC box by more than 10 ft
against the budget of 26. The `27 > 26` assertion was not changed.

Validation run:

```text
node --experimental-strip-types --test \
  tests/revit-2027-top-rail-mesh.test.ts \
  tests/revit-2027-baluster-instances.test.ts \
  tests/revit-2027-native-mesh-bridge.test.ts

node --experimental-strip-types scripts/verify-pair.ts <RVT> <IFC> \
  --json /tmp/phase4-verify-pair.json

npx tsc --noEmit
npm run lint
```

The production build completes. The aggregate `npm test` command then stops in
its first, unrelated SSR fixture because the current Vinext output contains
only the page shell and does not contain the already-committed
`/Zero upload/` body assertion in `tests/rendered-html.test.mjs`; the source
test and UI were not changed in this phase. The Phase 4 tests listed above pass
24/24 when run with the railing-alpha guard. The 223 remaining repository tests
also pass when invoked directly; lint plus TypeScript are clean.
