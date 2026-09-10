# PC Studio R3 — implementation contract

User-directed broad PC refinement replaces the former fixed 1586×992 image-coordinate
layout. The approved white/engineering visual language remains; the old 82px command
bar, 85px rail and 144px result strip are not the new acceptance targets.

## Ownership

- `design-system/tokens.json`: shared tokens plus explicit PC geometry budgets.
- `professional/pc-studio.css`: current PC shell, model, inspector, analysis, domains,
  asset collection and Agent presentation. The default route no longer imports
  workbench-layout, industrial-surfaces, progressive-workbench, reference-workbench,
  or reference-visual-acceptance. Shared primitive and legacy entrypoint styles remain.
- `WorkspaceHeader`, `WorkspacePage`, `ScrollRegion`, `SurfaceNotice`: reusable
  layout/accessibility components; own no engineering state or API side effects.
- `ComponentGallery`: an on-demand specimen using actual shared components, not
  fabricated product assets or solved values; searchable via `components`.

## Geometry and interaction

At PC widths above 1100px the command bar is 60px, rail 64px, inspector 312px,
result summary 76px and footer 32px. Main canvas consumes the remaining height.
Only one primary compute button is visible, in the command bar. Secondary project
commands are grouped in one menu. Permanent brand/tagline and duplicate page copy
are reduced; safety, units, validity and unsaved-input information remain accessible.

Inspector categories now show their own field groups instead of rendering all
categories behind a decorative tab bar. Draft values remain in `StudioState`.
Asset, document, product, field, selection, history and settings pages use a dedicated
workspace without a permanently visible calculation ribbon.

Analysis is presentation state: summary, split, full. Split is promoted to full when
height <900px or width <1100px. Full analysis hides rather than remounts the model.
Closing returns to the same canvas. Preferences never become solver inputs.

Asset text details use a named focusable native scroll region. Existing Radix modal
focus trapping and close semantics remain intact. No new package, remote font,
stock product record, solver, authentication model or numerical claim is introduced.

## Validation

`test_pc_layout.mjs` checks policy boundaries, import ownership and budget tokens.
`pc-studio.spec.ts` checks actual geometry at 1600×1000 and 1366×768, no document
scroll/overlap, explicit parameter categories, version preservation, real solve evidence,
retained canvas, responsive analysis mode, all major module navigation, component
specimens and manual Agent review. Existing asset/preflight API-backed browser cases
run alongside it on Chromium and WebKit with no retries.

Historical full-suite visual assertions still describe earlier layouts. They are not
silently skipped or treated as proof of R3 acceptance. A migration of those visual
fixtures must explicitly preserve their functional checks and tie targets to the new
accepted design. No full-cross-platform green claim follows from this focused lane.

References for component behavior: W3C WAI-ARIA APG Tabs Pattern and Radix Dialog
documentation (reviewed 2026-09-10). Collection controls continue using installed
TanStack Table; no new full-site template or second design-system dependency.
