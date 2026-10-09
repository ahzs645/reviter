# Native pipeline checkpoint — 2026-10-09

Preserves accumulated native physical material, circulation/door/stair/partition, exact overlay, prepared-display cache and bounded parallel/checkpoint compiler work. The matching OpenIndoorMaps runtime is committed separately.

The full unit suite passed: 1,692 tests, 1,690 passing and two optional input-dependent skips. Full TypeScript checking and the static Pages build passed. These checks do not certify a final regenerated UNBC master or all campus enclosures/routes.

Parity tests require the adjacent OpenIndoorMaps checkout and its dependencies. CI checks out both repositories; the test-only local extension resolver admits this shared checkout scope while keeping the compiler CLI resolver narrower. Native type stripping preserves functions serialized into CAD workers.

Ignored investigation folders are preserved outside the checkout with compatibility symlinks. Source checkpoints and binary patches were archived before consolidation. Canonical model, GIS and campus master assets remain unchanged by the Git checkpoint.

Repository lint remains a known gate failure: 76 errors and 67 warnings in the captured full run, including older CAD effect rules, typed fixture gaps and vendored-source style checks. No lint rules or deployment gates were disabled to conceal these findings. CI unit/type checks and static builds are reported separately.
