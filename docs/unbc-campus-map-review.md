# UNBC campus map review

This record explains the campus map decisions made during the September 29 to October 1, 2026 review, how those decisions are stored, and which operations the interface supports. The purpose is to make the imported plans useful for reviewing circulation, room boundaries and connections in their architectural context.

The map combines source annotations, registered drawing linework and recovered Revit geometry. A shared green fill describes reviewed circulation; it does not by itself prove that every outline belongs to one walking network. Routes need a supported opening or matched stair connection. The current review retains the original source records and distinguishes user reports from geometry checks.

## Files and current state

Load these two files together using **Open a Revit file**, or import the JSON after opening the matching model:

- `/Users/ahmadjalil/Downloads/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`
- `/Users/ahmadjalil/Downloads/rooms.public-circulation-reviewed.json`

The latest JSON contains 1,860 active source and recovered area records. The campus source coverage panel distinguishes 1,855 imported records from recovered additions and lists 360 skipped labels across 16 plans. These coverage counts do not mean every source boundary or route has been verified. The browser reports geometry recovery as partial.

Campus Floor 1 now groups native levels #1450417, #311 and #1487816. Its 627 records cover Buildings 03, 04, 05, 07, 08, 09 and 10. Their elevations remain −3.28, 0.00 and 3.28 ft. Building 09 belongs to the same campus storey; the separate Floor 0.5 campus entry was removed. Individual building views still retain their native level identities.

The current Agora hallway group contains 28 source records, about 1,938.1 m² and 15 outlines. This includes the newly reviewed 07-178 and 07-179. Earlier counts changed as public circulation was added and staff areas were excluded; the original source records were retained throughout.

## Decisions available in the interface

Select a source outline or a source-record chip within a grouped area before changing its use. Otherwise a shared area may contain several records and the intended record can be ambiguous.

| Decision | Interface operation | What the saved review means |
| --- | --- | --- |
| Shared circulation or atrium | **Selected source record use** → **Shared circulation** or **Shared atrium** | Classifies that source record while retaining its original name and outline. Touching compatible outlines can share a fill. |
| Keep a distinct room | **Selected source record use** → **Separate room** | Retains a separate area in the display. |
| Public or staff access | **Selected source record access** | Records the reported access. Staff records remain physical floor but are excluded from public routes. |
| No floor beneath an outline | **Walkability** → **Void / drop** | Excludes that area from walking routes and flat 3D floor fills. |
| Landing versus storey stair | **Storey connection** in stair details | Records local-only steps, flight and landing, or an upward flight with local downward steps. |
| Wrong room boundary | **Show room review** → **Edit boundary** | Edits source geometry; **Restore imported boundary** restores the imported outline. |
| Door relationships | Select a door circle and review its sides | Keeps the native door identity and distinguishes matched access from an unresolved opening. |
| Names, notes and model identities | **Associate area metadata** | Saves area metadata separately from the source labels. |
| Inspection location | Double-click the map | Shows model coordinates, containing records and nearby native geometry. A pin alone does not create a walking surface. |
| Shared campus floor | **Assign campus floors** → select native levels, name the campus floor and save | Groups offset native levels into one campus map. **Ungroup levels** restores individual level entries. Heights, source boundaries and navigation reviews are retained. |
| Campus and model context | **Campus map**, building focus buttons, **Show this floor in 3D** | Displays the current grouped storey and its recovered heights. |

**Circulation only** hides ordinary room fills while preserving architectural outlines. **Hide staff-only areas** also hides restricted fills, labels and crossing markers. **Connected circulation** can show reported access context, which remains distinct from a verified route.

Use **Export rooms with edits** after interface edits. Import the exported file in later sessions. The RVT is not rewritten by these annotations.

## Decisions that still require annotation editing

The interface can display and export the following reviews, but currently has no dedicated authoring form for them:

- Saving a local building transition with identified native steps and supporting slabs using `buildingTransitions`.
- Creating a precise passage without a door using `navigation.openLinks`.
- Adding reported area relationships and unassigned staff review pins.
- Assigning a specific native stair flight and a supported arrival point when source stair outlines are displaced.

