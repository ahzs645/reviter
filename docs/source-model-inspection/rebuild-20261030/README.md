# UNBC native gateway audit rebuild — October 30, 2026

The lost local implementation has been rebuilt from Reviter base
`80177ed21becc91c02df48bb27cd1d24f5fbf297`. These are **fresh source-graph
observations** from the recovered original run-1 dataset. They are not copied
October 23 acceptance claims, native geometry corrections, complete journeys or
public/step-free route approval.

## Verified source

| Input                                               | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Complete `compiled-dataset.json`, 243,679,296 bytes | `efd7efad5e8bc332e2a5eb68348d55241eb8c74bf386256f65b14bb40de07798` |
| Bound original model                                | `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178` |
| Bound source rooms                                  | `5291e1148cc27130b9239b6de26b2f7623c308f227f5dfc2b3e64b17f55e593c` |

The complete dataset contains **1,899 source-door records, 5,493 nodes and 7,337
edges**. Door records are not a count of graph crossings or building links. Each
report retains actual request/source/implementation hashes and successful final
unchanged-input checks. The parsed-value hash uses a different serialization
domain from the raw dataset-file hash above.

## Named checkpoints

[UNBC-gateways.request.json](UNBC-gateways.request.json) and the fresh
[UNBC-gateways.report.json](UNBC-gateways.report.json) establish **nine local
bidirectional witnesses in ten named checkpoints**.

| Native doorway | Checkpoint                                    | Current source observation                                                                                                                     |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2311764        | Building 04–08 journey, Floor 2               | Connected original 08-216 Vestibule / 08-260 Link owners; both local directions; two approaches on the Vestibule side and one on the Link side |
| 2315416        | Building 04–08 link, Floor 3, Building 08 end | Unmatched; one **08-360 owner candidate**; no original saved crossing                                                                          |
| 2112703        | Building 04 end of the Floor 3 link           | Connected 04-302 Corridor / 08-360 Link owners and both approaches; does not fix the opposite end                                              |
| 1501580        | Building 08–10, Floor 1                       | Connected 10-1080 Vestibule / 08-159 Alcove owners and both approaches                                                                         |
| 1501582        | Building 08–10, Floor 1                       | Connected 10-1060 Corridor / 10-1080 Vestibule owners and both approaches                                                                      |
| 1499620        | Building 08–10, Floor 2                       | Connected 08-267 Corridor / 10-2070 Vestibule owners and both approaches                                                                       |
| 1499619        | Building 08–10, Floor 2                       | Connected 10-2070 Vestibule / 10-2066 Corridor owners and both approaches                                                                      |
| 1630256        | Building 07–08 ramp landing doorway           | Original landing / 08-S101 Stair doorway approaches exist; ramp traversal is a separate check                                                  |
| 2018182        | Building 07–08 stair alcove doorway           | Original 08-102 Corridor / 08-S101 Stair doorway approaches exist; stair travel is a separate check                                            |
| 1951047        | Building 09–07 Agora doorway checkpoint       | Reviewed Agora circulation / 07-180 doorway approaches exist; local steps and complete journeys are separate checks                            |

The older zero-approach description of door 1501582 does not describe the
recovered current source. The preserved doorway/access identities and saved
walks are the evidence used here.

Floor 3 door 2315416 remains a genuine unresolved source gap. This audit does not
assign 08-305 or 08-316 as its second owner, enlarge a search radius, remove the
modeled sill or infer a flat/step-free passage. The camera recipe's old label
claiming entry into 08-316 has been corrected to say that ownership remains
unresolved; its camera coordinates and source hashes are unchanged.

## Expanded building-tag sweep

[UNBC-cross-building.request.json](UNBC-cross-building.request.json) unions those
ten checkpoints with source doorways whose saved owner **or candidate** records
carry differing building tags. Its fresh
[UNBC-cross-building.report.json](UNBC-cross-building.report.json) contains
**31 unique doorway identities: 25 local bidirectional witnesses and six
incomplete results**.

The earlier reconstruction summary counted 30 identities. The rebuilt expansion
also retains **door 754072**, which has three ambiguous owner candidates across
Buildings 05 and 07. This extra unresolved row is an explicit expansion of the
inventory; it is not a new connection and does not reduce the 25 local witnesses.

| Incomplete doorway | Current source evidence                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| 2315416            | Floor 3; one 08-360 candidate; unmatched and no crossing                                               |
| 754018             | Floor 1; 07-751 staff / 05-112 unknown; unsupported entrance, no crossing                              |
| 754072             | Floor 1; 07-751 staff / 05-111 unknown / 05-117 staff; **ambiguous three-way candidates**, no crossing |
| 865169             | Floor 1; 05-117 staff / 07-113A public; unsupported entrance, no crossing                              |
| 886407             | Floor 1; 05-116 unknown / 07-704 staff; unsupported entrance, no crossing                              |
| 886568             | Floor 1; 07-751 staff / 05-115 unknown; unsupported entrance, no crossing                              |

These are not six proven missing public passages. Some identities have staff
owners, ownership ambiguity or unsupported entrances. Both reports keep campus
inventory completeness, public route approval and step-free approval false.

## Implementation and checks

The [generic audit documentation](../native-gateway-audit.md) describes exact
source identity, crossing, directed approach and refusal checks. Tests cover
actual positive witnesses and changed hashes, aliases, missing owners, held
crossings, wrong native planes, moved endpoints, one-way branches, self-loops,
portal bypasses and ambiguous cross-building candidate inclusion.

The paired review-companion decoder correction replaces iterable expansion of
the `atob` string with one preallocated byte buffer. Existing base64 validation,
bounded inflation, exact recompression, source preservation and checksums remain.
The normal package tests include every byte value and all base64 remainder
lengths. This change is not a claim to have fixed the compiler worker-pool OOM.

[CODE-CHECKS.json](CODE-CHECKS.json) retains the fresh test, scoped TypeScript and
lint commands, exit statuses, source hashes and logs. The local topology CLI was
run with `--require-local-topology`; both real-source runs intentionally exit
**2** because unresolved checkpoints remain. Their report files and all final
source/request/implementation bindings were successfully written and checked.

Reproduce from the Reviter worktree with the recovered complete dataset:

```sh
node --max-old-space-size=2048 --experimental-strip-types \
  scripts/indoor/audit-native-gateways.ts COMPLETE-DATASET.json \
  docs/source-model-inspection/rebuild-20261030/UNBC-gateways.request.json \
  NEW-NAMED-REPORT.json --require-local-topology

node --max-old-space-size=2048 --experimental-strip-types \
  scripts/indoor/audit-native-gateways.ts COMPLETE-DATASET.json \
  docs/source-model-inspection/rebuild-20261030/UNBC-cross-building.request.json \
  NEW-CROSS-BUILDING-REPORT.json --require-local-topology
```

No source graph, native geometry, owner, access or original model asset was
modified. Use OpenIndoorMaps' current normal-import/export and production-worker
assertions to establish the exact tested journeys. This audit does not replace
those checks or authorize publication.
