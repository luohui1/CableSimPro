# Engineering workflow shell

`frontend/src/workflow/WorkflowApp.tsx` is the only frontend shell (architecture D1).
`frontend/src/main.tsx` renders nothing else; there are no `?workflow`, `?classic`,
`?legacy`, `?enterprise`, `?plugins` or `?mode` entries. `?project=<workspace ID>`
reopens a saved project.

## Single source and command ownership

- One StudioProvider, one Workspace, one server revision. No extra project store.
- Draft strings stay in the shared provider across object/document selection. Their
  base revision is captured at first edit. `commitDraft(changes, expectedRevision)`
  uses that exact revision; server CAS and complete Scenario/lock checks remain
  authoritative. No auto-rebase. Failed saves preserve drafts. Reading a new revision
  makes conflicts explicit; the user discards drafts and re-enters a reconciled edit.
- Undo/redo move the saved history cursor and are disabled while drafts exist.
- Two-dimensional section radii come from the server's R2 preflight recipe.
  Three-dimensional presentation reuses CableModelView and the complete cable input.
- Preflight is not a solver-validation certificate. Running requires explicit saved
  R20, a buried design basis (or none) and a per-revision scope acknowledgement.
- Result documents fetch exact saved runs. Revision, input and design basis are
  compared before saying they match current inputs. Reports pass the explicit run ID
  to `reports.render`; the filename includes source revision and run ID. Export never
  recomputes.
- Browser storage contains only document IDs and the remembered workspace ID, never
  engineering inputs or results.

## Project input exchange

- Export (More → 导出已保存输入 JSON) writes the saved Scenario only: no history,
  runs, locks, sources or design basis. Disabled while drafts exist.
- Import (project home) is limited to 120 KB, validated by `/api/validate`, and always
  creates a new independent workspace. It never merges by name or overwrites a project.

## Design basis

The study document shows the recorded basis. Editing calls `standards.inspect`
(read-only) and then `standards.propose`, which stages a proposal. The basis changes
only when the user approves it in the review panel; approval does not change cable
inputs, material properties or formulas. Proposals from an older revision cannot be
approved.

## Paused capabilities

Retired together with the old shells; backend APIs, stored data and backend tests are
kept, and the UI can be restored from git history when re-scheduled (PRD §4.4):
document library/OCR, enterprise product versions, reverse selection, parameter sweeps,
asset library, vertical air and electric/magnetic field panels, agent task planning,
provenance journal, integration settings and project fork.

## Tests

`frontend/pro-e2e/`: Playwright projects `chromium` and `webkit` run the workflow specs;
`workflow-plugins` runs the plugin specs (needs `plugins/requirements-native.txt`);
`playwright.windows.config.ts` runs Windows 100/125/150 % and Edge scale checks. Tests
use synthetic inputs and `.data/pro-e2e.sqlite`. Fault injection only simulates failed
connections; no successful solver response is substituted.
