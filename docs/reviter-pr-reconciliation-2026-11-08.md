# Reviter PR #11 and #16 reconciliation

Date: November 8, 2026 (America/Vancouver).

## Decision and source scope

Keep both features and integrate them with current `main` through PR #16.
Neither PR was completely superseded. PR #11's independent IFC audit and some
supporting material already existed on `main`, but its assertion editor and
export workflow did not. Main had separately incorporated part of PR #16's
large-frame geometry recovery, while its richer semantic/export integration
remained on the candidate branch.

The integration preserves both original PR histories. It does not replace main
with an older branch or regenerate an existing indoor visitor dataset.

| Input | Revision |
| --- | --- |
| Main reviewed for this reconciliation | `91ecb8586bf6be87007001fd4188e551365164e5` |
| PR #11 original head | `cb8a50f0135481c8437b537c61c6eca2c4fa01bd` |
| PR #16 original head | `0f225128b49a792bcd4047c6937c9d6bda18a919` |
| PR #16 original intermediate base | `4c13fd03e1ef994311f55e2312ef2590b898fb53` |
| Published combined code candidate | `04add04e58a8fbe8f33b4551bc0ad8f0ea429904` |
| Exact tested code tree | `4700f08b4f142d45ab084ebdcbd5ef32c4c2d679` |
| Sibling OpenIndoorMaps used by the CI parity tests | `65c85bb25ebfd8de1b00b05f3dc6373c4efa4240` |

## Behavior retained

- Current main's source direction selection, native material and drawing
  collectors, newer geometry/indoor work, command palette, saved views,
  dimensions and visibility controls remain present. The native mesh bridge,
  split alternate-frame collector and split-frame stream remain byte-identical
  to the reviewed main revision.
- PR #16 supplies qualified source identities, IFC semantics and optional source
  rooms, MEP, design options, maps/profiles, stored schedules, partial source
  drawings, bounded evidence inventories and portable viewpoint links.
- PR #11 supplies explicit editing, category/type/note assertions, undo/redo,
  saved assertions, decoded/inferred/edited provenance and a review step before
  asserted IFC export. Assertions do not modify the original RVT bytes.
- Main's consolidated CI/Pages workflow remains unchanged. The combined PR
  avoids separately publishing and validating two overlapping candidates.

## Defects corrected while combining the features

1. **Selected source identity:** assertions are stored under the source-byte
   SHA-256. Filename and length alone cannot restore them. Metadata still locates
   a cache candidate, but the newly selected bytes must hash-match before the
   cached conversion and its assertions can be reused. Hashless legacy caches
   reparse; old name/length assertion entries are not silently reassigned.
2. **Review staleness:** structural encoding binds the displayed changes to
   decoded values, numeric categories, orphan status, author/time, source and
   reference identity, export options, reviewed rooms and source organization.
   Confirmation also checks the conversion object. Model replacement/close
   clears edit mode, pending approval and the assertion undo/redo history.
3. **Duplicate evidence:** review, selected/hovered properties and IFC source
   properties use the same preferred original record. Applying an assertion
   cannot change which original evidence wins. A weaker first duplicate cannot
   remove a preferred source record's IFC exclusion or class parameters.
4. **IFC identities:** asserted category/type groups receive derived type IDs.
   Original product identities and unaffected native type projections remain
   intact, including when the lowest-ID occurrence has been edited. Source IFC
   suppression and authored class settings still apply to asserted elements.
5. **Viewpoint coexistence:** current saved views and portable links both remain
   available. Camera capture uses the current walking-state ref. Portable links
   refuse capture with individually hidden objects because that format only
   encodes category visibility. Restoring a viewer-bearing link clears stale
   per-object hiding and its visibility history; camera-only links retain their
   existing display-state behavior.
6. **Review accessibility:** the assertion dialog traps keyboard focus and
   supports cancellation with Escape.

## Fresh validation

Final local validation results are recorded below. The published code tree is
byte-identical to locally tested candidate `c760455`; the documentation commit
only adds this record. The full unit
suite includes the source, IFC, cache and assertion regressions; focused counts
are overlapping evidence and must not be added to the full-suite count.

| Check | Result |
| --- | --- |
| Full TypeScript check, combined code candidate | Passed, Node 24.22.1; 3,072 MiB heap limit; about 1.77 GiB reported compiler memory |
| Full unit suite, combined code candidate | 2,756 passed, zero failed, 27 conditional source-input skips (2,783 total) |
| Full ESLint | Passed, zero errors and 82 warnings |
| Autodesk pipeline tests | 8 passed, zero failures/skips |
| Pages build at `/reviter/` and artifact test | Build passed; 1 artifact test passed |
| Focused geometry reconciliation | 202 passed, zero failures/skips |
| Coupled IFC/assertion regression set | 147 passed, zero failures/skips |
| Independent assertion/source/cache review tests | 31 passed, zero failures/skips |
| Unasserted IFC comparison with the reconciled #16 candidate | Byte-identical for seven ordinary fixture/export-option combinations |
| Browser script syntax | Passed for the maintained interface and assertion scripts |

Initial unrestricted TypeScript execution and some concurrent 4,096 MiB retries
were terminated with exit 137. The isolated final check with a 3,072 MiB heap
completed with no TypeScript diagnostics. The remote workflow also checks the
submitted revision under its configured Node 22 runtime.

### Browser and original-source limits

No fresh desktop/mobile browser acceptance pass is claimed for this integration.
The environment lacks Playwright's bundled Chromium. Its installed Chromium
cannot create the required local process socket under the execution sandbox;
the approval policy rejects escalated execution. Both the connected browser and
the supported cloud browser returned connection refused for the local preview.
These failures occurred before application interaction.

The interface browser script now covers portable links alongside saved views,
changed camera/selection/section restoration, foreign-source refusal and
individual hiding. The assertion browser script accepts an explicit Chromium
executable and uses the current report control. Their new browser assertions
remain unexecuted here.

On a browser-capable environment, run:

```sh
npm run build:pages
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/check-cadcraft-interface.mjs
node scripts/browser-check-assertions.mjs dist-pages /absolute/path/to/model.rvt
```

Set `REVITER_BROWSER_EXECUTABLE` to an existing Chromium executable if needed.
Those scripts require the default root Pages build; the `/reviter/` build is
checked separately by `tests/pages-build.test.mjs`.

Historical four-model, independently opened IFC and browser results in
`docs/rvt-upstream-comparison.md` and `docs/generated/` retain their original
revision and input scope. They are not fresh private-model verification of this
merge. Conditional tests requiring unavailable original native files remain
skipped. This change does not certify complete physical equivalence, finish the
known source-material/type-recipe gaps, or authorize a new public indoor route.
