# Cable editor refinement — actual application, not a generated page

Based on PR #27 at `a89d6629027b3d90474d5cfe067d0664e5c1adc6`. Continue in the same
`design/professional-engineering-v1` branch and `/?workflow=1` entry. No main merge,
backend schema, formula, package dependency or plugin contract changes.

## Changes

- Extracted the real context inspector into `ObjectInspector`: object-specific groups,
  collapsible without unmounting drafts; geometry summary still comes from the saved
  backend recipe. Locking, validation and atomic save use the existing Studio state.
- Reused the existing approved AI brand crop, plus six display swatches from the
  independent design-system Alpha.5. No newly generated full-page image is included.
- Kept restrained silver-white surfaces, blue selected states and copper on conductors;
  restored the brand and compact material icons instead of adding a second asset menu.
- Rendered the real Three.js toolbar through a portal into the active document strip.
  No extra always-visible toolbar is stacked above the canvas. View/appearance options
  do not issue engineering mutations or solve requests.
- Controlled selection now reaches the live renderer. The selected rim is a scene-only
  object and is excluded from GLB export, numerical geometry and camera fitting.
- The refined workflow uses a **240 mm presentation sample**, while legacy callers keep
  their existing 360 mm default. Both preserve the engineering radii. The export uses
  the same presentation length and explicitly records `not_route_length=true`; it is
  not the installed circuit length. Strands remain illustrative, not manufacturing lay.
- Stronger axonometric framing and envelope fitting replace the long thin side-on view.
  Existing smooth material presets reduce exaggerated microrelief. A lighter shadow
  catcher and a 2048 map are used only by this opt-in rendering mode.

## Asset origin

`brand.webp` is unchanged from `approved-kit-baseline.zip`, `dist/engineering-kit/brand.webp`.
The six `material-*.svg` files derive from `CableDesignSystem-v0.1.0-alpha.5.zip`,
`CableDesignSystem/build/studio-assets/`. Fine-grain repeated strokes were removed for
small-size use; silhouettes, gradient palettes and shadows were retained. These are
visual identifiers only, not certified material properties. No font binaries or third-party
proprietary assets are included. See `frontend/public/workbench-assets/provenance.json`.

## Verification and limits

The existing 35 browser regressions stay in the gate. Two additional tests cover group
folding/draft retention, asset loading, real WebGL, single-toolbar placement, controlled
selection, sample length, six exported radii, excluded optical objects, retained canvas
identity, read-only display changes and desktop-sized viewports. Tests never replace
WebGL with a picture when WebGL is unavailable. The same full backend suite is retained.

Local Chromium cannot create a WebGL context in this container. Local non-WebGL tests
and screenshots do not certify the 3D changes; use the exact committed CI artifacts for
that verification. Screenshots use test workspaces, not a real manufacturer's design.
No claim of pixel-perfect reproduction, native Windows multi-monitor certification or
finished product-wide migration is made.
