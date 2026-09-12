# Electrothermal coefficient-loss reference and temperature-limit current

This increment adds `cablesim.electrothermal-reference@0.1.0` on top of the existing
19-domain cable/soil FEM. It reuses the same project snapshot, `CircularRecipe`,
plugin lock, worker boundary and immutable artifacts. It does **not** replace the
host ampacity result, and it does not claim a complete IEC 60287 or electromagnetic
field implementation.

## Required inputs and declared equations

The saved project must contain an explicit conductor resistance at 20 °C, `R20`, in
Ω/km. Missing `R20` is a hard error; area/material fallback is deliberately disabled.
The study also requires a temperature coefficient `alpha20`, conductor and metallic
screen thermal conductivities, and a human-readable source/assumption note. The user
must explicitly acknowledge that the AC and screen-loss coefficients are a specified
coefficient model rather than a solved electromagnetic/bonding model.

For phase `j`, using the **area-average conductor temperature** `Tmean,j`:

```
Rac,j(T) = R20 * (1 + ac_extra_factor) * (1 + alpha20 * (Tmean,j - 20))
Pc,j     = I² * Rac,j(T) / 1000
Ps,j     = screen_loss_factor * Pc,j
```

The engineering limit is checked against the **maximum conductor node temperature**,
not the mean. The distinction is stored in the result and evidence.

The dielectric heat per phase is:

```
C  = 2*pi*eps0*epsr / ln(r_insulation_outer / r_insulation_inner)
Wd = 2*pi*f*C*U0²*tan_delta
```

`U0` is the saved conductor-to-screen RMS voltage. Dielectric source density is
proportional to `1/r²` in each insulation domain and normalized so its integral is
exactly `Wd`. Conductor and screen sources are each normalized over their own domains.

## Thermal solve and feedback

Thermal conductivities and boundary conditions are constant. Nine unit-source FEM
responses are therefore solved once on the selected Gmsh mesh: three conductors,
three metallic screens and three insulation domains. Linear superposition then gives
the full field for any source vector in this declared model.

The three conductor losses are coupled through conductor mean temperatures. The
implementation solves the resulting three-by-three linear feedback system exactly,
then independently checks the accepted point with full fixed-point iterations. A
spectral-radius check rejects an unstable feedback state; a converged result stores
both the exact residual and the independent iteration trace.

Operating-point mode evaluates the saved project current. Ampacity mode brackets the
current at which the hottest conductor node reaches the saved temperature limit. The
reported current is the feasible lower endpoint; an over-limit upper witness is also
stored. The final bracket width is at most 0.01 A and the lower endpoint is within
0.005 K of the limit. Those numerical tolerances are root-finding tolerances, not a
claim of engineering accuracy.

## Finite soil domain and comparison

The thermal domain remains a finite rectangle with ground, sides and bottom fixed at
the project ambient temperature. The user may request a second ampacity solve on a
larger domain. The result reports both currents, the larger-domain temperature at the
primary current and their percentage difference.

A pairwise difference inside a user-set tolerance does **not** certify an infinite
soil boundary or mesh independence. Both certification flags are hard-coded false.
A real release decision requires a separate mesh/domain study and an acceptance
criterion appropriate to that decision.

## Scope exclusions

The adapter does not solve skin/proximity effects, bonding or circulating currents,
metallic-screen electromagnetic fields, soil drying, contact resistance, ducts,
backfill zones, transient loading or a complete standard clause set. `ac_extra_factor`
and `screen_loss_factor` come from the saved project input. The study result is never
promoted into the host's current ampacity result automatically.

## Artifacts and verification

Primary outputs are `buried.msh`, `temperature.vtu`, `field.json`, `thermal.json` and
`iteration.json`. A requested larger-domain comparison adds its mesh, field and JSON
record. Before success, the host verifies:

- plugin/project lock, exact input snapshot and explicit `R20`;
- field topology, 19 semantic domains, boundary nodes, units and finite values;
- conductor mean/peak temperatures against the field;
- resistance, conductor/screen/dielectric loss equations;
- source sum, Dirichlet reaction heat and free-equation residual;
- root bracket, feedback residual, input binding and optional domain comparison.

The browser rechecks file length and SHA-256 before rendering the field. View changes
and mesh overlays do not call the solver.

## Reproduce

```sh
python -m pip install -r backend/requirements-dev.txt \
  -r plugins/requirements-native.txt \
  -r plugins/requirements-electrothermal.txt
python scripts/plugin_sdk.py verify
python scripts/seal_plugin_catalog.py
python -m pytest plugin-tests/test_electrothermal.py
```

All numerical claims must be tied to an exact commit, environment record, JUnit and
artifacts from the dedicated Linux/Windows CI. Synthetic regression coefficients are
not manufacturer data or an approved product rating.
