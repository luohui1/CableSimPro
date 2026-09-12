# Half-space line-source cross-check for fixed-power buried FEM

This increment adds `cablesim.line-source-crosscheck@0.1.0` without changing the
existing buried or electrothermal release bytes. It is a validation-category plugin
that consumes the **newest successful, current-revision** `cablesim.buried-reference@0.1.0`
job. The v0.1 UI has no arbitrary job/file selector; the exact chosen job ID is sealed in the result. It does not accept arbitrary files, another project, a stale source snapshot or
an electrothermal/ampacity job.

## Independent equation family

For three line sources at `(x_j, y_j)` in homogeneous semi-infinite soil with an
isothermal ground plane at `y=0`, the method-of-images coefficient from source `j`
to cable `i` is

`G_ij = rho_soil/(2*pi) * ln(r_image / r_real)`.

`r_image = sqrt((x_i-x_j)^2 + (y_i+y_j)^2)`. For different cables,
`r_real` is their center distance; for the self term, it is the cable jacket outer
radius. Each cable's own center-to-jacket rise adds

`R_internal = 1/(4*pi*k_conductor) + sum[ln(r_o/r_i)/(2*pi*k_layer)]`

through the five outer material layers. The analytical conductor-center temperature
is therefore

`T_i = T_ambient + q_i*R_internal + sum_j(G_ij*q_j)`.

This calculation shares the saved dimensions, material constants, positions, soil
thermal resistivity and explicit W/m sources, but it does **not** share the FEM weak
form, sparse assembly or solution. It is consequently useful as an independent
equation-family check, not as experimental validation.

## Why a difference is expected

The FEM source job uses a finite rectangle with ambient-temperature ground, side and
bottom boundaries and polygonal interfaces. The analytical model has only an
isothermal ground plane and an otherwise infinite soil half-space, and represents
each cable externally as a line source. Its internal cable resistance remains a
circular six-layer solution. Reported FEM-minus-analytical differences therefore
combine at least:

- finite side/bottom truncation in the FEM domain;
- line-source and circular-interface approximations in the analytical reference;
- polygonal geometry and P1 mesh discretization;
- numerical rounding and source integration.

There is deliberately no built-in pass/fail tolerance. Expanding the FEM soil box
should normally reduce artificial cooling if truncation dominates, but a decreasing
difference does not prove infinite-domain accuracy, mesh independence, material
accuracy or compliance.

## Provenance and fail-closed behavior

The host copies only the source job's sealed `thermal.json` and a bounded metadata
record containing its exact plugin pin, command, arguments, project revision and
snapshot digest. The worker recalculates the comparison from the current saved
Scenario and CircularRecipe. It rejects changed powers, domain scale, resolution,
ambient temperature, soil conductivity, geometry, plugin identity or source command.
The resulting `line-source.json` is hashed like every other project artifact.

The UI shows phase-by-phase source heat, FEM peak, analytical center temperature,
difference, the external resistance matrix and the finite-domain dimensions. It
never promotes the report to the host ampacity result and labels the absence of an
engineering acceptance threshold.

## Evidence gate

`Line-source cross-check evidence` runs:

- the full host regression suite and checked-in schema/integrity checks;
- real Gmsh/scikit-fem buried sources at domain scales 4, 8 and 16 on Linux and
  Windows, checking that this fixture approaches the unchanged half-space result;
- the actual install/enable/source/invoke/download chain, cross-project and stale
  source rejection, and no engineering revision change;
- a production frontend build and Chromium interaction/screenshot/accessibility
  test using a real source job.

The default synthetic fixture is not manufacturer data or a published cable rating.
Exact numerical claims must cite an exact commit and its workflow artifacts.
