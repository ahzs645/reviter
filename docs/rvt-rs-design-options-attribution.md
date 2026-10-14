# Native design-option decoding

`lib/reviter/design-options.ts` adapts the measured record offsets, counted
option/name entry and conservative resolution rule from `rvt-rs`:

- Upstream: https://github.com/helenkwok/rvt-rs
- Revision: `1c3d337dbd2a6810e9dfad68fe99857843d67387`
- Sources: `src/partition_design_options.rs`, `src/partition_element_records.rs`
- License: Apache License 2.0, retained at [lib/rvt-wasm/LICENSE](../lib/rvt-wasm/LICENSE).

The TypeScript adaptation adds a streaming collector, strict release/schema
gates, bounded evidence storage, explicit diagnostics for disagreement and
configurable `all`/`primary` selection. The scene stays unchanged; callers must
request primary-only export explicitly. Missing evidence retains alternatives.
It does not expand geometry support or alter reviewed indoor source data.

The native layout is admitted for measured wide-ID releases 2024–2026 with the
matching `ElementHeader`, `Outline` and `ElementParents` tags. A set must belong
to the leading record chain; its list must start with its own ID, and its name
entry must identify one listed option as primary. Conflicting lists, names,
primaries or cross-set membership leave the set unresolved. Revit 2027 is
reported unsupported until that layout is independently verified.

The upstream [NOTICE](rvt-rs-NOTICE.txt) is retained, including its copyright and
trademark attributions. The upstream implementation is Copyright 2026 Griffin Long.

## Validation on supplied models

On the supplied Snowdon 2024 RVT, this reader resolves both measured sets without
unresolved evidence: `Bandstand Options` (set 1500723, primary 1500724) and
`Bleacher Seating` (set 2059966, primary 2059970). The non-primary source headers
include the same nine floors, eight walls, nine slab edges and one generic model
identified by the upstream paired-IFC investigation. Other option members include
dependencies; header counts do not claim every member is an exported product.

The supplied School and RAC 2025 files produce no option sets or option-bearing
headers. UNBC 2027 reports unsupported, retaining all elements. These are RVT
source checks; the supplied Snowdon reference is a view-scoped Autodesk conversion,
not a paired whole-project Revit IFC, so IFC product omission parity has not been
independently verified here. Unit tests verify strict framing, every byte split,
UTF-16 rejection, conflicting primaries/names/members and unknown memberships.
