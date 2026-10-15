# Native spatial and project organization evidence

`native-spatial-organization.ts` normalizes current bounded source graphs from
the pinned reader, retaining raw record indices. `RoomElem` is a shared native
serialization class: its name, area-scheme reference, occupancy flags or zone
reference do not decide whether it is a Revit Room, Area or MEP Space.

The classification joins the same exact RVT SHA and schema SHA to the file's
`ElementHeader.m_categroryId`: `-2000160` Rooms, `-2003200` Areas and `-2003600`
MEPSpaces. The independent header pass validates class tags from the complete
file-local schema, declared IDs from the complete element table, frame length
echoes, owner IDs and stream namespaces. Embedded-family/view-owned headers,
contradictory owner categories, partial scans and missing evidence remain
unresolved. It uses no mutable global decoder state. Inflation is capped at
512 MiB across successful pages and 16 MiB per chunk, with the existing bounded
inflater's separate retry/stream accounting. These are byte limits, not RSS
limits. No newly classified element changes scene geometry or navigation.

Source `AllProjectRevisions.m_revisionIds` proves catalog membership for exact
`ProjectRevision` owners. Revision sequence, free-form date, number and issued
Boolean are retained separately; visibility is never used to infer issuance.
`WorksetVisibilitySettingsElem.m_invisibleWorksets` retains stored IDs. Neither
this list nor partition names proves workset names, ownership or editability.

The coordinate path resolves an explicit
`ActiveGeoLocationTrackingElement.m_activeGeoLocationId` to a current
`GeoLocation`, its owned `InstanceInfo`, and the exact source `GeoSite` symbol.
It validates every pointer token, class, edge and object span before retaining
`InstanceInfo.m_Trf` as row-major source matrix plus feet translation. Names
such as “Internal”, “Project” or “Default Site” never choose an active site.

The stored matrix maps shared site coordinates to internal coordinates. That
direction is verified against an owned survey `BasePoint.m_oGPoint.m_coord`
and its stored `m_transformedPosition`; the maximum allowed error is 1e-6 feet.
Only a proper, rigid, upright matrix with this source direction witness yields
an inverse internal-to-shared transform and the true-north direction in the
internal frame. Scaled, mirrored, tilted, missing or conflicting evidence
remains unresolved. Canonical render coordinates are preserved. Source
geodetic latitude/longitude and CRS text remain raw site fields; no EPSG code,
map scale or survey datum is invented.

Actual source tests recover 14 RAC rooms, 91 School rooms plus 25 Areas, 49
Snowdon rooms plus 101 Areas, and nine Mechanical MEP Spaces. Five Snowdon
room graphs exceed the native graph budget and remain raw/unresolved. RAC's
nonzero 37-degree site transform agrees with
its survey-point witness within 2.8e-14 feet. Snowdon's nonzero 26-degree site
transform agrees within 6.6e-11 feet. School, Mechanical and UNBC also provide
explicit active site/owned-transform/base-point evidence. UNBC's five source
locations remain distinct; the explicit active selector chooses one of them.
There are no selected UNBC `RoomElem` records in this native query. The complete
source query retains release limits and graph-budget failures; successful
projections do not establish evaluated Revit quantities or room boundaries.

Reproduce the selected inventory and compact proof summary with:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-spatial-organization.ts model.rvt \
  --out /tmp/spatial-inventory.json --csv /tmp/spatial-inventory.csv \
  --summary /tmp/spatial-validation.json
```

The selected native query allows up to 2,048 retained records within the
bridge's 32 MiB output budget. On-demand wider drawing/parameter queries may
retain fewer spatial/site records; missing evidence stays visible. Eleven
focused tests cover owner/frame corruption, class/namespace mismatches,
cross-file joins, revision semantics, transform inversion, source-position
disagreement and unsupported matrix shapes. Full-model summaries are in
`docs/generated/rvt-spatial-organization-validation.json`.

Source references: pinned rvt-rs `src/native_document.rs`,
`src/native_parameters.rs`, `src/elements/zones.rs`,
`src/elements/reference_points.rs`, `src/elements/project_organization.rs`;
Reviter's complete schema, element-table and header contracts. The new adapter
uses exact schema fields instead of the upstream illustrative field aliases.
Apache-2.0 attribution remains in `docs/rvt-semantic-attribution.md`.

## Optional IFC4 export

`includeSourceSpatial` exports source Areas as identity-only
`IfcSpatialZone(.USERDEFINED.)` with `ObjectType='RevitArea'`, and MEP Spaces
as identity-only `IfcSpace` records. Source Rooms retain the existing separate
native-room option. New source spatial records require the same actual RVT SHA,
schema digest and pinned reader context plus a unique native GlobalId; repeated,
suppressed, already represented or identity-conflicting owners are withheld.
Unknown location/body/quantity attributes remain unset. Areas reference their
exact source storey through `IfcRelReferencedInSpatialStructure`; MEP spaces
aggregate under that storey. Missing source-level mappings use the building.
Source revision catalogs, scheme records and visibility lists are custom
project metadata, with no inferred workset ownership.

`sourceCoordinateMetadata` optionally writes proven active-site `TrueNorth`,
bounded source latitude/longitude as IFC compound angles and the inverse affine
as a custom site property. It preserves every canonical geometry placement.
It never emits `IfcProjectedCRS` or `IfcMapConversion` from free-form CRS text.
Neither source site elevation nor an EPSG/survey datum is inferred.

Primary IFC4 ADD2 TC1 contracts were checked against buildingSMART's
[IfcSpatialZone definition](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcproductextension/lexical/ifcspatialzone.htm)
and the
[published EXPRESS schema](https://raw.githubusercontent.com/buildingSMART/IFC4.3.x-development/master/reference_schemas/IFC4_ADD2_TC1.exp).
`IfcSpatialZone` has nine inherited/local attributes, `IfcSpace` eleven and
`IfcSite` fourteen. `IfcCompoundPlaneAngleMeasure` requires normalized
minutes/seconds/microseconds and a consistent sign, including negative angles
smaller than one degree. Zones are nonhierarchical and can themselves be
referenced by another spatial element.

Six focused export tests reopen source entities with web-ifc and IFC-Lite.
The actual model audit uses the app's reader on the same RVT bytes, exports
ordinary and opted-in IFCs, reopens both and compares transformed oriented
triangles/materials rounded to one micrometre. This is a preservation check,
not a shape comparison against Autodesk. Reproduce it with:

```sh
node --max-old-space-size=6144 --experimental-strip-types \
  --import ./scripts/register-test-typescript.mjs \
  scripts/audit-ifc-source-organization.ts model.rvt /tmp/source-ifc-proof.json
```

The published proof in
`docs/generated/rvt-source-organization-ifc-validation.json` independently
reopens all six ordinary/expanded IFCs: RAC preserves 461 geometry owners,
School preserves 5,507 while adding 25 identity-only Areas, and Mechanical
preserves 83 while adding nine identity-only MEP spaces. Source property
projection disagreements and reopened geometry disagreements are zero. All
nine Mechanical source parent assignments also match the exact source-level
mapping. Areas' storey references and unknown-level building fallback are
additionally verified by focused independent-reader tests. Mechanical's final
audit captures source mesh bytes before/after export; RAC/School's mesh-byte
snapshots were taken after export, while their preservation measurement uses
the independently reopened IFC geometry.
