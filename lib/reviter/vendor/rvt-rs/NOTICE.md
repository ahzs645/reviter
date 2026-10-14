# rvt-rs attribution

`lib/reviter/revit-ifc-semantics.ts` adapts the Revit GlobalId reconstruction,
IFC export parameter identifiers and inheritance rules from rvt-rs by Helen
Kwok and its contributors, licensed under the Apache License, Version 2.0.

Source: https://github.com/helenkwok/rvt-rs
Commit: `1c3d337dbd2a6810e9dfad68fe99857843d67387`
Files: `src/revit_global_ids.rs`, `src/partition_ifc_export_overrides.rs`,
`src/ifc/category_map.rs`.

Modifications: TypeScript implementation; owned-table recovery rather than
upstream's proximity scan; strict supported IFC4 classes and enumerations;
sticky ambiguity rejection; explicit export decision provenance. The upstream
Snowdon GlobalId test vectors are retained in `tests/revit-ifc-semantics.test.ts`.

The Apache-2.0 license is included in [LICENSE](./LICENSE). This notice does not
license the remainder of Reviter or any model/test data under Apache-2.0.
