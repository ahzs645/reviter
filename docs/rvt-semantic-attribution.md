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

New IFC room and MEP emitters consume the recovered evidence without replacing
Reviter's geometry or indoor review algorithms. Individual source files identify
their provenance and substantive changes. The existing IFC semantic notice is
also retained under `lib/reviter/vendor/`.
