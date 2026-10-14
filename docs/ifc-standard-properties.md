# Recovered IFC property mappings

`lib/reviter/ifc-standard-properties.ts` maps a bounded subset of native evidence
to IFC property sets. It does not replace `Reviter_Recovery` or
`Reviter_RevitInstanceParameters`. Parameter identities are Autodesk built-in
ids; translated display labels never select a mapping.

| Source evidence | IFC output | Restrictions |
| --- | --- | --- |
| Decoded type name linked to instance | Applicable `Pset_*Common.Reference` and `Pset_QuantityTakeOff.Reference` | Explicitly listed IFC building-element classes only; `IfcIdentifier` |
| `FIRE_RATING` (-1001206) | Applicable common `FireRating` | Nonempty string; `IfcLabel` |
| `GENERIC_FINISH` (-1001208) | `Pset_CoveringCommon.Finish` | Coverings only; nonempty `IfcText` |
| `WALL_STRUCTURAL_SIGNIFICANT` (-1001596) | `Pset_WallCommon.LoadBearing` | Explicit integer 0 or 1 only |
| `FLOOR_PARAM_IS_STRUCTURAL` (-1001954) | `Pset_SlabCommon.LoadBearing` | Explicit integer 0 or 1 only |
| `FUNCTION_PARAM` (-1001006) | Wall/door common `IsExternal` | 0 interior or 1 exterior; other enum values omitted |
| Stair run parameters (-1151305 through -1151308) | `Pset_StairFlightCommon.NumberOfRiser`, `NumberOfTreads`, `RiserHeight`, `TreadLength` | Counts are integral nonnegative `IfcCountMeasure`; lengths are positive `IfcPositiveLengthMeasure`, feet converted to metres |
| Native `Element.m_createdPhaseId` / `m_demolishedPhaseId`, or `PHASE_CREATED` / `PHASE_DEMOLISHED` (-1012100 / -1012101), joined phase-name map | Revit interoperability `Phasing` set | A positive native phase id must resolve to a nonempty native name. Conflicting native/parameter ids are omitted. `Phasing` is not a buildingSMART standard set. |

Each exported property carries its source evidence in its IFC description.
Conflicting duplicate parameter values are omitted; empty, nonfinite and
unsupported values are omitted. The helper does not infer exterior status from
geometry, structural status from category, or a lifecycle status from phase ids.

Type parameters not already recovered by Reviter remain unavailable; this change
does not independently decode family type parameter tables. In particular, type
fire ratings and Function values cannot be claimed present merely because the
mapping exists. Phase names come from the independently validated
`native-phases.ts` collector; numeric ids or enum labels are not names.

Reference and resolved Phasing interoperability conventions were reviewed against
[rvt-rs export_content.rs at 1c3d337](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/ifc/export_content.rs)
(Apache-2.0). No Rust source was copied. Property names and types were checked
against buildingSMART property-set definitions, including singular
`NumberOfRiser`, count measures, positive lengths and covering Finish text.

Run `node --experimental-strip-types --import ./scripts/register-test-typescript.mjs --test tests/ifc-standard-properties.test.ts`
for mapping/rejection checks and independently parsed STEP serialization. The
reader check uses `@ifc-lite/parser`, retains raw feet and recovery properties,
and checks SI measure values in the added sets.
