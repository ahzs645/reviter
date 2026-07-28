# Revit 2027 BaseRailing-to-stairs relation

This checkpoint closes the nine IFC stair-railing aggregation pairs that were
not present in `StairsElement.m_registeredRailings`.

The relation comes from the railing's own typed persisted field. IFC is used
only after decoding as a parity oracle.

## Exact persisted suffix

The UNBC `Formats/Latest` stream defines `BaseRailing` at inflated schema
offset `85464`. Its final fields are:

```text
m_stairsId                    ObjectId
m_placementOffset             double
m_sketchId                    ObjectId
m_stairsComponentId           ObjectId
m_stairsRailingAttrId         ObjectId
m_registeredLocation          int32
m_registeredLocationBackup    int32
m_version                      int32
m_flipped                      bool
m_useCurveLoopsFromSketch      bool
```

These fields occupy exactly 58 bytes and terminate at the independently echoed
framed-object boundary. `m_stairsId` is therefore `objectEnd - 58`; the reader
does not search for an id or use an IFC parent to choose an offset.

The native contract independently agrees:

- `OdBmBaseRailingInternalImpl::getStairsId` returns member `+0x260`;
- `OdBmBaseRailing::getStairsId` calls `prepareForRead`, forwards to the
  internal getter, and returns that object id;
- `setStairsId` writes the same `+0x260` member.

The browser-safe result exposes a model-tree-ready record:

```ts
{
  childId,
  parentId,
  source: "BaseRailing.m_stairsId",
  evidence: "persisted-revit-2027-base-railing-suffix"
}
```

Null `m_stairsId` values remain null and publish no relation.

## UNBC certification

All 215 marker-598 `BaseRailing` frames have the exact 321-byte corpus
envelope and decode with zero failures:

- 114 carry a non-null `m_stairsId`;
- 101 carry a null `m_stairsId`;
- all five IFC railings still missing from the model-tree baseline are among
  the typed non-null relations;
- all nine stair-railing pairs missed by the parent collection are recovered
  from the railing side. Four of those tags already had another native
  model-tree membership, so the net baseline gain is five.

The complete stairs aggregate proof now matches 598 of 598 IFC stair
aggregation pairs. Its cumulative model-tree impact is:

```text
before  37,874 / 38,063 = 99.5035%
after   38,002 / 38,063 = 99.8397%
delta      +128 exact tags
```

The 128 new tags are 78 `IfcStairFlight`, 44 `IfcRailing`, 4 `IfcSlab`, and
2 `IfcMember`.

## Bounded web ingestion

The exact readers accept one contiguous framed object, but the partition does
not need to be concatenated in memory. The audit now uses a bounded
cross-chunk reassembler:

1. retain incomplete candidates and the 17-byte split-header tail;
2. read the native object length once its header is available;
3. wait only until that candidate's length echo arrives;
4. copy the completed frame into a bounded byte array and release earlier
   partition bytes.

On UNBC the largest target frame is 440,372 bytes and the observed maximum
reassembly buffer is 440,392 bytes. The audit uses a 1 MiB safety limit instead
of concatenating the roughly 422 MiB inflated partition. This state machine is
browser-compatible; it does not require Node streams or filesystem access.

Implementation and verification:

- `lib/reviter/revit-2027-base-railing-stairs.ts`
- `tests/revit-2027-base-railing-stairs.test.ts`
- `scripts/audit-revit-2027-stairs-aggregate.ts`
