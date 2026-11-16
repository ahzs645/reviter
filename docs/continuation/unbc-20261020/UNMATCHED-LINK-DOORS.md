# Unmatched doors at the Building 4–8 links

Diagnosis, October 21, 2026, from the EVIDENCE-016 compiled dataset. No compiler or source change is made here.

## The defect

Buildings 4 and 8 are joined by link corridors on Floors 2 and 3 (08-260 Link, 08-360 Link). Each link's only door connection runs into Building 4. So the compiled graph, and the hallway network built from it, route between the buildings down to Floor 1 and back up: 04-255 to 08-272, both on Floor 2, is 270 m. At the Building 8 end the model has a real door on each floor, both `unmatched` with no rooms on either side:

- **2311764** (level 694) opens from 08-260 Link into Building 8's walkable cell (08-216 Vestibule / 08-265 Help Desk).
- **2315416** (level 400176) opens from 08-360 Link into the cell holding 08-305 Corridor.

The walkable cells on both sides meet at each door, 0.08 ft apart.

## Why they stay unmatched

A door's sides are room outlines within 2 ft whose nearest boundary point also lies inside the door's opening envelope: its footprint's extent plus 0.6 ft. `directoryDoors` stretches a footprint across its host wall only when the host is a measured rectangular wall. Both doors are hosted in `approximate` walls (2311758, 2315413), so their footprints stay the leaf's own 0.08 ft. The room outlines stop 1.64 ft either side of 2311764, so neither side matches. At 2315416, no room outline lies within 4.8 ft on the east side; 08-316 Corridor is the nearest.

## Why not relax the tolerance

A generic rule was tried: measure a flat door (under 0.25 ft deep) in its own frame, with the 2 ft candidate reach across the wall. On EVIDENCE-016 outlines it would add 9 connections and change none, including 2311764.

It contradicts two existing policy tests, and was reverted:

- `tests/directory-navigation.test.ts`, "a precise door opening spans its persisted host wall…": a door without host-wall evidence stays unmatched across a 3 ft wall.
- `tests/semantic-door-links.test.ts`, "…missing precise threshold cannot create portals": even an explicit semantic link is refused without host evidence.

The compiler does not infer a door's span from proximity.

## The supported fix: reviewed door apertures

`reviewedDoorApertures` in the room annotations (`lib/reviter/reviewed-door-apertures.ts`) supplies a measured aperture for a native door. `directoryDoors` then uses it as the footprint and normal, so the envelope spans the joint. Each patch is validated against the native model at the floor cut. It needs:

- the door's oriented box;
- the exact native wall parts it cuts (`wallEvidence`);
- either a complete native jamb pair (`frameEvidence`), or the `basic-wall-overlap` or `basic-host-missing-opening` kind with their own host proofs.

So it must be authored where the native model is, following the [source inspection workflow](../../source-model-inspection/README.md). Inspect both sides of each joint first, to confirm the opening is a real passage and not a closed or fire-separated door.

- **2311764:** measure the joint between 08-260 Link and 08-216 Vestibule and record the aperture across it.
- **2315416:** an aperture alone is not enough. The east side has no room outline near the door, so the room review must also extend or add the outline of the space it opens into (the walkable cell continues into 08-305 Corridor).

Both changes need a fresh native recompile with new bindings. Native attempt 006 compiled source 019 and does not include them.

## Wider review list

55 doors are unmatched or ambiguous although a walkable cell lies on each side. For 23 of them the two sides have no other connection ("only link"). Some may be correctly closed (locked, staff, mechanical), so each needs a decision in the room review: an aperture or outline correction, a reviewed door link, or confirmation that it stays closed. Rooms shown are the first two of each side's walkable cell.

