# Approved visual kit — native components, batch 2

Continues the original kit implementation at `99bac8f`, without replacing the five approved sheets with another generated screenshot.

## Additional extracted assets

Six 64 px transparent WebP subjects: locked, edit, database, resistance, error and lab. They total 6,368 bytes; together with the existing 20 images the kit is 27,444 bytes. `controls-manifest.json` records original source SHA-256, pixel bounds and individual image hashes. The first batch and its manifest remain unchanged. Run `python scripts/extract_engineering_controls.py --sources ORIGINAL_JPEG_FOLDER` to reproduce the image bytes. Run `python scripts/verify_engineering_kit.py` to check both batches.

## Working components

`KitMetric`, `KitLossBudget` and `KitTemperaturePath` render native text, units, SVG arcs and temperature proportions from the current result. The reference images supply only appearance. They do not supply engineering numbers, status or chart samples. The diagnostic drawer uses a native modal dialog, real tables, expandable evidence and the same manually approved study handoff.

The professional inspector's existing native inputs and unit plates are restyled in silver/blue. Their existing change, blur, Escape, lock, validation and persistence handlers are unchanged. This batch is not a new parameter editor or a new solver.

Operating temperature and margin remain unavailable when the operating solve is missing. The rating fallback in explanatory charts is explicitly labelled. The displayed state's hottest phase is distinct from the rating limiting phase. Run revision and current workspace revision are labelled separately.

## Verification

Five additional tests in `metal-components.spec.ts` join the original seven kit cases: source-byte verification; real edit/solve/chart linkage; 390 px native modal focus and overflow; image fallback recovery after material change; synthetic projection edge cases for missing operating results, zero loss and differing limiting/hottest phases. Synthetic fixtures are used only in the projection test, never presented as solver output. Existing full CI and approval tests are not removed or weakened. CI outcome must be checked at the new commit; this document does not assert that an unexecuted test has passed.
