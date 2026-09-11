# Project plugin workspace and field artifacts — integration batch

Based on `dd3cec3978741d7e77d3d6d20e9e66c0a22b27d7` (PR #22), not on the
older visual branch. This continuation reuses **one** `backend/plugins` service,
`plugin-spec/` contract and `plugins/registry.json`. A parallel unpublished prototype
under `backend/plugin_system` was deliberately not merged; no second catalog, runtime
or cable schema is introduced.

## Implemented additions

- The project command center and Resources menu open the same plugin center in an
  on-demand dialog. It stays inside the existing StudioProvider and preserves its
  canvas, selection and input drafts. The standalone `/?plugins=1` entry still works.
- Project ID is locked to the active project in the dialog. Unsubmitted/invalid
  parameters and host operations block plugin execution and project enable/disable.
  Opening, searching or closing does not generate a run or approve anything.
- A real solved field is now an additional `field.json` artifact, with metres,
  absolute kelvin, nodal association, indexed triangles and per-cell domain IDs.
  It is exported from the same solution used for `temperature.vtu`, not recomputed.
- The host validates mesh, units, counts, nonfinite values and peak-temperature
  consistency before a job can succeed. Browser downloads verify the declared
  size and SHA-256 before rendering; failed checks show an error, not a field.
- A compact result panel displays temperature/analytic-reference/energy residual
  and the actual field. Optional mesh overlay is a display-only operation, with no
  new solver POST. Raw JSON and runtime evidence remain folded under details.
- Changing any research argument invalidates the current result panel. A new
  explicit run is required; historical artifacts remain downloadable.
- Enabling a new release cannot silently replace an older project pin. The user
  must explicitly review and disable the old locked chain before enabling a new one.

## Versions and scope

The five native bundled adapters move from `0.1.0` to `0.1.1` because their shared
adapter payload changes; dependency pins move together. Core facades remain `0.1.0`.
Plugin manifest/project-lock protocol stays API 1 / spec 0.1: no incompatible schema
fork. Existing project pins are not rewritten during catalog discovery or install.
This preview still has one available release per catalog ID, not a complete
multi-version package store or automatic migration/rollback mechanism.

The thermal field remains **single-cable sectional heat conduction with fixed
jacket surface temperature and explicit conductor heat generation**. It is not
buried ampacity, electromagnetic coupling, a full IEC engine, or independent
experimental validation. `ampacity_a` remains null.

Canvas colors represent the arithmetic mean of three node temperatures per element;
all original nodal values remain in JSON. The renderer uses the same spatial scale
on both axes. It is a host-owned Canvas renderer, **not** an implemented vtk.js
plugin. The latter remains a clearly labeled roadmap item.

## Evidence gate

`Plugin workspace integration evidence` checks the full existing host test suite;
real CadQuery/Gmsh/meshio/scikit-fem/PyVista native operations on Linux and Windows;
VTU/JSON field equality and three mesh sizes; the previous three market browser
cases plus four project cases: canvas continuity, draft safety, real field rendering,
argument invalidation, keyboard isolation, accessibility and 390px layout.

Local environment permits only pure contract checks and source inspection. Full
application, build and native numerical claims must cite the exact Actions commit,
JUnit and actual screenshots. Added tests do not replace the old full UI matrix.
