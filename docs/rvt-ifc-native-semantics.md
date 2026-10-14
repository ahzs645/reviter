# Native Revit IFC semantics

The IFC4 exporter reconstructs a native occurrence's GlobalId from its creation
episode GUID and original element handle. The handle is XORed into the low
32 bits of the canonical GUID and encoded in IFC's 22-character alphabet.
It uses the original handle even when the current ElementId has changed.
Native IDs survive a rename and changes to the recovered element population.
Elements without a supported native identity retain the deterministic Reviter
fallback; no 64-bit handle is truncated. Derived relations, spaces, synthetic
type objects and anonymous context keep Reviter-generated IDs.

This does not claim to reproduce every Revit exporter ID. Revit can synthesize
opening and component IDs, split one element into several products, or use saved
IFC GUID settings. Those variants are not inferred. Saved IfcGUID text is not
blindly trusted: two distinct Snowdon elements in the supplied corpus hold the
same saved IfcGUID.

IFC instance/type settings are collected from the existing owned parameter-table
decoder, including type elements that have no geometry. There is no new byte
proximity scan. Four built-in text parameters are retained:

| Parameter | ID |
| --- | --- |
| Export to IFC As | -1019014 |
| Export Type to IFC As | -1019015 |
| IFC Predefined Type | -1019016 |
| Type IFC Predefined Type | -1019017 |

Instance settings take precedence over inherited type settings. A trailing
`Type` is removed only from the inherited type's entity name. Conflicting
copies of an owner's setting are discarded permanently for that conversion;
a later matching copy cannot restore an ambiguous value. Empty text means unset.
`ConvertResult.nativeIfcExportParameters` and the JSON export report retain
these settings with `owned-element-parameter-table` provenance.

Only product classes with implemented IFC4 occurrence/type layouts are honoured.
The whitelist and per-class enumerations are in `revit-ifc-semantics.ts`.
`USERDEFINED` requires an available ObjectType. Unsupported entity names,
cross-class enums and injection-shaped strings leave the admitted default
mapping intact. Requested values and their supported/unsupported decisions are
written to the occurrence's `Reviter_Recovery` property set. Type grouping
includes both final IFC class and enum so a single Revit type with different
instance export choices never silently collapses into one IFC type object.

Nine known MEP categories now export their corresponding IFC distribution
classes/types rather than proxies. Independent reader tests cover all nine.
Geometry recovery, material recovery and placement are unchanged.

## Validation

The focused tests cover upstream Snowdon authoring-witness GlobalIds, invalid
GUIDs and oversized handles, original/current handle differences, owned-table
parameter extraction, sticky conflicts, inheritance, unsupported decisions,
per-instance type splitting and round-trips through web-ifc and IFC-lite.

Run the paired audit without loading IFC geometry into the RVT converter:

```sh
node --experimental-strip-types --import ./scripts/register-local-typescript.mjs \
  scripts/audit-ifc-native-semantics.ts model.rvt reference.ifc --json report.json
```

Omit `reference.ifc` for a source-only owned-settings inventory. The report
hashes both inputs, reports the reference schema and available Revit export
identifiers, separates matches/mismatches by actual occurrence class, and
counts repeated numeric tags. Creation identity alone does not prove matching
save revisions; the report marks revision agreement unverified.

On the supplied UNBC RVT and IFC2X3 reference, 38,061 of 41,293 reference
occurrences with a native numeric tag have the reconstructed GlobalId. There
are 38,187 distinct native tags, and 38,061 distinct native elements have a
matching reference occurrence. Of 3,232 product disagreements, 3,071 are
`IfcOpeningElement`; the remainder are 10 stairs, 57 members, 67 slabs,
14 railings and 13 stair flights. Those disagreements are preserved in the audit.

Owned IFC export settings were absent across all four provided models (UNBC,
RAC, School and Snowdon), so class/predefined-type override parity is currently
validated by framed-table fixtures and two readers, not by a real override case
in this corpus. No broader claim about Revit release or geometry coverage is
made. The reference IFC2X3 comparison validates occurrence identity only; Reviter
continues to emit IFC4.

Adapted algorithms and witness vectors retain Apache-2.0 attribution and the
license under `lib/reviter/vendor/rvt-rs/`.
