# rvt-rs semantic integration provenance

The integration is based on [helenkwok/rvt-rs](https://github.com/helenkwok/rvt-rs)
commit `1c3d337dbd2a6810e9dfad68fe99857843d67387` (crate version 0.4.0).
The upstream [Apache-2.0 licence](third-party/rvt-rs/LICENSE) and
[NOTICE](third-party/rvt-rs/NOTICE) are retained without removing contributor
attribution. Vendored WASM also carries the licence, notice and build provenance.

| Reviter component | Upstream source/evidence | Adaptation |
| --- | --- | --- |
| `ifc-global-id.ts` | `revit_global_ids.rs`, `native_metadata.rs`, RE-48 | Independently implemented GUID formula and measured vectors; stricter provenance, ambiguity and collision checks |
| `native-ifc-export-parameters.ts` | `partition_ifc_export_overrides.rs`, `partition_names.rs`, RE-45 | Bounded TypeScript page collector, declared owners and conflict preservation |
| `ifc-export-semantics.ts` | RE-45 instance/type precedence | Reviter IFC4 allowlist and typed common-property mapping |
| `native-source-rooms.ts` | `partition_room_boundaries.rs`, `partition_room_parameters.rs`, RE-29/101/102/117 | Bounded collection, own-room bounds, page overlap, strict topology and source-only room evidence |
| `native-mep.ts` | `partition_mep_systems.rs`, `partition_connector_pairs.rs`, RE-162/138/141 | File-local schema indices, checksums, bounded references, measured connector lists and late fitting-category joins |
| `design-options.ts` | `partition_design_options.rs`, `partition_element_records.rs`, RE-40 | Bounded streaming record/name evidence and explicit unresolved alternatives |
| `capabilities.ts`, fuzz harness | Upstream capability/fuzzing approach | Independent Reviter contracts and deterministic parser/converter mutation corpus |
| `native-ifc-type-identity.ts`, GUID witness collectors | `revit_global_ids.rs`, original-symbol and exporter recipes | Measured source-class/checksum gates, exact type joins and retained conflicting raw values |
| `native-ifc-semantic-model.ts`, `ifc-category-map.ts` | Upstream IFC entity/property projection | Exact declared-owner joins, IFC4 allowlists, typed units and rejection of unproven defaults |
| `native-mep-model.ts`, `native-mep-dimensions.ts` | RE-134/157/165, native connector graph projection | Same-byte pinned-model joins, dimension witnesses and disagreement suppression |
| `export-ifc-mep-geometry.ts` | RE-131/157 pipe axes and diameters | Optional IFC-only hollow sweep with six-face bounds checks and explicit reconstruction provenance |
| `native-phase-spatial.ts` | Native phase, associated-level and room-finish readers | Source references and release-bounded fields; lifecycle order remains separately proved |
| `document-metadata.ts`, `export-schedules.ts` | `rvt-info`, `rvt-schedule`, Atom/ProjectInformation metadata | Independent bounded safe-container inspection and formula-neutralized inventory CSV |
| `viewpoint-links.ts` | `ifc/share.rs`, upstream viewer URL-fragment concept | Independent v1/v2/v3 SHA-256/review-frame binding, bounded selection/render state and opt-in user markup in canonical Revit feet |
| `lib/rvt-wasm/patches/native-evidence.patch` | `native_document`, native definitions, metadata and storage catalog | Reviter-owned WASM-only bridge; core Rust decoders unchanged, explicit source/output budgets and exact integer strings |
| `native-parameter-inventory.ts` | `native_parameter_definitions.rs`, `native_metadata.rs`, source family/symbol schema | Concrete storage/owner-edge contracts; exact retained instance→symbol→family/type-binding inheritance; present conflicts block fallback, no family-default substitution or formula evaluation |
| `native-record-inventory.ts` | `native_document.rs`, `native_parameters.rs`, typed drafting/organization modules | File-local schema fields, exact root owners and source pointer paths; serialized inventory and raw fallbacks |
| `elem-table.ts::parseFullElemTableInventory` | `elem_table.rs` | Complete u32 source inventory with exact framing, source aliases and acyclic owners; scene admission retained separately |
| `export-ifc-mapped-geometry.ts`, exporter mapping emitter | `ifc/step_writer.rs`, IFC-21/30 | Optional translation/rotation maps with decoded native type/geometry identity, proper source basis, full ordered vertices/topology/materials and independent placement checks |
| `native-schedule-inventory.ts`, `native-schedule-html.ts` | `native_document.rs`, `native_parameters.rs`, `elements/drafting.rs`; actual file-local ScheduleSchema/TableCellData fields | Source-owned schedule definitions/order/filter/sort records, cached text, owned row/column dimensions, reciprocal merges, visibility and bounded expression trees; escaped cached HTML does not execute native enum/operator/formula codes |
| `native-drawing-svg.ts`, `native-drawing-arcs.ts`, drawing record paths | `elements/drafting.rs`, `elements/annotations.rs`, `partition_beam_axes.rs` RE-100, `native_parametric_surface.rs`; actual file-local drawing/tag/dimension/curve schema | Exact owner/view/pointer/frame gates; bounded partial SVG text, straight leaders, tag-head markers and finite detail curves and exact-tag circle/arc evaluation; no regenerated sheets or native glyph/layout equivalence |
| `native-spatial-categories.ts`, `native-spatial-organization.ts`, `export-ifc-source-organization.ts` | `native_document.rs`, `native_parameters.rs`, `elements/zones.rs`, `elements/reference_points.rs`, `elements/project_organization.rs` | Same-source category-header joins, exact revision/visibility state, active-site/owned matrix and survey direction proof; optional identity-only spatial/site IFC metadata preserves canonical placements |
| `native-structural-profiles.ts`, `export-ifc-material-profiles.ts` | `partition_type_parameters.rs` RE-103, `ifc/mod.rs::material_profile_sets_from_sections`, `ifc/step_writer.rs`; Autodesk Section Shape enum and IFC4 profile specifications | Six symbol-owned section metrics plus explicit symbol- or exactly linked family-owned shape classification and occurrence/material gates. Real School/structural Snowdon exports emit two/11 profiles used by eight/427 products; general profiles/fillets remain unresolved |
| `revit-2027-default-3d-selection.ts`, native mesh bridge own-body precedence | `native_graphics_traversal.rs::direction_condition`, descriptor-owned GConditionCut 6–8 | Bounded FIFO ancestry/shared-occurrence checks and qualified own-body admission; measured selection suppresses duplicate alternatives without applying guessed wall trims |
| Type-recipe diagnostics and withholding reasons | Autodesk `revit-ifc` exporter at `3d7195e808a3f6a2e5f81041ec1524b0b49ad3e8`, public geometry-summary/GUID/flip contracts | Primary-source research and independently calculated hypotheses only; no Autodesk implementation copied. Embedded pointers/reference matches never authorize an unproved recipe |

New IFC room and MEP emitters consume the recovered evidence without replacing
Reviter's indoor review algorithms. Separately, qualified own-body precedence
and descriptor-owned default-3D selection intentionally change UNBC's rendered
body selection. The source/native bytes are preserved; measured owner geometry
improvements and remaining wall/selection residuals are documented in
[rvt-native-geometry-selection.md](rvt-native-geometry-selection.md). Individual source files identify
their provenance and substantive changes. The existing IFC semantic notice is
also retained under `lib/reviter/vendor/`.

The expanded inventory retains Apache attribution for upstream declaration
excerpts. The vendor patch manifest and provenance record both the unmodified
upstream revision and local patch hash; the comparison uses a separately built
unmodified bundle as its upstream baseline.

Public Autodesk API/exporter and buildingSMART references are evidence for independently implemented contracts, not copied source contributions. Their exact links and scope are recorded in [authored schedules](native-authored-schedules.md), [source drawings](native-source-drawings.md), [maps/profiles](native-ifc-maps-profiles.md), and the [exporter identity contract](revit-ifc-exporter-identity-contract.md).
