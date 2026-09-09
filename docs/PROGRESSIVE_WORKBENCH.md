# Progressive workbench · approved five-screen direction

This increment starts at `0f39d7641f86296314d112a79b527ee9b3c9100c` on PR #19.
The five approved mockups define layout and visual direction, not implemented engineering scope.
Their 220 kV submarine/armoured labels, example values, invented pass states, percentage margins,
and estimated scan duration are **not** product data and are not copied into the application.
The screenshot review board generated earlier is also not a pixel-faithful test artifact.
Browser captures for this implementation are produced by Playwright, without image regeneration.

## One real workspace, progressively exposed functions

- The shared StudioProvider, server workspace, revision, drafts, locks, output evidence and approvals remain unchanged.
- EnterpriseWorkbench retains the existing non-embedded enterprise regression surface; only its default embedded layout changes.
- A single command bar owns project selection, revision, saved/draft state, search, mode switching and calculation.
- A 72 px navigation rail and compact inspector give the real model more space. The six-layer comparison diagram is optional.
- Only the first parameter group opens by default. Existing Property components still edit, validate and lock data. Closed groups keep fields mounted.
- A stationary click on a visible model mesh opens its relevant parameter group. OrbitControls drags do not inspect or write. Keyboard inspection is available from the layer menu. The raycaster does not pick hidden layers or the studio floor.
- Four real, revision-bound metrics remain in the result ribbon. Analysis is opt-in; radial curves, result tables, sweep study and run evidence live in its drawer. No chart or baseline value is invented before solving.
- The project center lists actual saved workspaces and exposes products, documents, methods and run history. It has no fictitious team members, shared projects or activity.

## Command catalog

27 registered actions share availability predicates and dispatch to the existing workspace handlers.
Search supports Chinese, documented pinyin aliases and English keywords; this is not arbitrary semantic search.
Disabled commands remain discoverable with a reason. Busy, draft, undo, calculation-domain and current-result requirements are rechecked by the workspace owner immediately before dispatch.
Ctrl/Command + K opens the command center in professional mode only. Agent mode retains its existing composer shortcut.
The dialog supports arrow selection, Enter, Escape, focus return and IME composition handling. The palette never executes hidden DOM buttons.
Recent and favourite command IDs are browser-local, allowlisted, bounded to eight and tolerate unavailable/corrupt storage.
The four sweep commands prepare **explicit suggested points in an editable Agent draft**. They do not plan, approve, solve, or change the workspace on selection. Users still review conditions and approve the existing plan.

## Visual assets and token boundaries

No new image is needed for the shell, command search, parameter controls or numerical displays. The existing real-time copper/insulation/jacket model remains the visual focus.
New shell dimensions and overlay depth are registered in tokens.json; generated CSS is checked for drift.
No runtime image/font CDN or bundled font files were added. Existing decorative asset provenance is retained.
The UI is not a full-page background image. The material display and six-layer engineering GLB export remain separate.

## Validation

- Local production TypeScript/Vite build passes with the existing chunk-size warning retained.
- Local backend run: 243 tests passed. The backend source is unchanged.
- 54 command-catalog checks cover discovery, normalization, every guarded command, unknown capabilities, preference corruption and bounds.
- Existing 35 output-evidence, 40 sweep-study, token checks, 18 geometry configurations, 5 optical contracts and 7 ruler-scale checks retained.
- Six additional real-backend desktop cases cover layout, palette/accessibility, keyboard/IME and draft guards, explicit sweep handoff, object inspection/analysis evidence, real workspace listing and narrow viewports.
- Existing workbench layout assertions are migrated to opening the optional comparison and analysis. Numeric, export, draft, lock and canvas retention checks remain; no timeout/retry increases or removed cases.
- Full project inventory: Chromium 94, WebKit 94, mobile WebKit 11, four Windows projects 67 each. The strict 12-shard report gate remains.
- The local browser is blocked from localhost by administrator policy. That restriction was not bypassed. Real screenshots and browser acceptance must come from the exact submitted commit's GitHub Actions.
- Baseline full run 206 / 34309916950 failed; this UI increment does not claim to fix every historical Windows timing issue. The PR remains draft until its current-head checks are reviewed.

## Implementation references (checked 2026-09-09)

React, preserving component state through stable tree positions:
https://react.dev/learn/preserving-and-resetting-state

Radix Dialog, focus management and keyboard interaction:
https://www.radix-ui.com/primitives/docs/components/dialog

W3C WAI-ARIA APG, combobox/listbox semantics and active descendant:
https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

These references support UI implementation choices; they are not engineering model certification.
