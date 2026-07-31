# Revit 2027 railing nested-mesh investigation

## Result

The production composer is failing closed correctly. The two incomplete
`IfcRailing` roots are `1833657` and `1856525`; both reach an exact persisted
`GInstance` link whose target is absent from the collector's GElement
definition map. They are not declined by depth, occurrence/traversal limits,
selectors, storage caps, duplicate owners, ordering, or incomplete baluster
family meshes.

There is also a correction to the initial target list. Elements `1496331`,
`1498369`, and `1500200` are stair stringer/carriage members, not railing
roots. Their nearby actual railing roots (`1496333`, `1496337`, `1498371`,
`1498375`, `1500202`, and `1500206`) all compose successfully and are emitted
with `renderGeometryProvenance="native"`. They are not members of the
incomplete-root bucket in the current checkout.

No fix was implemented.

## Method and model-level controls

I ran three instrumented full conversions of the supplied RVT. Temporary
logging was gated by `REVITER_CODEX_NESTED_DEBUG=1`, and the bridge was restored
byte-for-byte afterward (`git diff --exit-code --
lib/reviter/revit-2027-native-mesh-bridge.ts` returned 0). I then scanned every
inflated partition chunk for the target frame ids. All such scans reported
`failedChunks=0`.

One full conversion measured:

| Measure | Value |
| --- | ---: |
| retained GRep definitions | 63,378 |
| exact nested links | 40,834 |
| direct roots with nested instances | 361 |
| complete direct nested roots | 299 |
| incomplete direct nested roots | 61 |
| triangles from complete nested roots | 151,924 |
| estimated retained bytes | 275,792,276 |
| definition/link/byte truncation | false |
| conflicting owner definitions | 0 |

The active finite limits are 100,000 owners, 100,000 links, and 320 MiB
estimated storage (`lib/reviter/revit-2027-native-mesh-bridge.ts:58-70`), and
the combined storage guard is at
`lib/reviter/revit-2027-native-mesh-bridge.ts:1369-1387`. The observed state is
therefore below every relevant collection cap.

The collector only turns marker-2246 GElement frames into owner definitions
(`lib/reviter/revit-2027-native-mesh-bridge.ts:1175-1186`). Finalization builds
the recursive definition map at
`lib/reviter/revit-2027-native-mesh-bridge.ts:922-937`, calls
`composeRevit2027NestedMesh` at
`lib/reviter/revit-2027-native-mesh-bridge.ts:962-968`, and atomically rejects
the root on any composition error. Inside the composer, an absent owner map
entry produces the exact error at
`lib/reviter/revit-2027-nested-instance.ts:550-553`.

## Target roots

### Railing 1856525: incomplete because two referenced definitions are absent

The direct root is a marker-2246 GElement in `Partitions/325`, compressed page
offset `53,811,273`, chunk `2748`, inflated frame
`59,744..60,260`, dynamic payload `59,916..60,276`. It has valid local extents
`(26.6167262786, 306.725649598, 14.4356955381)` to
`(201.925111266, 442.927421251, 18.0446194226)`, no local drawable faces, and
two external links:

| replay / info index | symbol target | transform | selector values |
| --- | ---: | --- | --- |
| `0 / 3` | `1857537` | identity | `gRepId=0`, `cda=1`, no scale, not view-dependent |
| `1 / 4` | `1856526` | identity | `gRepId=0`, `cda=1`, no scale, not view-dependent |

The no-face root is intentionally considered locally complete because it has
nested links (`lib/reviter/revit-2027-native-mesh-bridge.ts:1321-1324`).

The first branch continues through non-direct owner `1857537`:

- marker-2246 GElement at compressed page offset `53,845,854`, chunk `2751`,
  inflated frame `31,160..31,460`, dynamic payload `31,320..31,476`;
- one identity link, replay/info `0 / 1`, to `1857538`;
- the same element also has a non-GElement marker-4406 frame at compressed page
  offset `17,883,937`, chunk `1028`, inflated offset `87,348`, length `4,961`.

No framed element object with id `1857538` exists anywhere in the fully scanned
partitions. There is no definition failure or owner conflict for it: it was
never eligible for the marker-2246 definition map. The composer therefore
declines at `revit-2027-nested-instance.ts:550-553` with:

```text
nested instance symbol target 1857538 is missing
```

