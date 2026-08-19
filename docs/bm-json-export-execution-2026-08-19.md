# Running BmJsonExportEx — 2026-08-19

[The static analysis](bm-json-export-static-analysis.md) reconstructed this
runtime's command contract and JSON envelopes from its symbol tables and
disassembly, without executing anything. On 2026-08-19 the isolated runtime was
executed for the first time, with the model owner's authorisation, to see
whether it could serve as the semantic oracle the
[editing review](ifc-lite-interface-and-editing-2026-08-19.md) puts at step 0.

**It cannot, yet.** The runtime loads and starts; it stops at ODA trial
activation. What follows is what that run established.

Nothing from the runtime is in this repository — no binary, no output, no
disassembly. This entry records only what was observed.

## What was run

The delivered archive is a subset of the tree
[the recursive ledger](generated/isolated-tree-inventory.md) describes: 92 files
against the ledger's 820. **91 of the 92 match the ledger by SHA-256 and byte
count exactly**; the extra one is a stray `rvt-parser/.DS_Store`. The 732 entries
not delivered are the whole `third-party-dependency` group, which is
`rvt-parser/node_modules` — the parser prototype's build tooling, not runtime
libraries. Every `NEEDED` entry in the executable's dynamic section resolves
inside the delivered folder, which is why the absence did not matter.

Host: x86-64 Linux, which is what the ELF objects target.

## The reconstructed contract was right

Run with no arguments, the executable prints:

```text
Usage: BmJsonExportEx <input file> [<output file>] [<element handle>]
   <input file>    - .rfa or .rvt file
   [output file]   - .json file
   [element handle] - OdDbHandle of an OdBmElement for export. If the handle is not set, hierarchy export will be used.
```

That is the contract the static analysis derived from the launcher's symbol
table and disassembly, down to the meaning of the optional handle and the
hierarchy-export default. A clean-room reading of a stripped-of-context binary
reproduced its own documented interface exactly, which is worth recording
because nothing else in this repository has had that kind of confirmation.

## Where it stops

Pointed at the supplied Revit 2027 project, the run ends immediately:

```text
Trial error: 0x000001
open /root/.oda-trial-config.json: no such file or directory
```

`libOdTrial.so` is not a stub. It is a Go binary — `ODATrialActivator` — whose
strings name an HTTP client, `ODA-Activator-OS` and `ODA-Activator-Version`
request headers, `APIRefreshToken`, `apiTrialStatus`, `Invalid token responce`
and `Trial is expired`. It reads `~/.oda-trial-config.json` and refreshes a
token against an ODA service.

So the gate is a licence and a network call to the vendor, not a missing file
that could be synthesised. Two things would be needed to go further, and both
are the model owner's to provide rather than this repository's:

1. a valid ODA trial activation config, obtained from ODA by whoever holds the
   trial; and
2. outbound access to ODA's activation endpoint from wherever the run happens.

## What this does and does not change

**It does not change any decoder.** The rule from
[the geometry-gap inventory](revit-2027-ifc-geometry-gap.md) applies here and
more strictly: a vendor implementation may be used as a *post-decode acceptance
oracle* and never to locate a record, choose a rule, or synthesise geometry.
Reviter's clean-room claim is that its decoders come from measurements of Revit
files rather than from Autodesk or ODA source and runtime; scoring a decode
against ODA output preserves that, driving one with it would not.

**It does not settle step 0.** The measurement the editing work wants — whether
the 60.1% of categorised products whose category comes from a record-code
consensus are actually right, per element — still has no oracle. The paired
Autodesk IFC cannot answer it, because IFC product type is a lossy projection of
a Revit category: `IfcPlate` does not distinguish a curtain panel from a plate,
and a category mapping to `IfcBuildingElementProxy` is not corroborated at all.

**What it establishes** is that the oracle is reachable in principle. The
runtime executes on an ordinary Linux host, the interface is as documented, and
the only thing between here and a per-element semantic JSON — category, family,
type, parameter values and `UniqueId`, by element handle — is an activation the
holder of an ODA trial can supply.

## If it is run later

The comparison is small, because both sides already carry the identity to join
on. `externalId` in the ODA envelope is `OdBmElement::getUniqueId()`, and
Reviter decodes the same `UniqueId` for 41,709 tagged products. Join on that,
then compare category, family, type and parameter values per element. It needs a
new script; it does not need new decoding.

The result to look for is not an agreement percentage. It is **which categories
the consensus gets wrong, and in which direction** — that is what decides
whether the assertion editor's category picker is the feature it is currently
assumed to be.
