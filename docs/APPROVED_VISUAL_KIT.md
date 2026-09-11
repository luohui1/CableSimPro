# Approved CableSimPro visual kit · first implementation

The five user-provided sheets are the visual source. This change is working UI code,
not a newly generated screen image. Silver surfaces, electric-blue controls and
copper cable/material subjects are applied to the existing shared workspace.

## Assets and components

- `frontend/public/engineering-kit/*.webp`: 20 individually extracted local subjects (about 21 KB total).
- `brand.webp`: larger crop of the approved C/cable brand subject.
- `manifest.json`: original sheet filenames/SHA-256, extraction coordinates, semantic indices and output hashes.
- `EngineeringIcon`: typed semantic registry, accessible labels when requested, decorative by default, local fallback on image failure.
- `BrandLogo`: actual brand crop with native product text.
- `KitButton`, `KitBadge`, `KitStatus`: native accessible controls/status primitives.
- `MaterialSummary`: saved-scenario copper/aluminium, XLPE and jacket data; no copied illustration numbers.
- `metal-studio.css`: scoped theme on `.metal-studio`. Legacy client layouts keep their own theme.

The original full reference sheets are not shipped to the browser. To reproduce
extraction, place the five original JPEG files named in the manifest in a folder,
then run `python scripts/extract_engineering_kit.py --sources FOLDER` (Pillow).
Material/field artwork is decorative only; it is not a manufacturer-certified model,
a numerical result, or an IEC compliance indicator.

## Applied surfaces

Brand and dual-mode toolbar; professional navigation and product summary; shared
Engineering Pulse readouts; cable/material summary; native parameter inputs;
model-view tabs; result tiles and tables; Agent navigation and task starters;
review buttons and stage indicators; ampacity diagnosis cards and loss/resistance bars.
Small utility affordances such as close, play and chevrons remain vector icons.

## Safety and verification

No solver, workspace store, approval semantics, parameter locks, source evidence,
result-freshness check or numerical chart data is changed. Source-sheet sample
values never enter state. The field illustration appears only as a navigation icon;
actual temperature fields and curves continue to use the existing result renderers.

`playwright.kit.config.ts` adds focused verification without removing any existing
CI cases: local asset loading/provenance, startup without writes, native parameter
editing, copper/aluminium icon switching, retained WebGL canvas, exact solver output,
stale/invalid-input protection, broken-image fallback, and mobile explicit approval.
Run with `npx playwright test --config=playwright.kit.config.ts` after a frontend build.
The existing Python/browser/Windows verification matrix remains unchanged.