The path length is 2 (`1856525 -> 1857537 -> 1857538`), versus the depth limit
of 64 (`lib/reviter/revit-2027-nested-instance.ts:492-494,541-543`).

There is a second, currently masked failure: a full frame scan also finds no
object of any marker for immediate target `1856526`. Composition stops on the
first branch before visiting it. Consequently this root contains only three
persisted identity links across the reachable prefix and **zero persisted
per-station baluster transforms**. The paired IFC product has 845 placed mesh
parts, 10,972 triangles, and 21,944 vertices. Those stations cannot be recovered
by loosening the existing composer.

The conversion keeps element `1856525` on the reconstructed/swept path: 113
polylines (226 points), guard height `3.6089238845144394 ft`.

### The other incomplete railing, 1833657

This root fails for the same first-error class but retains much more useful
geometry evidence:

- direct root: compressed page offset `27,733,694`, chunk `1468`, inflated
  frame `12,444..12,960`;
- exact failing path:
  `1833657 (replay/info 0/3) -> 1834273 (0/1) -> 1834274`;
- all links use `gRepId=0`, `cda=1`, no scale, and no view-dependent
  resolution;
- target `1834274` is present only as a non-GElement marker-967 frame at
  compressed page offset `4,827,135`, chunk `259`, inflated offset `92,660`,
  length `28,031`; it has no marker-2246 definition.

The sibling owner `1833658` is already a complete persisted station graph: its
marker-2246 GElement frame is `12,980..55,050` in chunk `1468` and contains 258
exact GInstances to decoded symbol `1266931`. The paired IFC has 259 placed
parts and 3,340 triangles, consistent with 258 repeated members plus the one
unresolved other branch. Atomic admission correctly withholds those 258
recoverable occurrences until the remaining branch is exact.

### Control: railing 1842055

The control root is at compressed page offset `54,299,571`, chunk `2773`,
inflated frame `89,327..89,843`, dynamic payload `89,499..89,859`. Its two
identity root links target `1842409` and `1842056`. Composition succeeds with
87 geometry occurrences, maximum chain depth 2, 548 faces, and 1,096
triangles. The paired IFC has 84 placed parts and exactly 1,096 triangles. The
element is emitted as native geometry.

This control proves that the existing transform multiplication and face
handoff work for this railing representation. It does not supply the missing
definition bodies of `1856526` or `1857538`.

## Correction: the cited per-storey railings already complete

The three approximate ids in the request identify other stair components:

| cited id | decoded category | nearby direct railing roots |
| ---: | --- | --- |
| `1496331` | Stairs Stringer Carriage | `1496333`, `1496337` |
| `1498369` | Stairs Stringer Carriage | `1498371`, `1498375` |
| `1500200` | Stairs Stringer Carriage | `1500202`, `1500206` |

Measured examples:

| railing root | persisted root location | root links | composition | IFC diagnostic | final provenance |
| ---: | --- | ---: | --- | --- | --- |
| `1496333` | chunk 2338, compressed page 45,848,743, frame `19,052..19,598` | 2 (`1496351`, `1496334`) | 43 occurrences, depth 2, 282 faces, 564 triangles | 41 parts, 540 triangles | native |
| `1498371` | chunk 2344, compressed page 45,988,210, frame `19,052..19,952` | 4 (two each to `1498389`, `1498372`) | 85 occurrences, depth 2, 564 faces, 1,128 triangles | 82 parts across 2 products, 1,080 triangles | native |
| `1500202` | chunk 2362, compressed page 46,355,929, frame `122,810..123,356` | 2 (`1500220`, `1500203`) | 43 occurrences, depth 2, 282 faces, 564 triangles | 41 parts, 540 triangles | native |

These roots have no decline site. Their root-local drawable-face count is zero,
but the nested-instance exception at
`lib/reviter/revit-2027-native-mesh-bridge.ts:1321-1324` makes that state valid,
and the complete recursive closure is admitted at
`lib/reviter/revit-2027-native-mesh-bridge.ts:979-1002`.

## Incomplete-root bucket

Using the paired IFC's numeric `Tag` as the category join, the 61 **direct**
incomplete nested roots split as follows:

| IFC category | roots | share | decline reason |
| --- | ---: | ---: | --- |
| `IfcStairFlight` | 57 | 93.44% | first missing symbol target |
| `IfcRailing` | 2 | 3.28% | first missing symbol target |
| `IfcRamp` | 2 | 3.28% | incomplete local drawable-face coverage |
| **total** | **61** | **100%** | |

