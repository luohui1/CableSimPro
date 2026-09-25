# Electrothermal reference — explicit losses, temperature feedback, current bracket

Incremental branch from c699992 (PR #23). One PluginService, project store, catalog,
permission/lock model and artifact API. The new first-party adapter has a fixed
host-owned worker entry; unrelated adapters retain their existing bytes, versions
and digests. The new inert JSON record under plugins/releases is combined with
the legacy registry by the same Catalog, including global duplicate-ID/command
checks. It is not another runtime or an external package installer. Nothing is installed or imported from an arbitrary manifest path.

## Inputs and physical scope

Three identical single-core six-layer cables and homogeneous soil. The existing
Gmsh 19-domain mesh and scikit-fem P1 thermal assembly are reused. Each material's
thermal conductivity is constant. Ground, sides and bottom are all at the saved
ambient temperature, with the same finite-domain S=4/8/16 and mesh16/24/32 options.

The project **must contain an explicit R20 in ohm/km**. Unlike the legacy demo,
this plugin never estimates R20 from area or material resistivity. The saved
Scenario supplies RMS conductor-to-screen U0 (kV), frequency, relative permittivity,
tan-delta, AC-extra factor, screen-loss factor, temperature limit and operating
current. Arguments supply alpha20 (/K), the two metal conductivities and a mandatory
human-written coefficient-basis note. A separate acknowledgement is required.
These are user declarations, not authenticated approval or manufacturer certification.

With mean conductor temperature Tc,j, define:

- Rac,j [ohm/m] = R20 [ohm/km]/1000 * (1 + ac_extra) * (1 + alpha20*(Tc,j - 20)).
- Pc,j [W/m] = I² * Rac,j, uniform over the equivalent conductor domain.
- Ps,j [W/m] = screen_loss_factor * Pc,j, uniform over the metal-screen domain.
- C [F/m] = 2*pi*epsilon0*epsilon_r / log(r_insulation_outer/r_insulation_inner).
- Pd,j [W/m] = 2*pi*f*C*(1000*U0)²*tan_delta, distributed proportionally to 1/r²
  in that phase's insulation, normalized to the declared total on the polygon mesh.

U0 is already phase-to-screen RMS voltage: do **not** divide by sqrt(3). All three
loss components enter their own physical layers. The fixed screen ratio does NOT
model induced screen current or its resistance/temperature feedback; skin/proximity
and bonding-dependent loss factors are NOT calculated. No armouring, soil drying,
backfill, ducts, contact resistance, axial conduction, load history or thermal
property nonlinearity is included. This is not complete IEC60287 or EM FEM.

Resistance uses the **area-average** conductor temperature. The temperature limit
uses the **maximum conductor nodal temperature**. This distinction is included in
results and verified from the field. Individual strands and current redistribution
inside a nonisothermal conductor are not resolved.

## Computation and why the reduced feedback is exact for this model

Let A be the thermal FEM matrix, B the nine normalized source vectors, and U=A⁻¹B
on free DOFs. These nine real FEM solutions are not an imported thermal-network
approximation. Define Ueff=Uconductor + lambda*Uscreen and u0=Pd*sum(Udielectric).
With conductor averaging weights Bc, H=Bcᵀ Ueff and t0=Bcᵀ u0. For balanced current,
g=I²*R20ac and the three conductor powers satisfy:

    (identity - g*alpha20*H) p = g * (1 + alpha20*(Ta + t0 - 20)).

For constant thermal conductivities and the stated linear mean-temperature
resistance law, this is an exact elimination of the full discrete thermal problem,
not a surrogate fit. Every accepted final state also runs a bounded Picard feedback
iteration and cross-checks its power with the small-system solution. The native
suite independently iterates the **full sparse thermal system**, without using H,
and compares all nodal temperatures.

Reject negative/nonfinite solutions and feedback spectral radius >=1-1e-8. A
failed final Picard check never becomes success. The residual from A*u-B*p is
reported at free DOFs and summed at Dirichlet boundaries. This is a discrete
reaction-based energy check, not independently measured heat flux.

## Two explicit operations

**operating-point:** uses Scenario.operating_current_a. It may report an over-limit
state up to150°C, but `ampacity_a` is null. Higher accepted-point temperatures
are rejected as outside this reference model's declared range. Zero current still includes dielectric heating
when voltage and tan-delta are nonzero. No fabricated all-zero loss assumption.

**ampacity:** finds the common phase current at which the hottest conductor reaches
the saved limit. Bracket between zero current and a stable high trial, bounded by
maximum_search_current_a (default3000A). Reject a zero-current over-limit state,
unbracketed interval, unstable feedback or nonconvergence. Bisection returns the
*feasible lower endpoint*, not an arbitrary last iterate. Both endpoints, trial
history, <=0.01A bracket width and <=0.005K lower-end temperature shortfall are saved.
These tolerances describe the numerical root, NOT the accuracy of the physical model.

## Domain comparison is not an error certificate

An optional strictly larger domain is remeshed and independently solved at the same
mesh setting and electrical inputs. It has its own inverse current, bracket, field,
mesh and iteration evidence. Report the pairwise current change and the larger-domain
peak at the original current. Both remain bound to the same saved Scenario.

`within_pairwise_tolerance` only compares two numbers against a user-selected drift
threshold (default0.5%). `mesh_independence_certified` and
`infinite_domain_accuracy_certified` are always false. The primary ampacity is NOT
silently replaced with the comparison result. A small pairwise change alone is
not a bound on remaining truncation error. Nor does this run establish mesh
independence, experimental accuracy, regulatory compliance or a production rating.

## Artifacts and failure boundaries

Primary: buried.msh, field.json (existing buried-field/1), temperature.vtu,
thermal.json (new electrothermal-reference/1), iteration.json. Optional:
comparison.msh, comparison-field.json, comparison.json. VTU/JSON nodal values agree.
File length/SHA-256 are checked by host and field viewer. Before persisting success,
the host verifies R(T), I²R, screen/dielectric losses, total heat, electrical input
binding, field means/peaks, boundary temperature, domain extents, root bracket and
comparison binding. Missing or incorrect evidence fails rather than silently
falling back to the previous solver.

The host does not modify project parameters or automatically promote this result
to its existing ampacity run. No separate project DB, global navigation or third-party
remote-code loader is introduced. A fixed process is fault isolation, not OS sandboxing.

## Reproduction

Use a separate environment. Install backend requirements and optionally only
`plugins/requirements-electrothermal.txt` (full CAD environment not required for this
new plugin). The full regression workflow still tests Windows CAD clean exits.

    python scripts/plugin_sdk.py verify
    python scripts/seal_plugin_catalog.py
    python -m pytest plugin-tests/test_electrothermal.py
    cd frontend
    npx playwright test --config=playwright.electrothermal.config.ts

Numerical examples use explicitly labelled synthetic test inputs, not manufacturer
records. Exact source SHA, platform environment, JUnit and browser screenshots
accompany CI evidence. Local Python3.13 numerical tests do not replace Windows or
pinned-host acceptance.

## Primary technical references (checked during this increment)

- COMSOL, Submarine Cable6—Thermal Effects: distinguishes temperature-dependent
  phase resistance from fully coupled electromagnetic heating and screen behavior.
  https://doc.comsol.com/6.4/doc/com.comsol.help.models.acdc.submarine_cable_06_thermal_effects/submarine_cable_06_thermal_effects.html
- scikit-fem how-to/assembly: https://scikit-fem.readthedocs.io/en/latest/howto.html
- IEC60287-1-1:2023 scope (not a license or implemented-formula certification):
  https://webstore.iec.ch/en/publication/68118
- QuickField dielectric-loss example, voltage RMS/amplitude distinction:
  https://quickfield.com/advanced/cable_dielectric_losses.htm

The reduction, validation rules and solver acceptance thresholds above are our
implementation choices. None of these upstream projects certifies this adapter.
