# Engineering workflow integration / review baseline

Status: review candidate, not the default or a claim of completed product migration.
Integration branch: `integration/engineering-workflow-v1`.
Pinned engineering baseline: `c699992e268c89fd8c277b4305286666e99f5593`, tree
`5e1dcf4d67f2589ff68eced77f90a191087ffe05` (PR #23).
Source recovered from that commit's existing browser artifact and checked with
`git write-tree`. The original backend, plugin payloads and numerical methods are
unchanged. The separate electrothermal branch and CableDesignSystem Alpha.5 are
not silently merged. No component/animation Lab enters the production navigation.

## Entry and rollback

Build and launch the actual app; open `http://127.0.0.1:8000/?workflow=1`.
Opening with `&project=<workspace ID>` restores that saved project. To return to
the previous application, remove `workflow=1` (or use More → previous workbench).
This feature flag is for review and migration only, not a second product to expand
in parallel. Upon approval, migrate this shell into the regular entry in a separate
reviewed change and retire redundant navigation; do not keep two growing shells.

Existing project files, databases and saved runs must NOT be deleted. Use a separate
`CABLESIM_DB` for reviews/tests. Native CAD/FEM libraries are optional and unnecessary
for this first end-to-end slice. No model, approval, calculation or report is mocked.

```powershell
# Repository root, after fetching and switching to the integration branch.
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements-dev.txt
Set-Location frontend
npm ci
npm run build
Set-Location ..
# Choose a NEW review database; leave existing databases untouched.
$env:CABLESIM_DB = Join-Path (Get-Location) '.data\workflow-review.sqlite'
.\.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Single source and command ownership

- One StudioProvider, one Workspace, one server revision. No extra project store.
- The provider exposes additive `commitDraft(changes, expectedRevision)` and
  `exportSavedRun(runId)`. Both enter the existing command queue. Legacy callers
  and current-result export restrictions remain unchanged.
- Draft strings stay in the shared provider, across object/document selection.
  Their base revision is captured at first edit. Commit uses that exact revision;
  server CAS and complete Scenario/lock checks remain authoritative. No auto-rebase.
  Failed saves preserve drafts. Reading a new revision makes conflicts explicit;
  the user can inspect saved values, discard drafts, then re-enter a reconciled edit.
- Two-dimensional section radii come from the server's existing R2 preflight recipe.
  Three-dimensional presentation reuses CableModelView and the existing complete
  cable input, including fill factor. There is no imported Alpha.5 geometry formula.
  Existing Three.js context is retained through document/view switches and saves.
- Preflight is not a solver-validation certificate. This workflow additionally
  requires explicit saved R20, a buried method and per-revision scope acknowledgement.
  The existing coefficient-based thermal network is called through the same runtime.
  This slice does not promote the experimental electrothermal implementation or
  claim full IEC 60287, native FEM or certified manufacturer properties.
- Result documents fetch exact saved runs. Revision, input and design basis are
  compared before saying they match current inputs. Unsaved edits and historical
  runs remain visibly distinct. Reports pass the explicit run ID to reports.render;
  report filename includes the source revision and run ID. Export never recomputes.
- Browser storage contains only document IDs and the existing remembered workspace
  ID. It does not contain a second copy of engineering inputs or simulation results.

## Information architecture and approved scope

One initial document: C-001 (display alias for this single cable). The project tree
opens its layers, installation A, study R-001, and saved runs. Tabs are documents,
not a permanently open gallery of resources or developer components. Properties
change by object. Result inspection is read-only. A compact header replaces the
large intro; no duplicate material-strip selector, persistent task card wall, or
new ornamental animation. Existing plugins are managed on demand in the same session.
This does not create full multi-cable design object IDs or a recursive docking system.

## Review script / acceptance gates

1. Open a real project; only C-001 initially opens. Select insulation and jacket;
   confirm actual field sets differ and geometry matches the server recipe.
2. Enter invalid thickness, switch documents, verify retained drafts and blocked run.
   Submit a cross-field invalid arrangement; the whole change must be rejected.
3. Save valid input. Confirm server revision and geometry update; reload the page.
4. Change the server revision from another client while a draft exists. Saving must
   fail without overwriting. Refresh preserves the draft and shows the conflict.
5. Save explicit test R20, acknowledge method, solve. Change thickness, solve again,
   compare saved runs, and export the earlier run; its inputs must be unchanged.
6. Verify source, warnings, missing R20, locked fields, connection failure and resize.

Commands: `npm run build`; `npx playwright test --config=playwright.workflow.config.ts`;
`python -m pytest`. Tests use synthetic inputs and a separate database. Browser
fault injection simulates a failed connection only; no successful solver response
is substituted. Screenshots are review evidence, not yet user-approved visual
regression baselines. Smaller CSS viewports approximate desktop scaling pressure;
they are not actual Windows scaling, Safari, multi-window or long-session certification.

## Design-system extraction boundary

`workflow/fields.ts` is application metadata and input parsing, not a solver. Shared
controls use native controlled React fields; the appearance is isolated in one
scoped semantic-token stylesheet. Production behavior should be exercised here
before extracting stable CableDesignSystem React APIs. No new published packages,
icon counts or animation libraries are used as acceptance targets.

## Remaining gates

User review of structure/study/result screenshots; native target-device UX checks;
full old browser suite; conflict field-by-field merge (currently explicit discard /
re-enter); integrated renderer/selector synchronization beyond existing 3D picking;
final single default entry; production design-system distribution; independently
validated standard/FEM methods and PDF ReportEngine integration. HTML report export
is deliberately labelled HTML, not a completed PDF plugin.