Those operations were prepared against the local model and imported as JSON. They should not be described as decisions already fully available through the interface. A useful next interface addition would let a reviewer select two source areas, pick each side of an opening, enter a crossing width, see the drawing and native obstruction checks, and save a validated passage. Campus storey grouping now has an editor: **Assign campus floors**. A native level can belong to only one assignment. Edit its existing assignment to release it before adding it elsewhere.

## Assigning a shared campus floor

Open **Assign campus floors** from the map toolbar in either a building or campus view. Choose an existing assignment or **New shared campus floor**, enter its name, and select at least two native levels. Each row shows its original elevation, building coverage and source plans. Save opens the resulting campus map. You can rename the assignment, change its members or use **Ungroup levels** to restore separate map entries. Export rooms with edits or the project ZIP to preserve the assignment for later sessions.

This operation changes the semantic map grouping only. It retains native elevations, local step evidence, room geometry, access restrictions and navigation reviews. Grouping levels does not create a walking connection between them.

## Pathways without doors

An open plan area can have a traversable boundary without a Revit door object. The routing engine supports explicitly registered open passages. Each passage has its own identity, two source areas, crossing coordinates, width, native level and drawing hash. It is rejected if the registration is stale, its endpoints miss the current areas, or its crossing strip intersects drawing walls, native walls, columns or another source area. It never receives a fabricated door ID.

For 07-178 Multi Purpose Lounge and 07-179, the user identified open shared circulation adjoining 07-180. Both source records now use the hallway classification. Three passage strips, each 3 ft wide, were checked at the open boundaries between 178 and 179, 178 and 180, and 179 and 180. The width is the checked routing strip, not a measured claim about the full opening width.

Local verification found routes from both added records to 07-180 using the open passages and native wall barriers without supplying any native door links. Approximate grid distances were 28.9 m from the 07-178 label and 25.2 m from the 07-179 label. These are local verification results, not a complete campus route or a measured travel survey. A visually combined fill still retains source columns, holes and any real gaps.

The reviewed annotations were reimported into the live interface. Selecting 07-179 as the start and 07-178 as the destination shows an approximately 11 m route with zero recovered door links. The screenshot is saved at `work/agora-open-circulation-review/open-route.jpg`.

## Boundaries and connections reviewed

The initial plans contained separate room labels within apparently continuous atriums and corridors. We grouped compatible circulation records and retained each label's identity so a selected region can expose its original drawings, model relationships and review notes. We also inspected gaps rather than joining every nearby polygon: a gap can be an omitted source strip, a wall, a door threshold, a height change or a void.

| Building | Decisions and checks | Remaining limits |
| --- | --- | --- |
| 03 CJMH | Reviewed Copy and Copy Room access to hallway circulation. Added a registered open boundary for the 2007A connection. Inspected the difference between the S203 source area and actual stair geometry. | Source stair extents and arrival alignment still need review where native recovery is incomplete. |
| 04 Research Laboratory | Marked upper Rotunda 04-445 as a void based on the user's report. Reviewed raised ground Rotunda 04-124, local steps and the separate doorway to Agora. | The local Rotunda crossing has a discontinuity in recovered surface support. The distant Agora door is not evidence that the whole Rotunda gap is walkable. |
| 05 Library | Grouped reviewed open areas, plazas, stacks, study spaces, bridge and display areas by their levels. Inspected native stair flights, lower-floor space under stairs and upper arrival openings. | Some source stair labels intersect flights or have incomplete arrival boundaries. The open library stair remains distinct from a completed directory route. |
| 06 Conference | Reviewed actual flights and surrounding landings, the separate pub access record, the upper private Soundproof record and shared lounge circulation. | Some recovered flights still lack a matched source entrance. The missing ground plan cannot be assigned from ambiguous registration. |
| 07 Agora | Grouped reported open atrium and circulation areas, including Waiting Lounge 203A. Retained enclosed under-stair records. Excluded reported staff circulation. Added 178 and 179 and their checked open passages. | Not every Agora doorway or outline has been verified. Unassigned staff location pins need actual boundaries before an area can be hidden geometrically. |
| 08 Teaching Laboratory | Treated the S101 landing and downward local steps as same-storey circulation, retaining the separate upward flight to S201. Added Agora 155 and Alcove 159 to shared circulation. | Nearby Office, Storage and Print records keep separate boundaries and their reported access relationships. An upward flight does not prove clearance below it. |
| 09 Medical | Reviewed the gallery, kitchenette, commons and study-space relationships. Included the lower native level in Campus Floor 1 and checked the local connection to 07-180. | Missing slab associations elsewhere on this plan remain visible as review items. |
| 10 Teaching and Learning | Combined the four atrium source labels on the first-floor view. Recorded user-reported usual fire-door use and reviewed Lounge 1021 access and upper atrium walkway coverage. | Current fire-door position is unknown. Ambiguous upper atrium plan registration still prevents confident recovery of every walkway. |

