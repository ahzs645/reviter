# Autodesk exporter identity contract

Primary-source review uses Autodesk's public [`revit-ifc` exporter at `3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8`](https://github.com/Autodesk/revit-ifc/tree/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8). This documents behavior; no Autodesk implementation was copied into Reviter.

[`GeometryUtil.UsesInstanceGeometry`](https://github.com/Autodesk/revit-ifc/blob/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8/Source/Revit.IFC.Export/Utility/GeometryUtil.cs#L4541) reads the family instance with the IFC export geometry options. It returns false when the geometry summary contains only geometry instances. Otherwise it compares the instance and current family symbol summaries; unequal summaries select instance geometry. [`FamilyGeometrySummaryData`](https://github.com/Autodesk/revit-ifc/blob/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8/Source/Revit.IFC.Export/Utility/FamilyTypeInfo.cs#L31) compares curve counts and lengths, edges, faces and areas, meshes and triangle counts, points, polylines and coordinate counts, profiles, solids, volume, surface area, and solid face/edge counts. Revit's original symbol and current symbol have different roles: the former supplies the normal type identity, while the latter supplies this summary comparison.

A persisted `GInstance.m_oEmbeddedSymbolGRep` pointer is therefore insufficient to reproduce the exporter decision. A complete native graphics FIFO is useful source evidence, but its view/direction/cut filters and possibly multiple representations need the same selection semantics as the API geometry options before its `Geometry.m_pFaces` and `m_pEdges` become API solid counts. Triangle counts alone cannot replace the analytic summaries. Even a complete, correctly rendered saved graphics body does not establish equality with the API geometry summary selected by the exporter.

[`GUIDUtil.CreateInternal`](https://github.com/Autodesk/revit-ifc/blob/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8/Source/Revit.IFC.Export/Utility/GUIDUtil.cs#L261) uses subelement index 2048 for instance geometry only when there is no entity-type disambiguation, level/material override, or split-range index. Other variants include split-type indices, entity/predefined type, level, alternate copy index, material and assembly membership. [`CreateGUIDString`](https://github.com/Autodesk/revit-ifc/blob/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8/Source/Revit.IFC.Export/Utility/GUIDUtil.cs#L320) retries with entity-type disambiguation when the first identity conflicts in the exporter's GUID cache. Reviter's collision handling remains deterministic, but it does not claim every exporter cache/configuration variant.

[`DoorWindowInfo`](https://github.com/Autodesk/revit-ifc/blob/3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8/Source/Revit.IFC.Export/Utility/DoorWindowInfo.cs#L539) calculates symbol flip using the transformed center of `GetOriginalGeometry(options)` bounds, the host wall's local axis derivative, its extrusion direction and instance basis Y. A straight vertical wall is the currently admitted special case. For a curved or slanted wall, an axis AABB or global Z assumption cannot substitute for that derivative. Missing host/facing evidence remains unknown; a reference hash matching one flip candidate never selects it.

## Reproducible per-case diagnosis

Run the source field/FIFO scan, then compare hypotheses against the paired IFC:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/audit-ifc-type-recipes.ts /workspace/models/unbc.rvt --exported /workspace/scratch/head-to-head-continuation.json.artifacts/3-unbc.rvt/reviter.ifc --reference /workspace/models/unbc-reference.ifc --json docs/generated/rvt-ifc-type-recipe-triage.json
```

The [historical 246-case baseline report](generated/rvt-ifc-type-recipe-triage.json) retains the exact source/IFC SHA-256 values, stored symbol provenance, native graphics flags/bounds, complete FIFO reader counts and BRep descriptor counts or exact replay errors. Its source summary/field inventory and original-symbol graphics records are also included. Eight additional symbols became readable after the bounded identity replay increased from 512 to 1,024 entries; their geometry-summary recipes remain unproven. That earlier report identifies 209 embedded-geometry cases, 15 columns plus one door without an admissible original-symbol reference, and 21 doors/windows requiring flip evidence. All 224 column reference type IDs match the independently calculated instance subelement hypothesis. Twenty-one door/window reference type IDs match their source original-symbol flip hypotheses (14 true, seven false). These are observations after decoding; they are not decoder inputs or authorization to substitute those identities.

`resolveNativeFamilyTypeIdentity` now returns a resolved recipe or a stable withholding reason. The existing string/null API delegates to it, preserving valid export behavior and rejecting malformed native GUID inputs. This lets reports distinguish an unproven embedded-geometry summary, an unknown flip, an absent reference, a missing creation identity and an unsupported exporter recipe.


## Conservative envelope veto

The current native-bounds flip is now withheld when an independently checksum-verified original symbol graphics envelope produces the opposite side test. The comparison retains both candidates and exact source provenance, and marks API geometry-option equivalence unproven. It does not promote the original-envelope candidate into a replacement type identity. Autodesk's [geometry options documentation](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API/files/Revit_API_Developers_Guide/Revit_Geometric_Elements/Geometry/Revit_API_Revit_API_Developers_Guide_Revit_Geometric_Elements_Geometry_Geometry_Helper_Classes_html.html) explains that `GetOriginalGeometry` precedes joins/cuts/post-processing, and that view, detail level and inclusion of non-visible objects affect returned geometry. A cached `GElement.m_bBox` has not been proven equivalent to that options-selected API geometry.

The [source validation](generated/rvt-native-identity-envelope-validation.json) records the three investigated window contradictions and the partial historical-envelope work budget. These findings remove unsupported confidence; they alone do not establish better reference agreement. Fourteen additional large-record symbol references remain subject to the same API-summary limitation. The earlier 246-case triage report is retained as a historical input for the subsequent complete conversion comparison.

Partial source-envelope coverage is visible in production conversion warnings and `stats.nativeOriginalSymbolDiagnostics`, including the historical-envelope checksum count/cap and the separate large-object work. A missing conflict warning is not an assertion of API geometry-option equivalence.


The retained-veto census is reproducible without another RVT conversion. It reparses the actual IFC `IfcRelDefinesByType` relationships, checks matching RVT hashes and converter/export settings against the `2d42a9c` campaign, hashes each source-evidence artifact, and excludes ambiguous product/type joins:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/summarize-native-type-envelopes.ts --current /workspace/scratch/head-to-head-large-whole-frames-priority.json.artifacts --prior /workspace/scratch/head-to-head-final-geometry-selection.json.artifacts --reference-unbc /workspace/models/unbc-reference.ifc --json docs/generated/rvt-native-type-envelope-census.json
```


The [final four-model census](generated/rvt-native-type-envelope-census.json) records every retained conflict: RAC 0, School 18, Snowdon 17 and UNBC 3. Exactly those 38 source product-to-type relationships change from `2d42a9c`; all other unambiguous compared relationships retain the same type GUID. For the three UNBC windows, the previous and fallback type IDs both disagree with the paired reference, and no previously matching UNBC relationship is lost. School/Snowdon have no paired IFC identity reference. This demonstrates conservative withholding, without claiming improved IFC identity accuracy. The production UNBC scan reports its historical-envelope limit; absent or omitted envelope evidence does not establish agreement.
