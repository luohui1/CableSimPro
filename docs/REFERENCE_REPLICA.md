# Approved image implementation, not a new design direction

Reference: the first user-approved professional workbench concept. The exact image
SHA-256, source dimensions and manually measured landmark rectangles are recorded
in REFERENCE_LAYOUT.json. Source image dimensions are 1586 × 992; we do not claim
that the original was natively 2K. The image remains a design reference, not a
browser screenshot or proof of engineering validation.

## This increment

- 80px header, 84px rail, inspector aligned with the title, five equal work-view
  tabs, floating six-tool island, large studio viewport, unified result strip and
  one primary compute action at bottom right.
- The inspector retains every original field, unit, option, bound and nullability
  value, plus the original Property commit/draft/lock behavior. The display adapter
  lists groups together; it does not create another Scenario or StudioProvider.
- Model tree selection, visibility, GLB export, projection, material mode, zoom,
  context commands and analysis remain actual components and actions. The six-layer
  engineering export is not replaced by decorative geometry or an image plane.
- Camera and optical background change only presentation. No physical solver or
  saved input changes; no 220kV sea-cable scope, armour, fictional accounts, sample
  ratings, elapsed-time promises or compliance badges are copied from the mockup.
- LegacyEnterpriseWorkspace is a byte-for-byte retained c122d2a source blob for
  the old non-embedded entrypoints. Only the embedded professional presenter uses
  ReferenceWorkbench; state, APIs, reports and approvals remain shared.

## Checks

Four new browser cases run on Chromium and WebKit: measured layout landmarks,
real calculation and report download, model-tree/material/GLB/command interaction,
and 1366px/390px behavior. Screenshots are saved before layout assertions so a
failed check cannot conceal a visual defect. Numerical values are checked against
real responses, not the mockup. No retries or relaxed timeouts are introduced.

The full matrix retains every existing case and adds four per desktop project:
Chromium 98, WebKit 98, mobile-webkit 11, Windows projects 71 each. It still requires
12 complete, nonduplicated reports with no test failures, errors or skips.

Local production build and 243 backend tests passed before publication. Local
browser navigation is blocked by an administrator policy; no bypass is attempted.
Current-head browser acceptance must be read from the corresponding Actions run,
not inferred from build success. This increment is not a release or full-matrix
certification. Prior Windows long-tail failures remain a separate issue.

Implementation references: Three.js WebGLRenderer alpha/clear-color and official
MDN CSS Grid sizing documentation. No new CDN images, image-generative screenshot
repainting, or bundled font files are introduced.