Reason distribution independent of category:

| first atomic decline | roots | share |
| --- | ---: | ---: |
| missing symbol target | 59 | 96.72% |
| incomplete local face coverage | 2 | 3.28% |
| depth/cycle/occurrence/traversal cap | 0 | 0% |
| unsupported GRep/CDA/scale/view selector | 0 | 0% |
| storage truncation/owner conflict/no resulting faces | 0 | 0% |

The 59 missing-target paths have depth 1 for 57 roots and depth 2 for the two
railings. All 61 root-level links observed in those failures use the supported
selector tuple `gRepId=0`, `cda=1`, `hasScale=false`,
`resolveSymbolInView=false`; the selector rejection code is
`lib/reviter/revit-2027-nested-instance.ts:580-602`.

Across the 59 distinct first-missing ids, none has a marker-2246 GElement:
54 have only marker 4133, one (`1834274`) has only marker 967, and four
(`1373132`, `1460782`, `1821223`, `1857538`) have no framed object at all.
This is why generic rescanning or scan ordering cannot fill the owner map.

The two ramp roots (`1587605` and `2375155`) take the separate finalizer branch
at `lib/reviter/revit-2027-native-mesh-bridge.ts:970-977`. Each composition has
three occurrences; source owners `1587606` and `2375156` are present but have
`localComplete=false`, zero retained faces/triangles, zero nested instances,
and two drawable Face tokens without certified meshes. Their measured issue
sets are unsupported/loop-unresolved planar and cylindrical surfaces plus
unresolved ruled-helix profiles. They are unrelated to the railing fix.

For completeness, finalization also selects 10 nested definitions only because
they are placement-requested rather than direct scene roots. Nine fail on a
missing target and one on local coverage, so the all-selected count is 71
failures: 68 missing-target and 3 local-coverage. The warning's denominator of
361 and the category census above intentionally use direct roots only
(`lib/reviter/revit-2027-native-mesh-bridge.ts:883-892`).

## Is the railing information present?

The answer differs by railing and by layer:

1. **The references are present.** Both failing roots contain exact, supported
   `GInstance` links. This is not a missing-link decoder at the root and not a
   cap/order issue.
2. **For `1833657`, the station transforms are present.** Owner `1833658`
   contains 258 exact per-station transforms. The missing terminal target is the
   other branch, represented only by marker 967 rather than as a GElement.
3. **For `1856525`, the station transforms are absent from the persisted GRep
   closure currently visible in the file.** The main symbol target `1856526`
   has no frame, and the other branch terminates at frame-less `1857538`. No
   bridge-only change can infer 845 IFC parts from three identity links.

The file's recovered schema names the intended exact source:
`BaseRailingSym.m_balusterInstances`, an array of placed GRep nodes, with
`paramsAndId.m_famSymId` and `m_instId`
(`docs/revit-2027-baluster-instances.md:13-42`). It explicitly recommends
reading those instances instead of regenerating the distribution pattern
(`docs/revit-2027-baluster-instances.md:55-75`). Therefore the bounded
interpretation is:

- `1833657` is completion of an existing recovered station graph plus an
  alternate target representation;
- `1856525` requires a **new exact BaseRailingSym instance-array decode feeding
  the existing composer**, and only if a byte-owned array for this specific
  railing can be located. If that evidence cannot be located, `1856525` must
  remain a proxy. It is not safe to generate stations from the rail path,
  railing pattern, IFC, or neighbouring ids.

## Bounded fix plan

### 1. Add an evidence-only alternate definition provider

At the marker-only collection boundary
`lib/reviter/revit-2027-native-mesh-bridge.ts:1175-1186`, allow a release-gated
provider to contribute `CompactOwnerDefinition` inputs from a separately
decoded `BaseRailingSym`/top-rail representation. Keep marker-2246 GElement
replay unchanged. Do not teach `composeRevit2027NestedMesh` to skip missing
targets or admit partial roots.

Prefer a small dedicated decoder module rather than embedding a second binary
grammar in the bridge. Its output should reuse `Revit2027NestedInstance` so the
existing selector, cycle, depth, transform, occurrence, and traversal checks
remain authoritative.

