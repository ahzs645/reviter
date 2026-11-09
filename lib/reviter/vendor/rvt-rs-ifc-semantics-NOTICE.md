# rvt-rs IFC semantic decoding

`../native-ifc-export-parameters.ts` adapts the bounded IFC parameter framing,
release-specific CellList headers and conflict rules from `rvt-rs`, pinned at
commit `1c3d337` (`https://github.com/helenkwok/rvt-rs`).

Sources: `src/partition_ifc_export_overrides.rs` (RE-45) and
`src/partition_names.rs` (element-data headers). `../ifc-export-semantics.ts`
follows the source's instance/type parameter precedence and schema enum
validation approach; its TypeScript mapping and common property construction
are Reviter implementations.

Upstream is copyright its contributors and distributed under Apache License
2.0. The complete applicable licence is retained in
`rvt-rs-ifc-semantics-LICENSE`. This adaptation changes Rust stream scans into
Reviter's shared page collector, requires declared native ids, retains conflict
state across pages, permits a source-authored `NotExported` string, and preserves
raw parameter evidence separately from exported standard properties.
