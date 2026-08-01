# UNBC RVT CAD and floor-plan audit

Source: `UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`

## Result

- The RVT retains **30 distinct DWG filenames** in inflated Revit partition records.
- `TransmissionData` contains only two missing text-table references and **no external CAD link**.
- No raw `AC10…` DWG payload was found. The filenames are evidence of imported CAD sources, not recoverable copies of the original DWG files.
- Revit's persisted `Element.m_assocLevelId` relationships expose 12 usable levels. A level-isolated SVG was generated for level element **311**, elevation **0.000 ft**.
- The level-311 SVG contains **18,188** recovered footprint segments. It is a geometry plan, not a native Revit sheet: annotations, dimensions, CAD layers, line weights, and view-specific visibility are not reconstructed.
- Level 311 contains **5 actual Revit `Floors` slabs**. Their native sketch loops render separately in the floor-plates SVG, including three visible interior openings in the western slab.
- The file and paired IFC expose no native room instances (`Rooms`: 0; `IfcSpace`: 0). An optional derived-room pass therefore treats connected open floor cells separated by recovered walls as approximate, unnamed zones.
- On level 311 the derived pass finds **135 zones** from **1,989 wall records** at a **1.4 ft grid resolution** in about **0.45 seconds**. Large atria, corridors, terraces, and regions joined through incomplete walls can remain merged.

## Persisted DWG names

- `1 часть 2 этаж.dwg`
- `1 часть 3 этаж.dwg`
- `1 часть 4 этаж.dwg`
- `2 часть 2 этаж.dwg`
- `2 часть 3 этаж.dwg`
- `2 часть 4 этаж.dwg`
- `2 часть 5 этаж_пентхаус.dwg`
- `3 часть 2 этаж.dwg`
- `3 часть 3 этаж.dwg`
- `3 часть 4 этаж.dwg`
- `4 часть 2 этаж.dwg`
- `5 часть 2 этаж.dwg`
- `6 часть 2 этаж.dwg`
- `6 часть 3 этаж.dwg`
- `6 часть 4 этаж.dwg`
- `6 часть 5 крыша.dwg`
- `7 часть 2 этаж.dwg`
- `8 часть 2 этаж_ист.dwg`
- `8 часть 2 этаж.dwg`
- `8 часть 5 этаж_ист.dwg`
- `8 часть 5 этаж.dwg`
- `8.1 part 2 floor.dwg`
- `8.1 часть 2 этаж.dwg`
- `Building 10 - Teaching and Learning Centre - L0 (Basement).DWG`
- `Building 10 - Teaching and Learning Centre - L3.DWG`
- `Building 10 - Teaching and Learning Centre - L4.DWG`
- `Building 7 - Agora - L1 - Stairs to Building 8.DWG`
- `Part 3, 3rd floor.dwg`
- `Part 8, 2nd floor.dwg`
- `Подложка всего здания.dwg`

## App behavior added

- Recovery Report → Summary lists the retained DWG names and explains whether they are name-only records or external links.
- Recovery Report → Exports has a Revit-level selector and **Level plan SVG** action.
- **Floor plates SVG** isolates the actual `Floors` category and draws its native sketch loops with openings, rather than drawing every element envelope on the level.
- Recovery Report → **Floors** is an in-app browser with previous/next controls, a floor-level selector, inline slab preview, level metadata, and per-floor SVG download. Levels without recovered floor plates are omitted.
- Floors → **Show derived rooms** overlays the approximate zones in orange, labels the data **Inferred**, reports the wall inputs and grid resolution, and includes the overlay in the downloaded floor SVG. It is off by default and never presents the zones as native Revit Rooms.
- **Open side sub-map** moves the synchronized floor/room SVG into a compact viewport overlay. It remains available after the Report dock closes, supports level switching and room visibility independently, and does not change the 3D camera.
- Whole-model SVG export no longer overflows the JavaScript call stack on this model.
- CLI floor export:

  ```bash
  npm run extract -- model.rvt --out floor.svg --level-id 311
  npm run extract -- model.rvt --out floor-plates.svg --level-id 311 --floor-plates
  ```