## Local changes of elevation

Building 07 and Building 08 connect through native step assembly #1620957. The upper landing has native slab support but lacks a source room outline. It is not automatically assigned to 08-S101.

Building 07 and Building 09 connect through native assembly #1644499 and run #1644524. Five recovered tread elevations join the upper slab at 0.00 ft to the lower Medical slab at −3.28 ft. The user's Medical pin was on the upper approach; the checked lower endpoint lies farther east inside 09-201, beyond the steps. The local crossing passed the recovered surface and barrier checks. Grouping these levels into Campus Floor 1 changes the display catalog, not their physical heights or complete campus routing.

## Stairs and overhead space

A source record called Stair can include a flight, landing and surrounding space. Actual native treads define where the flight projects; the entire source polygon should not automatically become an inter-storey staircase.

The maps distinguish green same-storey steps from purple flights and optional blue overhead projections. The 3D view retains the actual recovered stair heights and cuts away higher geometry. An overhead projection does not establish a flat walking surface underneath. At a lower landing, usable floor may exist below a flight; on an upper storey, the descending stair opening must remain open. Headroom and access below still require review.

## Staff circulation and public filtering

The user identified 07-752, 07-113A, 07-702 and then 07-751 as staff areas. The associated Library 05-117 crossing was also reviewed as staff access. These records keep their physical boundaries but are excluded from public circulation and public route traversal. The unassigned staff pin near X25.86 Y236.37 ft was retained as a review location because a supported area boundary was not recovered there.

## What we tried and what remains unresolved

We used source plan registration, native slabs, wall cuts, door footprints, stair runs, local surface sampling and 3D context to investigate disconnected fills and incorrect source extents. We compared source polygons to these recovered elements and preserved holes rather than expanding every shape to a nearby wall or across an atrium void.

Several approaches were deliberately left incomplete when evidence was insufficient: assigning ambiguous upper atrium drawings to a floor, inventing an unassigned staff polygon, routing through an unsupported Rotunda strip, and treating every stair label or overhead footprint as an entrance to another storey. Registered drawing linework provides wall context where the native cut lacks recovered walls, but its association still needs review when slab matching fails.

The saved reviews should next be checked in the model and on site where source and native geometry disagree. Priority work is to add the missing authoring controls, resolve ambiguous source plans and supported stair arrivals, and connect verified local crossings into a campus routing graph. Access reports, usual fire-door use and colored fills should remain distinguishable from measured geometry and complete walking routes.

## Verification and supporting records

The shared-floor editor was tested in the live interface by creating and ungrouping a temporary assignment, editing Floor 1’s name and membership, and restoring its three reviewed native levels. A browser export matched the prior reviewed data exactly, including all 1,860 records and navigation reviews. The export was then reimported for a further interface check. Twenty-six focused tests, the application type check and production build passed. The full repository type check remains affected by existing scratch-work errors and missing IFC audit dependencies.

The October 1 open-circulation change preserved all 1,860 annotation records, the Campus Floor 1 grouping, existing building transitions, door reviews and stair links. Eight focused tests covering campus grouping, retained 3D heights and open-passage barrier rejection passed. Local assertions separately checked the three new passages, their lack of door identities, the updated hallway membership and routes to 07-180.

Supporting local records are under `work/agora-open-circulation-review`, `work/building-07-09-review`, `work/public-circulation-review`, `work/atrium-upper-stair-review`, `work/library-circulation-map-review` and the earlier building review directories. These working artifacts include before-file snapshots, verification JSON and map or model screenshots. The latest reviewed JSON remains the file to import; older intermediate room exports contain superseded decisions.
