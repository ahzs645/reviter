# Native RVT material decoder boundary

This note records the clean-room material work against:

- `UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`;
- `UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc`.

The implementation is browser-safe TypeScript. It does not load, link, or ship
the isolated native libraries. Those binaries were used only as static evidence
for class and API boundaries; the file layout below was independently measured
from the supplied RVT and checked against its embedded `Formats/Latest` schema.

The complete machine-readable result is
[`generated/unbc-rvt-materials.json`](generated/unbc-rvt-materials.json).

## What is decoded

Revit 2027 material elements use the same independently verified partition
object framing as the other recovered elements:

- a nonzero 32-bit element ID with a zero high word;
- object length at byte `+12`;
- `MaterialElem` marker `0x0ad3` at byte `+16`;
- the same object length echoed at `objectLength + 16`.

Inside that verified record, the material name is a 32-bit character count and
UTF-16LE text followed by the measured field trailer
`ff ff ff ff e0 0c`. Requiring that trailer matters: the record may also contain
appearance-library paths, schema labels, and other length-prefixed text. A
generic UTF-16 search would incorrectly promote those nested strings.

Appearance-backed records have a second, independently bounded layout matching
the static `MaterialElem.m_pMaterial` → `Material.m_name` object boundary:

- a bounded UTF-16 source description starts at object byte `+231`;
- the description ends in `0d b9 f0 ff ff ff ff ff 00 00 00 00`;
- the next bounded UTF-16 field is the material name;
- eight zero bytes and a nonzero 64-bit persisted object reference close it.

All parts of that chain are required. The decoder does not select “the second
string” or compare text to IFC at runtime, and it still rejects schema labels,
asset paths, and 21 lightweight “Unassigned” appearance records.

`lib/reviter/material-records.ts` applies both gated layouts and is disabled for
releases other than 2027. It returns material element identity and name only.
It does not synthesize colors or appearances.

## UNBC result

| Measure | Count |
| --- | ---: |
| Framed native `MaterialElem` records | 94 |
| Direct-name-layout definitions | 54 |
| Nested-name-layout definitions | 15 |
| Safely named material definitions | 69 |
| Unique safely decoded RVT names | 69 |
| Records with absent or unsupported name layout | 25 |
| IFC material entities | 30 |
| Unique IFC material names | 29 |
| Exact IFC names found in decoded RVT definitions | 28 (96.6%) |
| IFC material-association relations | 7,554 |
| Native shared-geometry assignments decoded | 5,413 |

The sole unmatched IFC name is:

- `<Unnamed>`;

The literal `<Unnamed>` occurs zero times in the 421,867,755 inflated partition
bytes and is not synthesized. Each of the other seven formerly missing IFC
names occurs exactly once as a length-prefixed UTF-16 field inside a distinct
framed `MaterialElem`, and all seven now decode through the nested field chain.

The converter exports all 69 native definitions. Three separately proven
shared-geometry layouts resolve 5,413 geometry-to-material assignments; exact
element/type, compound-layer, BRep-face, appearance, category-style, and view
override paths remain separate work.

## Assignment layers inspected

The embedded schema and isolated binary API surfaces agree that Revit material
resolution is layered:

| Layer | Evidence | Current status |
| --- | --- | --- |
| Material definition | `MaterialElem.m_pMaterial`; `Material.m_name`; `MaterialId` color/transparency fields | Outer identity and name decoded; nested properties unresolved |
| Element/type material | element, family instance, and family symbol material-ID accessors | Shared family geometry assignment partially decoded; direct instance/type sets unresolved |
| Structural material | structural material accessor/reference | Serialized reference unresolved |
| Family geometry tag | `m_geomTag2MaterialId`; geometry marker material ID plus geometry tag | 5,413 shared-geometry assignments decoded; per-tag maps unresolved |
| Stored polygon mesh | `GPolyMesh` material-ID field/accessor | Runtime member location is not accepted as serialized layout |
| BRep face | face material and mapper APIs, including per-face overrides | Requires general BRep decode and face identity |
| Category/object style | graphics-style material reference | Serialized style/category references unresolved |
| View display override | view/category/element override fields and graphics context | Separate display layer; must not overwrite base material identity |

Static disassembly showed that `MaterialId201120260Reader::read` delegates to
the generic class-container reader. It therefore supplies no fixed serialized
layout to copy into TypeScript. Similarly, the native runtime object for
`OdBmGeomMaterialMarker` stores an object ID and a geometry tag, and the runtime
`GPolyMesh` implementation exposes a material member, but C++ in-memory member
offsets are not proof of their on-disk encoding. Treating them as such would
produce plausible but unverified assignments.

## Smallest defensible next step

The next decoder should interpret the embedded schema's generic object tokens
and fixups sufficiently to extend the proven definition/assignment subset:

1. `MaterialElem.m_pMaterial` into complete `MaterialId` appearance values;
2. direct element/type and graphics-style material references;
3. complete family `geomTag -> materialId` maps;
4. stored-mesh and BRep-face references once stable geometry/face identity is
   available.

A renderer can then preserve explicit provenance and apply a tested precedence,
approximately:

1. per-face BRep override;
2. family geometry-tag material;
3. stored mesh material;
4. element or type material;
5. category/object-style material;
6. view override as a display-only layer;
7. existing fallback color.

That order is a target to verify against actual records, not a license to invent
missing references. Until a layer is decoded, the viewer should keep the
current fallback and report the material as unresolved.

## Reproduce

```sh
node --experimental-strip-types scripts/audit-rvt-materials.ts \
  --rvt '/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt' \
  --ifc '/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc' \
  --json docs/generated/unbc-rvt-materials.json
```

The exact inputs are pinned in the generated report by SHA-256:

- RVT: `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC: `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
