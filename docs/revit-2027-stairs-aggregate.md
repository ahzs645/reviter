# Revit 2027 stairs aggregate reader

This checkpoint adds a browser-safe, release-gated reader for the persisted
relationships that make a Revit stair a genuine model-tree aggregate. It does
not promote arbitrary nearby element ids.

## Schema and native chain

The UNBC model's `Formats/Latest` stream contains the `StairsElement`
definition at inflated offset `444252`. Its direct fields begin with:

1. `m_registeredRailings` — `PArray<ObjectId>`
2. `m_runsAndLandings` — `PArray<ObjectId>`
3. `m_stairsBndryCurves2d` — queued-object collection
4. `m_stairsRailingPaths` — queued-object collection
5. `m_supports` — `PArray<ObjectId>`

The three `ObjectId` collections are therefore decoded only at their named
schema cursor. The two intervening queued collections are fully consumed before
the support cursor is read. The remaining 84 scalar bytes are also consumed and
validated, so a collection cannot be accepted from a shifted cursor.

The `StairsRunAndLanding` definition begins at inflated schema offset `445024`.
Its later named fields form this exact suffix:

```text
m_stairsId
m_triserSymId
m_baseRiserIndex
m_isMirrored
m_stringerArr
m_oSupportPathCurveLoops
m_supportExistenceStatusMap
```

The preceding fields contain variable inline structures. The reader locates
the complete suffix, not the `m_stairsId` value by itself, and requires its
`m_stairsId` target to resolve to an independently framed `StairsElement`.
Ambiguous suffixes fail closed.

The native implementation independently confirms the meaning of the fields:

- `OdBmStairsElementInternalImpl::getRunsAndLandings` returns member `+0x1d0`;
- `getSupports` returns member `+0x1d8`;
- `getRegisteredRailings` exposes the registered-railing array;
- `OdBmStairsRunAndLandingInternalImpl::getStairsId` returns member `+0x208`;
- `OdBmStairsRunAndLanding::getStairsId` forwards that exact object id after
  `prepareForRead`.

These are semantic contracts, while `Formats/Latest` supplies the serialized
reader order.

## Framing boundary

The release-specific static body begins at framed-object offset `+127`.
Readers additionally require:

- Revit release `2027`;
- marker `4075` for `StairsElement`;
- marker `4080` or `4102` for landing/run subclasses;
- the stored object length and its trailer echo;
- a 32-bit persisted element id with a zero high word;
- bounded collection counts and complete `ObjectId` values.

Some run records are much larger than the generic 64 KiB element scanner's
historical bound. The exact UNBC maximum is `440,372` bytes. The audit
reconstructs each partition's inflated chunks before validating the native
length echo, which recovers all cross-chunk records without weakening the
envelope.

## Exact UNBC result

Against the supplied RVT, IFC, and `outputs/unbc-parity.json`:

- 82 `StairsElement` frames decode with zero failures;
- 108 `StairsRun` and 26 `StairsLanding` frames decode with zero failures;
- `m_registeredRailings` contains 101 ids;
- `m_runsAndLandings` and `m_supports` are both empty in these persisted parent
  bodies, so no child is invented from later bytes;
- 134 run/landing records carry one unique reciprocal `m_stairsId`;
- 589 of 598 IFC stair-aggregation pairs are independently present in the
  decoded RVT relationships;
- 123 previously missing numeric IFC tags become exact model-tree matches:
  78 `IfcStairFlight`, 39 `IfcRailing`, 4 `IfcSlab`, and 2 `IfcMember`.

The model-tree parity impact is:

```text
before  37,874 / 38,063 = 99.5035%
after   37,997 / 38,063 = 99.8266%
delta      +123 exact tags
```

The two members are `m_stringerArr` children of a run whose reciprocal
`m_stairsId` identifies the parent stair. This is a typed two-edge path, not a
raw parent-frame id search.

Nine IFC railing aggregation pairs remain absent from these persisted
collections. They stay unresolved.

## Reproduction

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-stairs-aggregate.ts \
  --rvt "/path/to/model.rvt" \
  --ifc "/path/to/reference.ifc" \
  --semantic outputs/unbc-parity.json \
  --json /tmp/unbc-stairs-aggregate.json
```

Implementation:

- `lib/reviter/revit-2027-stairs-aggregate.ts`
- `tests/revit-2027-stairs-aggregate.test.ts`
- `scripts/audit-revit-2027-stairs-aggregate.ts`
