# Room boundaries for clean indoor blocks

The hospital-style map needs two separate shapes: the room's **navigable finish-face interior** and the **display roof** that may absorb native wall material. Display roofs are never route geometry. Corridors remain flat; source holes, floor apertures, native columns and door openings stay protected.

## What the UNBC evidence supports

The original prepared package had 1,566 eligible room/area annotations, including 66 stair areas. The first precise wall-face recovery produced 881 display blocks; 685 annotations retained source outlines. That aggregate included 56 stair areas and 629 ordinary destinations. An open stairwell is not an unfinished private room, and an unclosed destination label does not by itself prove that the model is broken.

`promoteNativeRoomInteriors(dataset, roomDirectory)` independently checks prepared interiors before an explicit full routing regeneration. On this package it permits 866 interiors, excludes ten stair/ineligible rooms, two rooms overlapping protected floor and three with significant native barrier overlap. It preserves label/arrival compatibility and every source opening, and stores original rings in `nativeInteriorProvenance`. Native enclosure inference remains identified as inference; it is not a Revit semantic room export or a passage-clearance certification.

`auditRoomBoundaries(dataset, annotations)` emits per-room provenance, coverage, failure reason and a source correction action. It prioritizes building/native-level scopes by unresolved room count. The prepared-package report includes this audit under `boundaryAudit`.

## Native joint repair and complete native-level evidence

The follow-up preparation recovered 1,042 native interiors/display blocks from the hospital-review input, including 1,031 ordinary rooms and 11 stair areas. This is 161 additional prepared annotations with no loss of the previous 881 verified blocks. Strict promotion accepts 1,026 interiors; stairs and interiors conflicting with barriers/protected floors remain excluded. These measurements describe the input audit; use the regenerated package report for the final compiled counts.

Studio 05-122 illustrated two different problems: a coarse raster contour stopped short of its native corners, while its native wall projections had a 0.06326 ft (19.3 mm) T-junction seam and a 0.0126 ft (3.8 mm) tapered corner seam. Version 2 closes only short rectangular native wall end caps that reach independently recovered wall/column material within 0.08 ft (24.4 mm). A single supported cap corner has a stricter 0.04 ft limit and receives only a microscopic wedge. Native door envelopes exclude these patches. Door closure also requires actual material or jamb support along the doorway's long axis; front/back wall proximity cannot seal a gap.

`recoverNativeWallJunctionRepairs(walls, doors)` reports each derived patch's native level, native wall ID, supporting wall/column ID, measured gap, repair type, limit and exact internal-feet polygon. Spatial indexing preserves the original evidence order. Source wall/door arrays and original RVT bytes remain unchanged; these are explicitly derived preparation repairs, not edits to the source Revit file.

Local wall-face recovery remains preferred. Unclosed labels receive a complete native-level fallback: union native barrier material once per level, extract its bounded free-space holes, and subtract actual barrier islands/columns. Coordinates use a local frame and 0.0001 ft numerical precision. The original 65% source/cell overlap, independent-label, native-barrier, protected-floor and source-hole checks still apply. A coarse annotation cannot crop away a distant wall, and the fallback never fabricates a partition. Cached contexts are local to each call; repeated preparation is deterministic for unchanged input. A failed roof-material ownership operation retains the verified interior under every protected/door/hole mask.

The remaining input annotations comprise 469 ordinary destinations and 55 stair areas. For ordinary destinations, 230 have no closed native-level enclosure, 233 fail source-to-cell overlap, five explicitly share a cell, and one has no local native walls. The audit further separates overlapping cells with other labels from lone open-plan cells and crossing/mismatched contours. For example, 07-253/07-252/07-249 share a cell; 05-107/05-108 also remain contested. Neither case authorizes a divider drawn halfway between labels.

Generate the complete patch inventory and per-room correction queue after regeneration:

```sh
node --experimental-strip-types scripts/audit-room-junctions.ts --input /absolute/prepared.reviter.zip --out /absolute/joint-review.json
```

The output separates `ordinaryRoomCoverage` from `verticalCirculationCoverage`, preserves the previous aggregate fields, and includes `ordinaryRoomFailureCategories`. Native wall 1500873 lacks an explicit decoded level relation but is already present in prepared cut levels 311 and 1487816; missing relation metadata must not be reported as a missing wall.

## When offline recovery cannot define the room

