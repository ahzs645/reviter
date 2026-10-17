# Complete source headers across compressed pages

`createSplitFrameStream` previously advanced its scan after the class and type
were available: 22 bytes for wide IDs. The GElement collector also checked the
repeated owner ending at byte 30. A source header split after bytes 22–29 was
therefore rejected before that owner arrived, and was never retried. This could
silently omit a valid original geometry frame.

Collectors can now declare `minimumHeaderBytes`, including a width-dependent
callback. The stream retains the full unscannable tail until that lookahead is
available. GElement declares 30 bytes for wide IDs and 18 for narrow IDs. Its
original owner, length echo, frame/output budgets and whole-frame checksum
checks remain in effect. Other collectors retain the original default.

Validation includes every split through both headers under 32-bit and 64-bit
IDs and canonical and translated classes, foreign repeated owners, one-byte
chunks, partition resets, ordinary and oversized objects, and the generic
lookahead contract. The 13 new tests reproduce five failures against the prior
implementation. All 56 focused tests pass after the fix: the previous 30
geometry cases, 13 large-frame layout cases and 13 new lookahead cases. Full
TypeScript and scoped ESLint checks also pass.

An independent scan of the exact original UNBC RVT SHA-256
`8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
compared the previous and amended implementations across all 3,666 compressed
source pages. Both produce the same ordered 184 supplemental GElement frames
(109 whole and 75 crossing), including their source bytes, identity, page
location and crossing metadata. The canonical frame-sequence SHA-256 is
`5d20c661afb64918caba10dce0364d88c6893aa15d852064aad944b90d3a4351`;
neither run rejected checksums or exhausted its checksum budget. This is exact
source-admission parity, not a fresh full conversion or navigation approval.
The existing sealed conversion and all held stair gates are unchanged.
