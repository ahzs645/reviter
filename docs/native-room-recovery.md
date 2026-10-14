# Source-authored native rooms

`ConvertResult.nativeRooms` contains exact source Room identities from
`ElementHeader.m_categoryId = OST_Rooms`, including rooms without a box.
These records are independent of reviewed room annotations, native enclosure
selection, circulation, routes, served elevator stops and access. Their
`enclosure: "unreviewed-source"` is deliberate. Conversion does not promote
these records into the indoor pipeline.

The existing release/schema-gated ElementHeader decoder supplies identity.
Adjacent native ROOM_NUMBER/ROOM_NAME parameter entries supply names and
numbers; disagreements remain unresolved. Existing decoded instance parameter
tables provide a fallback and Floor Finish when available. Associated levels
come only from independently decoded native level relations.

RoomElem boxes require the file's own ElementHeader, Outline, ElementParents
and RoomElem tags and the placed-instance carrier. First encountered source
headers follow the main scanner's source selection, including a header with
no box: another partition cannot provide a replacement box. Container order
is the existing scanner selection; it is not proof of chronological recency. Outline evidence
must belong to that same selected partition. Multiple passing solid copies
must yield an identical canonical outline.

Stored solid outlines are limited to the measured 2023, 2024 and 2025 face
layout. Floor-reaching planar edges must close into complete simple cycles;
inner shaft/column rings are retained, disjoint outer cycles, intersections
and unmatched boxes are rejected. Endpoint tolerance is 0.0001 ft and box
parity is 0.001 ft. A third orthonormal surface basis identifies an unsupported
curved face; the entire room footprint stays unresolved rather than dropping
that face's cylindrical shaft/column hole. `outlineIssue` records this reason.
A room outline's area is computed from its stored footprint, not a decoded
ROOM_AREA parameter. No height, room volume or enclosure certification is
inferred from the box.

2026/2027 outlines are unsupported. Semantic identity/names can still be
recovered through their existing supported record layouts. Truncated or
page-spanning evidence that cannot be decoded remains unresolved. The scanner
retains bounded evidence, not complete inflated partition buffers; its limit
flag is exposed in nativeRoomCoverage. Unsupported curved faces are not
approximated or tessellated here.

## Paired corpus verification

On 2026-10-14, the user-supplied RVT and paired Autodesk SVF ZIP files in
`/workspace/reviter-corpus` gave:

| Model | Revit | Native / paired rooms | Exact name and number pairs | Emitted stored outlines | Outlines within 0.1% of Autodesk area |
| --- | --- | --- | --- | --- | --- |
| RAC | 2025 | 14 / 14 | 14 / 14 | 13 | 13 / 13 |
| School | 2025 | 91 / 91 | 91 / 91 | 42 | 42 / 42 |
| Snowdon | 2024 | 54 / 54 | 54 / 54 | 45 | 45 / 45 |

There were no reference-only room IDs, name mismatches or number mismatches.
Remaining outlines are explicitly unresolved. The 2027 UNBC layout is not
claimed by this outline decoder. The tests additionally cover a boxless room,
source partition isolation, conflicting duplicates, missing schema tags,
truncation, malformed axes, intersections, holes and the curved-column trap.

The curved-face guard was added after paired checks found a 1.08% area error
in RAC's Kitchen & Dining and smaller errors in 43 School rooms. The planar
reader alone dropped curved internal boundaries. All those footprints are
now withheld, preserving their semantic rooms and source boxes.

Reproduce each independent comparison:

```sh
node --experimental-strip-types --import ./scripts/register-local-typescript.mjs \
  scripts/audit-native-rooms.ts /path/RAC.rvt /path/RAC-svf.zip /tmp/RAC-rooms.json
node --experimental-strip-types --test \
  tests/native-rooms.test.ts tests/convert-rvt-bytes.test.ts
npm run typecheck
```

The audit compares native ElementIds to the paired SVF external UniqueId
suffix, reads the source room name/number and declared area units, and reports
missing identities and differences. Source RVT/SVF bytes and derived corpus
reports are not committed.

Layout attribution and retained upstream notice are in
`THIRD_PARTY_NOTICES.md` and `lib/rvt-wasm/NOTICE`.