Export real semantic boundaries from the same source RVT in Revit using `SpatialElement.GetBoundarySegments()` and `SpatialElementBoundaryOptions.SpatialElementBoundaryLocation = Finish`. Revit's boundaries include room-bounding walls and room-separation evidence. An unenclosed or schedule-only room can return no boundary; reject it rather than substituting a bounding box. Phase identity and native level must be explicit. See [Autodesk room boundaries](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API/files/Revit_API_Developers_Guide/Discipline_Specific_Functionality/Architecture/Revit_API_Revit_API_Developers_Guide_Discipline_Specific_Functionality_Architecture_Rooms_html.html) and [Autodesk room/space geometry](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API/files/Revit_API_Developers_Guide/Revit_Geometric_Elements/Geometry/Revit_API_Revit_API_Developers_Guide_Revit_Geometric_Elements_Geometry_Room_and_Space_Geometry_html.html).

The existing offline parser does not execute Revit's semantic API. A Revit add-in or Autodesk-hosted Revit export is required to create this source evidence. Curves must be tessellated at a documented geometric tolerance, each circuit must close, and outer/hole loops must be classified. Keep Revit **internal XY feet** without shared-coordinate transforms. Preserve boundary element IDs (including room separation), Room UniqueId, phase UniqueId and the original RVT SHA-256. Explicitly map the native room to an annotation `roomKey`; room number alone is insufficient across buildings, phases and repeated floor plans. Do not use colors, room names or nearby-label proximity to fabricate room separators.

The import sidecar contract is:

```json
{
  "format": "reviter-semantic-room-boundaries",
  "version": 1,
  "sourceModelSha256": "<64-character digest of the original RVT>",
  "units": "feet",
  "coordinateSystem": "revit-internal",
  "boundaryLocation": "finish",
  "exporter": "<Revit exporter name/version; tessellation tolerance>",
  "rooms": [{
    "roomKey": "<existing annotation key>",
    "nativeRoomUniqueId": "<Revit Room UniqueId>",
    "phaseUniqueId": "<Revit Phase UniqueId>",
    "levelId": 311,
    "elevationFeet": 0,
    "ringsFeet": [[[0,0],[10,0],[10,10],[0,10]]],
    "boundaryElementIds": [101,102,103,104]
  }]
}
```

These coordinates and IDs are illustrative, not UNBC source data. `ringsFeet[0]` is the exterior; later rings are holes. Disconnected regions need separate reviewed annotation mappings; the importer accepts one region per room. A file's declared exporter does not establish authenticity: use an export from the actual source model. Validation confirms model identity, mapping uniqueness, native surface/elevation, ring topology, label location, source overlap, independent room labels, protected floor and native barrier intersections. Two accepted semantic interiors that overlap are both rejected.

For visual-only import:

```sh
npm run indoor:presentation -- --input /absolute/prepared.reviter.zip --out /absolute/semantic-preview.reviter.zip --semantic-boundaries /absolute/finish-boundaries.json
```

Source records, nodes, edges, walls, doors, model bytes, scene and GIS are preserved. The source and graph immutability assertion runs before package writing. Rejected entries receive `semantic-*` diagnostics and leave existing native/source presentation available. Model/coordinate metadata mismatch rejects the whole export.

For authoritative source regeneration, use `validateSemanticRoomBoundaries(dataset, annotations, input)` followed by `applySemanticRoomBoundaries(directory, acceptedRooms)` and the complete indoor pipeline. For inferred native interiors, use `promoteNativeRoomInteriors` explicitly before the same full compile. Door matching, arrivals, obstacle checks and graph connections must all rerun. Existing geometry-bound accessibility reviews require fresh verification after geometry changes; display import alone never changes routing or certifies accessibility.

Promoted semantic annotations retain structured `semanticInteriorProvenance`: native Room/phase UniqueIds, exporter, elevation, source model digest, Finish/internal-feet schema, supporting element IDs, unchanged-ring geometry key and original source rings. Ordinary pipeline regeneration reconstructs this evidence and repeats full semantic validation, preserving `revit-finish-face` presentation provenance without requiring the sidecar again. Changed model identity, schema or annotation rings invalidate saved semantic evidence; new native obstacles can also reject previously accepted interiors. Visual-only sidecar import does not promote/save source annotation evidence; use the authoritative full preparation mode when repeatable source regeneration is intended.

## Remaining source work

