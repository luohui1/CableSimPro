# Professional engineering workbench · design review 1

## Integration scope

Base: `integration/engineering-workflow-v1` at `a047f84e225a75e784f26a03b932147f066c9825`.
Review branch: `design/professional-engineering-v1`.
Entry: `/?workflow=1`, with optional `&project=<existing workspace UUID>`.
The existing root/legacy workbench and plugin host remain available. This is a change
inside the application, not another independent component lab. Main is not changed.

## Design decisions

Use neutral surfaces, a charcoal application header and one blue interaction accent.
The frame has a compact application bar, context commands, a model browser, actual
open documents, a contextual inspector and a small status bar. Copper appears in the
engineering graphic, not as decorative material on every control. Do not add fake
menu items, certification badges, project counts, computed fields or automatic progress.

- Home has one creation action and the actual saved-project list.
- Document tabs represent C-001, R-001 and specific saved runs, not component categories.
- Only the selected object's editable fields appear. Saved geometry and pending drafts
  remain distinct; zoom and dimensions are display state, never engineering changes.
- The section uses the backend's saved six-layer geometry recipe. Its conductor texture
  is illustrative, not an actual wire count or a manufacturing drawing.
- The installation figure reads the saved flat/trefoil arrangement and dimensions.
  Tiny cable markers have a minimum display size; this is not a temperature field.
- The result curve consumes the saved run's discrete curve samples; no image-generated
  field or additional numerical solution is used for display.
- The existing Three.js renderer is retained. Its existing WebGL-unavailable fallback
  remains honest; a blank or fallback frame cannot pass the WebGL regression.
- Search and focus mode are UI-only. Ctrl+K opens commands; Ctrl+S uses the existing
  atomic draft-save path. Running a study still requires explicit review in its document.
- The command dialog and document tabs have keyboard/focus behavior. Tab close controls
  are outside the ARIA tablist, fixing the baseline required-child violation.

UI state stays in the workflow components. No new engineering store, solver, component
framework, animation dependency, npm version change or backend endpoint is introduced.
The stylesheet is scoped to `.wf-root`, plus its own portalled command dialog.

## Design references (principles, not copied brand assets)

Official sources reviewed on 2026-09-22:
- COMSOL Desktop: Model Builder, node-specific Settings, Graphics and task/log areas.
  https://www.comsol.com/support/learning-center/article/Introduction-to-the-desktop-34131
- Autodesk Fusion interface: workspace-specific tools, browser and active document.
  https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GS-THE-FUSION-INTERFACE.htm
- Fluent 2: layout proximity and spacing, compact toolbar command grouping.
  https://fluent2.microsoft.design/layout
  https://fluent2.microsoft.design/components/web/react/core/toolbar/usage

Do not reuse COMSOL, Autodesk or Microsoft logos, icons, screenshots or proprietary
component code in the product. References inform hierarchy and restraint, not an
endorsement or an assertion of feature parity.

## Verification

Use the committed package lock and existing Python requirements:

```sh
python -m pip install -r backend/requirements-dev.txt
python scripts/plugin_sdk.py verify
python -m pytest
cd frontend
npm ci
npm run build
npx playwright install --with-deps --only-shell chromium
npx playwright test --config=playwright.workflow.config.ts
```

The review workflow retains all 29 existing workflow/legacy browser cases and adds
five professional-design cases. Checks cover real parameter saves, invalid drafts,
concurrent edits, run staleness, two-run comparison, historical HTML export, retained
WebGL canvases, keyboard focus, command safety, read-only display controls and layout
at 1920x1080, 1366x768, 1093x615 and 911x512 CSS pixels. The smaller sizes approximate
reduced desktop workspace; they are not a claim of native Windows DPI/multi-monitor
certification. Axe checks are automated coverage, not a complete accessibility audit.

No native CAD/FEM code changes are included. The study document still runs the existing
limited buried thermal-network method, not a complete IEC 60287 or FEM calculation.
Plugin management and the legacy Agent interface are retained, not fully restyled in
this pass. Screenshots and test counts must be reported against the final exact commit.
