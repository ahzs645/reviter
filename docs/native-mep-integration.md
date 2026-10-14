# Native MEP evidence and IFC export

`lib/reviter/native-mep.ts` adapts rvt-rs commit `1c3d337`'s Apache-2.0
`partition_mep_systems.rs` (RE-162) and `partition_connector_pairs.rs`
(RE-138/141). Systems are admitted for Revit 2024–2027; the reference
measurement is Revit 2025. Connector layouts are admitted only for 2025.
Neither admission claims geometry coverage for those releases.

Systems require a file-local schema class, a declared element identity, a
complete native data-object size echo, and a matching Adler-32 checksum.
System names are the measured printable counted string or electrical circuit
number. Disagreeing records suppress the name. Membership is a reference to
the system's ElementId in an element's checksum-verified object; it is not a
fully decoded system field. Its source page and byte offset are preserved.
As upstream RE-162 documents, unfiltered references may include warning
records and additional family instances. IFC emission intersects membership
with products actually exported by Reviter.

Connections require the measured two-reference counted list, both flags equal
to one, both declared identities, and validated owner indices. Curve joins use
the measured connector-manager anchor and later-block precedence. Fitting
joins require native DuctFitting or PipeFitting category evidence, which can
arrive after the list. Spatial proximity is never used. Complete consecutive
pages may share a bounded 64 KiB tail; damaged chunks and stream changes
cannot be joined. Checksum work is bounded per page and compact references are
capped at one million, with partial-evidence limitations reported.

`export-ifc-mep.ts` emits IfcSystem, IfcRelAssignsToGroup,
IfcDistributionPort, IfcRelNests and IfcRelConnectsPorts. Port placement,
direction and classification remain unset. It creates ports only for observed
joins whose two owner products were exported. Unconnected family-symbol ports
and native-graph joins (RE-169/171) remain unsupported.

IFC emission is opt-in with `makeIfc(result, { mep: true })` or the semantic
audit CLI's `--mep` flag. The conversion report retains all evidence and
limitations regardless of that export choice. System roots use proven native
GlobalIds when their history identity is available; ports and relationships
retain deterministic derived identities.

## Validation

Nine unit cases exercise checksum corruption, conflicting names, circuit
names, release gates, native index handling, later-block precedence,
reciprocal deduplication, unknown endpoints, late fitting evidence, complete
and damaged page splits, and export filtering.

The SHA-verified MIT models and paired IFCs from `Drshelden/IFC-ECS` are
identified in rvt-rs `research/witness-registry.json`. Source files were kept
outside this repository. Run:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-native-mep.ts RE1-Mechanical.rvt RE1-Mechanical.ifc --out evidence.json
```

| Model (Revit 2025) | Systems | Native memberships | Recovered joins | Matching reference joins | Missing reference joins |
| --- | ---: | ---: | ---: | ---: | ---: |
| RE1 Mechanical | 5 | 78 | 69 | 69 of 73 | 4 |
| RE1 Plumbing | 8 | 138 | 121 | 120 of 126 | 6 |

Mechanical's names and memberships match RE-162's measured systems: Supply
Air 58, Return Air 8 and OTH 1/2/3 with 2/2/8 members. Plumbing's four
additional raw membership references are consistent with RE-162's documented
warning/family caveat. Its additional native join `442378:2/444124:0` has an
owner (`442378`) absent from the paired Revit IFC. The source relationship is
preserved in evidence and can be emitted only if Reviter actually exports both
owners. The missing joins are reported; this is partial topology recovery.

| File | SHA-256 |
| --- | --- |
| RE1-Mechanical.rvt | `d559720177aa0ec435133f804e7c45d60da2deb9d5585bb3d55f4830139c014b` |
| RE1-Mechanical.ifc | `9e56cf7246ce86ef73646dd588a1efb8a4756e5e102b30e28b3b58577a454db0` |
| RE1-Plumbing.rvt | `03689df2aa426031a216e65051b9f19d3265d6fe96884dd47373b17435f9e54c` |
| RE1-Plumbing.ifc | `294490b222632509779910345f27a4eeda3645956138a593298c241495f7b8b6` |

The supplied technical-school 2025 and UNBC 2027 models produced no native
systems or joins. UNBC's broad reference collection reached the compact
reference cap and reports partial evidence. Connector recovery is deliberately
disabled for that 2027 model. Those architectural models are negative checks,
not positive MEP parity witnesses.