| Door    | Level   | State     | Only link | One side                                       | Other side                                                            |
| ------- | ------- | --------- | --------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 621887  | 311     | unmatched | yes       | 07-305 Office/07-306A Office                   | 07-309 Vestibule                                                      |
| 1025983 | 311     | unmatched | yes       | 04-102 Vestibule                               | 04-S101 Stair                                                         |
| 1352575 | 694     | unmatched | yes       | 06-212 Storage/06-235 Washroom                 | 06-282 Corridor/06-244 Corridor                                       |
| 1968823 | 694     | unmatched | yes       | 09-S302 Stair                                  | 09-350 Corridor/09-351 Corridor                                       |
| 1996180 | 694     | unmatched | yes       | 08-246 Office/08-248 Office                    | 08-241 Office                                                         |
| 2035604 | 400176  | unmatched | yes       | 08-307 Office                                  | 08-325 Lab/08-305 Corridor                                            |
| 2215409 | 400176  | ambiguous | yes       | 10-S303 Stair/10-3578 Corridor                 | 10-3514 Comm                                                          |
| 1117420 | 402367  | unmatched | yes       | 04-443 Storage                                 | 04-402 Corridor/04-430 Corridor                                       |
| 2051009 | 402367  | unmatched | yes       | 08-S401 Stair/08-402 Corridor                  | 08-422 Spill Kit                                                      |
| 2147987 | 402367  | unmatched | yes       | 04-413 Microscopy Lab                          | 04-402 Corridor/04-430 Corridor                                       |
| 1522202 | 1450417 | unmatched | yes       | Native ramp lower approach/09-261 Reception    | 09-280 Office                                                         |
| 1964672 | 1450417 | unmatched | yes       | 09-S202 Stair                                  | Native ramp lower approach/09-261 Reception                           |
| 1972265 | 1450417 | unmatched | yes       | 09-S202 Stair                                  | Native ramp lower approach/09-261 Reception                           |
| 1779618 | 1487353 | unmatched | yes       | 06-304 Corridor/06-344 Pride Centre            | 06-340 Coordinators Office/06-342 Office                              |
| 2369239 | 1487353 | ambiguous | yes       | 06-S306 Stair 6/06-392 Club Room               | 06-396 Washroom                                                       |
| 1514947 | 1487816 | unmatched | yes       | 08-167 Classroom Support                       | 08-102 Corridor/08-105 Corridor                                       |
| 2041345 | 1487816 | unmatched | yes       | 08-S102 Stair                                  | 08-102 Corridor/08-105 Corridor                                       |
| 2064074 | 1487816 | unmatched | yes       | 08-165 Classroom Support                       | 08-102 Corridor/08-105 Corridor                                       |
| 2064122 | 1487816 | unmatched | yes       | 08-165 Classroom Support                       | 08-102 Corridor/08-105 Corridor                                       |
| 2064154 | 1487816 | unmatched | yes       | 08-167 Classroom Support                       | 08-102 Corridor/08-105 Corridor                                       |
| 2293604 | 1487816 | ambiguous | yes       | 10-1312 Atrium/10-1302 Atrium                  | 10-1500 Vestibule                                                     |
| 2471813 | 1487816 | unmatched | yes       | 10-1312 Atrium/10-1302 Atrium                  | 10-1300 Vestibule                                                     |
| 2302931 | 2295121 | unmatched | yes       | 10-B514 Hydrology Lab                          | 10-B510 Corridor/10-B500 Corridor                                     |
| 754072  | 311     | ambiguous |           | 07-750 Circulation/07-751 Circulation          | 05-111 Office                                                         |
| 1025528 | 311     | unmatched |           | 04-109 Corridor                                | 04-107 Fish Tank Lab                                                  |
| 1499415 | 694     | ambiguous |           | 10-2006 Office/10-2010 Corridor                | 10-2032 Artificial Intelligence Lab                                   |
| 1513788 | 694     | unmatched |           | 08-264 Signout Equip Storage/08-265 Help Desk  | 08-232 Soils Lab/08-231 Sediment and Soils Lab                        |
| 1513794 | 694     | unmatched |           | 08-264 Signout Equip Storage/08-265 Help Desk  | 08-232 Soils Lab/08-231 Sediment and Soils Lab                        |
| 1998631 | 694     | unmatched |           | 08-230 Sediment and Soils Lab                  | 08-232 Soils Lab/08-231 Sediment and Soils Lab                        |
| 2125864 | 694     | unmatched |           | 04-219 Chemical Storage/04-228 Spill Kits      | 04-259 Rotunda/04-236 Vestibule                                       |
| 2125901 | 694     | unmatched |           | 04-235 Avian Research Lab/04-234 Wet Lab       | 04-259 Rotunda/04-236 Vestibule                                       |
| 2125931 | 694     | unmatched |           | 04-259 Rotunda/04-236 Vestibule                | 04-212 NALS Water Testing                                             |
| 2126503 | 694     | unmatched |           | 04-201 Vestibule                               | 04-215 Env. Research Lab                                              |
| 2311764 | 694     | unmatched |           | 08-260 Link                                    | 08-264 Signout Equip Storage/08-265 Help Desk                         |
| 2406157 | 694     | unmatched |           | 03-1002 Office/03-1003 Office                  | 03-1038A Hallway/03-1005 Office                                       |
| 2469130 | 694     | unmatched |           | 08-264 Signout Equip Storage/08-265 Help Desk  | 08-232 Soils Lab/08-231 Sediment and Soils Lab                        |
| 1659663 | 400176  | unmatched |           | 03-2027 Comm/03-2021 Office                    | 03-2077 Office                                                        |
| 1668242 | 400176  | unmatched |           | 03-2027 Comm/03-2021 Office                    | 03-2011 Office                                                        |
| 2037503 | 400176  | unmatched |           | 08-318 Prep Room/08-319 Prep Room              | 08-325 Lab/08-305 Corridor                                            |
| 2042015 | 400176  | unmatched |           | 08-325 Lab/08-305 Corridor                     | 08-338 Coffee & Wait Room/08-342 Office                               |
| 2110442 | 400176  | unmatched |           | 04-307 Engineering Lab                         | 04-329 Rotunda/04-310 Media Prep Sterile Room,Genome Containment Room |
| 2110526 | 400176  | unmatched |           | 04-315 Wet Lab                                 | 04-329 Rotunda/04-310 Media Prep Sterile Room,Genome Containment Room |
| 2110619 | 400176  | unmatched |           | 04-314 Lab Prep Room                           | 04-329 Rotunda/04-310 Media Prep Sterile Room,Genome Containment Room |
| 2215567 | 400176  | unmatched |           | 10-3500 Vestibule                              | 10-3608 Washroom                                                      |
| 2315416 | 400176  | unmatched |           | 08-360 Link                                    | 08-325 Lab/08-305 Corridor                                            |
| 2148561 | 402367  | unmatched |           | 04-408 Equipment Room                          | 04-402 Corridor/04-430 Corridor                                       |
| 2148595 | 402367  | unmatched |           | 04-407 UAV Sensor and Meteorological Equip Lab | 04-402 Corridor/04-430 Corridor                                       |
| 2419165 | 402367  | unmatched |           | 03-3049 Office/03-3045 Corridor                | 03-3067 Office                                                        |
| 2465283 | 402367  | unmatched |           | 08-S401 Stair/08-402 Corridor                  | 08-439 Office/08-441 Office                                           |
| 1522203 | 1450417 | unmatched |           | Native ramp lower approach/09-261 Reception    | 09-271 Corridor/09-272 Shared Office                                  |
| 1779388 | 1487353 | unmatched |           | 06-314 Projection                              | 06-313 Soundproof Vestibule                                           |
| 1515126 | 1487816 | unmatched |           | 08-128 Prep Room / Research Office             | 08-127 Lab                                                            |
| 1515127 | 1487816 | unmatched |           | 08-102 Corridor/08-105 Corridor                | 08-127 Lab                                                            |
| 2018558 | 1487816 | unmatched |           | 08-122 Research Meeting Room/08-120 Corridor   | 08-102 Corridor/08-105 Corridor                                       |
| 2294582 | 1487816 | unmatched |           | 10-1500 Vestibule                              | 10-1588 Washroom                                                      |
