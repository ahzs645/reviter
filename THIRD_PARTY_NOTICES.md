# Third-party source adaptations

The semantic integration also adapts GlobalId reconstruction and IFC export
precedence (`revit-ifc-semantics.ts`), primary design options
(`design-options.ts`), and experimental MEP evidence (`native-mep.ts`) from
the same upstream revision. The respective modules and topic documents identify
their source files, changes and scope. Standard property and phase modules use
independently implemented decoders informed by the upstream observations.

Full upstream notices are retained in [docs/rvt-rs-NOTICE.txt](docs/rvt-rs-NOTICE.txt),
[lib/rvt-wasm/NOTICE](lib/rvt-wasm/NOTICE), and the adapted modules' vendor
directories. Apache-2.0 license texts remain with those distributions.

`lib/reviter/native-rooms.ts` adapts the measured room solid face layout,
constants and adjacent room parameter entry layout from
[helenkwok/rvt-rs](https://github.com/helenkwok/rvt-rs), commit
`1c3d337dbd2a6810e9dfad68fe99857843d67387`, specifically
`src/partition_room_boundaries.rs`, `src/partition_room_parameters.rs`,
`src/partition_element_records.rs` and `src/partition_element_records_2023.rs`.
The adaptation is TypeScript and adds strict topology checks, source record
joining and independent semantic room reporting. Unsupported outlines remain
unresolved and source room evidence does not certify navigation.

Upstream notice: rvt-rs — open reader for Autodesk Revit files.
Copyright 2026 Griffin Long. Licensed under the Apache License, Version 2.0.
The license text is retained in [`lib/rvt-wasm/LICENSE`](lib/rvt-wasm/LICENSE).
