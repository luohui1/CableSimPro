# Reference screenshot refinement — 2026-09-09

This increment continues from `d8eb256575a8c75538aff8e20f4f2fb3a51a12f6` on the existing PR #19 branch. The fixed approved image and its measurements remain in `REFERENCE_LAYOUT.json`. No new visual direction or generated replacement screenshot is introduced.

## Evidence read before editing

The exact-source reference artifact `10097387480` from run `34334603391` contains 8 browser executions, with 2 failures in the first landmark case. Actual title x was 105px instead of 104px. The inspector was at x=1181px instead of the target x=1196px. Inspection of both original PNGs and CSS showed an inherited model-column border and a reserved scrollbar gutter. The remaining 6 executions passed; that was not full visual acceptance.

Baseline compatibility artifact `10097596356` contains 42 executions with 2 errors: a retained test searched the old top navigation for the section button, which now lives in the model's view switcher. Its locator is migrated without removing the actual section, field, curve, one-invoke and canvas-retention assertions. The approved presenter shows dimensions by default, so the same case now checks visible/hidden/visible dimension toggling rather than assuming the old hidden default.

Baseline white-design artifact `10097681178` contains 30 executions with 1 failure in the existing material-export/edit case waiting for rev.2. This increment does not relax that wait or claim a root-cause fix for request latency.

## Actual changes

- Remove inherited column chrome and scrollbar reservation; keep the measured title, inspector, viewport and ribbon landmarks. Use existing layout tokens. Restore the intended bold title and keep native input/focus boundaries.
- Refine the six-tool island selection language, retaining actual actions. Complete-structure view stays discoverable in the model menu instead of creating a fourth permanent bottom view button.
- Adjust only the professional display's camera framing and optical presets. Reduce excessive polymer bump relief, soften the ground shadow, and keep geometry/export dimensions unchanged. Narrow or short viewports use a less aggressive camera fit.
- Add an orientation triad projected from the current camera quaternion, not a static pretend coordinate graphic. Rotation updates it; it is not exported as engineering geometry.
- Restore the reference's two temperature indicator tracks, calculated exclusively from the current run and the ambient-to-conductor-limit interval. They are not copied percentages or compliance checks. Missing or stale results have no tracks; raw numeric temperature margin is preserved, including negative values.
- Label the displayed voltage explicitly as U0, matching the actual input meaning.

## Verification boundary

The local source tree built successfully with the repository's pinned frontend dependencies. All 243 backend tests passed (1 dependency deprecation warning). The existing reference-input, command, output-evidence, sweep-comparison, token/asset and geometry/optical/tick checks passed. No backend or solver source changed.

The four reference browser cases retain all original assertions and additionally check exact inspector placement, no inherited border, title weight, camera triad, response-derived indicator values, and indicator invalidation after editing. No case is skipped or removed; timeouts, retries and full-matrix test counts are unchanged.

Local browser navigation is blocked by the environment administrator; no bypass is attempted. Current-commit Actions and their unmodified PNG/JUnit artifacts are required for browser acceptance. Previous-commit passes are not reused as current-commit certification. PR remains draft; no main merge or release is performed.