- Missing native partitions/jambs: recover source wall geometry or export semantic Finish boundaries.
- Shared room labels such as 05-107/05-108: verify native room separators rather than slicing their shared enclosure between labels.
- Unmatched doors: export Revit `FromRoom`/`ToRoom` for the relevant phase, preserve native door identity/footprint, and review ambiguous annotation mapping. Geometric proximity alone does not prove a passage.
- Floor holes versus column holes: preserve source openings and independently classify actual open-to-below regions; blanket transparent floor plates create false visibility.
- Elevators/escalators: export explicit connector type, served levels, entrance footprints, direction and accessibility. Shaft/name/XY overlap does not authorize a vertical connection.
- Visitor style: curate campus building, department/category and destination metadata. Approximate raster contours should remain visible in review until their source evidence is corrected.

Tests: `node --experimental-strip-types --test tests/native-room-presentation.test.ts tests/room-block-presentation.test.ts tests/semantic-room-boundaries.test.ts tests/native-room-promotion.test.ts`.

## Revit exporter and explicit mapping

`tools/revit-semantic-export/` now contains a read-only external command, project file and add-in manifest. It exports actual Finish circuits, supporting element identities/Room Bounding flags, native Room/phase/level identities, and door `FromRoom`/`ToRoom` for each phase. Unenclosed rooms, disconnected circuits, unsaved model changes and unavailable relationships produce diagnostics rather than boxes or invented links. Coordinates remain internal feet. Linked models are reported; this host-only exporter does not silently transform linked boundaries.

Build on Windows against the installed Revit SDK:

```powershell
dotnet build tools/revit-semantic-export/Reviter.SemanticExport.csproj -c Release -p:RevitInstallDir="C:\Program Files\Autodesk\Revit 2027"
```

The project targets .NET 10 for Revit 2027 ([Autodesk runtime migration](https://help.autodesk.com/cloudhelp/2027/ENU/Revit-WhatsNew/files/GUID-8D7A4715-EAF8-4BD1-BE78-061F900D0BCE.htm)). For Revit 2026, use `-p:TargetFramework=net8.0-windows` and its matching installation path. Set the manifest's assembly path to the built DLL and copy it to `%APPDATA%\Autodesk\Revit\Addins\2027`. Open a saved local copy of the exact source model with no unsaved changes, then choose **Add-ins → External Tools → Export Reviter Finish Inventory**. The SHA-256 is calculated from the saved RVT, so an upgraded/saved model needs a corresponding newly imported source package. This command does not edit the model. The C# command has not been built or executed on this macOS workspace; Windows Revit integration remains unverified. Its inventory mapper/import validation is covered by local tests.

Map stable identities explicitly with a version-1 JSON file:

```json
{
  "version": 1,
  "sourceModelSha256": "<exact source digest>",
  "rooms": [{
    "roomKey": "<existing annotation key>",
    "nativeRoomUniqueId": "<exported Room UniqueId>",
    "phaseUniqueId": "<exported phase UniqueId>",
    "levelId": 311
  }]
}
```

The level ID is the explicitly selected existing annotation floor, not an assumed floor number. Identifiers above are illustrative. Use the inventory Room/phase identities and actual source keys; room numbers and proximity alone do not authorize mapping.

```sh
node --experimental-strip-types scripts/map-revit-finish-inventory.ts --project /absolute/prepared.reviter.zip --inventory /absolute/reviter-finish-inventory.json --mapping /absolute/room-mapping.json --out /absolute/finish-boundaries.json
npm run indoor:prepare -- --input /absolute/prepared.reviter.zip --semantic-boundaries /absolute/finish-boundaries.json --out /absolute/semantic-prepared.reviter.zip --revit-version 2027
```

The mapper preserves holes, rejects disconnected/ambiguous mapping and records unresolved doors in `.mapping-review.json`. Full preparation repeats all independent Finish-boundary and native threshold checks. Optional semantic door entries must match exact native door ElementId/UniqueId, floor, phase and both mapped Room UniqueIds. They need the actual precise threshold and opposite-side room coverage. Accepted door evidence persists in reviewed navigation and is revalidated on each regeneration. An exterior null `FromRoom` or `ToRoom` never creates an imaginary room. API semantics: [Autodesk phase-specific FromRoom](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/2b41a232-8cc9-e2bf-8e47-dd95eaf25275.htm).
