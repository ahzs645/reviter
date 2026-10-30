# Audit native doorway ownership and local walking approaches

This read-only diagnostic answers whether an original native doorway has a saved
crossing and an incoming and outgoing walking approach on both sides. It does
not compile geometry, perform normal package validation, calculate a complete
journey, or approve public/step-free travel.

Use the complete source dataset recovered from the authoring run. Keep every
record, native level, node, original edge, source door and source issue. The
request binds its exact file SHA-256 and the model and source-rooms hashes inside
that file. A nearby point, room number or similar door name is never used to
repair or substitute a missing identity.

## Request

The version 1 JSON request has these fields:

| Field                        | Meaning                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `format`                     | `reviter-native-gateway-audit-request`                                           |
| `version`                    | `1`                                                                              |
| `sourceIndoorSha256`         | SHA-256 of the complete input JSON bytes                                         |
| `sourceModelSha256`          | Exact `source.modelSha256` in that dataset                                       |
| `sourceRoomsSha256`          | Exact `source.roomsSha256` in that dataset                                       |
| `gateways`                   | Explicit named requests using original `nativeDoorElementId`                     |
| `includeCrossBuildingOwners` | Optional union with doors whose saved owner records have different building tags |

Each gateway contains a unique `id`, a human-readable `label` and the original
native element ID. Optional `levelId` disambiguates the native level. Optional
`expectedDoorId` and `expectedRoomKeys` assert existing source identities; a
mismatch is reported, never applied as a correction. Two explicit requests may
not resolve to the same source doorway. Cross-building expansion avoids counting
an explicitly requested identity again.

Cross-building tags do not enumerate every physical building link. Both sides
of a link may be tagged with one building; ordinary doors may have different
owner tags. Explicit checkpoints remain necessary. Every report therefore keeps
`inventoryComplete`, `campusConnectivityProven` and `authorityGranted` false.

## Run

```sh
node --max-old-space-size=2048 --experimental-strip-types \
  scripts/indoor/audit-native-gateways.ts \
  COMPLETE-DATASET.json REQUEST.json NEW-REPORT.json
```

The command refuses to overwrite a report. A malformed request or changed
source, request or implementation exits unsuccessfully. Add
`--require-local-topology` when a caller needs exit status **2** for any remaining
incomplete local checkpoint. The report is still written in that case so the
refusals stay reviewable. Ordinary exit status **0** means the requested
diagnostic ran successfully; inspect its counts and each result.

The receipt includes the input hash, original model/rooms hashes, request hash,
parsed-value hash and source-module hashes. The CLI checks all three source
modules, the request, the input file and the parsed dataset after inspection.
Those are reproducibility bindings, not cached import or route authority.

## What qualifies a local witness

The original doorway must be uniquely identified, connected and retain two
distinct original owners on its declared native level. The exact saved edge ID
and native element ID must agree with that doorway. Duplicate aliases, an
unmatched owner, a different opening, a held edge and ambiguous identities remain
refusals.

The saved crossing must join two distinct owner portals. Its path must retain
their exact positions and the same native walking elevation as the source
owners. A changed or missing physical plane cannot be hidden by a display-floor
group.

Each side needs actual enabled, moving `walk` edges with unambiguous source node
identities, exact path endpoints and the same native plane. A self-loop or walk
directly to the opposite crossing portal is not an independent approach.
Directions are checked explicitly: the forward witness needs an incoming walk
on the first side, a permitted crossing direction and an outgoing walk on the
second side; reverse is checked independently. Rejected approaches and their
reasons remain in the report.

Source owner access, walkability and circulation tags and edge accessibility are
retained as observations. A local witness can involve staff areas or unknown
access. No part of this diagnostic changes policy, proves clearance, certifies
the original floor/foreign-material demand or demonstrates a complete route.
Use the OpenIndoorMaps normal-calculator and production-worker acceptance flow
for those exact journeys, profiles and endpoint options.

## Focused verification

```sh
node --experimental-strip-types \
  --import ./scripts/register-test-typescript.mjs \
  --test --test-isolation=none \
  tests/native-gateway-audit.test.ts \
  tests/review-bundle-wire-package.test.ts
```

Tests exercise source hash changes, missing and ambiguous owners/crossings,
alias refusal, held and wrong-plane edges, exact endpoint binding, one-way walks,
portal bypasses, self-loops and cross-building inventory deduplication. The
package tests exercise normal archive round trips and unchanged source bytes,
corruption/bounds failures and the full byte alphabet through the bounded
base64 decoder. Their fixtures are separate from the real UNBC source replay.
