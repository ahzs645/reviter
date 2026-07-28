# Native Revit identity decoding

Reviter can now reconstruct persisted Revit `UniqueId` values from the
browser-safe RVT container decoder for the measured Revit 2027 layout. The
implementation does not infer IDs from IFC `GlobalId` values and does not emit
an ID unless the element-history record resolves to a genuine document-history
episode.

The exact UNBC audit decoded 74,437 unique native identities. Every one of the
38,187 unique numeric Revit `Tag` values present on IFC elements joins to one
of those identities.

## Persisted contract

Static contract evidence establishes the public value:

```text
<creation-episode-guid>-<original-element-id-as-lowercase-hex>
```

The native suffix format literal is `-%08llx`: eight digits is a minimum
width, not a 32-bit truncation rule. The relevant exported contracts are
`OdBmElement::getUniqueId()`, `OdBmElementHistory::getOriginalElementId()`,
`OdBmElementHistory::getCreationDate()`, `OdBmDocumentHistory::getEpisode()`,
and `OdBmEpisode::getGUID()`. Persisted reader names include
`EpisodeGUID201120260Reader` and `OriginalElementId201120260Reader`.

The two required streams have independently verifiable shapes.

### `Global/History`

| Offset | Width | Meaning |
| ---: | ---: | --- |
| `0x00` | 14 | measured 2027 header |
| `0x0e` | 4 | next local sequence / episode count |
| `0x12` | 4 | signed subsequence deficit |
| `0x16` | 80 | five document GUID slots |
| `0x66` | 4 | history-index value count |
| `0x6a` | count × 4 | history-index values |
| variable | 4 | episode count |
| variable | count × 17 | 16-byte episode GUID plus one-byte strength |
| end − 4 | 4 | zero suffix |

GUID bytes use Microsoft in-memory ordering: the first 32-, 16-, and 16-bit
fields are little-endian, while the remaining eight bytes retain byte order.
Episode storage is newest-first. Native lookup maps an episode id to
`storage[count - episodeId - 1]`; treating storage order as episode-id order
produces the wrong UniqueIds.

### `Global/ElemTable`

For this release the table declares its record count at byte 2. Its first
complete ordinary row starts at byte 34, ordinary rows are 40 bytes, and the
stream ends in a 36-byte suffix. The identity fields within each ordinary row
are:

| Row offset | Width | Meaning |
| ---: | ---: | --- |
| `+12` | 8 | current element ID |
| `+20` | 4 | creation episode ID |
| `+24` | 4 | last-modification episode ID |
| `+28` | 4 | last-user-modification episode ID (`0xffffffff` means absent) |
| `+32` | 8 | original element ID |

The owner at `+0` belongs to the separate model-tree relationship layer. In
particular, `+20` is not a partition ID and `+32` is not an object-ID echo.
All UNBC rows happen to have original ID equal to current ID, but equality is
only an observation about this file. It is not a framing invariant and the
decoder deliberately accepts copied/history records where the values differ.

## Decoder gates

[`native-identity.ts`](../lib/reviter/native-identity.ts) is release-gated and
rejects the complete decode before formatting any identity when:

- either stream length disagrees with its declared collections;
- an episode GUID is zero or duplicated, or its strength differs from the
  measured `0x28`;
- the history count does not equal the next local sequence;
- an element ID is duplicated or cannot be represented exactly in JavaScript;
- any referenced episode is missing;
- modification precedes creation; or
- the resulting native UniqueId is duplicated.

This intentionally favors an explicit unsupported result over a plausible but
invented identity.

## Exact UNBC result

The bounded, reproducible audit is committed as
[`unbc-native-identity.json`](generated/unbc-native-identity.json).

| Check | Result |
| --- | ---: |
| Inflated history bytes | 16,946 |
| Unique episode GUIDs | 948 |
| Episode strength `0x28` | 948 / 948 |
| Inflated element-table bytes | 2,977,550 |
| Ordinary element-history rows | 74,437 |
| Unique native UniqueIds | 74,437 |
| Original/current ID differences in this model | 0 |
| Missing last-user episode sentinels | 25,609 |
| IFC elements | 41,312 |
| Unique numeric Revit IFC Tags | 38,187 |
| Numeric Tags joined to native identity | 38,187 / 38,187 |
| IFC `GlobalId` equal to native UniqueId | 0 |

The IFC header independently reports Revit ContentGUID
`88801bbe-804f-486f-82c6-7f7afc659fde`. It matches document GUID slots 0, 1,
2, and 4 exactly. This validates GUID byte ordering and document provenance;
it does not make IFC `GlobalId` interchangeable with Revit `UniqueId`.

Reproduce the audit with:

```sh
node --experimental-strip-types scripts/audit-native-identity.ts \
  --rvt "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  --ifc "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc" \
  --json docs/generated/unbc-native-identity.json
```

The JSON records both input hashes plus a SHA-256 digest over all UniqueIds, so
a rerun can be compared without committing a 74,437-row identifier dump.

## Current boundary

The identity decoder is browser-safe TypeScript and the audit proves the full
RVT-to-IFC numeric-tag join. It is intentionally isolated from the converter's
public result schema in this checkpoint because that schema is being changed by
the concurrent semantic/model-tree work. The next integration step is to add a
bounded identity summary and per-element `uniqueId` field using this decoder;
the IFC `GlobalId` must remain a separate field.
