# Native geometry selection integration candidate

This isolated candidate selects the converter geometry fixes from
[`codex/rvt-semantic-integration` at `0f225128`](https://github.com/ahzs645/reviter/blob/0f225128b49a792bcd4047c6937c9d6bda18a919/docs/rvt-native-geometry-selection.md).
It preserves the current UNBC stair, material-census and reviewed-drawing work.
It does not integrate that branch's separate UI, optional semantic readers,
WASM, source-room, phase, schedule or IFC identity features.

## Included converter changes

- Recover complete, same-page `GElement` records above the broad scanner's
  65,535-byte ceiling only after the original owner, length echo and Adler-32
  checks. Crossing frames retain their existing reader.
- Bound checksum work to 128 MiB per partition and queued supplemental frames
  to 64 MiB. Compile those bodies after ordinary, crossing and original
  alternate definitions. Preserve ordinary owners and their output priority.
- Suppress a reusable symbol fallback only after the same element's complete
  native own body passes its independent admission gates. Failed, reconstructed
  or provisional own bodies retain the fallback.
- Select only supported, descriptor-owned default 3D cut alternatives.
  Unknown predicates and externally shared drawable pointers remain unresolved.
- Report checksum, buffer and definition budget exhaustion explicitly.

The general FIFO, surface coverage, source envelope, geometry budget, actual
floor-hole, original identity, material and stair qualification guards remain
active. A recovered mesh is not a verified navigable stair.

## Verification scope

The upstream document records prior four-model and exact-UNBC source campaigns;
those saved results are reference evidence, not a fresh validation of this
combined candidate. The current task writes a separate fresh conversion cache,
source hash, implementation hash, source-flight extraction, strict native floor
polygons and downstream stair review in its task-specific output directory.
The original RVT, canonical authoring ZIP and existing navigation are preserved.

Focused tests cover owner fallback admission, supported/unknown cut selectors,
ordinary geometry priority, source frame budgets, 32/64-bit element-ID widths,
translated class slots, damaged checksums, foreign owners and length echoes.
The additional source tests retain exact stair widths, slab holes, source
ownership, reviewed drawing identities and independent paired-body checks.

For a source-only audit of selected original complete frames:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-rvt-owner-frames.ts model.rvt \
  --owners 1185924,801614,2236110 --json source-frames.json
```

That audit does not read reference geometry and does not grant route approval.
