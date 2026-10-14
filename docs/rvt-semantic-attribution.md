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
| `viewpoint-links.ts` | Upstream viewer URL-fragment concept | Independent versioned SHA-256 binding using Reviter's existing live-camera/model-coordinate helpers |
| `lib/rvt-wasm/patches/native-evidence.patch` | `native_document`, native definitions, metadata and storage catalog | Reviter-owned WASM-only bridge; core Rust decoders unchanged, explicit source/output budgets and exact integer strings |

New IFC room and MEP emitters consume the recovered evidence without replacing
Reviter's geometry or indoor review algorithms. Individual source files identify
their provenance and substantive changes. The existing IFC semantic notice is
also retained under `lib/reviter/vendor/`.

The expanded inventory retains Apache attribution for upstream declaration
excerpts. The vendor patch manifest and provenance record both the unmodified
upstream revision and local patch hash; the comparison uses a separately built
unmodified bundle as its upstream baseline.