### 2. Gate the new decoder on exact file evidence

For every candidate symbol:

- validate framing, length echo, array counts, body end, finite matrices, and
  positive 32-bit owner/symbol ids;
- require one-to-one count agreement between `m_balusterInstances` and
  `paramsAndId`;
- require every `m_famSymId` target to resolve to a complete existing symbol
  mesh;
- retain `m_instId` only as identity/provenance; do not use id adjacency for
  placement;
- require the decoded `m_baseRailingId` (or an equivalently exact persisted
  relation) to identify the root being supplemented;
- reject duplicate definitions unless the marker-2246 and alternate sources
  are byte/structure-equivalent;
- charge recovered definitions, links, triangles, and bytes to the existing
  caps at `revit-2027-native-mesh-bridge.ts:1365-1387`.

The first implementation gate is a probe that locates a byte-bounded
`m_balusterInstances` array for `1856525` and yields the expected station-level
transforms without consulting the IFC. If no such bytes are found, stop; there
is no bounded fix for that root inside nested recovery.

For `1833657`, separately decode the marker-967 target `1834274` only after its
class and exact geometry/link body are identified. Do not special-case the id
or substitute the swept proxy inside an otherwise certified composition.

### 3. Keep the blast radius category-scoped

Only 2 of 61 incomplete direct roots are railings. The other 59 are 57 stair
flights and 2 ramps. Moreover, 54 first-missing targets are marker 4133, so a
generic "accept non-GElement target" change would immediately cross into the
stair subsystem. Scope the new provider through exact BaseRailingSym ownership
and schema identity, not through marker shape or `target == root + 1`.

Expected production deltas if both railing roots pass all gates:

- complete nested roots: `299 -> 301`;
- partial direct nested roots: `61 -> 59`;
- incomplete `IfcRailing` roots: `2 -> 0`;
- the 57 stair-flight and 2 ramp failures remain unchanged;
- the six measured per-storey railing controls remain native with identical
  occurrence/face/triangle counts.

Treat these as expected counts, not admission shortcuts. A root enters the
scene only through the existing all-occurrences-local-complete check and
independent bounds/output gates.

### 4. Validation

1. Add decoder fixtures for valid, truncated, count-mismatched, non-finite,
   unresolved-family-symbol, duplicate-owner, and cap-exhaustion cases.
2. Add a graph test proving a supplied exact alternate definition closes a
   missing target while the same graph without it still returns the error from
   `revit-2027-nested-instance.ts:550-553`.
3. Run a model probe before the IFC comparison and assert:
   `1856525` has no missing targets, every occurrence has a complete local mesh,
   and every emitted face carries its composed transform. Do the same for
   `1833657`. Preserve the exact measured control outputs for `1842055`,
   `1496333`, `1498371`, and `1500202`.
4. Use the paired IFC only as an oracle after RVT decoding. Its target
   diagnostics are:

   | Tag | IFC parts | IFC triangles |
   | ---: | ---: | ---: |
   | `1833657` | 259 | 3,340 |
   | `1856525` | 845 | 10,972 |
   | `1842055` control | 84 | 1,096 |

   Compare per-position world transforms/AABBs, not triangle equality: RVT and
   IFC tessellation may differ. Require no unmatched or duplicated station
   cluster and require the complete root to pass the existing independent RVT
   envelope gate.
5. Run:

   ```bash
   node --experimental-strip-types scripts/verify-pair.ts \
     "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
     "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc"
   ```

   Current baseline: 215/215 IFC railings are drawn; railing centre and size
   agreement are both 98.6%, median centre error `0.011 ft`, median size error
   `0.142 ft`, and 156 railings use the swept proxy. The railing assertions
   pass. The command currently exits 1 for an unrelated baseline assertion:
   27 elements exceed their own IFC box by more than 10 ft versus a budget of
   26. Validation must preserve or improve every existing metric and compare
   that known failure separately; it must not attribute the pre-existing exit
   status to this railing work.

## Recommendation

Do not change the composer guards. First implement only the exact alternate
definition-provider seam and a byte-proven `BaseRailingSym.m_balusterInstances`
decoder. `1833657` is a plausible first closure because 258 station transforms
already exist and only one alternate branch is missing. Keep `1856525` on its
proxy unless the file yields its exact placed-instance array; its current GRep
links do not contain enough information to recover the 845-part railing.
