# White Workbench implementation

Visual reference: the conversation's 电缆工程分析专业工作台.png, generation 5cccfcbd-6095-4385-802b-f6e8eabbed88. This is a visual reference, NOT an engineering data source. No 220 kV offshore scenario, armour, invented 542.9 A, safety percentage or compliance statement is copied from the design image.

## Token and component handoff

`frontend/src/design-system/tokens.json` is the single editable token source. `node scripts/build_design_tokens.mjs` generates scoped tokens.css. The --check mode prevents drift. Tokens cover pure white canvas, semantic text/surface colors, typography, spacing, radii, shadows, control heights, layout widths and focus treatment.

`primitives.tsx` supplies native Button, Badge, MetricTile and labelled Panel components used by the actual workbench. `professional/WorkbenchChrome.tsx` supplies navigation, collapsible context, results, analysis and evidence components. `LayerDiagram.tsx` renders the current six-layer cable geometry, not a generated cable photograph. No font binaries or external font CDN are included.

## Professional mode only

The existing `mode=workbench` adds `.white-workbench`. The Agent remains `mode=agent`, sharing the same StudioProvider and mounted model; it is not renamed to a nonexistent research mode.

One navigation rail replaces duplicated navigation blocks. The project card opens saved projects. Undo, save-as, real report export, model generation and calculation stay available. Existing model/selection/document shortcuts move into an expandable menu, not dead buttons. Repeated global metrics move to an expandable input/status row; uncommitted input warnings and actual calculation guards remain visible/effective.

The main stage has a retained WebGL model and a live cross-section. Narrow screens retain the full 2D view even when the quick side preview is omitted. Mobile parameters flow below the stage and navigation becomes a drawer.

The inspector groups the SAME original Property fields, locks, drafts and commit validation. The four result tiles use current-run outputs only: ampacity A; operating maximum temperature °C; temperature headroom K; three-phase total circuit loss kW for the stated length. Headroom is not a safety percentage. The radial chart uses an existing operating radial profile. Missing or stale results stay unavailable; no numbers from the design image are used.

## Assets

The localized WebP is a small text-free scenery crop of the provided approved design, used only for the header and sidebar. Its source image SHA, generation reference, crop rectangle, processing and output SHA are in `public/engineering/white-workbench/manifest.json`. Empty alt text and white fallback make artwork failure independent of editing/calculation.

Grok-image was actually called for a decorative asset during implementation, but returned `FORBIDDEN: This conversation does not support developer MCPs`. This asset is therefore not claimed as a new Grok generation. Replacing this decorative file later does not change the component/data contract.

## Verification and boundaries

`test_design_tokens.mjs` checks generated-token consistency, 14 color pairs at 4.5:1 and the asset checksum. This is not a full accessibility certification. `white-workbench.spec.ts` exercises real white surfaces, four empty initial metrics, grouped controls, real solver results, radial chart, actual report download, retained model across modes, drafts, saved edits, locks, 1366/390 px operation with broken artwork, and axe against the actual page.

Existing pulse tests open the new disclosure before asserting the SAME original states/actions. Mode-switch tests read the relocated ampacity tile instead of its old DOM position. No old behavior checks are removed. Five new desktop cases raise full-matrix counts to Chromium/WebKit 84 each and four Windows projects 57 each; mobile-webkit remains 11. Twelve reports and no failures/errors/skips/duplicates are still required.

Local TypeScript/Vite build, 243 Python regressions and existing result/readiness/sweep selector checks passed before integration. Local Chromium blocked localhost with ERR_BLOCKED_BY_ADMINISTRATOR; its policy was not changed. Real-browser verification and screenshots are obtained through Actions. Previous Windows timing failures are not fixed or hidden by the visual redesign. Actual final acceptance is tied to the fixed source commit in the Actions artifact, not this document's prose.

Primary references: https://react.dev/learn/preserving-and-resetting-state and https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html . They support UI implementation choices, not solver certification.
