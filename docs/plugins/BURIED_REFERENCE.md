# Three-cable + homogeneous-soil thermal reference

This increment reuses `backend/plugins`, the existing saved `Scenario`, the R2
`CircularRecipe`, project locks and immutable job artifacts. It adds
`cablesim.buried-reference@0.1.0` / `skfem.buried-reference`. It does not add another
plugin runtime, CAD data model or database. The unchanged six-domain radial field
keeps `cablesim.thermal-field/1`; the 19-domain field has the separate additive
`cablesim.buried-field/1` contract.

## Exact physical problem

Three identical six-layer single-core cables, flat or trefoil, invariant along the
axis. Each conductor has an independently specified nonnegative **power per unit
length** in W/m. Each material is isotropic with constant thermal conductivity.
Solve `-div(k grad(T)) = Q` using an interface-conforming Gmsh mesh and P1 triangular
finite elements in scikit-fem. The conductor's equivalent radius follows the saved
fill factor; individual strands are not resolved. The source is normalized over
each polygonal conductor domain so its integral equals the specified W/m.

There are eighteen cable material domains (six per phase) and one homogeneous soil
domain. Domain IDs, semantic layer UIDs and phase labels are explicit. Geometry,
spacing, arrangement, average center depth, ambient temperature and material
resistivities come from the committed project snapshot. Metal conductivities and
three phase powers are mandatory research arguments. The UI currently exposes
**equal power in each phase**; the API supports unequal powers. No power or metal
conductivity is prefilled as manufacturer-certified data.

Coordinates are metres; positive y is depth. Ground is y=0. Define
`L=max(max(phase_depths), max(abs(phase_x))+cable_outer_radius)` and the finite box
`x in [-S*L,S*L], y in [0,S*L]`, with S=4,8,16. Ground, left, right and bottom are
Dirichlet boundaries at the project's ambient temperature. This is a finite
approximation, **not an infinite-soil boundary**. No convection, radiation,
backfill/ducts, soil drying, contact resistance, distributed screen/dielectric
losses, electrical loss calculation, temperature-dependent resistance or ampacity
inversion are included. `ampacity_a` is always null; no current result is promoted.

## Numerical and artifact checks

The rectangular boundary is recovered independently from mesh connectivity and
must match the declared boundary nodes. Internal material interfaces must share
nodes; holes, degenerate/duplicate triangles, unused nodes and nonmanifold edges
are rejected. Fields are absolute kelvin with nodal association. The new bounded
contract allows at most 100,000 nodes / 200,000 triangles; the host retains its
32 MiB per-file ceiling and worker timeout. Exceeding limits is a failure, not an
automatic coarse-mesh fallback. The radial adapter's existing limits are unchanged.

The same assembly is exercised by a manufactured solution
`T=sin(pi*x)sin(pi*y)` with k=3 and `Q=6*pi^2*sin(pi*x)sin(pi*y)`, three mesh levels
and L2 convergence. Additional tests exercise zero power, power scaling, ambient
offset, unequal phase powers in trefoil, flat-arrangement symmetry, source heat,
Dirichlet reaction sum, free-equation residual and three resolutions.

The reaction sum checks **discrete energy balance**, not an independently measured
heat flux. Mesh and domain-size studies are recorded separately. In the initial
local default fixture, S=8 to S=16 changed the peak by about 0.228 K: it did **not**
meet an initially explored 0.2 K domain-insensitivity target. The published test
checks diminishing truncation influence and records all values; it does not label
this solution domain-independent or invent a precision certificate. Accuracy
requirements for a real engineering decision must be set and checked separately.

Host checks bind source powers, soil conductivity, ambient temperature, resolution,
geometry and domain setting to the saved invocation. `field.json` and
`temperature.vtu` use the same solved nodal values. Browser downloads verify the
file size and SHA-256 before rendering. Local/full-domain views and mesh overlays
only change display; they do not solve again. The color of an element is its three
nodal temperatures' mean. The local view is labelled as a crop, not as a computation
boundary. Both spatial axes use the same scale.

## Reproduce

Use a separate test environment and intentionally install the optional packages:

```sh
python -m pip install -r backend/requirements-dev.txt -r plugins/requirements-native.txt
python scripts/plugin_sdk.py verify
python scripts/seal_plugin_catalog.py
python -m pytest plugin-tests/test_native.py plugin-tests/test_cad_runtime.py plugin-tests/test_buried.py
```

The project plugin center exposes the new study. Installation only registers the
bundled first-party adapter. It never installs Python dependencies or changes the
project design. The previous plugin ecosystem/browser cases remain in the CI gate.
Final numerical claims are tied to exact source commits and CI artifacts; local
results do not stand in for Windows or production browser validation.
